const express = require("express");
const router = express.Router();
const {
  toggleOnline,
  updateLocation,
  getEarnings,
  getNearbyDrivers,
  listDrivers,
} = require("../controllers/driverController");
const { protect, restrictTo } = require("../middlewares/auth");

router.get("/nearby", protect, restrictTo("rider"), getNearbyDrivers);
router.get("/list", protect, restrictTo("rider"), listDrivers);

router.use(protect, restrictTo("driver"));

router.get("/earnings", getEarnings);
router.put("/toggle", toggleOnline);
router.put("/location", updateLocation);

module.exports = router;
