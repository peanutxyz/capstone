// src/models/CreditScoreAnalytics.js

const mongoose = require('mongoose');
const Transaction = require('./Transaction');
const LoanPayment = require('./LoanPayment');
const Supplier = require('./Supplier');

class CreditScoreAnalytics {
    // Scoring Weights
    static WEIGHTS = {
        PAYMENT_HISTORY: {
            weight: 0.40,
            components: {
                onTimePayments: 0.50,
                latePayments: 0.30,
                defaults: 0.20
            }
        },
        TRANSACTION_HISTORY: {
            weight: 0.30,
            components: {
                volume: 0.40,
                frequency: 0.30,
                consistency: 0.30
            }
        },
        RELATIONSHIP_SCORE: {
            weight: 0.20,
            components: {
                duration: 0.40,
                loanHistory: 0.30,
                businessVolume: 0.30
            }
        },
        MARKET_FACTORS: {
            weight: 0.10,
            components: {
                seasonalPerformance: 0.50,
                marketConditions: 0.50
            }
        }
    };

    // Main scoring function
    static async calculateScore(supplierId) {
        try {
            const paymentScore = await this.evaluatePaymentHistory(supplierId);
            const transactionScore = await this.evaluateTransactionHistory(supplierId);
            const relationshipScore = await this.evaluateRelationshipScore(supplierId);
            const marketScore = await this.evaluateMarketFactors(supplierId);

            const finalScore = Math.round(
                (paymentScore * this.WEIGHTS.PAYMENT_HISTORY.weight) +
                (transactionScore * this.WEIGHTS.TRANSACTION_HISTORY.weight) +
                (relationshipScore * this.WEIGHTS.RELATIONSHIP_SCORE.weight) +
                (marketScore * this.WEIGHTS.MARKET_FACTORS.weight)
            );

            return {
                finalScore,
                breakdown: {
                    paymentHistory: {
                        score: paymentScore,
                        weight: this.WEIGHTS.PAYMENT_HISTORY.weight
                    },
                    transactionHistory: {
                        score: transactionScore,
                        weight: this.WEIGHTS.TRANSACTION_HISTORY.weight
                    },
                    relationshipScore: {
                        score: relationshipScore,
                        weight: this.WEIGHTS.RELATIONSHIP_SCORE.weight
                    },
                    marketFactors: {
                        score: marketScore,
                        weight: this.WEIGHTS.MARKET_FACTORS.weight
                    }
                }
            };
        } catch (error) {
            throw new Error(`Error calculating credit score: ${error.message}`);
        }
    }

    // Payment History Evaluation
    static async evaluatePaymentHistory(supplierId) {
        const lastYear = new Date();
        lastYear.setFullYear(lastYear.getFullYear() - 1);

        const payments = await LoanPayment.find({
            supplier: supplierId,
            payment_date: { $gte: lastYear }
        });

        let onTimeCount = 0;
        let lateCount = 0;
        let defaultCount = 0;

        // Analyze each payment
        payments.forEach(payment => {
            const daysLate = payment.payment_date - payment.due_date;
            if (daysLate <= 0) onTimeCount++;
            else if (daysLate <= 30) lateCount++;
            else defaultCount++;
        });

        const totalPayments = payments.length || 1;
        const onTimeRate = (onTimeCount / totalPayments) * 100;
        const lateRate = (lateCount / totalPayments) * 100;
        const defaultRate = (defaultCount / totalPayments) * 100;

        return Math.round(
            (onTimeRate * this.WEIGHTS.PAYMENT_HISTORY.components.onTimePayments) +
            ((100 - lateRate) * this.WEIGHTS.PAYMENT_HISTORY.components.latePayments) +
            ((100 - defaultRate) * this.WEIGHTS.PAYMENT_HISTORY.components.defaults)
        );
    }

