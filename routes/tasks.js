// routes/tasks.js - Task management routes
const express = require('express');
const router = express.Router();
const { db, logActivity } = require('../db');
const { authenticate, requireProjectMember } = require('../middleware/auth');

// Helper: check if user can modify task (admin, project admin, or task creator/assignee)
function canModifyTask(user, task, projectId) {
  if (user.role === 'admin') return true;
  if (task.creator_id === user.id) return true;

  const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, user.id);
  return member && member.role === 'admin';
}

// GET /api/tasks - Get all tasks (dashboard view)
router.get('/', authenticate, (req, res) => {
  try {
    let tasks;
    const { status, priority, project_id, assignee_id } = req.query;

    let query = `
      SELECT t.*, p.name as project_name, p.color as project_color,
        u1.name as assignee_name, u1.avatar_color as assignee_avatar,
        u2.name as creator_name
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u1 ON t.assignee_id = u1.id
      LEFT JOIN users u2 ON t.creator_id = u2.id
    `;

    const conditions = [];
    const params = [];

    if (req.user.role !== 'admin') {
      query += ` JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?`;
      params.push(req.user.id);
    }

    if (status) { conditions.push('t.status = ?'); params.push(status); }
    if (priority) { conditions.push('t.priority = ?'); params.push(priority); }
    if (project_id) { conditions.push('t.project_id = ?'); params.push(project_id); }
    if (assignee_id) { conditions.push('t.assignee_id = ?'); params.push(assignee_id); }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY t.updated_at DESC';

    tasks = db.prepare(query).all(...params);
    res.json({ tasks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// GET /api/tasks/my - Get tasks assigned to current user
router.get('/my', authenticate, (req, res) => {
  const tasks = db.prepare(`
    SELECT t.*, p.name as project_name, p.color as project_color,
      u1.name as assignee_name, u1.avatar_color as assignee_avatar,
      u2.name as creator_name
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    LEFT JOIN users u1 ON t.assignee_id = u1.id
    LEFT JOIN users u2 ON t.creator_id = u2.id
    WHERE t.assignee_id = ?
    ORDER BY 
      CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      t.due_date ASC NULLS LAST
  `).all(req.user.id);
  res.json({ tasks });
});

// GET /api/tasks/overdue - Get overdue tasks
router.get('/overdue', authenticate, (req, res) => {
  let tasks;
  if (req.user.role === 'admin') {
    tasks = db.prepare(`
      SELECT t.*, p.name as project_name, p.color as project_color,
        u.name as assignee_name, u.avatar_color as assignee_avatar
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.id
      WHERE t.due_date < date('now') AND t.status != 'done'
      ORDER BY t.due_date ASC
    `).all();
  } else {
    tasks = db.prepare(`
      SELECT t.*, p.name as project_name, p.color as project_color,
        u.name as assignee_name, u.avatar_color as assignee_avatar
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.id
      JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
      WHERE t.due_date < date('now') AND t.status != 'done'
      ORDER BY t.due_date ASC
    `).all(req.user.id);
  }
  res.json({ tasks });
});

// GET /api/tasks/stats - Dashboard statistics
router.get('/stats', authenticate, (req, res) => {
  try {
    let stats;
    if (req.user.role === 'admin') {
      stats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) as todo,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
          SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) as review,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
          SUM(CASE WHEN due_date < date('now') AND status != 'done' THEN 1 ELSE 0 END) as overdue,
          SUM(CASE WHEN priority = 'critical' THEN 1 ELSE 0 END) as critical
        FROM tasks
      `).get();
    } else {
      stats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN t.status = 'todo' THEN 1 ELSE 0 END) as todo,
          SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
          SUM(CASE WHEN t.status = 'review' THEN 1 ELSE 0 END) as review,
          SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done,
          SUM(CASE WHEN t.due_date < date('now') AND t.status != 'done' THEN 1 ELSE 0 END) as overdue,
          SUM(CASE WHEN t.priority = 'critical' THEN 1 ELSE 0 END) as critical
        FROM tasks t
        JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
      `).get(req.user.id);
    }

    const projectCount = req.user.role === 'admin'
      ? db.prepare('SELECT COUNT(*) as c FROM projects').get().c
      : db.prepare('SELECT COUNT(DISTINCT project_id) as c FROM project_members WHERE user_id = ?').get(req.user.id).c;

    const myTaskCount = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE assignee_id = ? AND status != ?').get(req.user.id, 'done').c;

    res.json({ stats, projectCount, myTaskCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/tasks/:projectId/list - Get tasks for a project
router.get('/:projectId/list', authenticate, (req, res) => {
  // Check project membership
  if (req.user.role !== 'admin') {
    const member = db.prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?').get(req.params.projectId, req.user.id);
    if (!member) return res.status(403).json({ error: 'Access denied' });
  }

  const { status } = req.query;
  let query = `
    SELECT t.*, 
      u1.name as assignee_name, u1.avatar_color as assignee_avatar, u1.email as assignee_email,
      u2.name as creator_name,
      (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) as comment_count
    FROM tasks t
    LEFT JOIN users u1 ON t.assignee_id = u1.id
    LEFT JOIN users u2 ON t.creator_id = u2.id
    WHERE t.project_id = ?
  `;
  const params = [req.params.projectId];
  if (status) { query += ' AND t.status = ?'; params.push(status); }
  query += ' ORDER BY CASE t.priority WHEN \\'critical\\' THEN 1 WHEN \\'high\\' THEN 2 WHEN \\'medium\\' THEN 3 ELSE 4 END, t.created_at DESC';

  const tasks = db.prepare(query).all(...params);
  res.json({ tasks });
});

// POST /api/tasks - Create task
router.post('/', authenticate, (req, res) => {
  const { title, description, status, priority, project_id, assignee_id, due_date } = req.body;

  if (!title || title.trim().length < 2) return res.status(400).json({ error: 'Task title required' });
  if (!project_id) return res.status(400).json({ error: 'Project ID required' });

  // Check membership
  if (req.user.role !== 'admin') {
    const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(project_id, req.user.id);
    if (!member || member.role !== 'admin') return res.status(403).json({ error: 'Only project admins can create tasks' });
  }

  // Validate assignee is a project member
  if (assignee_id) {
    const assigneeMember = db.prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?').get(project_id, assignee_id);
    if (!assigneeMember && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'Assignee must be a project member' });
    }
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO tasks (title, description, status, priority, project_id, assignee_id, creator_id, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      title.trim(), description || null,
      status || 'todo', priority || 'medium',
      project_id, assignee_id || null, req.user.id, due_date || null
    );

    const task = db.prepare(`
      SELECT t.*, u1.name as assignee_name, u1.avatar_color as assignee_avatar, u2.name as creator_name
      FROM tasks t LEFT JOIN users u1 ON t.assignee_id = u1.id LEFT JOIN users u2 ON t.creator_id = u2.id
      WHERE t.id = ?
    `).get(result.lastInsertRowid);

    logActivity(req.user.id, project_id, result.lastInsertRowid, 'task_created', `Created task "${title.trim()}"`);
    res.status(201).json({ message: 'Task created', task });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// GET /api/tasks/detail/:id - Get single task
router.get('/detail/:id', authenticate, (req, res) => {
  const task = db.prepare(`
    SELECT t.*, p.name as project_name, p.color as project_color,
      u1.name as assignee_name, u1.avatar_color as assignee_avatar,
      u2.name as creator_name, u2.avatar_color as creator_avatar
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    LEFT JOIN users u1 ON t.assignee_id = u1.id
    LEFT JOIN users u2 ON t.creator_id = u2.id
    WHERE t.id = ?
  `).get(req.params.id);

  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Check access
  if (req.user.role !== 'admin') {
    const member = db.prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?').get(task.project_id, req.user.id);
    if (!member) return res.status(403).json({ error: 'Access denied' });
  }

  const comments = db.prepare(`
    SELECT c.*, u.name as user_name, u.avatar_color
    FROM comments c JOIN users u ON c.user_id = u.id
    WHERE c.task_id = ?
    ORDER BY c.created_at ASC
  `).all(req.params.id);

  res.json({ task, comments });
});

// PUT /api/tasks/:id - Update task
router.put('/:id', authenticate, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (!canModifyTask(req.user, task, task.project_id)) {
    // Members can update status of their assigned task
    if (task.assignee_id !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied' });
    }
  }

  const { title, description, status, priority, assignee_id, due_date } = req.body;

  try {
    db.prepare(`
      UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, assignee_id = ?, due_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      title || task.title, description !== undefined ? description : task.description,
      status || task.status, priority || task.priority,
      assignee_id !== undefined ? (assignee_id || null) : task.assignee_id,
      due_date !== undefined ? (due_date || null) : task.due_date,
      req.params.id
    );

    logActivity(req.user.id, task.project_id, task.id, 'task_updated', `Updated task "${title || task.title}" to ${status || task.status}`);

    const updated = db.prepare(`
      SELECT t.*, u1.name as assignee_name, u1.avatar_color as assignee_avatar, u2.name as creator_name
      FROM tasks t LEFT JOIN users u1 ON t.assignee_id = u1.id LEFT JOIN users u2 ON t.creator_id = u2.id
      WHERE t.id = ?
    `).get(req.params.id);
    res.json({ message: 'Task updated', task: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// PATCH /api/tasks/:id/status - Quick status update
router.patch('/:id/status', authenticate, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['todo', 'in_progress', 'review', 'done'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (req.user.role !== 'admin' && task.assignee_id !== req.user.id && task.creator_id !== req.user.id) {
    const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(task.project_id, req.user.id);
    if (!member) return res.status(403).json({ error: 'Access denied' });
  }

  db.prepare('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, req.params.id);
  logActivity(req.user.id, task.project_id, task.id, 'status_changed', `Changed status to "${status}"`);
  res.json({ message: 'Status updated' });
});

// DELETE /api/tasks/:id
router.delete('/:id', authenticate, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (!canModifyTask(req.user, task, task.project_id)) {
    return res.status(403).json({ error: 'Permission denied' });
  }

  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  logActivity(req.user.id, task.project_id, null, 'task_deleted', `Deleted task "${task.title}"`);
  res.json({ message: 'Task deleted' });
});

// POST /api/tasks/:id/comments
router.post('/:id/comments', authenticate, (req, res) => {
  const { content } = req.body;
  if (!content || content.trim().length === 0) return res.status(400).json({ error: 'Comment cannot be empty' });

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const result = db.prepare('INSERT INTO comments (task_id, user_id, content) VALUES (?, ?, ?)').run(req.params.id, req.user.id, content.trim());
  const comment = db.prepare('SELECT c.*, u.name as user_name, u.avatar_color FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?').get(result.lastInsertRowid);

  logActivity(req.user.id, task.project_id, task.id, 'comment_added', `Commented on "${task.title}"`);
  res.status(201).json({ comment });
});

module.exports = router;
