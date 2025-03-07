// src/routes/analytics.routes.js

const express = require('express');
const analyticsRouter = express.Router();
const { auth, authorize } = require('../middleware/auth');
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Loan = require('../models/Loan');
const Supplier = require('../models/Supplier');
const CreditScore = require('../models/CreditScore');

// ADMIN ANALYTICS
analyticsRouter.get('/admin/overview', auth, authorize('admin'), async (req, res) => {
    try {
        // Get date ranges for filtering
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        console.log('Date range:', { startOfMonth, endOfMonth });

        // Transaction Overview
        const transactionStats = await Transaction.aggregate([
            {
                $facet: {
                    // Monthly transactions
                    monthly: [
                        { $match: { 
                            createdAt: { 
                                $gte: startOfMonth, 
                                $lte: endOfMonth 
                            },
                            status: 'completed',
                            is_deleted: { $ne: true }
                        }},
                        { $group: {
                            _id: null,
                            totalAmount: { $sum: '$total_amount' },
                            count: { $sum: 1 },
                            averageAmount: { $avg: '$total_amount' }
                        }}
                    ],
                    // Transaction trend (daily for current month)
                    trend: [
                        { $match: { 
                            transaction_date: { 
                                $gte: startOfMonth, 
                                $lte: endOfMonth 
                            },
                            status: 'completed',
                            is_deleted: { $ne: true }
                        }},
                        { $group: {
                            _id: { $dateToString: { format: "%Y-%m-%d", date: "$transaction_date" }},
                            totalAmount: { $sum: '$total_amount' },
                            count: { $sum: 1 }
                        }},
                        { $sort: { _id: 1 } }
                    ]
                }
            }
        ]);

        // Loan Analytics
        const loanStats = await Loan.aggregate([
            {
                $facet: {
                    status: [
                        { $group: {
                            _id: '$status',
                            count: { $sum: 1 },
                            totalAmount: { $sum: '$amount' }
                        }}
                    ],
                    monthly: [
                        { $match: { 
                            createdAt: { 
                                $gte: startOfMonth, 
                                $lte: endOfMonth 
                            }
                        }},
                        { $group: {
                            _id: null,
                            totalAmount: { $sum: '$amount' },
                            count: { $sum: 1 }
                        }}
                    ],
                    active: [
                        { $match: { 
                            status: { $in: ['approved', 'pending'] }
                        }},
                        { $group: {
                            _id: null,
                            count: { $sum: 1 },
                            totalAmount: { $sum: '$amount' }
                        }}
                    ]
                }
            }
        ]);

        // Supplier Analytics
        const supplierStats = await Supplier.aggregate([
            {
                $facet: {
                    total: [
                        { $group: {
                            _id: null,
                            count: { $sum: 1 }
                        }}
                    ],
                    active: [
                        { $match: { is_active: true }},
                        { $group: {
                            _id: null,
                            count: { $sum: 1 }
                        }}
                    ]
                }
            }
        ]);

        // Add additional debug logs
        console.log('Transaction stats:', {
            monthly: transactionStats[0].monthly[0] || 'No monthly data',
            trendCount: transactionStats[0].trend.length
        });
        
        console.log('Loan stats:', {
            statusCount: loanStats[0].status.length,
            monthly: loanStats[0].monthly[0] || 'No monthly data',
            active: loanStats[0].active[0] || 'No active loans'
        });
        
        console.log('Supplier stats:', {
            total: supplierStats[0].total[0] || 'No suppliers',
            active: supplierStats[0].active[0] || 'No active suppliers'
        });

        // Structure response to match frontend expectations
        res.json({
            transactions: {
                monthly: transactionStats[0].monthly[0] || { totalAmount: 0, count: 0, averageAmount: 0 },
                trend: transactionStats[0].trend || []
            },
            loans: {
                status: loanStats[0].status || [],
                monthly: loanStats[0].monthly[0] || { totalAmount: 0, count: 0 }
            },
            suppliers: {
                total: supplierStats[0].total[0]?.count || 0,
                active: supplierStats[0].active[0]?.count || 0
            }
        });

    } catch (error) {
        console.error('Admin analytics error:', error);
        res.status(500).json({ 
            message: 'Error fetching admin analytics', 
            error: error.message
        });
    }
});

// OWNER ANALYTICS
analyticsRouter.get('/owner/overview', auth, authorize('owner'), async (req, res) => {
    try {
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        // Financial Overview
        const financialStats = await Transaction.aggregate([
            {
                $facet: {
                    monthly: [
                        { $match: { 
                            createdAt: { $gte: startOfMonth },
                            status: 'completed',
                            is_deleted: { $ne: true }
                        }},
                        { $group: {
                            _id: null,
                            revenue: { $sum: '$total_amount' },
                            transactions: { $sum: 1 }
                        }}
                    ],
                    daily: [
                        { $match: { 
                            createdAt: { $gte: startOfMonth },
                            status: 'completed',
                            is_deleted: { $ne: true }
                        }},
                        { $group: {
                            _id: { $dateToString: { format: "%Y-%m-%d", date: "$transaction_date" }},
                            revenue: { $sum: '$total_amount' },
                            transactions: { $sum: 1 }
                        }},
                        { $sort: { _id: 1 } }
                    ]
                }
            }
        ]);

        // Outstanding Loans
        const loanStats = await Loan.aggregate([
            { $match: { status: { $in: ['approved', 'pending'] }}},
            { $group: {
                _id: '$status',
                totalAmount: { $sum: '$amount' },
                count: { $sum: 1 }
            }}
        ]);

        res.json({
            financial: {
                monthly: financialStats[0].monthly[0] || { revenue: 0, transactions: 0 },
                daily: financialStats[0].daily || []
            },
            loans: loanStats || []
        });

    } catch (error) {
        console.error('Owner analytics error:', error);
        res.status(500).json({ message: 'Error fetching owner analytics' });
    }
});

