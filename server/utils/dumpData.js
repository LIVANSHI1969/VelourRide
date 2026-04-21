const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');
const Ride = require('../models/Ride');

dotenv.config();

const connectDB = async () => {
  const conn = await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${conn.connection.host}`);
};

const main = async () => {
  try {
    await connectDB();

    // Get all users
    const users = await User.find({});
    const riders = users.filter(u => u.role === 'rider').map(u => u.toJSON());
    const drivers = users.filter(u => u.role === 'driver').map(u => u.toJSON());

    // Get all rides
    const rides = await Ride.find({}).populate('rider driver').lean();

    // Data dir
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

    // Write files
    fs.writeFileSync(path.join(dataDir, 'riders.json'), JSON.stringify(riders, null, 2));
    fs.writeFileSync(path.join(dataDir, 'drivers.json'), JSON.stringify(drivers, null, 2));
    fs.writeFileSync(path.join(dataDir, 'rides.json'), JSON.stringify(rides, null, 2));

    console.log('✅ Data dumped to server/data/ (riders.json, drivers.json, rides.json)');
    console.log(`Riders: ${riders.length}, Drivers: ${drivers.length}, Rides: ${rides.length}`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    mongoose.connection.close();
  }
};

main();
