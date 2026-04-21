const Ride = require("../models/Ride");
const User = require("../models/User");

const FARE_RATES = {
  bike: { base: 20, perKm: 8 },
  auto: { base: 30, perKm: 10 },
  standard: { base: 50, perKm: 12 },
  comfort:  { base: 80, perKm: 18 },
  black:    { base: 150, perKm: 28 },
  parcel: { base: 40, perKm: 15 },
};

const calcFare = (rideType, distance, promoCode = null) => {
  const rate = FARE_RATES[rideType] || FARE_RATES.standard;
  const distanceFare = parseFloat((distance * rate.perKm).toFixed(0));
  let subtotal = parseFloat((rate.base + distanceFare).toFixed(0));
  let promoDiscount = 0;
  
  if (promoCode) {
    const PROMO_CODES = {
      'WELCOME20': 0.2,
      'FIRST10': 10,
      'SAVE50': 50,
    };
    promoDiscount = PROMO_CODES[promoCode];
    if (promoDiscount) {
      if (promoDiscount < 1) subtotal *= (1 - promoDiscount);
    else subtotal = Math.max(20, subtotal - promoDiscount);
    }
  }
  
  const total = parseFloat(subtotal.toFixed(0));
  return { baseFare: rate.base, distanceFare, surgeMultiplier: 1, promoDiscount: Math.round(promoDiscount), total };
};

// POST /api/rides
exports.createRide = async (req, res, next) => {
  const mongoose = require('mongoose');
  const { rides } = require('../utils/memoryDB');
  try {
    const { pickup, destination, rideType, distance, duration, promoCode } = req.body;
    const fare = calcFare(rideType || "standard", distance || 0, promoCode);

    if (mongoose.connection.readyState !== 1) {
      const rideData = {
        _id: new mongoose.Types.ObjectId(),
        rider: req.user._id,
        pickup,
        destination,
        rideType: rideType || "standard",
        distance,
        duration,
        fare,
        promoCode: promoCode || null,
        status: "searching",
        createdAt: new Date(),
      };
      rides.push(rideData);

      // Broadcast new ride request to all online drivers
      const io = req.app.get("io");
      if (io) {
        io.to("drivers").emit("newRideRequest", {
          rideId: rideData._id,
          pickup: rideData.pickup,
          destination: rideData.destination,
          fare: rideData.fare,
          rideType: rideData.rideType,
        });
      }

      res.status(201).json({ success: true, ride: rideData });
      return;
    }

    const ride = await Ride.create({
      rider: req.user._id,
      pickup,
      destination,
      rideType: rideType || "standard",
      distance,
      duration,
      fare,
      promoCode: promoCode || null,
      status: "searching",
    });

    // Broadcast new ride request to all online drivers
    const io = req.app.get("io");
    if (io) {
      io.to("drivers").emit("newRideRequest", {
        rideId: ride._id,
        pickup: ride.pickup,
        destination: ride.destination,
        fare: ride.fare,
        rideType: ride.rideType,
      });
    }

    res.status(201).json({ success: true, ride });
  } catch (error) {
    next(error);
  }
};

// GET /api/rides/history
exports.getRideHistory = async (req, res, next) => {
  const mongoose = require('mongoose');
  const { rides: allRides, users } = require('../utils/memoryDB');
  try {
    if (mongoose.connection.readyState !== 1) {
      const roleField = req.user.role === "rider" ? "rider" : "driver";
      let historyRides = allRides.filter(r => r.status === "completed" && r[roleField] === req.user._id)
        .sort((a, b) => new Date(b.createdAt || b._id) - new Date(a.createdAt || a._id))
        .slice(0,20);
      const history = historyRides.map(ride => ({
        ...ride,
        rider: users.find(u => u._id.toString() === ride.rider.toString()) || {name: 'Anonymous Rider'},
        driver: users.find(u => u._id.toString() === ride.driver?.toString()) || {name: 'Anonymous Driver', vehicle: {}},
      }));
      res.status(200).json({ success: true, rides: history });
      return;
    }
    const filter =
      req.user.role === "rider"
        ? { rider: req.user._id }
        : { driver: req.user._id };
    const rides = await Ride.find({ ...filter, status: "completed" })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("rider", "name")
      .populate("driver", "name vehicle");

    res.status(200).json({ success: true, rides });
  } catch (error) {
    next(error);
  }
};

