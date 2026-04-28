const mongoose = require("mongoose");

const rideSchema = new mongoose.Schema(
  {
    riderName: {
      type: String,
      default: "",
      trim: true,
    },
    driverName: {
      type: String,
      default: "",
      trim: true,
    },
    pickupLocation: {
      type: String,
      default: "",
      trim: true,
    },
    destinationLocation: {
      type: String,
      default: "",
      trim: true,
    },
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
      enum: ["scheduled", "searching", "accepted", "arriving", "inProgress", "completed", "cancelled"],
      default: "searching",
    },
    requestExpiresAt: Date,
    rejectedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    scheduledAt: Date,
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
      paidAt: Date,
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
      riderFeedback: String,
      driverFeedback: String,
    },
    navigation: {
      polyline: [{ lat: Number, lng: Number }],
      etaMinutes: Number,
      distanceKm: Number,
      optimizedAt: Date,
    },
    emergency: {
      triggered: { type: Boolean, default: false },
      note: String,
      triggeredAt: Date,
      triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    chatMessages: [
      {
        senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        senderName: String,
        senderRole: { type: String, enum: ["rider", "driver"] },
        message: String,
        timestamp: { type: Date, default: Date.now },
      },
    ],
    timeline: [
      {
        status: String,
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        note: String,
        at: { type: Date, default: Date.now },
      },
    ],
    cancellation: {
      cancelledBy: { type: String, enum: ["rider", "driver", "system"] },
      reason: String,
      fee: { type: Number, default: 0 },
    },
    cancelReason: {
      type: String,
      default: "",
      trim: true,
    },
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Ride", rideSchema);