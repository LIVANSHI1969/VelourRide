const User = require("../models/User");
const Ride = require("../models/Ride");
const Notification = require("../models/Notification");
const WalletTransaction = require("../models/WalletTransaction");
const SOSAlert = require("../models/SOSAlert");

// GET /api/drivers/nearby  — accessible to riders
exports.getNearbyDrivers = async (req, res, next) => {
  try {
    const { lat, lng, radius = 10, rideType } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ message: "lat and lng are required" });
    }

    const query = {
      role: "driver",
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

    res.status(200).json({ success: true, drivers });
  } catch (error) {
    next(error);
  }
};

// GET /api/drivers/list — accessible to riders (fallback when location is missing)
exports.listDrivers = async (req, res, next) => {
  try {
    const { rideType } = req.query;

    const query = { role: "driver" };
    if (rideType) {
      query["vehicle.type"] = rideType;
    }

    const drivers = await User.find(query)
      .select("name vehicle location rating isOnline")
      .sort({ isOnline: -1, rating: -1, createdAt: -1 })
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

// GET /api/drivers/earnings-summary
// Returns production-friendly daily/weekly/monthly breakdown.
exports.getEarningsSummary = async (req, res, next) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const rides = await Ride.find({
      driver: req.user._id,
      status: "completed",
      $or: [{ "payment.status": "paid" }, { "payment.method": "cash" }],
    }).select("fare completedAt createdAt distance");

    const summarize = (fromDate) => {
      const bucket = rides.filter((ride) => new Date(ride.completedAt || ride.createdAt) >= fromDate);
      return {
        total: bucket.reduce((sum, ride) => sum + (ride.fare?.total || 0), 0),
        rides: bucket.length,
        distanceKm: Number(bucket.reduce((sum, ride) => sum + (ride.distance || 0), 0).toFixed(1)),
      };
    };

    res.status(200).json({
      success: true,
      daily: summarize(startOfDay),
      weekly: summarize(startOfWeek),
      monthly: summarize(startOfMonth),
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/drivers/toggle
exports.toggleOnline = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    user.isOnline = !user.isOnline;
    user.lastLocationUpdatedAt = user.isOnline ? new Date() : user.lastLocationUpdatedAt;
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
      lastLocationUpdatedAt: new Date(),
    });

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

// GET /api/drivers/wallet
exports.getWalletSummary = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("walletBalance");
    const transactions = await WalletTransaction.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20);
    res.status(200).json({
      success: true,
      balance: user?.walletBalance || 0,
      transactions,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/drivers/wallet/withdraw
exports.requestWithdrawal = async (req, res, next) => {
  try {
    const amount = Number(req.body.amount || 0);
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Valid withdrawal amount is required" });
    }
    const user = await User.findById(req.user._id);
    if (!user || user.walletBalance < amount) {
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }
    user.walletBalance -= amount;
    await user.save();
    await WalletTransaction.create({
      user: req.user._id,
      type: "withdrawal",
      amount,
      status: "pending",
      description: "Driver withdrawal requested",
    });
    res.status(200).json({ success: true, balance: user.walletBalance });
  } catch (error) {
    next(error);
  }
};

// GET /api/drivers/notifications
exports.getNotifications = async (req, res, next) => {
  try {
    const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
    res.status(200).json({ success: true, notifications });
  } catch (error) {
    next(error);
  }
};

// PUT /api/drivers/notifications/:id/read
exports.markNotificationRead = async (req, res, next) => {
  try {
    await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { read: true });
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

// POST /api/drivers/register-push-token
exports.registerPushToken = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "Push token is required" });
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { pushTokens: token } });
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

// GET /api/drivers/verification
exports.getVerificationStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("verification");
    res.status(200).json({ success: true, verification: user?.verification || {} });
  } catch (error) {
    next(error);
  }
};