// GET /api/rides/:id
exports.getRide = async (req, res, next) => {
  try {
    const ride = await Ride.findById(req.params.id)
      .populate("rider", "name phone rating")
      .populate("driver", "name phone rating vehicle");

    if (!ride) return res.status(404).json({ message: "Ride not found" });

    res.status(200).json({ success: true, ride });
  } catch (error) {
    next(error);
  }
};

// PUT /api/rides/:id/status
exports.updateRideStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const ride = await Ride.findById(req.params.id);

    if (!ride) return res.status(404).json({ message: "Ride not found" });

    // Prevent driver cancelling after accepted
    if (status === "cancelled" && req.user.role === "driver" && ride.driver) {
      return res.status(400).json({ message: "Driver cannot cancel accepted ride" });
    }

    // Assign driver on accept
    if (status === "accepted" && req.user.role === "driver") {
      ride.driver = req.user._id;
    }
    if (status === "inProgress") ride.startedAt = new Date();
    if (status === "completed") {
      ride.completedAt = new Date();
      // Auto-complete payment for cash/wallet
      ride.payment.status = "paid";
    }

    ride.status = status;
    await ride.save();

    // Notify everyone in the ride room
    const io = req.app.get("io");
    if (io) {
      io.to(`ride_${ride._id}`).emit("rideStatusUpdate", {
        rideId: ride._id,
        status: ride.status,
        driver: ride.driver,
      });
    }

    res.status(200).json({ success: true, ride });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/rides/:id (cancel by rider before accepted)
exports.cancelRide = async (req, res, next) => {
  try {
    const ride = await Ride.findById(req.params.id);

    if (!ride) return res.status(404).json({ message: "Ride not found" });
    if (ride.rider.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Not authorized" });
    if (ride.status === "accepted" || ride.status === "inProgress") return res.status(400).json({ message: "Cannot cancel accepted or ongoing ride" });

    ride.status = "cancelled";
    await ride.save();

    const io = req.app.get("io");
    if (io) {
      io.to(`ride_${ride._id}`).emit("rideStatusUpdate", {
        rideId: ride._id,
        status: "cancelled",
      });
    }

    res.status(200).json({ success: true, ride });
  } catch (error) {
    next(error);
  }
};


// Haversine formula to calculate distance in km
const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// Estimate time (simple: 50 km/h average with traffic factor)
const estimateDuration = (distance) => Math.max(5, Math.round((distance / 50) * 60 * 1.5));

// POST /api/rides/estimate (unauth ok for preview)
exports.estimateRide = async (req, res, next) => {
  try {
    const { pickupCoords, destCoords, rideType, promoCode } = req.body;
    if (!pickupCoords?.lat || !pickupCoords?.lng || !destCoords?.lat || !destCoords?.lng) {
      return res.status(400).json({ message: "Coordinates required" });
    }

    const distance = haversineDistance(
      pickupCoords.lat, pickupCoords.lng,
      destCoords.lat, destCoords.lng
    );
    const duration = estimateDuration(distance);
    const fare = calcFare(rideType || "standard", distance, req.body.promoCode);

    res.status(200).json({ success: true, distance: Math.round(distance * 10)/10, duration, fare });
  } catch (error) {
    next(error);
  }
};

// GET /api/drivers/nearby
exports.getNearbyDrivers = async (req, res, next) => {
  try {
    const { lat, lng, radius = 10, rideType } = req.query; // radius in km, default 10km

    let query = {
      role: "driver",
      isOnline: true,
      ...(rideType ? { "vehicle.type": rideType } : {}),
    };

    if (lat && lng) {
      query.location = {
        $near: {
          $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseFloat(radius) * 1000, // convert km to meters
        },
      };
    }

    const drivers = await User.find(query).select("name rating vehicle location");

    res.status(200).json({ success: true, drivers });
  } catch (error) {
    next(error);
  }
};

