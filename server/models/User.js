const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      enum: ["rider", "driver"],
      default: "rider",
    },
    phone: {
      type: String,
      trim: true,
    },
    // Driver-only fields
    isOnline: {
      type: Boolean,
      default: false,
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
    },
    vehicle: {
      model: String,
      plate: String,
      type: {
        type: String,
        enum: ["bike", "auto", "standard", "comfort", "black", "parcel"],
        default: "standard",
      },
    },
    rating: {
      type: Number,
      default: 5.0,
      min: 1,
      max: 5,
    },
    totalRides: {
      type: Number,
      default: 0,
    },
    // Wallet keeps running driver balance.
    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Driver profile verification/KYC flags.
    verification: {
      status: {
        type: String,
        enum: ["notSubmitted", "pending", "approved", "rejected"],
        default: "notSubmitted",
      },
      documents: [
        {
          type: { type: String, trim: true },
          number: { type: String, trim: true },
          url: { type: String, trim: true },
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      reviewedAt: Date,
      rejectionReason: String,
    },
    emergencyContact: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
    },
    pushTokens: [{ type: String, trim: true }],
    lastLocationUpdatedAt: Date,
  },
  { timestamps: true }
);

// Index for geospatial queries (finding nearby drivers)
userSchema.index({ location: "2dsphere" });

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);