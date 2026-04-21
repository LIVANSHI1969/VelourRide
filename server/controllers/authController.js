const jwt = require("jsonwebtoken");
const User = require("../models/User");

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });

const sendTokenResponse = (user, statusCode, res) => {
  const token = signToken(user._id);
  res.status(statusCode).json({
    success: true,
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      rating: user.rating,
      vehicle: user.vehicle,
    },
  });
};

// POST /api/auth/register
exports.register = async (req, res, next) => {
  const mongoose = require('mongoose');
  const { users, hashPassword } = require('../utils/memoryDB');
  try {
    if (mongoose.connection.readyState !== 1) {
      const { name, email, password, role, phone, vehicle } = req.body;
      const userData = {
        _id: new mongoose.Types.ObjectId(),
        name,
        email,
        password: await hashPassword(password),
        role: role || "rider",
        phone,
        ...(role === "driver" && vehicle ? { vehicle } : {}),
      };
      users.push(userData);
      sendTokenResponse(userData, 201, res);
      return;
    }
    const { name, email, password, role, phone, vehicle } = req.body;
    const user = await User.create({
      name,
      email,
      password,
      role: role || "rider",
      phone,
      ...(role === "driver" && vehicle ? { vehicle } : {}),
    });
    sendTokenResponse(user, 201, res);
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/login
exports.login = async (req, res, next) => {
  const mongoose = require('mongoose');
  const { users, verifyPassword } = require('../utils/memoryDB');
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Please provide email and password" });
    }

    if (mongoose.connection.readyState !== 1) {
      const user = users.find(u => u.email === email);
      if (!user || !(await verifyPassword(password, user.password))) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      sendTokenResponse(user, 200, res);
      return;
    }

    const user = await User.findOne({ email }).select("+password");

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

// GET /api/auth/me
exports.getMe = async (req, res) => {
  res.status(200).json({ success: true, user: req.user });
};