// src/routes/supplier.routes.js

const express = require('express');
const supplierRouter = express.Router();
const { auth, authorize } = require('../middleware/auth');
const Supplier = require('../models/Supplier');
const User = require('../models/User');
const { recalculateSupplierBalance } = require('../lib/utils/supplierBalanceUtils');

// Create supplier (Admin & Owner only)
supplierRouter.post('/', auth, authorize('admin', 'owner'), async (req, res) => {
    try {
        const supplier = new Supplier({
            user: req.body.user_id,
            // Add contact fields if provided
            contact: {
                phone: req.body.phone || '',
                email: req.body.email || ''
            },
            // Add address fields if provided
            address: {
                street: req.body.street || '',
                purok: req.body.purok || '',
                barangay: req.body.barangay || '',
                municipal: req.body.municipal || ''
            },
            current_balance: 0,
            is_active: true
        });
        await supplier.save();

        const populatedSupplier = await Supplier.findById(supplier._id)
            .populate('user', '-password');
           
        res.status(201).json(populatedSupplier);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get all suppliers
supplierRouter.get('/', auth, async (req, res) => {
    try {
        const suppliers = await Supplier.find()
            .populate('user', '-password');
        res.json(suppliers);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get supplier by ID
supplierRouter.get('/:id', auth, async (req, res) => {
    try {
        const supplier = await Supplier.findById(req.params.id)
            .populate('user', '-password');
        if (!supplier) {
            return res.status(404).json({ message: 'Supplier not found' });
        }
        res.json(supplier);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Update supplier
supplierRouter.put('/:id', auth, authorize('admin', 'owner'), async (req, res) => {
    try {
        // Build update object
        const updateData = {};
       
        // Update basic fields if provided
        if (req.body.current_balance !== undefined) {
            updateData.current_balance = req.body.current_balance;
        }
       
        if (req.body.is_active !== undefined) {
            updateData.is_active = req.body.is_active;
        }
       
        // Update contact fields if provided
        if (req.body.phone || req.body.email) {
            updateData.contact = {};
           
            if (req.body.phone) {
                updateData.contact.phone = req.body.phone;
            }
           
            if (req.body.email) {
                updateData.contact.email = req.body.email;
            }
        }
       
        // Update address fields if provided
        if (req.body.street || req.body.purok || req.body.barangay || req.body.municipal) {
            updateData.address = {};
           
            if (req.body.street) {
                updateData.address.street = req.body.street;
            }
           
            if (req.body.purok) {
                updateData.address.purok = req.body.purok;
            }
           
            if (req.body.barangay) {
                updateData.address.barangay = req.body.barangay;
            }
           
            if (req.body.municipal) {
                updateData.address.municipal = req.body.municipal;
            }
        }
        // For nested objects like contact and address, use $set to update specific fields
        // without completely replacing the objects
        const updateOp = {};
       
        for (const [key, value] of Object.entries(updateData)) {
            if (typeof value === 'object' && value !== null) {
                // For nested objects, use dot notation with $set
                for (const [nestedKey, nestedValue] of Object.entries(value)) {
                    updateOp[`${key}.${nestedKey}`] = nestedValue;
                }
            } else {
                // For top-level fields
                updateOp[key] = value;
            }
        }

        const supplier = await Supplier.findByIdAndUpdate(
            req.params.id,
            { $set: updateOp },
            { new: true, runValidators: true }
        ).populate('user', '-password');
        if (!supplier) {
            return res.status(404).json({ message: 'Supplier not found' });
        }
        res.json(supplier);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Delete supplier (Admin only)
supplierRouter.delete('/:id', auth, authorize('admin'), async (req, res) => {
    try {
      const supplier = await Supplier.findById(req.params.id);
      
      if (!supplier) {
        return res.status(404).json({ message: 'Supplier not found' });
      }
      
      await supplier.deleteOne(); // Changed from remove() to deleteOne()
      res.json({ message: 'Supplier deleted successfully' });
    } catch (error) {
      console.error('Error deleting supplier:', error);
      res.status(500).json({ message: error.message });
    }
  });

// Sync supplier balance
supplierRouter.post('/:id/sync-balance', auth, authorize('admin', 'owner'), async (req, res) => {
  try {
    const supplierId = req.params.id;
    
    const newBalance = await recalculateSupplierBalance(supplierId);
    
    res.status(200).json({
      success: true,
      message: 'Supplier balance synced successfully',
      current_balance: newBalance
    });
  } catch (error) {
    console.error('Error syncing supplier balance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync supplier balance',
      error: error.message
    });
  }
});

module.exports = supplierRouter;