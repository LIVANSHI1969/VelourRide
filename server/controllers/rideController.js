const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const User = require("../models/User");

// ─── Fare calculation ─────────────────────────────────────────────────────────
const FARE_RATES = {
  bike:     { base: 20,  perKm: 8  },
  auto:     { base: 30,  perKm: 10 },
  standard: { base: 50,  perKm: 12 },
  comfort:  { base: 80,  perKm: 18 },
  black:    { base: 150, perKm: 28 },
  parcel:   { base: 40,  perKm: 15 },
};

const PROMO_CODES = { WELCOME20: 0.2, FIRST10: 10, SAVE50: 50 };

const calcFare = (rideType, distance, promoCode) => {
  const rate         = FARE_RATES[rideType] || FARE_RATES.standard;
  const distanceFare = parseFloat((distance * rate.perKm).toFixed(0));
  let subtotal       = parseFloat((rate.base + distanceFare).toFixed(0));
  let promoDiscount  = 0;
  if (promoCode && PROMO_CODES[promoCode]) {
    promoDiscount = PROMO_CODES[promoCode];
    subtotal = promoDiscount < 1
      ? subtotal * (1 - promoDiscount)
      : Math.max(20, subtotal - promoDiscount);
    promoDiscount = Math.round(promoDiscount);
  }
  return { baseFare: rate.base, distanceFare, surgeMultiplier: 1, promoDiscount, total: parseFloat(subtotal.toFixed(0)) };
};

const haversine = (lat1, lon1, lat2, lon2) => {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
               Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ─── POST /api/rides ──────────────────────────────────────────────────────────
exports.createRide = async (req, res, next) => {
  try {
    const { pickup, destination, rideType, distance, duration, promoCode, payment } = req.body;
    const fare = calcFare(rideType || "standard", distance || 0, promoCode);

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
      payment: { method: payment?.method || "cash", status: "pending" },
    });

    const io = req.app.get("io");
    if (io) {
      io.to("drivers").emit("newRideRequest", {
        rideId:      ride._id,
        pickup:      ride.pickup,
        destination: ride.destination,
        fare:        ride.fare,
        rideType:    ride.rideType,
      });
    }

    res.status(201).json({ success: true, ride });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/rides/history ───────────────────────────────────────────────────
exports.getRideHistory = async (req, res, next) => {
  try {
    const filter = req.user.role === "rider"
      ? { rider: req.user._id }
      : { driver: req.user._id };

    const rides = await Ride.find({ ...filter, status: "completed" })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("rider",  "name")
      .populate("driver", "name vehicle");

    res.status(200).json({ success: true, rides });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/rides/:id ───────────────────────────────────────────────────────
exports.getRide = async (req, res, next) => {
  try {
    const ride = await Ride.findById(req.params.id)
      .populate("rider",  "name phone rating")
      .populate("driver", "name phone rating vehicle");

    if (!ride) return res.status(404).json({ message: "Ride not found" });
    res.status(200).json({ success: true, ride });
  } catch (error) {
    next(error);
  }
};

// ─── PUT /api/rides/:id/status ────────────────────────────────────────────────
exports.updateRideStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const ride = await Ride.findById(req.params.id);

    if (!ride) return res.status(404).json({ message: "Ride not found" });

    if (status === "cancelled" && req.user.role === "driver" && ride.driver)
      return res.status(400).json({ message: "Driver cannot cancel an accepted ride" });

    if (status === "accepted" && req.user.role === "driver") ride.driver = req.user._id;
    if (status === "inProgress") ride.startedAt = new Date();

    if (status === "completed") {
      ride.completedAt = new Date();

      // Wallet payment — debit rider, credit driver
      if (ride.payment?.method === "wallet" && ride.driver) {
        try {
          const { settleRidePayment } = require("./walletController");
          await settleRidePayment(ride.rider, ride.driver, ride.fare?.total || 0, ride._id, null);
          ride.payment.status = "paid";
        } catch (walletErr) {
          return res.status(402).json({
            message: walletErr.message || "Wallet payment failed",
            code:    walletErr.code    || "PAYMENT_FAILED",
          });
        }
      } else {
        ride.payment.status = "paid";
      }
    }

    ride.status = status;
    await ride.save();

    const io = req.app.get("io");
    if (io) {
      io.to(`ride_${ride._id}`).emit("rideStatusUpdate", {
        rideId: ride._id, status: ride.status, driver: ride.driver,
      });
    }

    res.status(200).json({ success: true, ride });
  } catch (error) {
    next(error);
  }
};

// ─── DELETE /api/rides/:id ────────────────────────────────────────────────────
exports.cancelRide = async (req, res, next) => {
  try {
    const ride = await Ride.findById(req.params.id);

    if (!ride) return res.status(404).json({ message: "Ride not found" });
    if (ride.rider.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Not authorized" });
    if (["accepted", "inProgress"].includes(ride.status))
      return res.status(400).json({ message: "Cannot cancel an ongoing ride" });

    ride.status = "cancelled";
    await ride.save();

    const io = req.app.get("io");
    if (io) io.to(`ride_${ride._id}`).emit("rideStatusUpdate", { rideId: ride._id, status: "cancelled" });

    res.status(200).json({ success: true, ride });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/rides/estimate ─────────────────────────────────────────────────
exports.estimateRide = async (req, res, next) => {
  try {
    const { pickupCoords, destCoords, rideType, promoCode } = req.body;
    if (!pickupCoords?.lat || !pickupCoords?.lng || !destCoords?.lat || !destCoords?.lng)
      return res.status(400).json({ message: "Coordinates required" });

    const distance = haversine(pickupCoords.lat, pickupCoords.lng, destCoords.lat, destCoords.lng);
    const duration = Math.max(5, Math.round((distance / 50) * 60 * 1.5));
    const fare     = calcFare(rideType || "standard", distance, promoCode);

    res.status(200).json({ success: true, distance: Math.round(distance * 10) / 10, duration, fare });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/rides/drivers/nearby (legacy — kept for rideRoutes compat) ──────
exports.getNearbyDrivers = async (req, res, next) => {
  try {
    const { lat, lng, radius = 10 } = req.query;

    const query = { role: "driver" };
    if (lat && lng) {
      query.location = {
        $near: {
          $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseFloat(radius) * 1000,
        },
      };
    }

    const drivers = await User.find(query).select("name rating vehicle location isOnline");
    res.status(200).json({ success: true, drivers });
  } catch (error) {
    next(error);
  }
};