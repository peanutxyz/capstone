// src/controllers/loan.controller.js

const Loan = require('../models/Loan');
const CreditScore = require('../models/CreditScore');
const Transaction = require('../models/Transaction');
const { creditScoreUtils } = require('../lib/utils');
const { recalculateSupplierBalance } = require('../lib/utils/supplierBalanceUtils');

exports.approveLoan = async (req, res) => {
  try {
    const { loanId } = req.params;
    const { approvedAmount } = req.body;
   
    const loan = await Loan.findById(loanId);
    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }
   
    if (loan.status !== 'pending') {
      return res.status(400).json({ message: `Loan is already ${loan.status}` });
    }
   
    // Update loan with approved amount and status
    loan.amount = approvedAmount || loan.amount;
    loan.remainingAmount = loan.amount;
    loan.status = 'approved';
    loan.approvalDate = new Date();
    loan.approvedBy = req.user._id;
   
    await loan.save();
    
    // Update supplier balance after loan approval
    try {
      await recalculateSupplierBalance(loan.supplier);
      console.log(`Updated supplier balance after loan approval for supplier ${loan.supplier}`);
    } catch (balanceError) {
      console.error('Error updating supplier balance:', balanceError);
    }
   
    res.status(200).json({
      message: 'Loan approved successfully',
      loan
    });
  } catch (error) {
    console.error('Error approving loan:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Check loan eligibility with standardized approach - No minimum limit
async function checkLoanEligibility(supplierId, requestedAmount) {
  try {
    // First check if supplier has any transactions
    const transactions = await Transaction.find({
      supplier: supplierId,
      status: 'completed'
    });
   
    const transactionCount = transactions.length;
   
    // Suppliers must have at least one transaction to be eligible
    if (transactionCount === 0) {
      return {
        eligible: false,
        limit: 0,
        message: "Supplier must complete at least one transaction before being eligible for loans."
      };
    }
   
    // Get the credit score
    const creditScore = await CreditScore.findOne({ supplier: supplierId })
      .sort({ assessment_date: -1 });
   
    if (!creditScore) {
      // Calculate credit score on the fly if not found
      const creditDetails = creditScoreUtils.calculateCreditScoreComponents(transactions);
     
      // Use calculated limit without applying a minimum
      const loanLimit = creditDetails.eligibleAmount;
     
      return {
        eligible: requestedAmount <= loanLimit && creditDetails.isEligible,
        limit: loanLimit,
        transaction_count: transactionCount,
        score: creditDetails.score,
        message: requestedAmount <= loanLimit
          ? "Loan amount within acceptable limit"
          : `Loan amount exceeds limit of ₱${loanLimit}`
      };
    }
   
    // Use the credit score's eligible amount directly and check against threshold of 20
    return {
      eligible: requestedAmount <= creditScore.eligible_amount && creditScore.score >= 20,
      limit: creditScore.eligible_amount,
      score: creditScore.score,
      transaction_count: creditScore.transaction_count,
      message: requestedAmount <= creditScore.eligible_amount
        ? "Loan amount within acceptable limit"
        : `Loan amount exceeds limit of ₱${creditScore.eligible_amount} for credit score ${creditScore.score}`
    };
  } catch (error) {
    console.error("Error checking loan eligibility:", error);
    throw error;
  }
}

// Export for use in routes
exports.checkLoanEligibility = checkLoanEligibility;