const express = require("express");
const router = express.Router();
const {
  createRide,
  getRide,
  updateRideStatus,
  getRideHistory,
  getNearbyDrivers,
  estimateRide,
  cancelRide,
} = require("../controllers/rideController");
const { protect, restrictTo } = require("../middlewares/auth");

router.post("/estimate", estimateRide); // estimate no auth
router.use(protect); // other routes require auth

router.post("/", restrictTo("rider"), createRide);
router.get("/history", getRideHistory);
router.get("/drivers/nearby", getNearbyDrivers);
router.get("/:id", getRide);
router.put("/:id/status", updateRideStatus);
router.delete("/:id", restrictTo("rider"), cancelRide);

module.exports = router;