// SUPPLIER ANALYTICS
analyticsRouter.get('/supplier/overview', auth, authorize('supplier'), async (req, res) => {
    try {
        // Find the supplier record associated with this user
        const supplier = await Supplier.findOne({ user: req.user.id });
       
        if (!supplier) {
            return res.status(404).json({ message: 'Supplier profile not found for this user' });
        }
       
        const supplierId = supplier._id;
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        
        // Log the supplier ID for debugging
        console.log('Fetching analytics for supplier:', supplierId);
        
        // Transaction History - improved query to ensure we get data
        const transactionStats = await Transaction.aggregate([
            { $match: {
                supplier: new mongoose.Types.ObjectId(supplierId),
                is_deleted: { $ne: true }
            }},
            {
                $facet: {
                    monthly: [
                        { $match: {
                            transaction_date: { $gte: startOfMonth }, // Use transaction_date instead of createdAt
                            status: 'completed'
                        }},
                        { $group: {
                            _id: null,
                            totalAmount: { $sum: '$total_amount' },
                            count: { $sum: 1 }
                        }}
                    ],
                    history: [
                        { $match: { status: 'completed' }},
                        { $group: {
                            _id: { $dateToString: { format: "%Y-%m", date: "$transaction_date" }},
                            totalAmount: { $sum: '$total_amount' },
                            count: { $sum: 1 }
                        }},
                        { $sort: { _id: 1 } }
                    ]
                }
            }
        ]);

        // Log transaction stats for debugging
        console.log('Transaction stats count:', transactionStats[0]?.history?.length || 0);

        // Loan Status - Get real loan data
        const loanStats = await Loan.aggregate([
            { $match: { supplier: new mongoose.Types.ObjectId(supplierId) }},
            { $group: {
                _id: '$status',
                totalAmount: { $sum: '$amount' },
                count: { $sum: 1 }
            }}
        ]);

        // Use the controller utility for more comprehensive credit score data
        let creditScore = { 
            score: 0, 
            history: [], 
            remarks: 'No credit score available',
            transaction_count: 0,
            eligible_amount: 0,
            credit_percentage: 0,
            average_transaction: 0
        };
        
        try {
            // Get most recent credit score
            const scoreResult = await CreditScore.findOne({ supplier: supplierId })
                .select('score history remarks assessment_date transaction_count eligible_amount credit_percentage average_transaction')
                .sort('-assessment_date');
            
            if (scoreResult) {
                const creditHistory = await CreditScore.find({ supplier: supplierId })
                    .sort('-assessment_date')
                    .limit(10);
                
                creditScore = {
                    score: scoreResult.score || 0,
                    remarks: scoreResult.remarks || 'Credit score based on transaction history',
                    eligible_amount: scoreResult.eligible_amount || 0,
                    transaction_count: scoreResult.transaction_count || 0,
                    average_transaction: scoreResult.average_transaction || 0,
                    credit_percentage: scoreResult.credit_percentage || 0,
                    history: creditHistory.map(item => ({
                        date: item.assessment_date,
                        score: item.score
                    }))
                };
            }
        } catch (scoreError) {
            console.error('Credit score retrieval error:', scoreError);
        }

        // Ensure we return complete data even if parts are empty
        const response = {
            transactions: {
                monthly: transactionStats[0]?.monthly[0] || { totalAmount: 0, count: 0 },
                history: transactionStats[0]?.history || []
            },
            loans: loanStats || [],
            creditScore: creditScore
        };
        
        console.log('Sending supplier analytics response with data');
        res.json(response);
    } catch (error) {
        console.error('Supplier analytics error:', error);
        res.status(500).json({
            message: 'Error fetching supplier analytics',
            error: error.message
        });
    }
});

// MARKET TRENDS (Available to all authenticated users)
analyticsRouter.get('/market-trends', auth, async (req, res) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const trends = await Transaction.aggregate([
            { $match: { 
                transaction_date: { $gte: thirtyDaysAgo },
                status: 'completed',
                is_deleted: { $ne: true }
            }},
            { $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$transaction_date" }},
                averagePrice: { $avg: '$unit_price' },
                totalVolume: { $sum: '$quantity' }
            }},
            { $sort: { _id: 1 } }
        ]);

        res.json({ trends: trends || [] });

    } catch (error) {
        console.error('Market trends error:', error);
        res.status(500).json({ message: 'Error fetching market trends' });
    }
});

module.exports = analyticsRouter;