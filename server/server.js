const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const errorHandler = require("./middlewares/errorHandler");

dotenv.config();

const app = express();

// Create HTTP server
const httpServer = http.createServer(app);

// Setup Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.set("io", io);

// Middlewares
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/rides", require("./routes/rideRoutes"));
app.use("/api/drivers", require("./routes/driverRoutes"));

// Test routes
app.get("/", (req, res) => res.send("this is coming"));

app.get("/api/health", (req, res) =>
  res.json({ status: "ok", message: "VelourRide server running" })
);

// Socket.IO logic
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("driverOnline", (driverId) => {
    socket.join("drivers");
    socket.driverId = driverId;
    console.log("Driver online:", driverId);
  });

  socket.on("driverOffline", (driverId) => {
    socket.leave("drivers");
    console.log("Driver offline:", driverId);
  });

  socket.on("joinRide", (rideId) => {
    socket.join("ride_" + rideId);
    console.log("Joined ride room:", rideId);
  });

  socket.on("driverLocation", ({ rideId, lat, lng }) => {
    io.to("ride_" + rideId).emit("driverMoved", { lat, lng });
  });

  socket.on("acceptRide", ({ rideId, driverId }) => {
    io.to("ride_" + rideId).emit("rideAccepted", { rideId, driverId });
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

// Error handler (must be last middleware)
app.use(errorHandler);

// ✅ CONNECT DB FIRST, THEN START SERVER
const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    console.log("✅ MongoDB connected successfully");

    httpServer.listen(PORT, () => {
      console.log(`🚀 VelourRide server running on http://localhost:${PORT}`);
      console.log(`❤️ Health: http://localhost:${PORT}/api/health`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection FAILED:", err.message);
    process.exit(1); // Stop app if DB fails
  });