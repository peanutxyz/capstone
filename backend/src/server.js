// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const config = require('./config/config');
const connectDB = require('./config/database');
const errorHandler = require('./middleware/errorHandler');
const authRouter = require('./routes/auth.routes');
const supplierRouter = require('./routes/supplier.routes');
const transactionRouter = require('./routes/transaction.routes');
const loanRouter = require('./routes/loan.routes');
const paymentRouter = require('./routes/payment.routes');
const creditScoreRouter = require('./routes/creditScore.routes');
const loanPaymentRouter = require('./routes/loanPayment.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const analyticsRouter = require('./routes/analytics.routes');

const app = express();

// Connect to MongoDB
connectDB();

// CORS configuration - Only one CORS middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'], // Allow both localhost variations
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Add Access-Control headers for preflight requests
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Bangbangan Copra Trading API' });
});

// API routes
app.use('/api/auth', authRouter);
app.use('/api/suppliers', supplierRouter);
app.use('/api/transactions', transactionRouter);
app.use('/api/loans', loanRouter);
app.use('/api/payments', paymentRouter);
app.use('/api/creditscores', creditScoreRouter);
app.use('/api/loanpayments', loanPaymentRouter);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics', analyticsRouter);

// Error handling
app.use(errorHandler);

// Handle 404
app.use((req, res) => {
  console.log('404 Hit:', req.method, req.path);
  res.status(404).json({ message: 'Route not found' });
});

app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
  console.log('Available routes:');
  console.log('- POST /api/auth/register');
  console.log('- POST /api/auth/login');
  // Add other routes here
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
});