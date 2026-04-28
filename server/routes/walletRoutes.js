const express = require("express");
const router  = express.Router();
const { getWallet, topUp } = require("../controllers/walletController");
const { protect } = require("../middlewares/auth");

router.get("/",       protect, getWallet);   // GET  /api/wallet
router.post("/topup", protect, topUp);       // POST /api/wallet/topup

module.exports = router;