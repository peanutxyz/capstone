// src/models/Supplier.js

const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Contact fields
  contact: {
    phone: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    }
  },
  // Address fields with Philippine format
  address: {
    street: {
      type: String,
      trim: true
    },
    purok: {
      type: String,
      trim: true
    },
    barangay: {
      type: String,
      trim: true
    },
    municipal: {
      type: String,
      trim: true
    }
  },
  current_balance: {
    type: Number,
    default: 0
  },
  is_active: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// Virtual property to get full supplier name from user
supplierSchema.virtual('name').get(function() {
  return this.populated('user') && this.user.name 
    ? this.user.name 
    : 'Unknown Supplier';
});

// Always include virtuals when converting to JSON
supplierSchema.set('toJSON', { virtuals: true });
supplierSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Supplier', supplierSchema);