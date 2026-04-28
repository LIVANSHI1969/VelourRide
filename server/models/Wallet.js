const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,           // one wallet per user
    },
    balance: {
      type: Number,
      default: 200,           // ₹200 welcome bonus for every new user
      min: [0, "Balance cannot go below zero"],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Wallet", walletSchema);