    // Enhanced Transaction History Evaluation
    static async evaluateTransactionHistory(supplierId) {
        const lastYear = new Date();
        lastYear.setFullYear(lastYear.getFullYear() - 1);
        
        const transactions = await Transaction.find({
            supplier: supplierId,
            created_at: { $gte: lastYear }
        });
        
        // Volume Score - Based on total transaction volume
        const totalVolume = transactions.reduce((sum, t) => sum + t.amount, 0);
        const volumeScore = this.calculateVolumeScore(totalVolume);
        
        // Frequency Score - Based on transaction count
        const frequencyScore = this.calculateFrequencyScore(transactions.length);
        
        // Consistency Score - Based on regular transaction pattern
        // Group transactions by month to see consistency
        const monthlyTransactions = {};
        
        transactions.forEach(t => {
            const date = new Date(t.created_at);
            const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
            
            if (!monthlyTransactions[monthKey]) {
                monthlyTransactions[monthKey] = 0;
            }
            
            monthlyTransactions[monthKey]++;
        });
        
        // Count months with transactions
        const monthsWithTransactions = Object.keys(monthlyTransactions).length;
        
        // Calculate consistency score (out of 100)
        // Perfect score if transactions in at least 10 of the last 12 months
        const consistencyScore = Math.min(100, (monthsWithTransactions / 12) * 100);
        
        // Calculate transaction growth trend
        let growthScore = 50; // Default neutral score
        
        if (transactions.length > 0) {
            // Sort transactions by date
            const sortedTransactions = [...transactions].sort((a, b) => 
                new Date(a.created_at) - new Date(b.created_at)
            );
            
            // Split into first half and second half
            const midpoint = Math.floor(sortedTransactions.length / 2);
            const firstHalf = sortedTransactions.slice(0, midpoint);
            const secondHalf = sortedTransactions.slice(midpoint);
            
            // Calculate average transaction amount for each half
            const firstHalfAvg = firstHalf.reduce((sum, t) => sum + t.amount, 0) / firstHalf.length;
            const secondHalfAvg = secondHalf.reduce((sum, t) => sum + t.amount, 0) / secondHalf.length;
            
            // Calculate growth percentage
            if (firstHalfAvg > 0) {
                const growthPercent = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;
                
                // Map growth to a score between 0-100
                // -20% or worse: score of 0
                // +20% or better: score of 100
                growthScore = Math.max(0, Math.min(100, ((growthPercent + 20) / 40) * 100));
            }
        }
        
        // Final transaction history score with weighted components
        return Math.round(
            (volumeScore * 0.4) + 
            (frequencyScore * 0.3) + 
            (consistencyScore * 0.3)
        );
    }

    // Relationship Score Evaluation
    static async evaluateRelationshipScore(supplierId) {
        const supplier = await Supplier.findById(supplierId);
        if (!supplier) return 0;

        // Duration Score
        const durationInMonths = Math.floor(
            (new Date() - supplier.created_at) / (1000 * 60 * 60 * 24 * 30)
        );
        const durationScore = Math.min(100, (durationInMonths / 24) * 100); // Max score at 2 years

        // Loan History Score
        const loanHistoryScore = await this.evaluateLoanHistory(supplierId);

        // Business Volume Score
        const businessVolumeScore = await this.evaluateBusinessVolume(supplierId);

        return Math.round(
            (durationScore * this.WEIGHTS.RELATIONSHIP_SCORE.components.duration) +
            (loanHistoryScore * this.WEIGHTS.RELATIONSHIP_SCORE.components.loanHistory) +
            (businessVolumeScore * this.WEIGHTS.RELATIONSHIP_SCORE.components.businessVolume)
        );
    }

    // Market Factors Evaluation
    static async evaluateMarketFactors(supplierId) {
        const seasonalScore = await this.evaluateSeasonalPerformance(supplierId);
        const marketConditionsScore = await this.evaluateMarketConditions();

        return Math.round(
            (seasonalScore * this.WEIGHTS.MARKET_FACTORS.components.seasonalPerformance) +
            (marketConditionsScore * this.WEIGHTS.MARKET_FACTORS.components.marketConditions)
        );
    }

    // Helper functions
    static calculateVolumeScore(volume) {
        // Implement volume scoring logic based on your business rules
        const VOLUME_THRESHOLDS = {
            HIGH: 1000000,  // 1M
            MEDIUM: 500000, // 500K
            LOW: 100000     // 100K
        };

        if (volume >= VOLUME_THRESHOLDS.HIGH) return 100;
        if (volume >= VOLUME_THRESHOLDS.MEDIUM) return 75;
        if (volume >= VOLUME_THRESHOLDS.LOW) return 50;
        return 25;
    }

    static calculateFrequencyScore(transactionCount) {
        // Implement frequency scoring logic
        const FREQUENCY_THRESHOLDS = {
            HIGH: 50,   // 50 transactions per year
            MEDIUM: 25, // 25 transactions per year
            LOW: 12     // 1 transaction per month
        };

        if (transactionCount >= FREQUENCY_THRESHOLDS.HIGH) return 100;
        if (transactionCount >= FREQUENCY_THRESHOLDS.MEDIUM) return 75;
        if (transactionCount >= FREQUENCY_THRESHOLDS.LOW) return 50;
        return 25;
    }

