// src/controllers/transaction.controller.js

const Transaction = require('../models/Transaction');
const Supplier = require('../models/Supplier');
const Loan = require('../models/Loan');
const LoanPayment = require('../models/LoanPayment');

exports.createTransaction = async (req, res) => {
  try {
    const { supplier_id, quantity, unit_price, transaction_date, description } = req.body;
    
    // Calculate total amount
    const total_amount = quantity * unit_price;
    
    // Start a session for transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Create the transaction
      const transaction = new Transaction({
        supplier: supplier_id,
        quantity,
        unit_price,
        total_amount,
        transaction_date: transaction_date || new Date(),
        description,
        created_by: req.user.id,
        status: 'pending' // Start with pending until auto-debit logic processes
      });
      
      // Find any outstanding approved loans for this supplier
      const outstandingLoans = await Loan.find({
        supplier: supplier_id,
        status: 'approved',
        remainingAmount: { $gt: 0 }
      }).sort({ createdAt: 1 }); // Process oldest loans first
      
      console.log(`Found ${outstandingLoans.length} outstanding loans for supplier ${supplier_id}`);
      
      let remainingTransactionAmount = total_amount;
      let deductions = [];
      
      // Process each outstanding loan
      for (const loan of outstandingLoans) {
        if (remainingTransactionAmount <= 0) break;
        
        // Calculate amount to deduct for this loan (up to 40% of transaction or remaining loan amount)
        const maxDeduction = Math.min(
          remainingTransactionAmount * 0.4, // 40% of transaction
          loan.remainingAmount // Don't exceed loan balance
        );
        
        if (maxDeduction > 0) {
          // Create payment record
          const payment = new LoanPayment({
            loan: loan._id,
            transaction: transaction._id,
            amount: maxDeduction,
            payment_method: 'auto-debit',
            payment_date: new Date(),
            notes: `Auto-debit from transaction #${transaction._id}`
          });
          
          await payment.save({ session });
          
          // Update loan remaining amount
          loan.remainingAmount -= maxDeduction;
          
          // Check if loan is fully paid
          if (loan.remainingAmount <= 0) {
            loan.status = 'paid';
            loan.completionDate = new Date();
          }
          
          // Update last payment date
          loan.lastPaymentDate = new Date();
          
          await loan.save({ session });
          
          // Track deduction
          deductions.push({
            loan_id: loan._id,
            amount: maxDeduction
          });
          
          // Reduce remaining transaction amount
          remainingTransactionAmount -= maxDeduction;
        }
      }
      
      // Update transaction with deduction information
      transaction.deductions = deductions;
      transaction.deducted_amount = total_amount - remainingTransactionAmount;
      transaction.final_amount = remainingTransactionAmount;
      transaction.status = 'completed'; // Mark as completed after processing
      
      await transaction.save({ session });
      
      // Commit the transaction
      await session.commitTransaction();
      session.endSession();
      
      // Return the result
      res.status(201).json({
        message: 'Transaction created successfully',
        transaction,
        deductions
      });
    } catch (error) {
      // Abort the transaction in case of error
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};