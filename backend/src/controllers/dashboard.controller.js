// src/controllers/dashboard.controller.js

const Transaction = require('../models/Transaction');
const Supplier = require('../models/Supplier');
const Loan = require('../models/Loan');
const CreditScore = require('../models/CreditScore');
const Settings = require('../models/Settings');
const mongoose = require('mongoose');

// Keep existing getDashboardStats
const getDashboardStats = async (req, res) => {
    try {
        // Get all required data
        const [
            transactions,
            suppliers,
            loans,
            pendingTransactions
        ] = await Promise.all([
            Transaction.find({ is_deleted: false }),
            Supplier.find({ is_active: true }).populate('user', 'name'),
            Loan.find(),
            Transaction.find({ status: 'pending', is_deleted: false })
        ]);

        // Calculate loan statistics
        const activeLoans = loans.filter(l => l.status === 'approved');
        const paidLoans = loans.filter(l => l.status === 'paid');
        const pendingLoans = loans.filter(l => l.status === 'pending');
       
        // Calculate total and remaining loan amounts for approved/active loans only
        const totalLoanAmount = activeLoans.reduce((sum, loan) => {
            // Calculate remaining amount (amount minus paid portion)
            const remaining = loan.amount - (loan.total_paid || 0);
            // Only add to total if there's a remaining amount
            return sum + (remaining > 0 ? remaining : 0);
        }, 0);

        // Calculate stats
        const stats = {
            totalSuppliers: suppliers.length,
            activeTransactions: transactions.filter(t => t.status === 'active').length,
            pendingApprovals: pendingTransactions.length,
            recentTransactions: await Transaction.find({ is_deleted: false })
                .sort({ createdAt: -1 })
                .limit(5)
                .populate({
                    path: 'supplier',
                    populate: { path: 'user', select: 'name' }
                }),
            pendingItems: pendingTransactions
                .slice(0, 5)
                .map(item => ({
                    _id: item._id,
                    reference_number: item.transaction_number,
                    amount: item.total_amount,
                    date: item.createdAt,
                    status: item.status
                })),
            // Enhanced loan statistics
            loans: {
                total: loans.length,
                activeLoans: activeLoans.length,
                paidLoans: paidLoans.length,
                pendingLoans: pendingLoans.length,
                totalLoanAmount: totalLoanAmount,
                recentLoans: loans
                    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                    .slice(0, 5)
                    .map(loan => ({
                        id: loan._id,
                        supplier: loan.supplier ? loan.supplier.name || (loan.supplier.user ? loan.supplier.user.name : 'Unknown') : 'Unknown',
                        amount: loan.amount,
                        status: loan.status,
                        date: loan.createdAt.toISOString().split('T')[0],
                        paid: loan.total_paid || 0,
                        remaining: loan.amount - (loan.total_paid || 0)
                    }))
            },
            transactions: {
                count: transactions.length,
                totalAmount: transactions.reduce((sum, t) => sum + (t.total_amount || 0), 0)
            },
            suppliers: {
                activeCount: suppliers.length,
                recent: suppliers
                    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                    .slice(0, 5)
                    .map(supplier => ({
                        id: supplier._id,
                        name: supplier.name || (supplier.user ? supplier.user.name : 'Unknown'),
                        isActive: supplier.is_active
                    }))
            }
        };

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching dashboard stats',
            error: error.message
        });
    }
};