// POST /api/drivers/verification
exports.submitVerification = async (req, res, next) => {
  try {
    const docs = Array.isArray(req.body.documents) ? req.body.documents : [];
    await User.findByIdAndUpdate(req.user._id, {
      verification: {
        status: "pending",
        documents: docs,
        reviewedAt: null,
        rejectionReason: "",
      },
    });
    res.status(200).json({ success: true, message: "Verification submitted for review" });
  } catch (error) {
    next(error);
  }
};

// POST /api/drivers/sos
exports.triggerSOS = async (req, res, next) => {
  try {
    const { rideId, lat, lng, note } = req.body;
    const alert = await SOSAlert.create({
      driver: req.user._id,
      ride: rideId || null,
      location: { lat, lng },
      note: note || "Emergency reported by driver",
    });
    const io = req.app.get("io");
    if (io) {
      io.emit("driverSOS", {
        driverId: req.user._id.toString(),
        rideId: rideId || null,
        alertId: alert._id.toString(),
        location: { lat, lng },
      });
    }
    res.status(201).json({ success: true, alert });
  } catch (error) {
    next(error);
  }
};

// GET /api/drivers/heatmap
// Aggregates searching rides by rounded lat/lng buckets.
exports.getDemandHeatmap = async (req, res, next) => {
  try {
    const rows = await Ride.aggregate([
      { $match: { status: { $in: ["searching", "scheduled"] } } },
      {
        $project: {
          latBucket: { $round: ["$pickup.coordinates.lat", 2] },
          lngBucket: { $round: ["$pickup.coordinates.lng", 2] },
        },
      },
      {
        $group: {
          _id: { lat: "$latBucket", lng: "$lngBucket" },
          demand: { $sum: 1 },
        },
      },
      { $sort: { demand: -1 } },
      { $limit: 50 },
    ]);
    res.status(200).json({ success: true, zones: rows.map((z) => ({ ...z._id, demand: z.demand })) });
  } catch (error) {
    next(error);
  }
};

// GET /api/drivers/dashboard
// Consolidated dashboard payload for driver app.
exports.getDriverDashboard = async (req, res, next) => {
  try {
    const driverId = req.user._id;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [driver, completedRides, todayCompletedRides, historyRides, activeRide] = await Promise.all([
      User.findById(driverId).select("name isOnline rating totalRides walletBalance vehicle"),
      Ride.find({
        driver: driverId,
        status: "completed",
      }).select("fare completedAt createdAt rating riderName pickup destination"),
      Ride.find({
        driver: driverId,
        status: "completed",
        completedAt: { $gte: startOfToday },
      }).select("fare"),
      Ride.find({
        driver: driverId,
        status: { $in: ["completed", "cancelled"] },
      })
        .populate("rider", "name")
        .sort({ createdAt: -1 })
        .limit(20),
      Ride.findOne({
        driver: driverId,
        status: { $in: ["accepted", "arriving", "inProgress"] },
      })
        .populate("rider", "name")
        .sort({ updatedAt: -1 }),
    ]);

    const totalEarnings = completedRides.reduce((sum, ride) => sum + (ride.fare?.total || 0), 0);
    const todayEarnings = todayCompletedRides.reduce((sum, ride) => sum + (ride.fare?.total || 0), 0);
    const ridesCount = completedRides.length;

    const riderRatings = completedRides
      .map((ride) => ride.rating?.riderRating)
      .filter((value) => typeof value === "number");
    const averageRiderRating = riderRatings.length
      ? Number((riderRatings.reduce((sum, value) => sum + value, 0) / riderRatings.length).toFixed(1))
      : null;

    res.status(200).json({
      success: true,
      driver: {
        id: driver?._id || driverId,
        name: driver?.name || "",
        isOnline: Boolean(driver?.isOnline),
        rating: driver?.rating ?? 0,
        vehicle: driver?.vehicle || null,
      },
      earnings: {
        total: totalEarnings,
        today: todayEarnings,
        ridesCount,
      },
      ratings: {
        average: averageRiderRating,
        count: riderRatings.length,
      },
      activeRide,
      history: historyRides,
    });
  } catch (error) {
    next(error);
  }
};
