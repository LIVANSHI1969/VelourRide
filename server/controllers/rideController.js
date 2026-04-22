const Ride = require("../models/Ride");
const User = require("../models/User");

const SEARCHABLE_STATUSES = ["searching", "accepted", "arriving", "inProgress"];

const RIDE_PRICING = {
  bike: { base: 20, perKm: 8 },
  auto: { base: 30, perKm: 10 },
  standard: { base: 50, perKm: 12 },
  comfort: { base: 80, perKm: 18 },
  black: { base: 150, perKm: 28 },
  parcel: { base: 40, perKm: 15 },
};

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function normalizeCoords(value) {
  if (!value) return null;

  if (
    typeof value.lat === "number" &&
    typeof value.lng === "number"
  ) {
    return {
      lat: value.lat,
      lng: value.lng,
    };
  }

  if (
    value.coordinates &&
    typeof value.coordinates.lat === "number" &&
    typeof value.coordinates.lng === "number"
  ) {
    return {
      lat: value.coordinates.lat,
      lng: value.coordinates.lng,
    };
  }

  return null;
}

function normalizeLocationPayload(place = {}) {
  const coordinates = normalizeCoords(place);

  return {
    address: place.address || "",
    coordinates,
  };
}

function buildFare(distance, rideType, promoCode = "") {
  const pricing = RIDE_PRICING[rideType] || RIDE_PRICING.standard;
  const baseFare = pricing.base;
  const distanceFare = Math.round(distance * pricing.perKm);
  const surgeMultiplier = 1;

  let subtotal = Math.round((baseFare + distanceFare) * surgeMultiplier);
  let promoDiscount = 0;

  if (promoCode && promoCode.toUpperCase() === "FIRST10") {
    promoDiscount = Math.min(100, Math.round(subtotal * 0.1));
  }

  return {
    baseFare,
    distanceFare,
    surgeMultiplier,
    promoDiscount,
    total: Math.max(0, subtotal - promoDiscount),
  };
}

async function findNearestAvailableDriver({ pickupCoords, rideType }) {
  const busyRides = await Ride.find({
    driver: { $ne: null },
    status: { $in: SEARCHABLE_STATUSES },
  }).select("driver");

  const busyDriverIds = new Set(
    busyRides
      .map((ride) => ride.driver && ride.driver.toString())
      .filter(Boolean)
  );

  const isValidPickup =
    pickupCoords &&
    typeof pickupCoords.lat === "number" &&
    typeof pickupCoords.lng === "number";

  // 1) Best case: nearest driver via geo query (requires driver location + 2dsphere index)
  if (isValidPickup) {
    try {
      const nearbyDrivers = await User.find({
        role: "driver",
        isOnline: true,
        "vehicle.type": rideType,
        location: {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [pickupCoords.lng, pickupCoords.lat],
            },
            $maxDistance: 5000,
          },
        },
      }).select("name vehicle location rating isOnline");

      const availableSameType = nearbyDrivers.filter(
        (driver) => !busyDriverIds.has(driver._id.toString())
      );

      if (availableSameType[0]) return availableSameType[0];
    } catch {
      // If geo query fails (missing index / bad data), fall back below.
    }
  }

  // 2) Fallback: any online driver of same vehicle type (ignores distance)
  const anySameType = await User.find({
    role: "driver",
    isOnline: true,
    "vehicle.type": rideType,
    _id: { $nin: Array.from(busyDriverIds) },
  })
    .select("name vehicle location rating isOnline")
    .sort({ rating: -1 })
    .limit(1);

  if (anySameType[0]) return anySameType[0];

  // 3) Last fallback: any online driver (if vehicle types aren't set)
  const anyOnline = await User.find({
    role: "driver",
    isOnline: true,
    _id: { $nin: Array.from(busyDriverIds) },
  })
    .select("name vehicle location rating isOnline vehicle")
    .sort({ rating: -1 })
    .limit(1);

  return anyOnline[0] || null;
}

function canAccessRide(reqUser, ride) {
  if (!reqUser || !ride) return false;

  const riderId = ride.rider?._id ? ride.rider._id.toString() : ride.rider?.toString();
  const driverId = ride.driver?._id ? ride.driver._id.toString() : ride.driver?.toString();

  if (reqUser.role === "rider") {
    return riderId === reqUser._id.toString();
  }

  if (reqUser.role === "driver") {
    return driverId === reqUser._id.toString();
  }

  return false;
}