// Updated getOwnerDashboard function to focus on loan information
const getOwnerDashboard = async (req, res) => {
    try {
        // Fetch all loans
        const loans = await Loan.find()
            .populate({
                path: 'supplier',
                populate: { path: 'user', select: 'name' }
            })
            .sort({ createdAt: -1 });

        // Calculate loan statistics
        const activeLoans = loans.filter(l => l.status === 'approved');
        const paidLoans = loans.filter(l => l.status === 'paid');
        const pendingLoans = loans.filter(l => l.status === 'pending');
       
        // Calculate total and remaining loan amounts for approved/active loans only
        const totalLoanAmount = activeLoans.reduce((sum, loan) => {
            // Calculate remaining amount (amount minus paid portion)
            const remaining = loan.amount - (loan.total_paid || 0);
            // Only add to total if there's a remaining amount
            return sum + (remaining > 0 ? remaining : 0);
        }, 0);

        // Get recent loans
        const recentLoans = loans.slice(0, 5).map(loan => ({
            id: loan._id,
            supplier: loan.supplier?.user?.name || 'Unknown',
            amount: loan.amount,
            status: loan.status,
            date: loan.createdAt.toISOString().split('T')[0],
            paid: loan.total_paid || 0,
            remaining: loan.amount - (loan.total_paid || 0)
        }));

        // Calculate payment statistics
        let loanPayments = [];
        let recentPayments = [];
       
        try {
            const LoanPayment = mongoose.model('LoanPayment');
            loanPayments = await LoanPayment.find()
                .sort({ payment_date: -1 })
                .limit(10)
                .populate({
                    path: 'loan',
                    populate: { path: 'supplier', populate: { path: 'user', select: 'name' } }
                });

            recentPayments = loanPayments.map(payment => ({
                id: payment._id,
                supplier: payment.loan?.supplier?.user?.name || 'Unknown',
                amount: payment.amount,
                date: payment.payment_date ? payment.payment_date.toISOString().split('T')[0] : 'Unknown',
                method: payment.payment_method
            }));
        } catch (error) {
            console.log('Error fetching loan payments:', error.message);
            // Continue without payments
        }

        // Construct the dashboard data with focus on loans
        const dashboardData = {
            loanStats: {
                activeLoans: activeLoans.length,
                paidLoans: paidLoans.length,
                pendingLoans: pendingLoans.length,
                totalLoanAmount,
                outstandingAmount: totalLoanAmount // Use the same value for consistency
            },
            loans: {
                active: activeLoans,
                pending: pendingLoans,
                recent: recentLoans
            },
            payments: {
                recent: recentPayments
            }
        };

        res.json({
            success: true,
            data: dashboardData
        });
    } catch (error) {
        console.error('Owner dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching owner dashboard data',
            error: error.message
        });
    }
};

// Keep this function to maintain route compatibility
const updateLoanLimit = async (req, res) => {
    try {
        const { amount } = req.body;
       
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid loan limit amount'
            });
        }
       
        // We'll keep this function for route compatibility,
        // but it won't affect the actual credit limit calculation
        // which now always uses 40% of average transaction
       
        res.json({
            success: true,
            message: 'Note: System now uses fixed 40% of average transaction value',
            limit: amount
        });
    } catch (error) {
        console.error('Error updating loan limit:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// Updated getSupplierDashboard function with fixed 40% credit limit calculation
const getSupplierDashboard = async (req, res) => {
    try {
        // Get user ID from authenticated user
        const userId = req.user.id;
       
        console.log(`Getting dashboard for user ID: ${userId}`);
       
        // First, find the supplier document associated with this user
        const supplier = await Supplier.findOne({ user: userId });
       
        if (!supplier) {
            console.log(`No supplier found for user ID: ${userId}`);
            return res.status(404).json({
                success: false,
                message: 'Supplier not found for this user'
            });
        }
        console.log(`Found supplier: ${supplier._id}`);
        
        const [
            transactions,
            creditScore,
            loans,
            pendingTransactions
        ] = await Promise.all([
            Transaction.find({
                supplier: supplier._id,
                status: 'completed',  // Ensure we only count completed transactions
                is_deleted: false
            }),
            CreditScore.findOne({ supplier: supplier._id }).sort({ assessment_date: -1 }),
            Loan.find({
                supplier: supplier._id,
                status: { $ne: 'paid' }
            }),
            Transaction.find({
                supplier: supplier._id,
                status: 'pending',
                is_deleted: false
            })
        ]);

        console.log(`Transactions found: ${transactions.length}`);
        console.log(`Credit score found:`, creditScore ? 'Yes' : 'No');
       
        if (creditScore) {
            console.log(`Credit score details: Score=${creditScore.score}, EligibleAmount=${creditScore.eligible_amount}`);
        } else {
            console.log('No credit score found, will need to recalculate');
            // If no credit score exists but there are transactions, trigger a calculation
            if (transactions.length > 0) {
                const { recalculateSupplierCreditScore } = require('./transaction.controller');
                await recalculateSupplierCreditScore(supplier._id);
                // Fetch the newly calculated credit score
                creditScore = await CreditScore.findOne({ supplier: supplier._id }).sort({ assessment_date: -1 });
                console.log('Credit score recalculated:', creditScore);
            }
        }

        // Calculate total earnings - using total_amount instead of totalAmount
        const totalEarnings = transactions.reduce((sum, t) => sum + (t.total_amount || 0), 0);
        console.log(`Total earnings calculated: ${totalEarnings}`);
        
        // Calculate average transaction value
        const averageTransaction = transactions.length > 0 ? 
            totalEarnings / transactions.length : 0;
        
        // Calculate loan limit - FIXED 40% regardless of credit score
        const loanLimit = transactions.length > 0 ? 
            Math.round(averageTransaction * 0.40) : 0;
            
        console.log(`Calculated loan limit using 40% of average: ${loanLimit}`);

        // Get monthly earnings trend (last 6 months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const monthlyStats = await Transaction.aggregate([
            {
                $match: {
                    supplier: supplier._id,
                    is_deleted: false,
                    createdAt: { $gte: sixMonthsAgo }
                }
            },
            {
                $group: {
                    _id: {
                        month: { $month: "$createdAt" },
                        year: { $year: "$createdAt" }
                    },
                    earnings: { $sum: "$total_amount" },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } }
        ]);

        // If we have a creditScore, update its eligible_amount and credit_percentage
        if (creditScore && transactions.length > 0) {
            creditScore.eligible_amount = loanLimit;
            creditScore.credit_percentage = 0.40;
            await creditScore.save();
            console.log('Updated credit score with fixed 40% calculation:', {
                eligible_amount: loanLimit,
                credit_percentage: 0.40
            });
        }

        const dashboardData = {
            overview: {
                totalEarnings,
                activeLoans: loans.length,
                monthlyAverage: totalEarnings / 12,
                creditScore: creditScore?.score || 0,
                pendingTransactions: pendingTransactions.length
            },
            creditInfo: {
                score: creditScore?.score || 0,
                status: creditScore?.status || 'Not Available',
                lastUpdated: creditScore?.assessment_date || new Date(),
                // Always use our calculated loan limit with fixed 40% rate
                loanLimit: loanLimit,
                transactionCount: transactions.length || 0,
                averageTransaction: averageTransaction
            },
            supplierInfo: {
                id: supplier._id,
                userId: supplier.user,
                contact: supplier.contact || {},
                address: supplier.address || {},
                currentBalance: supplier.current_balance || 0,
                isActive: supplier.is_active
            },
            transactions: {
                recent: transactions
                    .sort((a, b) => new Date(b.date) - new Date(a.date))
                    .slice(0, 5)
                    .map(t => ({
                        id: t._id,
                        reference: t.transaction_number || t._id,
                        date: t.date,
                        amount: t.total_amount || 0,
                        status: t.status
                    })),
                monthlyStats: monthlyStats.map(stat => ({
                    month: new Date(2024, stat._id.month - 1).toLocaleString('default', { month: 'short' }),
                    year: stat._id.year,
                    earnings: stat.earnings,
                    count: stat.count
                }))
            },
            loans: {
                active: loans.map(loan => ({
                    id: loan._id,
                    amount: loan.amount,
                    remainingAmount: loan.remaining_amount,
                    dueDate: loan.due_date,
                    status: loan.status
                })),
                totalOwed: loans.reduce((sum, loan) => sum + (loan.remaining_amount || 0), 0)
            }
        };

        console.log('Sending dashboard data with credit info:', dashboardData.creditInfo);

        res.json({
            success: true,
            data: dashboardData
        });
    } catch (error) {
        console.error('Supplier dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching supplier dashboard data',
            error: error.message
        });
    }
};

