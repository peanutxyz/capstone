// src/models/index.js
const mongoose = require('mongoose');
const User = require('./User');
const Supplier = require('./Supplier');
const Transaction = require('./Transaction');
const Payment = require('./Payment');
const CreditScore = require('./CreditScore');
const Loan = require('./Loan');
const LoanPayment = require('./LoanPayment');

module.exports = {
    User,
    Supplier,
    Transaction,
    Payment,
    CreditScore,
    Loan,
    LoanPayment
};