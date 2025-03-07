// src/routes/transaction.routes.js

const express = require('express');
const transactionRouter = express.Router();
const { auth, authorize } = require('../middleware/auth');
const mongoose = require('mongoose');

// Import all models at the top to avoid circular dependency issues
const Transaction = require('../models/Transaction');
const Loan = require('../models/Loan');
const LoanPayment = require('../models/LoanPayment');
const Supplier = require('../models/Supplier');
const CreditScore = require('../models/CreditScore');

console.log("DEBUGGING: Transaction routes loaded");

// Generate transaction reports
transactionRouter.get('/report', auth, authorize('admin', 'owner'), async (req, res) => {
    try {
        const { startDate, endDate, type, status } = req.query;
       
        // Build query filters
        const query = { is_deleted: false };
       
        if (startDate && endDate) {
            query.transaction_date = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }
       
        if (type) query.type = type;
        if (status) query.status = status;
       
        // Fetch transactions with populated fields
        const transactions = await Transaction.find(query)
            .populate({
                path: 'supplier',
                populate: { path: 'user', select: 'name' }
            })
            .populate('created_by', 'name')
            .sort({ transaction_date: -1 });
           
        // Calculate summary statistics
        const summary = {
            totalTransactions: transactions.length,
            totalQuantity: transactions.reduce((sum, t) => sum + t.quantity, 0),
            totalAmount: transactions.reduce((sum, t) => sum + t.total_amount, 0),
            completedTransactions: transactions.filter(t => t.status === 'completed').length,
            cancelledTransactions: transactions.filter(t => t.status === 'cancelled').length,
            voidedTransactions: transactions.filter(t => t.status === 'voided').length,
            totalPaidAmount: transactions.reduce((sum, t) => sum + (t.paid_amount || 0), 0),
            totalUnpaidAmount: transactions.reduce((sum, t) =>
                sum + ((t.total_amount || 0) - (t.paid_amount || 0)), 0)
        };

        res.json({
            summary,
            transactions,
            filters: {
                startDate,
                endDate,
                type,
                status
            }
        });
    } catch (error) {
        console.error('Report generation error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Get all transactions
transactionRouter.get('/', auth, authorize('admin', 'owner'), async (req, res) => {
    try {
      const transactions = await Transaction.find({ is_deleted: false })
        .populate({
          path: 'supplier',
          populate: { path: 'user', select: 'name' }
        })
        .populate('created_by', 'name')
        .sort({ createdAt: -1 });
       
      res.json(transactions);
    } catch (error) {
      console.error('Transaction fetch error:', error);
      res.status(500).json({ message: error.message });
    }
});

// Get transactions for current supplier
transactionRouter.get('/supplier', auth, async (req, res) => {
    try {
      // First, find the supplier associated with the current user
      const supplier = await Supplier.findOne({ user: req.user.id });
     
      if (!supplier) {
        return res.status(404).json({ message: 'Supplier not found for current user' });
      }
     
      // Then find all transactions for this supplier
      const transactions = await Transaction.find({
        supplier: supplier._id,
        is_deleted: false
      })
      .populate('created_by', 'name')
      .sort({ createdAt: -1 });
     
      res.json(transactions);
    } catch (error) {
      console.error('Supplier transaction fetch error:', error);
      res.status(500).json({ message: error.message });
    }
});

// Create transaction with auto-debit
transactionRouter.post('/', auth, authorize('admin', 'owner'), async (req, res) => {
    try {
        console.log('DEBUGGING: Received transaction data:', req.body);
       
        const {
            supplier,
            type = 'purchase',
            quantity,
            less_kilo,
            unit_price,
            transaction_date,
            status = 'completed' // Default to completed
        } = req.body;
       
        // Validate required fields
        if (!supplier || !quantity || !unit_price) {
            return res.status(400).json({
                message: 'Missing required fields',
                requiredFields: {
                    supplier: !!supplier,
                    quantity: !!quantity,
                    unit_price: !!unit_price
                }
            });
        }
       
        const total_kilo = Number(quantity) - (Number(less_kilo) || 0);
        const total_price = total_kilo * Number(unit_price);
       
        console.log(`DEBUGGING: Creating transaction for supplier: ${supplier}, amount: ${total_price}`);
        
        const transaction = new Transaction({
            supplier,
            created_by: req.user.id,
            transaction_number: `TRX${Date.now()}`,
            type,
            quantity: Number(quantity),
            less_kilo: Number(less_kilo) || 0,
            total_kilo,
            unit_price: Number(unit_price),
            total_price,
            total_amount: total_price,
            // IMPORTANT: Don't set paid_amount here
            transaction_date: new Date(transaction_date),
            status
        });
       
        // Save the transaction first to get its ID
        await transaction.save();
       
        // Find any approved loans for this supplier
        const loans = await Loan.find({
            supplier: supplier,
            status: 'approved'
        }).sort({ createdAt: 1 }); // Process oldest loans first
       
        console.log(`DEBUGGING: Found ${loans.length} approved loans for supplier ${supplier}`);
        
        if (loans.length > 0) {
            // Log first loan details for debugging
            const firstLoan = loans[0];
            console.log('DEBUGGING: First loan details:', {
                id: firstLoan._id,
                amount: firstLoan.amount,
                total_paid: firstLoan.total_paid || 0,
                status: firstLoan.status
            });
            
            // Take the first loan (oldest)
            const loan = loans[0];
            
            // Calculate remaining loan amount
            const remainingLoanAmount = loan.amount - (loan.total_paid || 0);
            
            // Deduct the full transaction amount or remaining loan amount (whichever is smaller)
            const deductionAmount = Math.min(total_price, remainingLoanAmount);
            
            console.log(`DEBUGGING: Deduction amount: ${deductionAmount}, Transaction amount: ${total_price}, Remaining loan: ${remainingLoanAmount}`);
            
            if (deductionAmount > 0) {
                // Update transaction with deduction information
                transaction.loan_deduction = deductionAmount;
                transaction.amount_after_deduction = total_price - deductionAmount;
                transaction.paid_amount = transaction.amount_after_deduction;
                
                // Track which loan was paid
                transaction.loan_payments = [{
                    loan: loan._id,
                    amount: deductionAmount
                }];
                
                // Update the transaction first
                await transaction.save();
                
                // Create payment record with unique reference number
                const LoanPayment = mongoose.model('LoanPayment');
                const payment = new LoanPayment({
                    loan: loan._id,
                    transaction: transaction._id,
                    amount: deductionAmount,
                    payment_method: 'auto-debit',
                    payment_date: new Date(),
                    // Generate a unique reference number to avoid collisions
                    reference_number: `TXN-${transaction._id.toString().slice(-6)}-${Date.now()}`,
                    notes: `Auto-debit from transaction #${transaction.transaction_number}`
                });
                
                // Save the payment
                await payment.save();
                
                // Update loan payment totals
                loan.total_paid = (loan.total_paid || 0) + deductionAmount;
                loan.lastPaymentDate = new Date();
                
                // Check if loan is fully paid
                if (loan.total_paid >= loan.amount) {
                    loan.status = 'paid';
                    loan.completionDate = new Date();
                    console.log(`DEBUGGING: Loan ${loan._id} marked as fully paid`);
                }
                
                // Save the loan
                await loan.save();
                
                console.log(`DEBUGGING: Applied ${deductionAmount} deduction to loan ${loan._id}`);
            } else {
                console.log(`DEBUGGING: No deduction applied - loan may be fully paid already`);
            }
        } else {
            // No loans or no remaining loan amount, so no deduction
            transaction.loan_deduction = 0;
            transaction.amount_after_deduction = total_price;
            transaction.paid_amount = total_price;
            
            await transaction.save();
            console.log(`DEBUGGING: No loans found, no deduction applied`);
        }
        
        // Fetch the final updated transaction with populated fields
        const populatedTransaction = await Transaction.findById(transaction._id)
            .populate({
                path: 'supplier',
                populate: { path: 'user', select: 'name' }
            })
            .populate('created_by', 'name');
        
        res.status(201).json(populatedTransaction);
    } catch (error) {
        console.error('Transaction creation error:', error);
        res.status(500).json({ 
            message: error.message, 
            stack: error.stack 
        });
    }
});


// Get transaction by ID
transactionRouter.get('/:id', auth, async (req, res) => {
    try {
      const transaction = await Transaction.findOne({
        _id: req.params.id,
        is_deleted: false
      })
      .populate({
        path: 'supplier',
        populate: { path: 'user', select: 'name' }
      })
      .populate('created_by', 'name');
     
      if (!transaction) {
        return res.status(404).json({ message: 'Transaction not found' });
      }
     
      res.json(transaction);
    } catch (error) {
      console.error('Transaction fetch error:', error);
      res.status(500).json({ message: error.message });
    }
});

// Update transaction
transactionRouter.put('/:id', auth, authorize('admin', 'owner'), async (req, res) => {
    try {
        const transaction = await Transaction.findById(req.params.id);
       
        if (!transaction) {
            return res.status(404).json({ message: 'Transaction not found' });
        }
        
        // Update fields
        Object.keys(req.body).forEach(key => {
            transaction[key] = req.body[key];
        });
        
        await transaction.save();
        
        const updatedTransaction = await Transaction.findById(transaction._id)
            .populate({
                path: 'supplier',
                populate: { path: 'user', select: 'name' }
            })
            .populate('created_by', 'name');
            
        res.json(updatedTransaction);
    } catch (error) {
        console.error('Transaction update error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Cancel transaction
transactionRouter.patch('/:id/cancel', auth, authorize('admin', 'owner'), async (req, res) => {
    // Start a session for transaction atomicity
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const transaction = await Transaction.findById(req.params.id);
       
        if (!transaction) {
            return res.status(404).json({ message: 'Transaction not found' });
        }
        
        // Only completed transactions can be cancelled
        if (transaction.status !== 'completed') {
            return res.status(400).json({
                message: `Cannot cancel transaction with status: ${transaction.status}. Only completed transactions can be cancelled.`
            });
        }
        
        // If this transaction had loan deductions, we need to reverse them
        if (transaction.loan_deduction > 0 && transaction.loan_payments && transaction.loan_payments.length > 0) {
            for (const payment of transaction.loan_payments) {
                // Find the loan
                const loan = await Loan.findById(payment.loan);
                if (loan) {
                    // Reverse the payment
                    loan.total_paid -= payment.amount;
                    
                    // If loan was marked as paid but now isn't fully paid, revert status
                    if (loan.status === 'paid' && loan.total_paid < loan.amount) {
                        loan.status = 'approved';
                        loan.completionDate = null;
                    }
                    
                    await loan.save({ session });
                    
                    // Find and delete the loan payment record
                    await LoanPayment.deleteOne({ 
                        transaction: transaction._id,
                        loan: payment.loan 
                    }).session(session);
                    
                    console.log(`DEBUGGING: Reversed loan payment of ${payment.amount} for loan ${payment.loan}`);
                }
            }
        }
        
        // Update transaction status
        transaction.status = 'cancelled';
        transaction.loan_deduction = 0;
        transaction.loan_payments = [];
        transaction.paid_amount = 0;
        
        await transaction.save({ session });
        
        // Commit the transaction
        await session.commitTransaction();
        session.endSession();
        
        const updatedTransaction = await Transaction.findById(req.params.id)
            .populate({
                path: 'supplier',
                populate: { path: 'user', select: 'name' }
            })
            .populate('created_by', 'name');
            
        res.json(updatedTransaction);
    } catch (error) {
        // Abort the transaction on error
        await session.abortTransaction();
        session.endSession();
        
        console.error('Transaction cancellation error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Void transaction
transactionRouter.patch('/:id/void', auth, authorize('admin', 'owner'), async (req, res) => {
    // Start a session for transaction atomicity
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const transaction = await Transaction.findById(req.params.id);
       
        if (!transaction) {
            return res.status(404).json({ message: 'Transaction not found' });
        }
        
        // Only completed transactions can be voided
        if (transaction.status !== 'completed') {
            return res.status(400).json({
                message: `Cannot void transaction with status: ${transaction.status}. Only completed transactions can be voided.`
            });
        }
        
        // If this transaction had loan deductions, we need to reverse them
        if (transaction.loan_deduction > 0 && transaction.loan_payments && transaction.loan_payments.length > 0) {
            for (const payment of transaction.loan_payments) {
                // Find the loan
                const loan = await Loan.findById(payment.loan);
                if (loan) {
                    // Reverse the payment
                    loan.total_paid -= payment.amount;
                    
                    // If loan was marked as paid but now isn't fully paid, revert status
                    if (loan.status === 'paid' && loan.total_paid < loan.amount) {
                        loan.status = 'approved';
                        loan.completionDate = null;
                    }
                    
                    await loan.save({ session });
                    
                    // Find and delete the loan payment record
                    await LoanPayment.deleteOne({ 
                        transaction: transaction._id,
                        loan: payment.loan 
                    }).session(session);
                    
                    console.log(`DEBUGGING: Reversed loan payment of ${payment.amount} for loan ${payment.loan}`);
                }
            }
        }
        
        // Update transaction status
        transaction.status = 'voided';
        transaction.loan_deduction = 0;
        transaction.loan_payments = [];
        transaction.paid_amount = 0;
        
        await transaction.save({ session });
        
        // Commit the transaction
        await session.commitTransaction();
        session.endSession();
        
        const updatedTransaction = await Transaction.findById(req.params.id)
            .populate({
                path: 'supplier',
                populate: { path: 'user', select: 'name' }
            })
            .populate('created_by', 'name');
            
        res.json(updatedTransaction);
    } catch (error) {
        // Abort the transaction on error
        await session.abortTransaction();
        session.endSession();
        
        console.error('Transaction void error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Soft delete transaction
transactionRouter.delete('/:id', auth, authorize('admin'), async (req, res) => {
    try {
        const transaction = await Transaction.findById(req.params.id);
       
        if (!transaction) {
            return res.status(404).json({ message: 'Transaction not found' });
        }
        
        transaction.is_deleted = true;
        await transaction.save();
        
        res.json({ message: 'Transaction deleted successfully' });
    } catch (error) {
        console.error('Transaction deletion error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Debugging routes
transactionRouter.get('/debug/loans', auth, async (req, res) => {
    try {
        const loans = await Loan.find();
        res.json({
            count: loans.length,
            loans: loans.map(loan => ({
                _id: loan._id,
                supplier: loan.supplier,
                amount: loan.amount,
                status: loan.status,
                total_paid: loan.total_paid,
                created_at: loan.createdAt
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

transactionRouter.get('/debug/payments', auth, async (req, res) => {
    try {
        const payments = await LoanPayment.find();
        res.json({
            count: payments.length,
            payments: payments.map(payment => ({
                _id: payment._id,
                loan: payment.loan,
                transaction: payment.transaction,
                amount: payment.amount,
                created_at: payment.createdAt
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = transactionRouter;