// Add a force recalculation endpoint for debugging with fixed 40% credit limit
const forceRecalculate = async (req, res) => {
    try {
        const userId = req.user.id;
       
        // Find the supplier associated with this user
        const supplier = await Supplier.findOne({ user: userId });
       
        if (!supplier) {
            return res.status(404).json({
                success: false,
                message: 'Supplier not found for this user'
            });
        }
       
        // Import and call the recalculation function
        const { recalculateSupplierCreditScore } = require('./transaction.controller');
        await recalculateSupplierCreditScore(supplier._id);
       
        // Get the updated credit score
        const creditScore = await CreditScore.findOne({ supplier: supplier._id })
            .sort({ assessment_date: -1 });
        
        // Get all transactions for this supplier to calculate average
        const transactions = await Transaction.find({
            supplier: supplier._id,
            status: 'completed',
            is_deleted: false
        });
        
        // Calculate average transaction
        const totalAmount = transactions.reduce((sum, t) => sum + (t.total_amount || 0), 0);
        const averageTransaction = transactions.length > 0 ? totalAmount / transactions.length : 0;
        
        // Set fixed credit percentage of 40%
        const creditPercentage = 0.40;
        
        // Calculate loan limit
        const loanLimit = Math.round(averageTransaction * creditPercentage);
        
        // Override the credit score's eligible_amount
        if (creditScore) {
            creditScore.eligible_amount = loanLimit;
            creditScore.credit_percentage = creditPercentage;
            await creditScore.save();
        }
       
        res.json({
            success: true,
            message: 'Credit score recalculated with fixed 40% credit percentage',
            creditScore,
            calculatedLimit: loanLimit,
            averageTransaction,
            transactionCount: transactions.length
        });
    } catch (error) {
        console.error('Recalculation error:', error);
        res.status(500).json({
            success: false,
            message: 'Error recalculating credit score',
            error: error.message
        });
    }
};

module.exports = {
    getDashboardStats,
    getOwnerDashboard,
    getSupplierDashboard,
    forceRecalculate,
    updateLoanLimit 
};