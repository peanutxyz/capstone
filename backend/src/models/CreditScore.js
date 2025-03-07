// src/models/CreditScore.js

const mongoose = require('mongoose');

const creditScoreSchema = new mongoose.Schema({
   supplier: {
       type: mongoose.Schema.Types.ObjectId,
       ref: 'Supplier',
       required: true
   },
   score: {
       type: Number,
       required: true,
       min: 0,
       max: 100 // max score is 100
   },
   transaction_consistency: {
       type: Number,
       min: 0,
       max: 100,
       default: 0
   },
   total_supply_score: {
       type: Number,
       min: 0,
       max: 100,
       default: 0
   },
   transaction_count_score: {
       type: Number,
       min: 0,
       max: 100,
       default: 0
   },
   eligible_amount: {
       type: Number,
       default: 0,
       min: 0
   },
   transaction_count: {
       type: Number,
       default: 0,
       min: 0
   },
   credit_percentage: {
       type: Number,
       default: 0.2,
       min: 0,
       max: 1
   },
   average_transaction: {
       type: Number,
       default: 0,
       min: 0
   },
   assessment_date: {
       type: Date,
       required: true,
       default: Date.now
   },
   remarks: String
}, { timestamps: true });

// Add indexes
creditScoreSchema.index({ supplier: 1, assessment_date: -1 });

// Static method to get latest score for a supplier
creditScoreSchema.statics.getLatestScore = async function(supplierId) {
   return this.findOne({ supplier: supplierId })
       .sort({ assessment_date: -1 })
       .exec();
};

// Static method to get score history for a supplier
creditScoreSchema.statics.getScoreHistory = async function(supplierId) {
   return this.find({ supplier: supplierId })
       .sort({ assessment_date: -1 })
       .exec();
};

// Pre-save middleware to validate score
creditScoreSchema.pre('save', function(next) {
   if (this.score < 0) this.score = 0;
   if (this.score > 100) this.score = 100;
   next();
});

// Virtual for score category - standardized categories
creditScoreSchema.virtual('category').get(function() {
   if (this.score <= 0) return 'No Score';
   if (this.score <= 30) return 'Poor';
   if (this.score <= 40) return 'Fair';
   if (this.score <= 60) return 'Good';
   if (this.score <= 75) return 'Very Good';
   return 'Excellent';
});

// Virtual for loan eligibility - enforces transaction requirement
creditScoreSchema.virtual('is_eligible').get(function() {
   return this.transaction_count > 0 && this.score >= 30;
});

module.exports = mongoose.model('CreditScore', creditScoreSchema);