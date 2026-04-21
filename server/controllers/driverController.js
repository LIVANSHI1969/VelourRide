const User = require("../models/User");

// GET /api/drivers/earnings
exports.getEarnings = async (req, res, next) => {
  try {
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