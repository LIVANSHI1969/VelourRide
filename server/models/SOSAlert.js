const mongoose = require("mongoose");

const sosAlertSchema = new mongoose.Schema(
  {
    driver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    ride: { type: mongoose.Schema.Types.ObjectId, ref: "Ride" },
    location: {
      lat: Number,
      lng: Number,
    },
    note: { type: String, trim: true },
    status: {
      type: String,
      enum: ["open", "resolved"],
      default: "open",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SOSAlert", sosAlertSchema);
