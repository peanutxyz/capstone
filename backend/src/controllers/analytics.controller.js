// src/controllers/analytics.controller.js

const mongoose = require('mongoose');
const io = require('../socket');
const Transaction = require('../models/Transaction');
const Supplier = require('../models/Supplier');
const Loan = require('../models/Loan');
const LoanPayment = require('../models/LoanPayment');
const CreditScore = require('../models/CreditScore');
const CreditScoreAnalytics = require('../models/CreditScoreAnalytics');

// Calculate admin dashboard analytics
const calculateAdminAnalytics = async () => {
  try {
    // Transaction metrics
    const totalTransactions = await Transaction.countDocuments();
    const totalTransactionValue = await Transaction.aggregate([
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    
    // Supplier metrics
    const totalSuppliers = await Supplier.countDocuments();
    const activeSuppliers = await Supplier.countDocuments({ status: 'active' });
    
    // Loan metrics
    const totalLoans = await Loan.countDocuments();
    const pendingLoans = await Loan.countDocuments({ status: 'pending' });
    const totalLoanValue = await Loan.aggregate([
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const outstandingLoanValue = await Loan.aggregate([
      { $match: { status: { $nin: ['paid', 'rejected'] } } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    
    // Credit score metrics
    const averageCreditScore = await CreditScore.aggregate([
      { $group: { _id: null, average: { $avg: "$score" } } }
    ]);
    
    // Recent transactions
    const recentTransactions = await Transaction.find()
      .sort({ created_at: -1 })
      .limit(10)
      .populate('supplier', 'name')
    
    // Transaction trends (monthly)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const monthlyTransactions = await Transaction.aggregate([
      { $match: { created_at: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { 
            year: { $year: "$created_at" }, 
            month: { $month: "$created_at" } 
          },
          count: { $sum: 1 },
          total: { $sum: "$amount" }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);
    
    // Credit score distribution
    const creditScoreDistribution = await CreditScore.aggregate([
      {
        $group: {
          _id: {
            $switch: {
              branches: [
                { case: { $lte: ["$score", 40] }, then: "Poor" },
                { case: { $lte: ["$score", 60] }, then: "Fair" },
                { case: { $lte: ["$score", 80] }, then: "Good" },
              ],
              default: "Excellent"
            }
          },
          count: { $sum: 1 }
        }
      }
    ]);
    
    return {
      overview: {
        totalTransactions: totalTransactions,
        totalTransactionValue: totalTransactionValue[0]?.total || 0,
        totalSuppliers: totalSuppliers,
        activeSuppliers: activeSuppliers,
        totalLoans: totalLoans,
        pendingLoans: pendingLoans,
        totalLoanValue: totalLoanValue[0]?.total || 0,
        outstandingLoanValue: outstandingLoanValue[0]?.total || 0,
        averageCreditScore: averageCreditScore[0]?.average || 0
      },
      recentTransactions: recentTransactions,
      trends: {
        monthlyTransactions: monthlyTransactions
      },
      creditMetrics: {
        distribution: creditScoreDistribution
      }
    };
  } catch (error) {
    console.error("Error calculating admin analytics:", error);
    return {};
  }
};

// Calculate supplier-specific analytics
const calculateSupplierAnalytics = async (supplierId) => {
  try {
    if (!supplierId) return null;
    
    // Supplier's transaction data
    const transactions = await Transaction.find({ supplier: supplierId });
    const totalTransactions = transactions.length;
    const totalValue = transactions.reduce((sum, t) => sum + t.amount, 0);
    
    // Transaction trend (monthly)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const monthlyTransactions = await Transaction.aggregate([
      { $match: { 
        supplier: mongoose.Types.ObjectId(supplierId),
        created_at: { $gte: sixMonthsAgo }
      }},
      {
        $group: {
          _id: { 
            year: { $year: "$created_at" }, 
            month: { $month: "$created_at" } 
          },
          count: { $sum: 1 },
          total: { $sum: "$amount" }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);
    
    // Loan data
    const loans = await Loan.find({ supplier: supplierId });
    const totalLoans = loans.length;
    const outstandingLoans = loans.filter(loan => 
      loan.status !== 'paid' && loan.status !== 'rejected'
    ).length;
    const totalLoanAmount = loans.reduce((sum, loan) => sum + loan.amount, 0);
    const outstandingAmount = loans
      .filter(loan => loan.status !== 'paid' && loan.status !== 'rejected')
      .reduce((sum, loan) => sum + loan.amount, 0);
    
    // Credit score data
    const creditScores = await CreditScore.find({ supplier: supplierId })
      .sort({ assessment_date: -1 })
      .limit(10);
    
    const latestScore = creditScores.length > 0 ? creditScores[0] : null;
    
    // Format history for charting
    const creditScoreHistory = creditScores.map(score => ({
      date: score.assessment_date,
      score: score.score
    })).reverse();
    
    return {
      overview: {
        totalTransactions,
        totalValue,
        totalLoans,
        outstandingLoans,
        totalLoanAmount,
        outstandingAmount,
        currentCreditScore: latestScore?.score || 0
      },
      trends: {
        monthlyTransactions
      },
      creditScore: {
        current: latestScore?.score || 0,
        category: latestScore ? getScoreCategory(latestScore.score) : "N/A",
        history: creditScoreHistory
      }
    };
  } catch (error) {
    console.error("Error calculating supplier analytics:", error);
    return null;
  }
};

// Calculate credit score analytics
const calculateCreditScoreAnalytics = async () => {
  try {
    // Average credit score
    const averageScore = await CreditScore.aggregate([
      { $group: { _id: null, average: { $avg: "$score" } } }
    ]);
    
    // Distribution by score category
    const distribution = await CreditScore.aggregate([
      {
        $group: {
          _id: {
            $switch: {
              branches: [
                { case: { $lte: ["$score", 40] }, then: "Poor" },
                { case: { $lte: ["$score", 60] }, then: "Fair" },
                { case: { $lte: ["$score", 80] }, then: "Good" },
              ],
              default: "Excellent"
            }
          },
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Monthly average scores trend
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const monthlyAverages = await CreditScore.aggregate([
      { $match: { assessment_date: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { 
            year: { $year: "$assessment_date" }, 
            month: { $month: "$assessment_date" } 
          },
          average: { $avg: "$score" }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);
    
    // Suppliers with improving scores (last 3 months)
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    const allSuppliers = await Supplier.find();
    const improvingSuppliers = [];
    
    for (const supplier of allSuppliers) {
      const scores = await CreditScore.find({
        supplier: supplier._id,
        assessment_date: { $gte: threeMonthsAgo }
      }).sort({ assessment_date: 1 });
      
      if (scores.length >= 2) {
        const firstScore = scores[0].score;
        const lastScore = scores[scores.length - 1].score;
        
        if (lastScore > firstScore) {
          improvingSuppliers.push({
            supplier: supplier.name,
            improvement: lastScore - firstScore,
            currentScore: lastScore
          });
        }
      }
    }
    
    return {
      overview: {
        averageScore: averageScore[0]?.average || 0,
        distribution
      },
      trends: {
        monthlyAverages
      },
      improvingSuppliers: improvingSuppliers.sort((a, b) => b.improvement - a.improvement).slice(0, 5)
    };
  } catch (error) {
    console.error("Error calculating credit score analytics:", error);
    return {};
  }
};

// Utility function to get score category
const getScoreCategory = (score) => {
  if (score <= 40) return "Poor";
  if (score <= 60) return "Fair";
  if (score <= 80) return "Good";
  return "Excellent";
};

// Send analytics updates through socket.io
const emitAnalyticsUpdate = async (type, data) => {
  try {
    switch(type) {
      case 'transaction':
        // Recalculate admin analytics
        const adminAnalytics = await calculateAdminAnalytics();
        io.emit('analytics:update:admin', adminAnalytics);
        
        // Update supplier-specific analytics
        if (data && data.supplier) {
          const supplierAnalytics = await calculateSupplierAnalytics(data.supplier);
          io.emit(`analytics:update:supplier:${data.supplier}`, supplierAnalytics);
        }
        break;
        
      case 'loan':
        // Update loan-related analytics
        const loanAnalytics = await calculateAdminAnalytics();
        io.emit('analytics:update:admin', loanAnalytics);
        
        // Update supplier-specific loan analytics
        if (data && data.supplier) {
          const supplierLoanAnalytics = await calculateSupplierAnalytics(data.supplier);
          io.emit(`analytics:update:supplier:${data.supplier}`, supplierLoanAnalytics);
        }
        break;
        
      case 'creditScore':
        // Update credit score analytics
        const creditScoreAnalytics = await calculateCreditScoreAnalytics();
        io.emit('analytics:update:creditScore', creditScoreAnalytics);
        
        // Update supplier-specific credit analytics
        if (data && data.supplier) {
          const supplierCreditAnalytics = await calculateSupplierAnalytics(data.supplier);
          io.emit(`analytics:update:supplier:${data.supplier}`, supplierCreditAnalytics);
          
          // Also send notification if score has changed significantly
          if (data.previousScore && Math.abs(data.score - data.previousScore) >= 10) {
            const changeDirection = data.score > data.previousScore ? 'increased' : 'decreased';
            const notification = {
              type: 'creditScore',
              message: `Your credit score has ${changeDirection} from ${data.previousScore} to ${data.score}.`,
              details: {
                previousScore: data.previousScore,
                newScore: data.score,
                change: data.score - data.previousScore
              }
            };
            io.emit(`notification:supplier:${data.supplier}`, notification);
          }
        }
        break;
    }
  } catch (error) {
    console.error(`Error emitting analytics update for ${type}:`, error);
  }
};

// Event handlers for various data changes

// Handle transaction created/updated
exports.handleTransactionCreated = async (transaction) => {
  // Recalculate credit score
  try {
    const supplierId = transaction.supplier;
    const supplier = await Supplier.findById(supplierId);
    
    if (supplier) {
      // Calculate new credit score
      const creditScoreResult = await CreditScoreAnalytics.calculateScore(supplierId);
      
      // Get previous credit score
      const previousScore = await CreditScore.findOne({ supplier: supplierId })
        .sort({ assessment_date: -1 });
      
      // Save new credit score
      const newCreditScore = new CreditScore({
        supplier: supplierId,
        score: creditScoreResult.finalScore,
        assessment_date: new Date(),
        remarks: `Score updated after transaction ${transaction._id}`
      });
      
      await newCreditScore.save();
      
      // Emit analytics update
      await emitAnalyticsUpdate('transaction', transaction);
      await emitAnalyticsUpdate('creditScore', {
        supplier: supplierId,
        score: creditScoreResult.finalScore,
        previousScore: previousScore?.score,
        breakdown: creditScoreResult.breakdown
      });
    }
  } catch (error) {
    console.error("Error handling transaction creation:", error);
  }
};

// Handle loan created/updated
exports.handleLoanCreated = async (loan) => {
  try {
    // Emit loan analytics update
    await emitAnalyticsUpdate('loan', loan);
  } catch (error) {
    console.error("Error handling loan creation:", error);
  }
};

// Handle loan payment
exports.handleLoanPayment = async (payment, loan) => {
  try {
    const supplierId = loan.supplier;
    
    // Recalculate credit score after payment
    const creditScoreResult = await CreditScoreAnalytics.calculateScore(supplierId);
    
    // Get previous credit score
    const previousScore = await CreditScore.findOne({ supplier: supplierId })
      .sort({ assessment_date: -1 });
    
    // Save new credit score
    const newCreditScore = new CreditScore({
      supplier: supplierId,
      score: creditScoreResult.finalScore,
      assessment_date: new Date(),
      remarks: `Score updated after loan payment for loan ${loan._id}`
    });
    
    await newCreditScore.save();
    
    // Emit analytics updates
    await emitAnalyticsUpdate('loan', { ...loan, supplier: supplierId });
    await emitAnalyticsUpdate('creditScore', {
      supplier: supplierId,
      score: creditScoreResult.finalScore,
      previousScore: previousScore?.score,
      breakdown: creditScoreResult.breakdown
    });
  } catch (error) {
    console.error("Error handling loan payment:", error);
  }
};

// API Endpoints for analytics data

// Get admin dashboard overview
exports.getAdminOverview = async (req, res) => {
  try {
    const analytics = await calculateAdminAnalytics();
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving admin analytics", error: error.message });
  }
};

// Get supplier dashboard overview
exports.getSupplierOverview = async (req, res) => {
  try {
    const supplierId = req.params.supplierId || req.query.supplierId;
    
    if (!supplierId) {
      return res.status(400).json({ message: "Supplier ID is required" });
    }
    
    const analytics = await calculateSupplierAnalytics(supplierId);
    
    if (!analytics) {
      return res.status(404).json({ message: "Supplier not found or has no data" });
    }
    
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving supplier analytics", error: error.message });
  }
};

// Get credit score analytics
exports.getCreditScoreAnalytics = async (req, res) => {
  try {
    const analytics = await calculateCreditScoreAnalytics();
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving credit score analytics", error: error.message });
  }
};

// Get detailed credit assessment for a supplier
exports.getSupplierCreditAssessment = async (req, res) => {
  try {
    const supplierId = req.params.supplierId;
    
    if (!supplierId) {
      return res.status(400).json({ message: "Supplier ID is required" });
    }
    
    // Get detailed credit assessment
    const creditScoreResult = await CreditScoreAnalytics.calculateScore(supplierId);
    
    // Get credit score history
    const creditHistory = await CreditScore.find({ supplier: supplierId })
      .sort({ assessment_date: -1 })
      .limit(10);
    
    const formattedHistory = creditHistory.map(entry => ({
      date: entry.assessment_date,
      score: entry.score,
      remarks: entry.remarks
    }));
    
    res.json({
      currentScore: creditScoreResult.finalScore,
      breakdown: creditScoreResult.breakdown,
      history: formattedHistory,
      category: getScoreCategory(creditScoreResult.finalScore),
      creditLimit: calculateCreditLimit(creditScoreResult.finalScore)
    });
  } catch (error) {
    res.status(500).json({ message: "Error retrieving credit assessment", error: error.message });
  }
};

// Export all functions
module.exports = {
  handleTransactionCreated: exports.handleTransactionCreated,
  handleLoanCreated: exports.handleLoanCreated,
  handleLoanPayment: exports.handleLoanPayment,
  getAdminOverview: exports.getAdminOverview,
  getSupplierOverview: exports.getSupplierOverview,
  getCreditScoreAnalytics: exports.getCreditScoreAnalytics,
  getSupplierCreditAssessment: exports.getSupplierCreditAssessment
};