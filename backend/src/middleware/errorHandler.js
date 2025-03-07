// src/middleware/errorHandler.js
const errorHandler = (err, req, res, next) => {
    console.error(err.stack);
  
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        details: err.message
      });
    }
  
    if (err.name === 'CastError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid ID',
        details: err.message
      });
    }
  
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Duplicate Field',
        details: 'A record with this field already exists'
      });
    }
  
    res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Server Error'
    });
  };
  
  module.exports = errorHandler;