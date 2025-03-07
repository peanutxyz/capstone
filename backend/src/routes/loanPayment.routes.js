// src/routes/loanPayment.routes.js

const express = require('express');
const loanPaymentRouter = express.Router();
const { auth, authorize } = require('../middleware/auth');
const LoanPayment = require('../models/LoanPayment');
const Loan = require('../models/Loan');
const Supplier = require('../models/Supplier');
const CreditScore = require('../models/CreditScore');

// Add GET route to fetch all payments
loanPaymentRouter.get('/', auth, async (req, res) => {
  try {
    const { supplier_id, payment_method, startDate, endDate } = req.query;
    
    // Build query based on filters
    const query = {};
    
    if (supplier_id) {
      const loans = await Loan.find({ supplier: supplier_id }).select('_id');
      query.loan = { $in: loans.map(loan => loan._id) };
    }
    
    if (payment_method) {
      query.payment_method = payment_method;
    }
    
    // Date range filtering
    if (startDate || endDate) {
      query.payment_date = {};
      if (startDate) query.payment_date.$gte = new Date(startDate);
      if (endDate) query.payment_date.$lte = new Date(endDate);
    }
    
    // Fetch all payments with populated references
    const payments = await LoanPayment.find(query)
      .populate({
        path: 'loan',
        populate: {
          path: 'supplier',
          select: 'name user',
          populate: {
            path: 'user',
            select: 'name email'
          }
        }
      })
      .populate('processed_by', 'name email')
      .sort({ payment_date: -1 });
    
    res.status(200).json(payments);
  } catch (error) {
    console.error('Error fetching loan payments:', error);
    res.status(500).json({ message: error.message });
  }
});

// Add GET route to fetch payments for a specific loan
loanPaymentRouter.get('/loan/:loanId', auth, async (req, res) => {
  try {
    const { loanId } = req.params;
    
    // Verify loan exists
    const loan = await Loan.findById(loanId);
    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }
    
    // Fetch payments for this loan
    const payments = await LoanPayment.find({ loan: loanId })
      .populate('processed_by', 'name email')
      .sort({ payment_date: -1 });
    
    res.status(200).json(payments);
  } catch (error) {
    console.error('Error fetching loan payments:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get a single payment by ID
loanPaymentRouter.get('/:id', auth, async (req, res) => {
  try {
    const payment = await LoanPayment.findById(req.params.id)
      .populate({
        path: 'loan',
        populate: {
          path: 'supplier',
          select: 'name user',
          populate: {
            path: 'user',
            select: 'name email'
          }
        }
      })
      .populate('processed_by', 'name email');
    
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }
    
    res.status(200).json(payment);
  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({ message: error.message });
  }
});

// Add this helper function above your routes
async function updateCreditScore(loan, payment, paymentDate) {
    try {
        let creditScore = await CreditScore.findOne({ supplier: loan.supplier });
        if (!creditScore) {
            creditScore = new CreditScore({
                supplier: loan.supplier,
                score: 50,
                assessment_date: new Date()
            });
        }

        let scoreAdjustment = 0;
        let adjustmentReasons = [];

        // Check for late payment
        const dueDate = new Date(loan.due_date);
        const paymentDateObj = new Date(paymentDate);
        const daysLate = Math.floor((paymentDateObj - dueDate) / (1000 * 60 * 60 * 24));

        if (daysLate > 0) {
            // Apply penalty for late payment
            scoreAdjustment -= Math.min(10, daysLate); // -1 point per day late, max -10
            adjustmentReasons.push(`Late payment penalty (-${Math.min(10, daysLate)} points)`);
        } else {
            // Reward for on-time payment
            scoreAdjustment += 2;
            adjustmentReasons.push('On-time payment (+2 points)');
        }

        // Check payment amount vs total due
        const paymentRatio = payment.amount / loan.total_amount_with_interest;
        if (paymentRatio >= 0.5) {
            scoreAdjustment += 3;
            adjustmentReasons.push('Significant payment amount (+3 points)');
        }

        // Apply score adjustment
        creditScore.score = Math.min(100, Math.max(0, creditScore.score + scoreAdjustment));
        creditScore.assessment_date = new Date();
        creditScore.remarks = `Loan payment assessment: ${adjustmentReasons.join(', ')}`;

        await creditScore.save();

        return { creditScore, adjustmentReasons };
    } catch (error) {
        console.error('Error updating credit score:', error);
        throw error;
    }
}

// Update your existing post route
loanPaymentRouter.post('/', auth, authorize('admin', 'owner'), async (req, res) => {
    try {
        const { loan: loanId, amount, payment_method, payment_date, notes } = req.body;

        // Find the loan
        const loanRecord = await Loan.findById(loanId)
            .populate('supplier');

        if (!loanRecord) {
            return res.status(404).json({ message: 'Loan not found' });
        }

        // Calculate payment distribution
        const remainingInterest = loanRecord.total_amount_with_interest - loanRecord.amount - (loanRecord.interest_paid || 0);
        let interestPayment = Math.min(remainingInterest, amount);
        let principalPayment = amount - interestPayment;

        // Create payment record
        const loanPayment = new LoanPayment({
            loan: loanId,
            amount,
            payment_method,
            payment_date: payment_date || new Date(),
            notes,
            processed_by: req.user.id,
            interest_portion: interestPayment,
            principal_portion: principalPayment
        });

        await loanPayment.save();

        // Update loan balances
        loanRecord.total_paid = (loanRecord.total_paid || 0) + amount;
        loanRecord.interest_paid = (loanRecord.interest_paid || 0) + interestPayment;
        loanRecord.principal_paid = (loanRecord.principal_paid || 0) + principalPayment;

        // Check if loan is fully paid
        if (loanRecord.total_paid >= loanRecord.total_amount_with_interest) {
            loanRecord.status = 'paid';
        }

        await loanRecord.save();

        // Update supplier's current balance
        const updatedSupplier = await Supplier.findByIdAndUpdate(
            loanRecord.supplier,
            {
                $set: {
                    current_balance: -(loanRecord.total_amount_with_interest - loanRecord.total_paid)
                }
            },
            { new: true }
        );

        // Update credit score
        const creditScoreUpdate = await updateCreditScore(loanRecord, loanPayment, payment_date);

        res.status(201).json({
            message: 'Loan payment recorded successfully',
            payment: loanPayment,
            loan_status: loanRecord.status,
            remaining_balance: loanRecord.total_amount_with_interest - loanRecord.total_paid,
            supplier_balance: updatedSupplier.current_balance,
            credit_score_update: {
                new_score: creditScoreUpdate.creditScore.score,
                adjustments: creditScoreUpdate.adjustmentReasons
            }
        });
    } catch (error) {
        console.error('Loan payment creation error:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = loanPaymentRouter;