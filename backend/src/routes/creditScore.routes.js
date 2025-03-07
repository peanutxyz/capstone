// src/routes/creditScore.routes.js

const express = require('express');
const creditScoreRouter = express.Router();
const { auth, authorize } = require('../middleware/auth');
const CreditScore = require('../models/CreditScore');
const Transaction = require('../models/Transaction');

// Create credit score
creditScoreRouter.post('/', auth, authorize('admin', 'owner'), async (req, res) => {
    try {
        const {
            supplier,
            score,
            transaction_consistency,
            total_supply_score,
            transaction_count_score,
            eligible_amount,
            assessment_date,
            remarks,
            transaction_count
        } = req.body;
       
        const creditScore = new CreditScore({
            supplier,
            score,
            transaction_consistency,
            total_supply_score,
            transaction_count_score,
            eligible_amount,
            assessment_date,
            remarks,
            transaction_count
        });
       
        await creditScore.save();
       
        const populatedScore = await CreditScore.findById(creditScore._id)
            .populate('supplier', 'name');
           
        res.status(201).json(populatedScore);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get supplier credit score history
creditScoreRouter.get('/supplier/:supplierId/history', auth, async (req, res) => {
    try {
        const scores = await CreditScore.find({ supplier: req.params.supplierId })
            .sort({ assessment_date: -1 });
           
        res.json(scores);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get latest credit score for a supplier with detailed components
creditScoreRouter.get('/supplier/:supplierId', auth, async (req, res) => {
    try {
        const latestScore = await CreditScore.findOne({ supplier: req.params.supplierId })
            .sort({ assessment_date: -1 });
       
        if (!latestScore) {
            // Check if supplier has any transactions
            const supplierTransactions = await Transaction.find({
                supplier: req.params.supplierId,
                status: 'completed'
            });
           
            // Store transaction count for eligibility checking
            const transactionCount = supplierTransactions.length;
           
            if (transactionCount > 0) {
                // Calculate credit score components based on transaction history
                let transactionConsistency = 0;
                let totalSupplyScore = 0;
                let transactionCountScore = 0;
                let eligibleAmount = 0;
                let creditPercentage = 0.40; // Fixed 40% credit percentage
                let averageTransaction = 0;
                let finalScore = 0;
               
                // Get total supplied amount
                const amounts = supplierTransactions.map(t => t.total_kilo || t.quantity);
                const totalSupplied = supplierTransactions.reduce((sum, t) => sum + (t.total_kilo || t.quantity), 0);
                averageTransaction = totalSupplied / transactionCount;
               
                if (transactionCount >= 2) {
                    // For 2+ transactions, use full formula
                    const smallestTransaction = Math.min(...amounts);
                    const largestTransaction = Math.max(...amounts);
                    transactionConsistency = (smallestTransaction / largestTransaction) * 100;
                   
                    const maxPossibleSupply = largestTransaction * supplierTransactions.length;
                    totalSupplyScore = (totalSupplied / maxPossibleSupply) * 100;
                   
                    const idealTransactionCycle = 10;
                    transactionCountScore = Math.min(100, (transactionCount / idealTransactionCycle) * 100);
                   
                    finalScore = Math.round((transactionConsistency + totalSupplyScore + transactionCountScore) / 3);
                } else {
                    // For exactly 1 transaction, use starter score
                    transactionConsistency = 100; // Perfect consistency with just one transaction
                    totalSupplyScore = 100; // Perfect supply score with just one transaction
                    transactionCountScore = 10; // 1/10 of ideal transaction count
                    finalScore = 20; // Starter score for one transaction
                }
               
                // Calculate eligible amount - fixed 40% regardless of score
                eligibleAmount = Math.round(averageTransaction * creditPercentage);
               
                return res.json({
                    supplier: req.params.supplierId,
                    score: finalScore,
                    transaction_consistency: Math.round(transactionConsistency),
                    total_supply_score: Math.round(totalSupplyScore),
                    transaction_count_score: Math.round(transactionCountScore),
                    eligible_amount: eligibleAmount,
                    credit_percentage: creditPercentage,
                    transaction_count: transactionCount,
                    average_transaction: Math.round(averageTransaction),
                    assessment_date: new Date(),
                    remarks: transactionCount === 1
                        ? "Initial score based on first transaction"
                        : "Score calculated from transaction history"
                });
            } else {
                // No transactions yet - not eligible for loans
                return res.json({
                    supplier: req.params.supplierId,
                    score: 0,
                    transaction_consistency: 0,
                    total_supply_score: 0,
                    transaction_count_score: 0,
                    eligible_amount: 0,
                    credit_percentage: 0,
                    transaction_count: 0,
                    assessment_date: new Date(),
                    remarks: "New supplier - no transaction history. Transactions required for loan eligibility."
                });
            }
        }
       
        res.json(latestScore);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get latest credit score with a simple endpoint (for frontend compatibility)
creditScoreRouter.get('/:supplierId', auth, async (req, res) => {
    try {
        const latestScore = await CreditScore.findOne({ supplier: req.params.supplierId })
            .sort({ assessment_date: -1 });
       
        if (!latestScore) {
            // Check if supplier has any transactions
            const transactions = await Transaction.find({
                supplier: req.params.supplierId,
                status: 'completed'
            });
           
            const transactionCount = transactions.length;
           
            // Calculate average transaction amount if there are transactions
            let averageTransaction = 0;
            if (transactionCount > 0) {
                const totalAmount = transactions.reduce((sum, t) => {
                    return sum + (t.total_amount || t.totalAmount || t.amount || 0);
                }, 0);
                averageTransaction = totalAmount / transactionCount;
            }
            
            // Use fixed 40% credit percentage
            const creditPercentage = 0.40;
            
            // Calculate eligible amount
            const eligibleAmount = transactionCount > 0 ? Math.round(averageTransaction * creditPercentage) : 0;
           
            // Return appropriate score based on transaction history
            return res.json({
                supplier: req.params.supplierId,
                score: transactionCount > 0 ? 20 : 0,
                transaction_count: transactionCount,
                is_eligible: transactionCount > 0,
                assessment_date: new Date(),
                eligible_amount: eligibleAmount,
                credit_percentage: transactionCount > 0 ? creditPercentage : 0,
                average_transaction: averageTransaction,
                remarks: transactionCount > 0
                    ? "Default score based on transaction history"
                    : "New supplier - no transaction history. Transactions required for loan eligibility."
            });
        }
       
        // If we have a stored credit score, update the eligible amount based on the fixed 40%
        const updatedScore = latestScore.toObject();
        
        // If there's an average_transaction field, recalculate the eligible_amount
        if (updatedScore.average_transaction) {
            updatedScore.credit_percentage = 0.40;
            updatedScore.eligible_amount = Math.round(updatedScore.average_transaction * 0.40);
        }
        
        // Always eligible if has transactions
        updatedScore.is_eligible = updatedScore.transaction_count > 0;
        
        res.json(updatedScore);
    } catch (error) {
        console.error("Error fetching credit score:", error);
        // Even on error, return a default response that's safe
        res.json({
            supplier: req.params.supplierId,
            score: 0,
            transaction_count: 0,
            is_eligible: false,
            assessment_date: new Date(),
            remarks: "Error retrieving score - using conservative default"
        });
    }
});

module.exports = creditScoreRouter;