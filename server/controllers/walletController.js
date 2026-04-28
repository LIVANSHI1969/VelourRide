const mongoose = require("mongoose");
const Wallet      = require("../models/Wallet");
const Transaction = require("../models/Transaction");

// ─── Helper: get or create wallet ────────────────────────────────────────────
const getOrCreateWallet = async (userId, session) => {
  const opts = session ? { session } : {};
  let wallet = await Wallet.findOne({ user: userId }, null, opts);
  if (!wallet) wallet = await Wallet.create([{ user: userId }], opts).then(r => r[0]);
  return wallet;
};

// ─── GET /api/wallet ──────────────────────────────────────────────────────────
exports.getWallet = async (req, res, next) => {
  try {
    const wallet = await getOrCreateWallet(req.user._id);
    const transactions = await Transaction.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("ride", "pickup destination rideType fare");

    res.status(200).json({
      success: true,
      wallet: { id: wallet._id, balance: wallet.balance, updatedAt: wallet.updatedAt },
      transactions,
    });
  } catch (err) { next(err); }
};

// ─── POST /api/wallet/topup ───────────────────────────────────────────────────
exports.topUp = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0 || parsed > 50000)
      return res.status(400).json({ message: "Amount must be between ₹1 and ₹50,000" });

    const wallet = await getOrCreateWallet(req.user._id);
    wallet.balance = parseFloat((wallet.balance + parsed).toFixed(2));
    await wallet.save();

    const txn = await Transaction.create({
      wallet:       wallet._id,
      user:         req.user._id,
      type:         "credit",
      amount:       parsed,
      balanceAfter: wallet.balance,
      description:  `Wallet top-up of ₹${parsed}`,
      category:     "top_up",
    });

    res.status(200).json({
      success: true,
      message: `₹${parsed} added to your wallet`,
      balance: wallet.balance,
      transaction: txn,
    });
  } catch (err) { next(err); }
};

// ─── Settle ride payment — called from rideController on completion ───────────
// session can be null (standalone MongoDB doesn't support transactions)
exports.settleRidePayment = async (riderId, driverId, amount, rideId, session) => {
  const fare = parseFloat((amount || 0).toFixed(2));
  const opts = session ? { session } : {};

  // Get / create both wallets
  const riderWallet  = await getOrCreateWallet(riderId,  session);
  const driverWallet = await getOrCreateWallet(driverId, session);

  if (riderWallet.balance < fare) {
    throw Object.assign(new Error("Insufficient wallet balance"), { code: "INSUFFICIENT_BALANCE" });
  }

  riderWallet.balance  = parseFloat((riderWallet.balance  - fare).toFixed(2));
  driverWallet.balance = parseFloat((driverWallet.balance + fare).toFixed(2));

  if (session) {
    await riderWallet.save({ session });
    await driverWallet.save({ session });
    await Transaction.insertMany([
      { wallet: riderWallet._id,  user: riderId,  type: "debit",  amount: fare, balanceAfter: riderWallet.balance,  description: `Ride fare paid — ₹${fare}`,   category: "ride_payment", ride: rideId },
      { wallet: driverWallet._id, user: driverId, type: "credit", amount: fare, balanceAfter: driverWallet.balance, description: `Ride fare earned — ₹${fare}`, category: "ride_earning", ride: rideId },
    ], { session });
  } else {
    // No session — save sequentially (best-effort for standalone MongoDB)
    await riderWallet.save();
    await driverWallet.save();
    await Transaction.insertMany([
      { wallet: riderWallet._id,  user: riderId,  type: "debit",  amount: fare, balanceAfter: riderWallet.balance,  description: `Ride fare paid — ₹${fare}`,   category: "ride_payment", ride: rideId },
      { wallet: driverWallet._id, user: driverId, type: "credit", amount: fare, balanceAfter: driverWallet.balance, description: `Ride fare earned — ₹${fare}`, category: "ride_earning", ride: rideId },
    ]);
  }

  return { riderBalance: riderWallet.balance, driverBalance: driverWallet.balance };
};