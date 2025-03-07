// src/lib/utils/supplierBalanceUtils.js
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;

async function recalculateSupplierBalance(supplierId) {
  try {
    const Supplier = mongoose.model('Supplier');
    const Loan = mongoose.model('Loan');
    
    // Convert string ID to ObjectId if needed
    const supplierObjectId = typeof supplierId === 'string' ? 
      new ObjectId(supplierId) : supplierId;
    
    // Calculate sum of remaining loan amounts
    const loanBalances = await Loan.aggregate([
      { 
        $match: { 
          supplier: supplierObjectId, 
          status: 'approved' 
        } 
      },
      { 
        $group: { 
          _id: null, 
          totalRemaining: { 
            $sum: { 
              $subtract: [
                '$amount', 
                { $ifNull: ['$total_paid', 0] }
              ] 
            } 
          } 
        } 
      }
    ]);
    
    // Extract the balance or default to 0
    const currentBalance = loanBalances.length > 0 ? 
      loanBalances[0].totalRemaining : 0;
    
    // Update the supplier record
    await Supplier.findByIdAndUpdate(
      supplierObjectId, 
      { current_balance: currentBalance }
    );
    
    return currentBalance;
  } catch (error) {
    console.error('Error recalculating supplier balance:', error);
    throw error;
  }
}

module.exports = { recalculateSupplierBalance };