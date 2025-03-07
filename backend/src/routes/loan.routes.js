// src/routes/loan.routes.js

const express = require('express');
const loanRouter = express.Router();
const { auth, authorize } = require('../middleware/auth');
const Loan = require('../models/Loan');
const LoanPayment = require('../models/LoanPayment');
const CreditScore = require('../models/CreditScore');
const Supplier = require('../models/Supplier');
const Transaction = require('../models/Transaction');

async function checkLoanEligibility(supplierId, requestedAmount) {
    try {
        // First check if supplier has any transactions - FIX THE FIELD NAME ISSUE
        const transactions = await Transaction.find({
            $or: [
                { supplier: supplierId },
                { supplierId: supplierId }  // Add this to check both field names
            ],
            status: 'completed'
        });
       
        console.log(`Found ${transactions.length} transactions for supplier ${supplierId}`);
       
        const transactionCount = transactions.length;
       
        // Suppliers must have at least one transaction to be eligible
        if (transactionCount === 0) {
            return {
                eligible: false,
                limit: 0,
                message: "Supplier must complete at least one transaction before being eligible for loans."
            };
        }
       
        // Calculate average transaction amount - ENSURE PROPER FIELD ACCESS
        const totalAmount = transactions.reduce((sum, t) => {
            // Try different possible field names for transaction amount
            const amount = t.total_amount || t.totalAmount || t.amount || 0;
            console.log(`Transaction amount: ${amount}`);
            return sum + amount;
        }, 0);
       
        const averageTransaction = totalAmount / transactionCount;
        console.log(`Average transaction: ${averageTransaction}, Total: ${totalAmount}, Count: ${transactionCount}`);
       
        // Fixed credit percentage of 40% for all suppliers
        const creditPercentage = 0.40;
       
        // Calculate loan limit
        const loanLimit = Math.round(averageTransaction * creditPercentage);
       
        console.log(`Final calculation: ${averageTransaction} × ${creditPercentage} = ${loanLimit}`);
       
        return {
            eligible: true, // Eligible as long as they have transaction history
            limit: loanLimit,
            score: 0, // Score is no longer relevant for loan eligibility
            average_transaction: averageTransaction,
            transaction_count: transactionCount,
            message: "Loan amount within acceptable limit"
        };
    } catch (error) {
        console.error("Error checking loan eligibility:", error);
        throw error;
    }
}

