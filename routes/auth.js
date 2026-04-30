// routes/auth.js - Authentication routes
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { generateToken, authenticate } = require('../middleware/auth');

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#3b82f6'
];

// POST /api/auth/signup
router.post('/signup', (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = bcrypt.hashSync(password, 12);
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    // First user becomes admin
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const assignedRole = userCount.count === 0 ? 'admin' : (role === 'admin' ? 'admin' : 'member');

    const stmt = db.prepare(`
      INSERT INTO users (name, email, password, role, avatar_color)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(name.trim(), email.toLowerCase(), hashedPassword, assignedRole, avatarColor);

    const user = db.prepare('SELECT id, name, email, role, avatar_color FROM users WHERE id = ?').get(result.lastInsertRowid);
    const token = generateToken(user);

    res.status(201).json({ message: 'Account created successfully', token, user });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const { password: _, ...userWithoutPassword } = user;
    const token = generateToken(user);

    res.json({ message: 'Login successful', token, user: userWithoutPassword });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// PUT /api/auth/profile
router.put('/profile', authenticate, (req, res) => {
  const { name, currentPassword, newPassword } = req.body;

  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters' });
  }

  try {
    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
      const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
      if (!bcrypt.compareSync(currentPassword, user.password)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
      const hashed = bcrypt.hashSync(newPassword, 12);
      db.prepare('UPDATE users SET name = ?, password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(name.trim(), hashed, req.user.id);
    } else {
      db.prepare('UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(name.trim(), req.user.id);
    }

    const updatedUser = db.prepare('SELECT id, name, email, role, avatar_color FROM users WHERE id = ?').get(req.user.id);
    res.json({ message: 'Profile updated', user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// GET /api/auth/users (admin only - list all users)
router.get('/users', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    // Members can see basic user list for assignment
    const users = db.prepare('SELECT id, name, email, role, avatar_color FROM users ORDER BY name').all();
    return res.json({ users });
  }
  const users = db.prepare('SELECT id, name, email, role, avatar_color, created_at FROM users ORDER BY created_at DESC').all();
  res.json({ users });
});

// PUT /api/auth/users/:id/role (admin only)
router.put('/users/:id/role', authenticate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { role } = req.body;
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot change own role' });

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ message: 'Role updated' });
});

module.exports = router;
