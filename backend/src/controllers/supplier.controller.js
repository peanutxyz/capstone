// src/controllers/supplier.controller.js

const { recalculateSupplierBalance } = require('../lib/utils/supplierBalanceUtils');

exports.syncSupplierBalance = async (req, res) => {
  try {
    const { supplierId } = req.params;
    
    const newBalance = await recalculateSupplierBalance(supplierId);
    
    res.status(200).json({
      success: true,
      message: 'Supplier balance synced successfully',
      balance: newBalance
    });
  } catch (error) {
    console.error('Error syncing supplier balance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync supplier balance',
      error: error.message
    });
  }
};