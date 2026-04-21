const mongoose = require("mongoose");

const rideSchema = new mongoose.Schema(
  {
    rider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    pickup: {
      address: { type: String, required: true },
      coordinates: {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
      },
    },
    destination: {
      address: { type: String, required: true },
      coordinates: {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
      },
    },
    rideType: {
      type: String,
      enum: ["bike", "auto", "standard", "comfort", "black", "parcel"],
      default: "standard",
    },
    status: {
      type: String,
      enum: ["searching", "accepted", "arriving", "inProgress", "completed", "cancelled"],
      default: "searching",
    },
    fare: {
      baseFare: { type: Number, default: 50 },
      distanceFare: { type: Number, default: 0 },
      surgeMultiplier: { type: Number, default: 1 },
      promoDiscount: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    promoCode: String,
    payment: {
      method: { type: String, enum: ["cash", "card", "wallet"], default: "cash" },
      status: { type: String, enum: ["pending", "paid", "failed"], default: "pending" },
      transactionId: String,
    },
    distance: {
      type: Number, // in km
      default: 0,
    },
    duration: {
      type: Number, // in minutes
      default: 0,
    },
    rating: {
      riderRating: { type: Number, min: 1, max: 5 },
      driverRating: { type: Number, min: 1, max: 5 },
    },
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Ride", rideSchema);