// Add GET route for fetching all loans
loanRouter.get('/', auth, async (req, res) => {
    try {
        const { status, supplier_id } = req.query;
       
        // Build query based on filters
        const query = {};
       
        if (status) {
            query.status = status;
        }
       
        if (supplier_id) {
            query.supplier = supplier_id;
        }
       
        // Fetch loans with properly populated supplier references
        const loans = await Loan.find(query)
            .populate({
                path: 'supplier',
                select: 'name email phone address user',
                populate: {
                    path: 'user',
                    select: 'name email'
                }
            })
            .populate({
                path: 'created_by',
                select: 'name email',
                strictPopulate: false
            })
            .sort({ created_at: -1 });
       
        // Format the response data to ensure supplier names are available
        const formattedLoans = loans.map(loan => {
            const loanObj = loan.toObject();
           
            // Make sure supplier data is properly structured
            if (loanObj.supplier) {
                if (loanObj.supplier.name) {
                    // If supplier has name directly, use it
                    loanObj.supplier_name = loanObj.supplier.name;
                } else if (loanObj.supplier.user && loanObj.supplier.user.name) {
                    // If supplier name is in user object, use that
                    loanObj.supplier_name = loanObj.supplier.user.name;
                } else {
                    // Fallback
                    loanObj.supplier_name = "Unknown Supplier";
                }
               
                // Include supplier_id for reference
                loanObj.supplier_id = {
                    _id: loanObj.supplier._id,
                    user: loanObj.supplier.user
                };
            } else {
                loanObj.supplier_name = "Unknown Supplier";
            }
           
            return loanObj;
        });
       
        res.status(200).json(formattedLoans);
    } catch (error) {
        console.error('Error fetching loans:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET supplier's own loans
loanRouter.get('/supplier', auth, async (req, res) => {
    try {
      // Debug the user
      console.log("Supplier loans requested by user:", req.user.id);
     
      // First get the supplier ID for the authenticated user
      const supplier = await Supplier.findOne({ user: req.user.id });
     
      if (!supplier) {
        console.log("No supplier profile found for user:", req.user.id);
        return res.status(404).json({ message: 'Supplier profile not found' });
      }
     
      console.log("Found supplier:", supplier._id);
     
      // Get all loans for this supplier
      const loans = await Loan.find({ supplier: supplier._id })
        // Use createdAt from mongoose instead of created_at
        .sort({ createdAt: -1 })
        .populate('created_by', 'name');
     
      console.log(`Found ${loans.length} loans for supplier ${supplier._id}`);
     
      res.status(200).json(loans);
    } catch (error) {
      console.error('Error fetching supplier loans:', error);
      res.status(500).json({ message: error.message });
    }
  });

// GET single loan by ID
loanRouter.get('/:id', auth, async (req, res) => {
    try {
        const loan = await Loan.findById(req.params.id)
            .populate({
                path: 'supplier',
                select: 'name email user',
                populate: {
                    path: 'user',
                    select: 'name email'
                }
            })
            .populate('created_by', 'name email');
           
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }
       
        // Create a response object with all potentially useful date fields
        const loanObj = {
            ...loan.toObject(),
            createdAt: loan.createdAt,
            updatedAt: loan.updatedAt,
            start_date: loan.start_date,
            // Ensure we have a value for created_at
            created_at: loan.createdAt || loan.start_date || new Date()
        };
       
        res.status(200).json(loanObj);
    } catch (error) {
        console.error('Error fetching loan:', error);
        res.status(500).json({ message: error.message });
    }
});

// Updated POST route with transaction verification
loanRouter.post('/', auth, authorize('admin', 'owner', 'supplier'), async (req, res) => {
    try {
        const { supplier_id, amount, interest_rate, purpose, due_date } = req.body;
       
        // Check eligibility
        const eligibility = await checkLoanEligibility(supplier_id, amount);
       
        if (!eligibility.eligible || eligibility.limit <= 0) {
            return res.status(400).json({
                message: "You are not eligible for a loan at this time.",
                limit: eligibility.limit || 0,
                transaction_count: eligibility.transaction_count || 0
            });
        }
       
        const interestAmount = amount * (interest_rate / 100);
        const totalAmountWithInterest = amount + interestAmount;
       
        const loan = new Loan({
            supplier: supplier_id,
            created_by: req.user.id,
            amount,
            interest_rate,
            total_amount_with_interest: totalAmountWithInterest,
            total_paid: 0,
            principal_paid: 0,
            interest_paid: 0,
            status: 'pending',
            purpose,
            due_date,
            start_date: new Date()
        });
       
        await loan.save();
       
        const populatedLoan = await Loan.findById(loan._id)
            .populate('supplier')
            .populate('created_by', 'name');
       
        res.status(201).json(populatedLoan);
    } catch (error) {
        console.error('Loan creation error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Approval route with payment system integration
loanRouter.patch('/:id/approve', auth, authorize('admin', 'owner'), async (req, res) => {
    try {
        // Find the loan and populate supplier
        const loan = await Loan.findById(req.params.id).populate('supplier');
       
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }
       
        if (loan.status !== 'pending') {
            return res.status(400).json({
                message: `Cannot approve loan that is already ${loan.status}`
            });
        }
       
        // Set basic fields
        loan.total_paid = 0;
       
        // Update loan status and dates
        loan.status = 'approved';
        loan.approvalDate = new Date();
        loan.approvedBy = req.user.id;
       
        await loan.save();
       
        // Get or update the credit score
        let creditScore = await CreditScore.findOne({ supplier: loan.supplier });
        if (creditScore) {
            creditScore.remarks = `Loan #${loan._id} approved on ${new Date().toLocaleDateString()}`;
            await creditScore.save();
        }
       
        // Populate the response
        const populatedLoan = await Loan.findById(loan._id)
            .populate('supplier')
            .populate('created_by', 'name');
           
        res.status(200).json({
            message: 'Loan approved successfully',
            loan: populatedLoan
        });
    } catch (error) {
        console.error('Loan approval error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Rejection route
loanRouter.patch('/:id/reject', auth, authorize('admin', 'owner'), async (req, res) => {
    try {
        const loan = await Loan.findById(req.params.id);
       
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }
       
        if (loan.status !== 'pending') {
            return res.status(400).json({
                message: `Cannot reject loan that is already ${loan.status}`
            });
        }
       
        loan.status = 'rejected';
        await loan.save();
       
        const populatedLoan = await Loan.findById(loan._id)
            .populate('supplier')
            .populate('created_by', 'name');
           
        res.status(200).json({
            message: 'Loan rejected successfully',
            loan: populatedLoan
        });
    } catch (error) {
        console.error('Loan rejection error:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET loan payments
loanRouter.get('/:id/payments', auth, async (req, res) => {
    try {
        const loanId = req.params.id;
       
        // Verify loan exists
        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }
       
        // Get all payments for this loan
        const payments = await LoanPayment.find({ loan: loanId })
            .populate('transaction', 'transaction_number total_amount transaction_date')
            .sort({ payment_date: -1 });
           
        res.status(200).json({
            loan_id: loanId,
            total_paid: loan.total_paid || 0,
            remaining: loan.total_amount_with_interest - (loan.total_paid || 0),
            payments
        });
    } catch (error) {
        console.error('Error fetching loan payments:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST manual loan payment
loanRouter.post('/:id/payments', auth, authorize('admin', 'owner'), async (req, res) => {
    try {
        const loanId = req.params.id;
        const { amount, payment_method, reference_number, notes } = req.body;
       
        // Validate input
        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Valid payment amount is required' });
        }
       
        // Find the loan
        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }
       
        if (loan.status !== 'approved') {
            return res.status(400).json({ message: `Cannot make payment on ${loan.status} loan` });
        }
       
        // Create payment record
        const payment = new LoanPayment({
            loan: loanId,
            amount,
            payment_method: payment_method || 'manual',
            reference_number,
            notes,
            payment_date: new Date()
        });
       
        await payment.save();
       
        // LoanPayment.post('save') middleware will update the loan
       
        res.status(201).json({
            message: 'Payment recorded successfully',
            payment
        });
    } catch (error) {
        console.error('Error recording payment:', error);
        res.status(500).json({ message: error.message });
    }
});

// Cancel loan route
loanRouter.patch('/:id/cancel', auth, authorize('admin', 'owner', 'supplier'), async (req, res) => {
    try {
        const loan = await Loan.findById(req.params.id);
       
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }
       
        // Only pending or approved loans can be cancelled
        if (loan.status !== 'pending' && loan.status !== 'approved') {
            return res.status(400).json({
                message: `Cannot cancel loan that is ${loan.status}`
            });
        }
       
        // Check if supplier is trying to cancel their own loan
        if (req.user.role === 'supplier') {
            const supplier = await Supplier.findOne({ user: req.user.id });
           
            if (!supplier || !loan.supplier.equals(supplier._id)) {
                return res.status(403).json({
                    message: 'You can only cancel your own loans'
                });
            }
        }
       
        loan.status = 'cancelled';
        loan.cancelled_date = new Date();
        loan.cancelled_by = req.user.id;
        await loan.save();
       
        const populatedLoan = await Loan.findById(loan._id)
            .populate('supplier')
            .populate('created_by', 'name');
           
        res.status(200).json({
            message: 'Loan cancelled successfully',
            loan: populatedLoan
        });
    } catch (error) {
        console.error('Loan cancellation error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Void loan route (admin only)
loanRouter.patch('/:id/void', auth, authorize('admin'), async (req, res) => {
    try {
        const loan = await Loan.findById(req.params.id);
       
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }
       
        // Only pending or approved loans can be voided
        if (loan.status !== 'pending' && loan.status !== 'approved') {
            return res.status(400).json({
                message: `Cannot void loan that is ${loan.status}`
            });
        }
       
        loan.status = 'voided';
        loan.voided_date = new Date();
        loan.voided_by = req.user.id;
        loan.void_reason = req.body.reason || 'Administrative void';
        await loan.save();
       
        const populatedLoan = await Loan.findById(loan._id)
            .populate('supplier')
            .populate('created_by', 'name');
           
        res.status(200).json({
            message: 'Loan voided successfully',
            loan: populatedLoan
        });
    } catch (error) {
        console.error('Loan voiding error:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = loanRouter;