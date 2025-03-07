// src/models/Settings.js
const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  type: { 
    type: String, 
    required: true, 
    unique: true 
  },
  defaultLoanLimit: { 
    type: Number, 
    default: 5000 
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);