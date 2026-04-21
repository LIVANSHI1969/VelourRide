const User = require("../models/User");
const Ride = require("../models/Ride");

// GET /api/drivers/nearby  — accessible to riders
exports.getNearbyDrivers = async (req, res, next) => {
  try {
    const { lat, lng, radius = 10 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ message: "lat and lng are required" });
    }

    // Find ALL registered drivers near the coords — no isOnline filter
    // so drivers show up even if they haven't toggled online yet (dev-friendly)
    const drivers = await User.find({
      role: "driver",
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(lng), parseFloat(lat)],
          },
          $maxDistance: parseFloat(radius) * 1000, // km → metres
        },
      },
    })
      .select("name vehicle location rating isOnline")
      .limit(10);

    res.status(200).json({ success: true, drivers });
  } catch (error) {
    next(error);
  }
};

// GET /api/drivers/earnings
exports.getEarnings = async (req, res, next) => {
  const mongoose = require('mongoose');
  const { rides: allRides } = require('../utils/memoryDB');
  try {
    if (mongoose.connection.readyState !== 1) {
      const recentRides = allRides.filter(r => r.driver === req.user._id && r.status === "completed" && (r.payment?.status === "paid" || true))
        .sort((a, b) => new Date(b.completedAt || b.createdAt || b._id) - new Date(a.completedAt || a.createdAt || a._id))
        .slice(0,10);
      const totalEarnings = recentRides.reduce((sum, ride) => sum + (ride.fare?.total || 0), 0);
      res.status(200).json({ success: true, totalEarnings, recentRides });
      return;
    }
    const rides = await Ride.find({
      driver: req.user._id,
      status: "completed",
      "payment.status": "paid",
    }).select("fare payment").sort({ completedAt: -1 }).limit(10);

    const totalEarnings = rides.reduce((sum, ride) => sum + ride.fare.total, 0);

    res.status(200).json({ success: true, totalEarnings, recentRides: rides });
  } catch (error) {
    next(error);
  }
};

// PUT /api/drivers/toggle
exports.toggleOnline = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    user.isOnline = !user.isOnline;
    await user.save();

    const io = req.app.get("io");
    if (io) {
      io.emit("driverStatusChange", {
        driverId: user._id,
        isOnline: user.isOnline,
      });
    }

    res.status(200).json({ success: true, isOnline: user.isOnline });
  } catch (error) {
    next(error);
  }
};


// PUT /api/drivers/location
exports.updateLocation = async (req, res, next) => {
  try {
    const { lat, lng } = req.body;

    await User.findByIdAndUpdate(req.user._id, {
      location: { type: "Point", coordinates: [lng, lat] },
    });

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};