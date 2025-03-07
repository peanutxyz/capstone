// src/middleware/auth.js

const jwt = require('jsonwebtoken');
const config = require('../config/config');
const User = require('../models/User'); // Add this import
const Supplier = require('../models/Supplier'); // Add this import

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No authentication token' });
    }

    const decoded = jwt.verify(token, config.jwt_secret);
    
    // Find the complete user data
    const user = await User.findById(decoded.id);
    if (!user) {
      throw new Error('User not found');
    }

    // If role is supplier, get the supplier ID
    if (decoded.role === 'supplier') {
      const supplier = await Supplier.findOne({ user: decoded.id });
      if (supplier) {
        req.user = {
          ...decoded,
          supplierId: supplier._id // Add supplier ID to request
        };
      }
    } else {
      req.user = decoded;
    }

    console.log('Auth middleware user:', req.user); // Debug log
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Enhanced RBAC middleware
const authorize = (...roles) => {
  return async (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Not authorized for this operation' });
    }

    // Special handling for owner role restrictions
    if (req.user.role === 'owner') {
      const operation = req.method;
      // Owners cannot delete records
      if (operation === 'DELETE') {
        return res.status(403).json({ 
          message: 'Owners are not authorized to delete records' 
        });
      }
    }

    next();
  };
};

// Admin-only delete permission middleware
const allowDelete = async (req, res, next) => {
  if (req.method === 'DELETE' && req.user.role !== 'admin') {
    return res.status(403).json({ 
      message: 'Only administrators can delete records' 
    });
  }
  next();
};

module.exports = { auth, authorize, allowDelete };