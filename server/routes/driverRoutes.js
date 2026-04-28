const express = require("express");
const router = express.Router();
const {
  toggleOnline,
  updateLocation,
  getEarnings,
  getEarningsSummary,
  getNearbyDrivers,
  listDrivers,
  getWalletSummary,
  requestWithdrawal,
  getNotifications,
  markNotificationRead,
  registerPushToken,
  getVerificationStatus,
  submitVerification,
  triggerSOS,
  getDemandHeatmap,
  getDriverDashboard,
} = require("../controllers/driverController");
const { protect, restrictTo } = require("../middlewares/auth");

router.get("/nearby", protect, restrictTo("rider"), getNearbyDrivers);
router.get("/list", protect, restrictTo("rider"), listDrivers);

router.use(protect, restrictTo("driver"));

router.get("/earnings", getEarnings);
router.get("/earnings-summary", getEarningsSummary);
router.get("/dashboard", getDriverDashboard);
router.put("/toggle", toggleOnline);
router.put("/location", updateLocation);
router.get("/wallet", getWalletSummary);
router.post("/wallet/withdraw", requestWithdrawal);
router.get("/notifications", getNotifications);
router.put("/notifications/:id/read", markNotificationRead);
router.post("/register-push-token", registerPushToken);
router.get("/verification", getVerificationStatus);
router.post("/verification", submitVerification);
router.post("/sos", triggerSOS);
router.get("/heatmap", getDemandHeatmap);

module.exports = router;
