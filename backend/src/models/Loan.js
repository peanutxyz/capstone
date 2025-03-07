// src/models/Loan.js

const mongoose = require('mongoose');

const LoanSchema = new mongoose.Schema({
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Simple tracking fields
  total_paid: {
    type: Number,
    default: 0
  },
  purpose: String,
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'paid', 'cancelled', 'voided'],
    default: 'pending'
  },
  requestDate: {
    type: Date,
    default: Date.now
  },
  due_date: {
    type: Date,
    required: true
  },
  approvalDate: Date,
  lastPaymentDate: Date,
  completionDate: Date,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  cancelled_date: Date,
  cancelled_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  voided_date: Date,
  voided_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  void_reason: String
}, { timestamps: true });

// Pre-save hook to check if loan is paid
LoanSchema.pre('save', function(next) {
  // If total_paid equals or exceeds amount, mark as paid
  if (this.status === 'approved' && this.total_paid >= this.amount) {
    this.status = 'paid';
    this.completionDate = new Date();
  }
  next();
});

module.exports = mongoose.model('Loan', LoanSchema);