const express = require("express");
const router = express.Router();
const { toggleOnline, updateLocation, getEarnings } = require("../controllers/driverController");
const { protect, restrictTo } = require("../middlewares/auth");

router.use(protect, restrictTo("driver"));

router.get("/earnings", getEarnings);
router.put("/toggle", toggleOnline);
router.put("/location", updateLocation);

module.exports = router;