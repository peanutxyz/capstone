// src/models/LoanPayment.js

const mongoose = require('mongoose');

const LoanPaymentSchema = new mongoose.Schema({
  loan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Loan',
    required: true
  },
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    // Not required because manual payments won't have a transaction
    required: false
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  payment_date: {
    type: Date,
    default: Date.now
  },
  // To track payment method
  payment_method: {
    type: String,
    enum: ['auto-debit', 'manual', 'bank-transfer', 'cash'],
    default: 'auto-debit'
  },
  reference_number: {
    type: String,
  },
  notes: String
}, { timestamps: true });

// Generate unique reference number if none provided
LoanPaymentSchema.pre('save', function(next) {
  // If no reference number is provided, generate one
  if (!this.reference_number) {
    // Create a unique reference based on timestamp and random string
    this.reference_number = `PAY-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  }
  next();
});

// Update loan record after payment
LoanPaymentSchema.post('save', async function() {
  try {
    const Loan = mongoose.model('Loan');
    const loan = await Loan.findById(this.loan);
   
    if (!loan) {
      console.error(`Loan not found for payment: ${this._id}, loan ID: ${this.loan}`);
      return;
    }
    
    console.log(`Processing payment of ${this.amount} for loan ${this.loan}`);
    
    // Initialize fields if they don't exist
    loan.total_paid = loan.total_paid || 0;
    loan.principal_paid = loan.principal_paid || 0;
    loan.interest_paid = loan.interest_paid || 0;
    
    // Calculate total amount with interest if not set
    if (!loan.total_amount_with_interest && loan.interest_rate) {
      const interest = loan.amount * (loan.interest_rate / 100);
      loan.total_amount_with_interest = loan.amount + interest;
    } else if (!loan.total_amount_with_interest) {
      loan.total_amount_with_interest = loan.amount;
    }
    
    // Update loan payment totals
    loan.total_paid += this.amount;
   
    // Determine how much goes to principal vs interest
    const principalRemaining = loan.amount - loan.principal_paid;
    const interestRemaining = loan.total_amount_with_interest - loan.amount - loan.interest_paid;
   
    // Prioritize interest payment first
    if (interestRemaining > 0) {
      const interestPayment = Math.min(this.amount, interestRemaining);
      loan.interest_paid += interestPayment;
      
      const principalPayment = this.amount - interestPayment;
      if (principalPayment > 0) {
        loan.principal_paid += principalPayment;
      }
    } else {
      loan.principal_paid += this.amount;
    }
   
    // Check if loan is fully paid
    if (loan.total_paid >= loan.total_amount_with_interest) {
      loan.status = 'paid';
      loan.completionDate = new Date();
    }
    
    // Set last payment date
    loan.lastPaymentDate = this.payment_date || new Date();
   
    await loan.save();
  } catch (error) {
    console.error('Error updating loan after payment:', error);
  }
});

module.exports = mongoose.model('LoanPayment', LoanPaymentSchema);