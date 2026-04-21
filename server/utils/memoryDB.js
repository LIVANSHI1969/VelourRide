const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

let users = [
  {
    _id: '507f1f77bcf86cd799439011',
    name: 'John Driver',
    email: 'driver1@example.com',
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj8nJZkHqUe', // password: driver123
    role: 'driver',
    isOnline: true,
    location: {
      type: 'Point',
      coordinates: [77.2167, 28.6139] // Delhi coordinates
    },
    vehicle: {
      type: 'bike',
      model: 'Honda Activa',
      plate: 'DL01AB1234'
    },
    rating: 4.5
  },
  {
    _id: '507f1f77bcf86cd799439012',
    name: 'Jane Driver',
    email: 'driver2@example.com',
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj8nJZkHqUe',
    role: 'driver',
    isOnline: true,
    location: {
      type: 'Point',
      coordinates: [77.2090, 28.6139] // Near Delhi
    },
    vehicle: {
      type: 'auto',
      model: 'Bajaj Auto',
      plate: 'DL02CD5678'
    },
    rating: 4.2
  },
  {
    _id: '507f1f77bcf86cd799439013',
    name: 'Bob Rider',
    email: 'rider@example.com',
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj8nJZkHqUe', // password: rider123
    role: 'rider',
    rating: 4.8
  }
];
let rides = [];

const hashPassword = async (pw) => await bcrypt.hash(pw, 12);

const verifyPassword = async (pw, hash) => await bcrypt.compare(pw, hash);

module.exports = {
  users,
  rides,
  hashPassword,
  verifyPassword
};
