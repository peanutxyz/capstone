// src/controllers/creditScore.controller.js

const { creditScoreUtils } = require('../lib/utils');
const CreditScore = require('../models/CreditScore');
const Supplier = require('../models/Supplier');
const Transaction = require('../models/Transaction');

exports.getSupplierCreditScore = async (req, res) => {
  try {
    const { supplierId } = req.params;
    
    // Check if supplier exists
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    
    // Get all completed transactions for this supplier
    const supplierTransactions = await Transaction.find({
      supplier: supplierId,
      status: 'completed'
    });
    
    // Calculate credit score components
    const creditDetails = creditScoreUtils.calculateCreditScoreComponents(supplierTransactions);
    
    // Get or create credit score record
    let creditScoreRecord = await CreditScore.findOne({ supplier: supplierId });
    
    if (!creditScoreRecord) {
      creditScoreRecord = new CreditScore({
        supplier: supplierId,
        score: creditDetails.score,
        transaction_consistency: creditDetails.transactionConsistency,
        total_supply_score: creditDetails.totalSupplyScore,
        transaction_count_score: creditDetails.transactionCountScore,
        eligible_amount: creditDetails.eligibleAmount,
        transaction_count: creditDetails.transactionCount,
        credit_percentage: creditDetails.creditPercentage,
        average_transaction: creditDetails.averageTransaction,
        assessment_date: new Date(),
        remarks: creditDetails.transactionCount === 1
          ? "Initial score based on first transaction"
          : "Score calculated from transaction history"
      });
    } else {
      // Update existing record
      creditScoreRecord.score = creditDetails.score;
      creditScoreRecord.transaction_consistency = creditDetails.transactionConsistency;
      creditScoreRecord.total_supply_score = creditDetails.totalSupplyScore;
      creditScoreRecord.transaction_count_score = creditDetails.transactionCountScore;
      creditScoreRecord.eligible_amount = creditDetails.eligibleAmount;
      creditScoreRecord.transaction_count = creditDetails.transactionCount;
      creditScoreRecord.credit_percentage = creditDetails.creditPercentage;
      creditScoreRecord.average_transaction = creditDetails.averageTransaction;
      creditScoreRecord.assessment_date = new Date();
      creditScoreRecord.remarks = "Updated credit score based on transaction history";
    }
    
    await creditScoreRecord.save();
    
    res.status(200).json({
      creditScore: creditScoreRecord,
      details: creditDetails
    });
  } catch (error) {
    console.error('Error calculating credit score:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get latest credit score with a simple endpoint (for frontend compatibility)
exports.getLatestCreditScore = async (req, res) => {
  try {
    const { supplierId } = req.params;
    
    const latestScore = await CreditScore.findOne({ supplier: supplierId })
      .sort({ assessment_date: -1 });
    
    if (!latestScore) {
      // Check if supplier has any transactions
      const transactions = await Transaction.find({
        supplier: supplierId,
        status: 'completed'
      });
      
      const transactionCount = transactions.length;
      
      if (transactionCount > 0) {
        // Calculate credit score on the fly
        const creditDetails = creditScoreUtils.calculateCreditScoreComponents(transactions);
        
        return res.json({
          supplier: supplierId,
          score: creditDetails.score,
          category: creditScoreUtils.getScoreCategory(creditDetails.score),
          transaction_consistency: creditDetails.transactionConsistency,
          total_supply_score: creditDetails.totalSupplyScore,
          transaction_count_score: creditDetails.transactionCountScore,
          eligible_amount: creditDetails.eligibleAmount,
          credit_percentage: creditDetails.creditPercentage,
          transaction_count: creditDetails.transactionCount,
          average_transaction: creditDetails.averageTransaction,
          assessment_date: new Date(),
          is_eligible: creditDetails.isEligible,
          remarks: "Score calculated from transaction history"
        });
      } else {
        // No transactions yet - not eligible for loans
        return res.json({
          supplier: supplierId,
          score: 0,
          category: creditScoreUtils.getScoreCategory(0),
          transaction_consistency: 0,
          total_supply_score: 0,
          transaction_count_score: 0,
          eligible_amount: 0,
          credit_percentage: 0,
          transaction_count: 0,
          assessment_date: new Date(),
          is_eligible: false,
          remarks: "New supplier - no transaction history. Transactions required for loan eligibility."
        });
      }
    }
    
    res.json({
      ...latestScore.toObject(),
      category: creditScoreUtils.getScoreCategory(latestScore.score),
      is_eligible: latestScore.transaction_count > 0 && latestScore.score >= 30
    });
  } catch (error) {
    console.error("Error fetching credit score:", error);
    // Even on error, return a default response that's safe
    res.json({
      supplier: req.params.supplierId,
      score: 0,
      category: 'No Score',
      transaction_count: 0,
      is_eligible: false,
      assessment_date: new Date(),
      remarks: "Error retrieving score - using conservative default"
    });
  }
};