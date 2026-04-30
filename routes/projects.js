// routes/projects.js - Project management routes
const express = require('express');
const router = express.Router();
const { db, logActivity } = require('../db');
const { authenticate, requireProjectAdmin, requireProjectMember } = require('../middleware/auth');

const PROJECT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#22c55e', '#0ea5e9'];

// GET /api/projects - List all projects for current user
router.get('/', authenticate, (req, res) => {
  try {
    let projects;
    if (req.user.role === 'admin') {
      projects = db.prepare(`
        SELECT p.*, u.name as owner_name, u.avatar_color as owner_avatar,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') as done_count,
          (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as member_count
        FROM projects p
        JOIN users u ON p.owner_id = u.id
        ORDER BY p.updated_at DESC
      `).all();
    } else {
      projects = db.prepare(`
        SELECT p.*, u.name as owner_name, u.avatar_color as owner_avatar,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') as done_count,
          (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as member_count,
          pm2.role as my_role
        FROM projects p
        JOIN users u ON p.owner_id = u.id
        LEFT JOIN project_members pm2 ON pm2.project_id = p.id AND pm2.user_id = ?
        WHERE p.owner_id = ? OR pm2.user_id = ?
        ORDER BY p.updated_at DESC
      `).all(req.user.id, req.user.id, req.user.id);
    }

    res.json({ projects });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// POST /api/projects - Create project
router.post('/', authenticate, (req, res) => {
  const { name, description, due_date, color } = req.body;
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Project name must be at least 2 characters' });
  }

  try {
    const projectColor = color || PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
    const stmt = db.prepare(`
      INSERT INTO projects (name, description, color, owner_id, due_date)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(name.trim(), description || null, projectColor, req.user.id, due_date || null);

    // Add creator as project admin
    db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)').run(result.lastInsertRowid, req.user.id, 'admin');

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
    logActivity(req.user.id, result.lastInsertRowid, null, 'project_created', `Created project "${name.trim()}"`);

    res.status(201).json({ message: 'Project created', project });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// GET /api/projects/:id - Get single project
router.get('/:id', authenticate, requireProjectMember, (req, res) => {
  try {
    const project = db.prepare(`
      SELECT p.*, u.name as owner_name, u.avatar_color as owner_avatar
      FROM projects p JOIN users u ON p.owner_id = u.id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!project) return res.status(404).json({ error: 'Project not found' });

    const members = db.prepare(`
      SELECT u.id, u.name, u.email, u.role as global_role, u.avatar_color, pm.role as project_role, pm.joined_at
      FROM project_members pm JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ?
      ORDER BY pm.role DESC, u.name
    `).all(req.params.id);

    const taskStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) as todo,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) as review,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN due_date < date('now') AND status != 'done' THEN 1 ELSE 0 END) as overdue
      FROM tasks WHERE project_id = ?
    `).get(req.params.id);

    res.json({ project, members, taskStats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// PUT /api/projects/:id - Update project
router.put('/:id', authenticate, requireProjectAdmin, (req, res) => {
  const { name, description, status, due_date, color } = req.body;
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Project name required' });
  }

  try {
    db.prepare(`
      UPDATE projects SET name = ?, description = ?, status = ?, due_date = ?, color = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name.trim(), description || null, status || 'active', due_date || null, color || '#6366f1', req.params.id);

    logActivity(req.user.id, req.params.id, null, 'project_updated', `Updated project "${name.trim()}"`);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    res.json({ message: 'Project updated', project });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', authenticate, requireProjectAdmin, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Only global admin or project owner can delete
  if (req.user.role !== 'admin' && project.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Only project owner can delete' });
  }

  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ message: 'Project deleted' });
});

// POST /api/projects/:id/members - Add member
router.post('/:id/members', authenticate, requireProjectAdmin, (req, res) => {
  const { user_id, role } = req.body;
  if (!user_id) return res.status(400).json({ error: 'User ID required' });

  try {
    const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const existing = db.prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?').get(req.params.id, user_id);
    if (existing) return res.status(409).json({ error: 'User is already a member' });

    db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)').run(req.params.id, user_id, role || 'member');

    logActivity(req.user.id, req.params.id, null, 'member_added', `Added ${user.name} to project`);
    res.status(201).json({ message: 'Member added' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// PUT /api/projects/:id/members/:userId - Update member role
router.put('/:id/members/:userId', authenticate, requireProjectAdmin, (req, res) => {
  const { role } = req.body;
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  db.prepare('UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?').run(role, req.params.id, req.params.userId);
  res.json({ message: 'Member role updated' });
});

// DELETE /api/projects/:id/members/:userId - Remove member
router.delete('/:id/members/:userId', authenticate, requireProjectAdmin, (req, res) => {
  const project = db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(req.params.id);
  if (parseInt(req.params.userId) === project.owner_id) {
    return res.status(400).json({ error: 'Cannot remove project owner' });
  }

  db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  res.json({ message: 'Member removed' });
});

// GET /api/projects/:id/activity
router.get('/:id/activity', authenticate, requireProjectMember, (req, res) => {
  const activity = db.prepare(`
    SELECT al.*, u.name as user_name, u.avatar_color
    FROM activity_log al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE al.project_id = ?
    ORDER BY al.created_at DESC
    LIMIT 20
  `).all(req.params.id);
  res.json({ activity });
});

module.exports = router;
