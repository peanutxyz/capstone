// src/models/Transaction.js

const mongoose = require('mongoose');
const transactionSchema = new mongoose.Schema({
    supplier: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Supplier',
        required: true
    },
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    transaction_number: {
        type: String,
        unique: true,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'cancelled', 'voided'],
        default: 'completed'
    },
    quantity: {
        type: Number,
        required: true,
        min: 0
    },
    less_kilo: {
        type: Number,
        default: 0,
        min: 0
    },
    total_kilo: {
        type: Number,
        required: true
    },
    unit_price: {
        type: Number,
        required: true,
        min: 0
    },
    total_price: {
        type: Number,
        required: true
    },
    total_amount: {
        type: Number,
        required: true
    },
    // Add new fields for loan deductions
    loan_deduction: {
        type: Number,
        default: 0
    },
    amount_after_deduction: {
        type: Number
    },
    paid_amount: {
        type: Number,
        default: 0
    },
    transaction_date: {
        type: Date,
        required: true
    },
    is_deleted: {
        type: Boolean,
        default: false
    },
    // Track which loans were deducted from this transaction
    loan_payments: [{
        loan: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Loan'
        },
        amount: Number
    }]
}, { timestamps: true });

// Handle loan deductions when a transaction is completed
transactionSchema.post('save', async function() {
    // Only process when transaction is completed
    if (this.status === 'completed') {
        try {
            // First, handle loan auto-debit if there are outstanding loans
            const Loan = mongoose.model('Loan');
            const LoanPayment = mongoose.model('LoanPayment');
           
            console.log(`Processing auto-debit for transaction ${this._id} (${this.transaction_number})`);
           
            // Find active loans for this supplier
            const outstandingLoans = await Loan.find({
                supplier: this.supplier,
                status: 'approved',
                $expr: { $lt: ['$total_paid', '$total_amount_with_interest'] }
            }).sort({ createdAt: 1 }); // Process oldest loans first
           
            console.log(`Found ${outstandingLoans.length} outstanding loans for supplier ${this.supplier}`);
           
            if (outstandingLoans.length > 0) {
                // Calculate amount available for deduction (increased from 30% to 40% of transaction)
                const maxDeductionAmount = this.total_amount * 0.4;
                let remainingDeduction = maxDeductionAmount;
                let totalDeduction = 0;
                let loanPaymentsArray = [];
               
                console.log(`Max deduction amount: ${maxDeductionAmount}`);
               
                // Process each loan for deductions
                for (const loan of outstandingLoans) {
                    if (remainingDeduction <= 0) break;
                   
                    const loanRemainingAmount =
                        (loan.total_amount_with_interest || loan.amount) - (loan.total_paid || 0);
                   
                    console.log(`Loan ${loan._id} has remaining amount: ${loanRemainingAmount}`);
                   
                    const currentDeduction = Math.min(remainingDeduction, loanRemainingAmount);
                   
                    if (currentDeduction > 0) {
                        console.log(`Applying deduction of ${currentDeduction} to loan ${loan._id}`);
                       
                        // Create loan payment record
                        const loanPayment = new LoanPayment({
                            loan: loan._id,
                            transaction: this._id,
                            amount: currentDeduction,
                            payment_date: new Date(),
                            payment_method: 'auto-debit',
                            notes: `Auto-debit from transaction #${this.transaction_number}`
                        });
                       
                        // Update loan record
                        loan.total_paid = (loan.total_paid || 0) + currentDeduction;
                       
                        // Determine how much goes to principal vs interest
                        const principalRemaining = loan.amount - (loan.principal_paid || 0);
                        const interestRemaining =
                            (loan.total_amount_with_interest || loan.amount) -
                            loan.amount - (loan.interest_paid || 0);
                       
                        // Prioritize interest payment first
                        if (interestRemaining > 0) {
                            const interestPayment = Math.min(currentDeduction, interestRemaining);
                            loan.interest_paid = (loan.interest_paid || 0) + interestPayment;
                            const principalPayment = currentDeduction - interestPayment;
                            loan.principal_paid = (loan.principal_paid || 0) + principalPayment;
                        } else {
                            loan.principal_paid = (loan.principal_paid || 0) + currentDeduction;
                        }
                       
                        // Check if loan is fully paid
                        if (loan.total_paid >= (loan.total_amount_with_interest || loan.amount)) {
                            loan.status = 'paid';
                            loan.completionDate = new Date();
                        }
                       
                        await loan.save();
                        await loanPayment.save();
                       
                        // Track loan payment in array for this transaction
                        loanPaymentsArray.push({
                            loan: loan._id,
                            amount: currentDeduction
                        });
                       
                        totalDeduction += currentDeduction;
                        remainingDeduction -= currentDeduction;
                       
                        console.log(`After deduction: total=${totalDeduction}, remaining=${remainingDeduction}`);
                    }
                }
               
                // Update transaction with deduction information
                this.loan_deduction = totalDeduction;
                this.amount_after_deduction = this.total_amount - totalDeduction;
                this.paid_amount = this.amount_after_deduction;
                this.loan_payments = loanPaymentsArray;
               
                // Save transaction updates
                await this.constructor.findByIdAndUpdate(this._id, {
                    loan_deduction: totalDeduction,
                    amount_after_deduction: this.total_amount - totalDeduction,
                    paid_amount: this.amount_after_deduction,
                    loan_payments: loanPaymentsArray
                });
               
                console.log(`Transaction updated with deduction: ${totalDeduction}`);
            } else {
                // No loans, so amount after deduction is same as total
                this.amount_after_deduction = this.total_amount;
                this.paid_amount = this.total_amount;
               
                await this.constructor.findByIdAndUpdate(this._id, {
                    amount_after_deduction: this.total_amount,
                    paid_amount: this.total_amount
                });
               
                console.log('No outstanding loans, no deduction applied');
            }
           
            // Update credit score using formula
            const CreditScore = mongoose.model('CreditScore');
           
            // Get all completed transactions for this supplier
            const supplierTransactions = await this.constructor.find({
                supplier: this.supplier,
                status: 'completed'
            });
           
            if (supplierTransactions.length < 2) {
                // Not enough transactions to calculate a meaningful score yet
                let initialScore = await CreditScore.findOne({ supplier: this.supplier });
                               
                if (!initialScore) {
                    initialScore = new CreditScore({
                        supplier: this.supplier,
                        score: 20,
                        transaction_count: 1,
                        eligible_amount: this.total_amount * 0.15, // 15% of first transaction
                        average_transaction: this.total_amount,
                        credit_percentage: 0.15,
                        assessment_date: new Date(),
                        remarks: 'Initial score with first transaction'
                    });
                    await initialScore.save();
                }
               
                console.log('Created initial credit score');
                
                // Update supplier balance after creating initial score
                try {
                    const { recalculateSupplierBalance } = require('../lib/utils/supplierBalanceUtils');
                    await recalculateSupplierBalance(this.supplier);
                } catch (balanceError) {
                    console.error('Error updating supplier balance:', balanceError);
                }
                
                return;
            }
           
            // Calculate Transaction Consistency (TC)
            const amounts = supplierTransactions.map(t => t.total_amount);
            const smallestTransaction = Math.min(...amounts);
            const largestTransaction = Math.max(...amounts);
            const transactionConsistency = (smallestTransaction / largestTransaction) * 100;
           
            // Calculate Total Supply Score (TSS)
            const totalSupplied = supplierTransactions.reduce((sum, t) => sum + t.total_amount, 0);
            const maxPossibleSupply = largestTransaction * supplierTransactions.length;
            const totalSupplyScore = (totalSupplied / maxPossibleSupply) * 100;
           
            // Calculate Transaction Count Score (TCS)
            // Assuming ideal transaction cycle is 10
            const idealTransactionCycle = 10;
            const transactionCountScore = Math.min(100, (supplierTransactions.length / idealTransactionCycle) * 100);
           
            // Calculate Final Credit Score
            const finalScore = (transactionConsistency + totalSupplyScore + transactionCountScore) / 3;
           
            // Calculate eligible loan amount
            const averageTransaction = totalSupplied / supplierTransactions.length;
           
            // Determine credit percentage based on score
            let creditPercentage = 0;
            if (finalScore >= 80) creditPercentage = 0.6;
            else if (finalScore >= 60) creditPercentage = 0.5;
            else if (finalScore >= 40) creditPercentage = 0.4;
            else if (finalScore > 30) creditPercentage = 0.3;
            else if (finalScore >= 20) creditPercentage = 0.15;
            else creditPercentage = 0;
           
            const eligibleAmount = Math.round(averageTransaction * creditPercentage);
           
            // Save credit score
            let creditScore = await CreditScore.findOne({ supplier: this.supplier });
           
            if (!creditScore) {
                creditScore = new CreditScore({
                    supplier: this.supplier,
                    score: Math.round(finalScore),
                    transaction_consistency: Math.round(transactionConsistency),
                    total_supply_score: Math.round(totalSupplyScore),
                    transaction_count_score: Math.round(transactionCountScore),
                    eligible_amount: Math.round(eligibleAmount),
                    transaction_count: supplierTransactions.length,
                    average_transaction: averageTransaction,
                    credit_percentage: creditPercentage,
                    assessment_date: new Date(),
                    remarks: `Credit score calculated based on ${supplierTransactions.length} transactions.`
                });
            } else {
                creditScore.score = Math.round(finalScore);
                creditScore.transaction_consistency = Math.round(transactionConsistency);
                creditScore.total_supply_score = Math.round(totalSupplyScore);
                creditScore.transaction_count_score = Math.round(transactionCountScore);
                creditScore.eligible_amount = eligibleAmount;
                creditScore.transaction_count = supplierTransactions.length;
                creditScore.average_transaction = averageTransaction;
                creditScore.credit_percentage = creditPercentage;
                creditScore.assessment_date = new Date();
                creditScore.remarks = `Credit score updated after transaction ${this.transaction_number}. Based on ${supplierTransactions.length} transactions.`;
            }
           
            await creditScore.save();
            console.log(`Credit score updated: ${Math.round(finalScore)}`);
            
            // Update supplier balance after updating credit score
            try {
                const { recalculateSupplierBalance } = require('../lib/utils/supplierBalanceUtils');
                await recalculateSupplierBalance(this.supplier);
                console.log(`Updated supplier balance after transaction`);
            } catch (balanceError) {
                console.error('Error updating supplier balance:', balanceError);
            }
        } catch (error) {
            console.error('Error processing transaction completion:', error);
            // Don't throw error to prevent transaction save from failing
        }
    }
});

// Pre-save middleware to calculate total_kilo and total_price
transactionSchema.pre('save', function(next) {
    if (this.isModified('quantity') || this.isModified('less_kilo') || this.isModified('unit_price')) {
        this.total_kilo = this.quantity - (this.less_kilo || 0);
        this.total_price = this.total_kilo * this.unit_price;
        this.total_amount = this.total_price;
    }
   
    // Initialize amount_after_deduction to be the same as total_amount by default
    if (this.isNew || !this.amount_after_deduction) {
        this.amount_after_deduction = this.total_amount;
    }
   
    // If this is a new transaction, set paid_amount to zero initially
    // It will be updated in the post-save middleware after loan deductions
    if (this.isNew) {
        this.paid_amount = 0;
    }
   
    next();
});

module.exports = mongoose.model('Transaction', transactionSchema);