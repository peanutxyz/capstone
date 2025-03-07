const Settings = require('../models/Settings'); // Create this model if needed

exports.updateLoanLimit = async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid loan limit amount'
      });
    }
    
    // Find and update settings or create if not exists
    let settings = await Settings.findOne({ type: 'loan_config' });
    
    if (!settings) {
      settings = new Settings({
        type: 'loan_config',
        defaultLoanLimit: amount
      });
    } else {
      settings.defaultLoanLimit = amount;
    }
    
    await settings.save();
    
    res.json({
      success: true,
      message: 'Loan limit updated successfully',
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