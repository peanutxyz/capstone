// src/routes/payment.routes.js
const express = require('express');
const paymentRouter = express.Router();
const { auth, authorize } = require('../middleware/auth');
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');

// Add payment for transaction
paymentRouter.post('/', auth, authorize('admin', 'owner'), async (req, res) => {
    try {
        const { 
            transaction_id, 
            amount, 
            type,  // Must be one of: 'cash', 'bank', 'credit'
            reference_number, 
            payment_date,
            bank_details // Optional, include if type is 'bank'
        } = req.body;

        // Find transaction first to confirm it exists
        const transaction = await Transaction.findById(transaction_id);
        if (!transaction) {
            return res.status(404).json({ message: 'Transaction not found' });
        }

        // Check if payment amount is valid
        if (transaction.paid_amount >= transaction.total_amount) {
            transaction.status = 'completed';
        } else {
            transaction.status = 'pending'; // Use 'pending' for partial payments
        }

        // Create payment record
        const payment = new Payment({
            transaction: transaction_id,
            amount,
            type,  // This is required and must match enum values
            reference_number,
            payment_date: payment_date || new Date(),
            processed_by: req.user.id,
            bank_details: type === 'bank' ? bank_details : undefined,
            notes: `Payment for transaction ${transaction.transaction_number}`
        });

        await payment.save();

        // Populate the payment response
        const populatedPayment = await Payment.findById(payment._id)
            .populate('transaction', 'transaction_number total_amount paid_amount status')
            .populate('processed_by', 'name');

        res.status(201).json({
            message: 'Payment recorded successfully',
            payment: populatedPayment,
            transaction_status: transaction.status,
            remaining_balance: transaction.total_amount - transaction.paid_amount
        });
    } catch (error) {
        console.error('Payment creation error:', error);
        res.status(500).json({ message: error.message });
    }
});
module.exports = paymentRouter;