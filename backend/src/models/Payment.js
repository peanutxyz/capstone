const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
   transaction: {
       type: mongoose.Schema.Types.ObjectId,
       ref: 'Transaction',
       required: true
   },
   amount: {
       type: Number,
       required: true,
       min: 0
   },
   type: {
       type: String,
       enum: ['cash', 'bank', 'credit'],
       required: true
   },
   reference_number: {
       type: String,
       unique: true,
       default: () => `PAY${Date.now()}`
   },
   payment_date: {
       type: Date,
       required: true,
       default: Date.now
   },
   processed_by: {
       type: mongoose.Schema.Types.ObjectId,
       ref: 'User',
       required: true
   },
   bank_details: {
       bank_name: { type: String },
       account_number: { type: String },
       receipt_number: { type: String }
   },
   notes: { type: String }
}, { timestamps: true });



// Pre-save middleware to update transaction paid amount
paymentSchema.pre('save', async function(next) {
    if (this.isNew) {
        try {
            const Transaction = mongoose.model('Transaction');
            const transaction = await Transaction.findById(this.transaction);
            
            if (!transaction) {
                return next(new Error('Transaction not found'));
            }
 
            // Update the transaction's paid amount
            transaction.paid_amount += this.amount;
 
            // Check if transaction is fully paid
            if (transaction.paid_amount >= transaction.total_amount) {
                transaction.status = 'completed';
            } else {
                transaction.status = 'pending'; // Keep as pending for partial payments
            }
            
            await transaction.save();
        } catch (error) {
            return next(error); // Propagate errors
        }
    }
    next();
 });
// Static method to get payment history for a transaction
paymentSchema.statics.getTransactionPayments = function(transactionId) {
   return this.find({ transaction: transactionId })
       .sort({ payment_date: -1 })
       .populate('processed_by', 'name');
};

module.exports = mongoose.model('Payment', paymentSchema);