exports.createRide = async (req, res, next) => {
  try {
    const {
      pickup,
      destination,
      rideType = "standard",
      distance,
      duration,
      promoCode,
      payment,
    } = req.body;

    const pickupPayload = normalizeLocationPayload(pickup);
    const destinationPayload = normalizeLocationPayload(destination);

    if (!pickupPayload.address || !pickupPayload.coordinates) {
      return res
        .status(400)
        .json({ message: "Valid pickup address and coordinates are required" });
    }

    if (!destinationPayload.address || !destinationPayload.coordinates) {
      return res.status(400).json({
        message: "Valid destination address and coordinates are required",
      });
    }

    const computedDistance =
      typeof distance === "number" && distance > 0
        ? distance
        : getDistance(
            pickupPayload.coordinates.lat,
            pickupPayload.coordinates.lng,
            destinationPayload.coordinates.lat,
            destinationPayload.coordinates.lng
          );

    const computedDuration =
      typeof duration === "number" && duration > 0
        ? duration
        : Math.max(5, Math.round((computedDistance / 35) * 60));

    const fare = buildFare(computedDistance, rideType, promoCode);

    const nearestDriver = await findNearestAvailableDriver({
      pickupCoords: pickupPayload.coordinates,
      rideType,
    });

    const ride = await Ride.create({
      rider: req.user._id,
      driver: nearestDriver?._id || null,
      pickup: pickupPayload,
      destination: destinationPayload,
      rideType,
      status: "searching",
      fare,
      promoCode,
      payment: {
        method: payment?.method || "cash",
        status: "pending",
      },
      distance: Number(computedDistance.toFixed(1)),
      duration: computedDuration,
    });

    const populatedRide = await Ride.findById(ride._id)
      .populate("driver", "name rating vehicle location isOnline")
      .populate("rider", "name");

    const io = req.app.get("io");

    // 🔔 Existing event (keep this)
    if (io && nearestDriver) {
      io.to("drivers").emit("newRideRequest", {
        rideId: populatedRide._id,
        assignedDriverId: nearestDriver._id.toString(),
        pickup: populatedRide.pickup,
        destination: populatedRide.destination,
        fare: populatedRide.fare,
        rideType: populatedRide.rideType,
        status: populatedRide.status,
        riderId: req.user._id.toString(),
      });
    }

    // 🔥 NEW FEATURE: AUTO MESSAGE FROM DRIVER
    if (io && nearestDriver) {
      io.to(`ride_${ride._id}`).emit("receiveMessage", {
        sender: "driver",
        message: `Hi, I'm ${nearestDriver.name}. I'm on my way 🚗`,
        driver: {
          id: nearestDriver._id,
          name: nearestDriver.name,
          rating: nearestDriver.rating,
          vehicle: nearestDriver.vehicle,
        },
        rideId: ride._id,
        time: new Date(),
      });
    }

    return res.status(201).json({
      success: true,
      message: nearestDriver
        ? "Nearby driver assigned and message sent"
        : "Ride created. Looking for nearby drivers",
      ride: populatedRide,
      driver: populatedRide.driver || null,
    });
  } catch (error) {
    next(error);
  }
};
exports.getRide = async (req, res, next) => {
  try {
    const ride = await Ride.findById(req.params.id)
      .populate("driver", "name rating vehicle location isOnline")
      .populate("rider", "name");

    if (!ride) {
      return res.status(404).json({ message: "Ride not found" });
    }

    if (!canAccessRide(req.user, ride)) {
      return res.status(403).json({ message: "Access denied for this ride" });
    }

    res.status(200).json({
      success: true,
      ride,
    });
  } catch (error) {
    next(error);
  }
};

exports.getRideHistory = async (req, res, next) => {
  try {
    const query =
      req.user.role === "driver"
        ? { driver: req.user._id }
        : { rider: req.user._id };

    const rides = await Ride.find(query)
      .populate("driver", "name rating vehicle")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      rides,
    });
  } catch (error) {
    next(error);
  }
};

exports.getNearbyDrivers = async (req, res, next) => {
  try {
    const { lat, lng, radius = 6, rideType } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ message: "lat and lng are required" });
    }

    const query = {
      role: "driver",
      isOnline: true,
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(lng), parseFloat(lat)],
          },
          $maxDistance: parseFloat(radius) * 1000,
        },
      },
    };

    if (rideType) {
      query["vehicle.type"] = rideType;
    }

    const drivers = await User.find(query)
      .select("name vehicle location rating isOnline")
      .limit(10);

    res.status(200).json({
      success: true,
      drivers,
    });
  } catch (error) {
    next(error);
  }
};