    // Calculate consistency score based on transaction patterns
    static async calculateConsistencyScore(transactions) {
        if (!transactions || transactions.length === 0) return 0;
        
        // Group transactions by month
        const monthlyTransactions = {};
        
        transactions.forEach(transaction => {
            const date = new Date(transaction.created_at);
            const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
            
            if (!monthlyTransactions[monthKey]) {
                monthlyTransactions[monthKey] = 0;
            }
            
            monthlyTransactions[monthKey]++;
        });
        
        // Calculate months with activity
        const monthsWithActivity = Object.keys(monthlyTransactions).length;
        
        // Calculate consistency score (max score if active in at least 10 of last 12 months)
        return Math.min(100, (monthsWithActivity / 12) * 100);
    }

    // Evaluate loan history for a supplier
    static async evaluateLoanHistory(supplierId) {
        try {
            const Loan = mongoose.model('Loan');
            
            // Get all completed loans
            const loans = await Loan.find({
                supplier: supplierId,
                status: 'paid'
            });
            
            if (loans.length === 0) return 50; // Neutral score if no loan history
            
            // Calculate total loans and on-time completion rate
            const totalLoans = loans.length;
            const onTimeLoans = loans.filter(loan => {
                // Check if loan was paid on time (before or on due date)
                return loan.paid_date <= loan.due_date;
            }).length;
            
            const onTimeRate = (onTimeLoans / totalLoans) * 100;
            
            // Award higher scores for more loans completed on time
            let volumeBonus = Math.min(20, totalLoans * 2); // Up to 20 points bonus for volume
            
            return Math.min(100, onTimeRate + volumeBonus);
        } catch (error) {
            console.error('Error evaluating loan history:', error);
            return 50; // Default to neutral score on error
        }
    }

    // Evaluate business volume for relationship score
    static async evaluateBusinessVolume(supplierId) {
        try {
            // Calculate total transaction amount
            const transactions = await Transaction.find({ supplier: supplierId });
            const totalVolume = transactions.reduce((sum, t) => sum + t.amount, 0);
            
            // Score based on total business volume
            if (totalVolume >= 5000000) return 100; // 5M+
            if (totalVolume >= 1000000) return 80;  // 1M+
            if (totalVolume >= 500000) return 60;   // 500K+
            if (totalVolume >= 100000) return 40;   // 100K+
            return 20; // Less than 100K
        } catch (error) {
            console.error('Error evaluating business volume:', error);
            return 0;
        }
    }

    // Evaluate seasonal performance
    static async evaluateSeasonalPerformance(supplierId) {
        try {
            const currentMonth = new Date().getMonth();
            
            // Define peak seasons for copra (customize based on your business)
            const peakSeasons = [0, 1, 5, 6, 7]; // Jan, Feb, Jun, Jul, Aug
            
            // Get transactions from the last 3 months
            const threeMonthsAgo = new Date();
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
            
            const recentTransactions = await Transaction.find({
                supplier: supplierId,
                created_at: { $gte: threeMonthsAgo }
            });
            
            if (recentTransactions.length === 0) return 50; // Neutral score
            
            // Calculate average monthly transaction volume for the period
            const monthlyVolumes = {};
            
            recentTransactions.forEach(transaction => {
                const month = new Date(transaction.created_at).getMonth();
                if (!monthlyVolumes[month]) monthlyVolumes[month] = 0;
                monthlyVolumes[month] += transaction.amount;
            });
            
            // Current season expectations
            const isPeakSeason = peakSeasons.includes(currentMonth);
            
            // Calculate current month's performance relative to expectations
            const currentMonthVolume = monthlyVolumes[currentMonth] || 0;
            
            // During peak season, high volume is expected
            // During off-season, lower volume is acceptable
            if (isPeakSeason) {
                // Higher score for higher volume during peak season
                return Math.min(100, (currentMonthVolume / 100000) * 100);
            } else {
                // During off-season, any activity is good
                return currentMonthVolume > 0 ? 75 : 50;
            }
        } catch (error) {
            console.error('Error evaluating seasonal performance:', error);
            return 50; // Default to neutral
        }
    }

    // Evaluate market conditions
    static async evaluateMarketConditions() {
        try {
            // In a real-world scenario, this would pull from market data sources
            // For now, we'll use a placeholder implementation
            
            // You could replace this with actual market data from an external API
            const currentMarketCondition = 'stable'; // Example: 'favorable', 'stable', 'unfavorable'
            
            switch (currentMarketCondition) {
                case 'favorable':
                    return 100;
                case 'stable':
                    return 75;
                case 'unfavorable':
                    return 50;
                default:
                    return 75;
            }
        } catch (error) {
            console.error('Error evaluating market conditions:', error);
            return 75; // Default to stable market conditions
        }
    }
}

module.exports = CreditScoreAnalytics;