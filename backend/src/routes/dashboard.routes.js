// src/routes/dashboard.routes.js

const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const Supplier = require('../models/Supplier');
const Loan = require('../models/Loan');
const CreditScore = require('../models/CreditScore');
const dashboardController = require('../controllers/dashboard.controller');

// Explicitly define the callback function first
const getDashboardStats = async (req, res) => {
  try {
    // Fetch data from all collections
    const [transactions, suppliers, loans] = await Promise.all([
      Transaction.find({ is_deleted: false }),
      Supplier.find({ is_active: true }),
      Loan.find()
    ]);

    // Calculate statistics
    const stats = {
      transactions: {
        count: transactions.length,
        totalAmount: transactions.reduce((sum, t) => sum + (t.total_amount || 0), 0)
      },
      suppliers: {
        activeCount: suppliers.length
      },
      loans: {
        totalLoans: loans.length,
        activeLoans: loans.filter(l => l.status !== 'paid').length,
        totalAmount: loans.reduce((sum, l) => sum + (l.amount || 0), 0)
      },
      recentTransactions: await Transaction.find({ is_deleted: false })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('supplier', 'name'),
      pendingApprovals: await Transaction.find({
        status: 'pending',
        is_deleted: false
      }).countDocuments()
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

// Get owner dashboard stats
const getOwnerDashboardStats = async (req, res) => {
  try {
    // Fetch data from all collections
    const [transactions, suppliers, loans] = await Promise.all([
      Transaction.find({ is_deleted: false }),
      Supplier.find({ is_active: true }),
      Loan.find()
    ]);

    // Calculate owner-specific statistics
    const stats = {
      overview: {
        totalRevenue: transactions.reduce((sum, t) => sum + (t.total_amount || 0), 0),
        activeLoans: loans.filter(l => l.status === 'active').length,
        totalSuppliers: suppliers.length,
        pendingTransactions: transactions.filter(t => t.status === 'pending').length
      },
      transactions: {
        recent: await Transaction.find({ is_deleted: false })
          .sort({ createdAt: -1 })
          .limit(5)
          .populate('supplier', 'name'),
        monthlyStats: await Transaction.aggregate([
          {
            $match: {
              is_deleted: false,
              createdAt: {
                $gte: new Date(new Date().setMonth(new Date().getMonth() - 6))
              }
            }
          },
          {
            $group: {
              _id: {
                month: { $month: "$createdAt" },
                year: { $year: "$createdAt" }
              },
              totalAmount: { $sum: "$total_amount" },
              count: { $sum: 1 }
            }
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } }
        ])
      },
      loans: {
        active: loans.filter(l => l.status === 'active'),
        totalAmount: loans.reduce((sum, l) => sum + (l.amount || 0), 0),
        recentPayments: await Loan.find({ status: 'active' })
          .sort({ createdAt: -1 })
          .limit(5)
      }
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Owner dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching owner dashboard stats',
      error: error.message
    });
  }
};

// Add new getSupplierDashboardStats function
const getSupplierDashboardStats = async (req, res) => {
  try {
    const supplierId = req.user.supplierId;
    console.log('Fetching stats for supplier:', supplierId);

    const [transactions, creditScore, loans] = await Promise.all([
      Transaction.find({
        supplier: supplierId,
        is_deleted: false
      }),
      CreditScore.findOne({ supplier: supplierId }),
      // Update loan query to get all loans
      Loan.find({
        supplier: supplierId
      }).sort({ createdAt: -1 }) // Sort by latest first
    ]);

    // Calculate loan statistics
    const activeLoans = loans.filter(l => l.status === 'approved');
    const paidLoans = loans.filter(l => l.status === 'paid');
    const pendingLoans = loans.filter(l => l.status === 'pending');
    const totalOwed = activeLoans.reduce((sum, l) =>
      sum + (l.total_amount_with_interest - (l.total_paid || 0)), 0
    );

    const stats = {
      // Include the supplier ID in the response
      supplierInfo: {
        id: supplierId
      },
      overview: {
        totalTransactions: transactions.length,
        totalEarnings: transactions.reduce((sum, t) => sum + (t.total_amount || 0), 0),
        activeLoans: activeLoans.length
      },
      loans: {
        active: activeLoans,
        paid: paidLoans,
        pending: pendingLoans,
        totalOwed: totalOwed,
        loanHistory: loans.map(loan => ({
          id: loan._id,
          amount: loan.amount,
          totalAmount: loan.total_amount_with_interest,
          paid: loan.total_paid,
          remaining: loan.total_amount_with_interest - loan.total_paid,
          status: loan.status,
          startDate: loan.start_date,
          dueDate: loan.due_date
        }))
      },
      creditInfo: {
        score: creditScore?.score || 0,
        status: creditScore?.status || 'Not Available',
        lastUpdated: creditScore?.updatedAt,
        loanLimit: creditScore?.loan_limit || 5000
      },
      transactions: {
        recent: await Transaction.find({
          supplier: supplierId,
          is_deleted: false
        })
          .sort({ createdAt: -1 })
          .limit(5)
          .lean()
          .then(transactions => transactions.map(t => ({
            reference: t.transaction_number,
            date: t.createdAt,
            amount: t.total_amount || 0
          }))),
        monthlyStats: await Transaction.aggregate([
          {
            $match: {
              supplier: supplierId,
              is_deleted: false,
              createdAt: {
                $gte: new Date(new Date().setMonth(new Date().getMonth() - 6))
              }
            }
          },
          {
            $group: {
              _id: {
                month: { $month: "$createdAt" },
                year: { $year: "$createdAt" }
              },
              earnings: { $sum: "$total_amount" }, // Changed to match frontend
              count: { $sum: 1 }
            }
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } }
        ])
      }
    };

    console.log('Stats prepared:', {
      totalLoans: loans.length,
      activeLoans: activeLoans.length,
      paidLoans: paidLoans.length,
      pendingLoans: pendingLoans.length
    });

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Supplier dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching supplier dashboard stats',
      error: error.message
    });
  }
};

// Define routes with callback functions and protect middleware
router.get('/stats', auth, authorize('admin'), dashboardController.getDashboardStats);
router.get('/owner', auth, authorize('owner'), dashboardController.getOwnerDashboard);
router.get('/supplier', auth, authorize('supplier'), dashboardController.getSupplierDashboard);
router.get('/recalculate', auth, authorize('supplier'), dashboardController.forceRecalculate);
router.post('/settings/loan-limit', auth, authorize('admin', 'owner'), dashboardController.updateLoanLimit);

module.exports = router;