exports.estimateRide = async (req, res, next) => {
  try {
    const { pickupCoords, destCoords, rideType = "standard", promoCode } =
      req.body;

    if (!pickupCoords || !destCoords) {
      return res.status(400).json({
        message: "Pickup and destination coordinates are required",
      });
    }

    const distance = getDistance(
      pickupCoords.lat,
      pickupCoords.lng,
      destCoords.lat,
      destCoords.lng
    );

    const roundedDistance = Number(distance.toFixed(1));
    const duration = Math.max(5, Math.round((roundedDistance / 35) * 60));
    const fare = buildFare(roundedDistance, rideType, promoCode);

    res.status(200).json({
      success: true,
      distance: roundedDistance,
      duration,
      fare,
    });
  } catch (error) {
    next(error);
  }
};

exports.updateRideStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowedStatuses = [
      "accepted",
      "arriving",
      "inProgress",
      "completed",
      "cancelled",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid ride status" });
    }

    const ride = await Ride.findById(req.params.id);

    if (!ride) {
      return res.status(404).json({ message: "Ride not found" });
    }

    const isAssignedDriver =
      req.user.role === "driver" &&
      ride.driver &&
      ride.driver.toString() === req.user._id.toString();

    const isDriverAcceptingUnassignedRide =
      status === "accepted" &&
      req.user.role === "driver" &&
      (!ride.driver || ride.driver.toString() === req.user._id.toString());

    const isRideOwner =
      req.user.role === "rider" &&
      ride.rider.toString() === req.user._id.toString();

    if (!isAssignedDriver && !isRideOwner && !isDriverAcceptingUnassignedRide) {
      return res.status(403).json({ message: "Not authorised for this ride" });
    }

    if (isDriverAcceptingUnassignedRide && !ride.driver) {
      ride.driver = req.user._id;
    }

    ride.status = status;

    if (status === "inProgress" && !ride.startedAt) {
      ride.startedAt = new Date();
    }

    if (status === "completed") {
      ride.completedAt = new Date();
    }

    const updatedRide = await ride.save();
    const populatedRide = await Ride.findById(updatedRide._id)
      .populate("driver", "name rating vehicle location isOnline")
      .populate("rider", "name");

    const io = req.app.get("io");
    if (io) {
      io.to(`ride_${ride._id}`).emit("rideStatusUpdate", {
        rideId: ride._id,
        status: ride.status,
        ride: populatedRide,
      });

      if (status === "accepted") {
        io.to(`ride_${ride._id}`).emit("rideAccepted", {
          rideId: ride._id,
          driverId: ride.driver ? ride.driver.toString() : null,
        });
      }
    }

    res.status(200).json({
      success: true,
      ride: populatedRide,
    });
  } catch (error) {
    next(error);
  }
};

exports.assignDriver = async (req, res, next) => {
  try {
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({ message: "driverId is required" });
    }

    const ride = await Ride.findById(req.params.id);
    if (!ride) {
      return res.status(404).json({ message: "Ride not found" });
    }

    if (req.user.role !== "rider" || ride.rider.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorised for this ride" });
    }

    if (ride.status !== "searching") {
      return res.status(400).json({ message: "Driver can only be assigned while searching" });
    }

    const driver = await User.findById(driverId).select("role isOnline vehicle location name rating");
    if (!driver || driver.role !== "driver") {
      return res.status(400).json({ message: "Invalid driver" });
    }

    ride.driver = driver._id;
    ride.status = "accepted";

    const updatedRide = await ride.save();
    const populatedRide = await Ride.findById(updatedRide._id)
      .populate("driver", "name rating vehicle location isOnline")
      .populate("rider", "name");

    const io = req.app.get("io");
    if (io) {
      io.to(`ride_${ride._id}`).emit("rideStatusUpdate", {
        rideId: ride._id,
        status: ride.status,
        ride: populatedRide,
      });

      io.to(`ride_${ride._id}`).emit("rideAccepted", {
        rideId: ride._id,
        driverId: driver._id.toString(),
      });
    }

    return res.status(200).json({
      success: true,
      ride: populatedRide,
    });
  } catch (error) {
    next(error);
  }
};

exports.cancelRide = async (req, res, next) => {
  try {
    const ride = await Ride.findById(req.params.id);

    if (!ride) {
      return res.status(404).json({ message: "Ride not found" });
    }

    if (ride.rider.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorised to cancel ride" });
    }

    if (["completed", "cancelled"].includes(ride.status)) {
      return res.status(400).json({
        message: `Ride already ${ride.status}`,
      });
    }

    ride.status = "cancelled";
    await ride.save();

    const io = req.app.get("io");
    if (io) {
      io.to(`ride_${ride._id}`).emit("rideStatusUpdate", {
        rideId: ride._id,
        status: "cancelled",
      });
    }

    res.status(200).json({
      success: true,
      message: "Ride cancelled successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.bookRide = exports.createRide;
