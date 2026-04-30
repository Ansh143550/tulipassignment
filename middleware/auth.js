// middleware/auth.js - JWT Authentication & Role-Based Access Control
const jwt = require('jsonwebtoken');
const { db } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'tulip_secret_key';

// Verify JWT token
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, role, avatar_color FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// Require global admin role
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Require project admin or global admin
function requireProjectAdmin(req, res, next) {
  const projectId = req.params.projectId || req.params.id || req.body.project_id;
  if (req.user.role === 'admin') return next(); // Global admin bypasses

  const member = db.prepare(
    'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
  ).get(projectId, req.user.id);

  if (!member || member.role !== 'admin') {
    return res.status(403).json({ error: 'Project admin access required' });
  }
  next();
}

// Check if user is project member (any role)
function requireProjectMember(req, res, next) {
  const projectId = req.params.projectId || req.params.id;
  if (req.user.role === 'admin') return next(); // Global admin bypasses

  const project = db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const member = db.prepare(
    'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?'
  ).get(projectId, req.user.id);

  if (!member && project.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }
  next();
}

function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { authenticate, requireAdmin, requireProjectAdmin, requireProjectMember, generateToken };
