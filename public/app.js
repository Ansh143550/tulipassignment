// === STATE ===

let token = localStorage.getItem('token') || '';
let currentUser = null;
let currentProject = null;
let editingProjectId = null;
let editingTaskId = null;
let viewingTaskId = null;
const API = '';

// === HELPERS ===
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...opts
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast ' + type;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3500);
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function setLoading(btnId, loading) {
  const b = document.getElementById(btnId);
  if (!b) return;
  b.disabled = loading;
  b.textContent = loading ? 'Loading...' : b.dataset.label || b.textContent;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isOverdue(d, status) {
  if (!d || status === 'done') return false;
  return new Date(d) < new Date(new Date().toDateString());
}

function statusBadge(s) {
  const map = { todo: ['badge-todo', 'Todo'], in_progress: ['badge-inprogress', 'In Progress'], review: ['badge-review', 'Review'], done: ['badge-done', 'Done'] };
  const [cls, label] = map[s] || ['', s];
  return `<span class="badge ${cls}">${label}</span>`;
}

function priorityBadge(p) {
  const map = { low: 'badge-low', medium: 'badge-medium', high: 'badge-high', critical: 'badge-critical' };
  return `<span class="badge ${map[p] || ''}">${p}</span>`;
}

function avatarEl(name, color, size = 28) {
  return `<div class="user-avatar" style="background:${color || '#6366f1'};width:${size}px;height:${size}px;font-size:${size * 0.4}px">${(name || '?')[0].toUpperCase()}</div>`;
}

// === AUTH ===
function switchTab(tab) {
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('signup-form').classList.toggle('hidden', tab !== 'signup');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
}

async function handleLogin(e) {
  e.preventDefault();
  const err = document.getElementById('login-error');
  err.classList.add('hidden');
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: document.getElementById('login-email').value, password: document.getElementById('login-password').value })
    });
    token = data.token;
    localStorage.setItem('token', token);
    currentUser = data.user;
    initApp();
  } catch (ex) {
    err.textContent = ex.message; err.classList.remove('hidden');
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const err = document.getElementById('signup-error');
  err.classList.add('hidden');
  try {
    const data = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('signup-name').value,
        email: document.getElementById('signup-email').value,
        password: document.getElementById('signup-password').value,
        role: document.getElementById('signup-role').value
      })
    });
    token = data.token;
    localStorage.setItem('token', token);
    currentUser = data.user;
    initApp();
  } catch (ex) {
    err.textContent = ex.message; err.classList.remove('hidden');
  }
}

function logout() {
  token = ''; currentUser = null;
  localStorage.removeItem('token');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('auth-page').classList.remove('hidden');
}

// === NAVIGATION ===
function navigate(page, projectId) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.remove('hidden');
  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  if (page === 'dashboard') loadDashboard();
  else if (page === 'projects') loadProjects();
  else if (page === 'my-tasks') loadMyTasks();
  else if (page === 'admin') loadAdmin();
  else if (page === 'project-detail' && projectId) {
    currentProject = projectId;
    loadProjectDetail(projectId);
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// === INIT ===
async function initApp() {
  try {
    if (!token) { document.getElementById('auth-page').classList.remove('hidden'); return; }
    if (!currentUser) {
      const d = await api('/api/auth/me');
      currentUser = d.user;
    }
    document.getElementById('auth-page').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('sidebar-name').textContent = currentUser.name;
    document.getElementById('sidebar-role').textContent = currentUser.role;
    const av = document.getElementById('sidebar-avatar');
    av.textContent = currentUser.name[0].toUpperCase();
    av.style.background = currentUser.avatar_color || '#6366f1';
    document.getElementById('dash-greeting').textContent = `Welcome back, ${currentUser.name.split(' ')[0]}! 👋`;
    document.getElementById('admin-nav').style.display = currentUser.role === 'admin' ? '' : 'none';
    navigate('dashboard');
  } catch (e) {
    logout();
  }
}

// === DASHBOARD ===
async function loadDashboard() {
  try {
    const [statsData, projectsData, overdueData] = await Promise.all([
      api('/api/tasks/stats'),
      api('/api/projects'),
      api('/api/tasks/overdue')
    ]);
    const s = statsData.stats;
    document.getElementById('stat-total').textContent = s.total || 0;
    document.getElementById('stat-inprogress').textContent = s.in_progress || 0;
    document.getElementById('stat-done').textContent = s.done || 0;
    document.getElementById('stat-overdue').textContent = s.overdue || 0;
    document.getElementById('stat-projects').textContent = statsData.projectCount || 0;
    document.getElementById('stat-mytasks').textContent = statsData.myTaskCount || 0;

    const dp = document.getElementById('dash-projects');
    if (!projectsData.projects.length) {
      dp.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📁</div><p>No projects yet</p></div>';
    } else {
      dp.innerHTML = projectsData.projects.slice(0, 5).map(p => {
        const pct = p.task_count ? Math.round((p.done_count / p.task_count) * 100) : 0;
        return `<div class="project-card" onclick="navigate('project-detail','${p.id}')">
          <div class="project-card-accent" style="background:${p.color}"></div>
          <div class="project-card-name">${p.name}</div>
          <div class="project-progress"><div class="project-progress-bar" style="width:${pct}%;background:${p.color}"></div></div>
          <div class="project-card-meta"><span>${p.task_count} tasks</span><span>${pct}% done</span></div>
        </div>`;
      }).join('');
    }

    const od = document.getElementById('dash-overdue');
    document.getElementById('overdue-badge').textContent = overdueData.tasks.length;
    if (!overdueData.tasks.length) {
      od.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎉</div><p>No overdue tasks!</p></div>';
    } else {
      od.innerHTML = overdueData.tasks.slice(0, 6).map(t => `
        <div class="task-list-item" onclick="openTaskDetail(${t.id})">
          <div class="task-list-title">${t.title}</div>
          <span class="due-label overdue">${formatDate(t.due_date)}</span>
          ${priorityBadge(t.priority)}
        </div>`).join('');
    }
  } catch (e) { showToast('Failed to load dashboard', 'error'); }
}

// === PROJECTS ===
async function loadProjects() {
  const grid = document.getElementById('projects-grid');
  grid.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const data = await api('/api/projects');
    if (!data.projects.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📁</div><p>No projects yet. Create one!</p></div>';
      return;
    }
    grid.innerHTML = data.projects.map(p => {
      const pct = p.task_count ? Math.round((p.done_count / p.task_count) * 100) : 0;
      return `<div class="project-card" onclick="navigate('project-detail','${p.id}')">
        <div class="project-card-accent" style="background:${p.color}"></div>
        <div class="project-card-name">${p.name}</div>
        <div class="project-card-desc">${p.description || 'No description'}</div>
        <div class="project-progress"><div class="project-progress-bar" style="width:${pct}%;background:${p.color}"></div></div>
        <div class="project-card-meta">
          <span>${p.member_count} members · ${p.task_count} tasks</span>
          <span class="badge badge-${p.status === 'active' ? 'green' : 'member'}">${p.status}</span>
        </div>
      </div>`;
    }).join('');
  } catch (e) { showToast('Failed to load projects', 'error'); }
}

// === PROJECT MODAL ===
function selectColor(el) {
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
}

function openEditProject() {
  const p = window._currentProjectData;
  if (!p) return;
  editingProjectId = p.id;
  document.getElementById('project-modal-title').textContent = 'Edit Project';
  document.getElementById('proj-save-btn').textContent = 'Save Changes';
  document.getElementById('proj-name').value = p.name;
  document.getElementById('proj-desc').value = p.description || '';
  document.getElementById('proj-status').value = p.status;
  document.getElementById('proj-due').value = p.due_date || '';
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('selected', s.dataset.color === p.color);
  });
  openModal('project-modal');
}

async function handleSaveProject(e) {
  e.preventDefault();
  const color = document.querySelector('.color-swatch.selected')?.dataset.color || '#6366f1';
  const body = {
    name: document.getElementById('proj-name').value,
    description: document.getElementById('proj-desc').value,
    status: document.getElementById('proj-status').value,
    due_date: document.getElementById('proj-due').value,
    color
  };
  const err = document.getElementById('proj-modal-error');
  err.classList.add('hidden');
  try {
    if (editingProjectId) {
      await api('/api/projects/' + editingProjectId, { method: 'PUT', body: JSON.stringify(body) });
      showToast('Project updated!');
      closeModal('project-modal');
      loadProjectDetail(editingProjectId);
    } else {
      const d = await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
      showToast('Project created!');
      closeModal('project-modal');
      navigate('project-detail', d.project.id);
    }
    editingProjectId = null;
  } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
}

document.getElementById('project-modal').addEventListener('click', e => { if (e.target.id === 'project-modal') { editingProjectId = null; closeModal('project-modal'); } });

// Override openModal to reset project modal
window.openModal = function(id) {
  if (id === 'project-modal' && !editingProjectId) {
    document.getElementById('project-modal-title').textContent = 'New Project';
    document.getElementById('proj-save-btn').textContent = 'Create Project';
    document.getElementById('proj-name').value = '';
    document.getElementById('proj-desc').value = '';
    document.getElementById('proj-status').value = 'active';
    document.getElementById('proj-due').value = '';
    document.querySelectorAll('.color-swatch').forEach((s, i) => s.classList.toggle('selected', i === 0));
    document.getElementById('proj-modal-error').classList.add('hidden');
  }
  document.getElementById(id).classList.remove('hidden');
};

// === PROJECT DETAIL ===
async function loadProjectDetail(projectId) {
  try {
    const data = await api('/api/projects/' + projectId);
    window._currentProjectData = data.project;
    document.getElementById('proj-detail-name').textContent = data.project.name;
    document.getElementById('proj-detail-desc').textContent = data.project.description || '';

    const s = data.taskStats;
    const isAdmin = currentUser.role === 'admin' || (data.members && data.members.some(m => m.id === currentUser.id && m.project_role === 'admin'));
    window._currentProjectIsAdmin = isAdmin;
    document.getElementById('btn-edit-project').style.display = isAdmin ? '' : 'none';
    document.getElementById('btn-add-task').style.display = isAdmin ? '' : 'none';

    document.getElementById('proj-stats-bar').innerHTML = `
      <div class="psb-item"><div class="psb-val">${s.total}</div><div class="psb-lbl">Total</div></div>
      <div class="psb-item"><div class="psb-val" style="color:#60a5fa">${s.in_progress}</div><div class="psb-lbl">In Progress</div></div>
      <div class="psb-item"><div class="psb-val" style="color:#4ade80">${s.done}</div><div class="psb-lbl">Done</div></div>
      <div class="psb-item"><div class="psb-val" style="color:#f87171">${s.overdue}</div><div class="psb-lbl">Overdue</div></div>
    `;
    switchProjectTab('board');
  } catch (e) { showToast('Failed to load project', 'error'); }
}

function switchProjectTab(tab) {
  document.querySelectorAll('.proj-tab').forEach(t => t.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('proj-tab-' + tab).classList.remove('hidden');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  if (tab === 'board') loadKanban(currentProject);
  else if (tab === 'list') loadTaskList(currentProject);
  else if (tab === 'members') loadMembers(currentProject);
  else if (tab === 'activity') loadActivity(currentProject);
}

async function loadKanban(projectId) {
  const board = document.getElementById('kanban-board');
  board.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const data = await api('/api/tasks/' + projectId + '/list');
    const cols = [
      { key: 'todo', label: 'Todo', color: '#9aa0b4' },
      { key: 'in_progress', label: 'In Progress', color: '#60a5fa' },
      { key: 'review', label: 'Review', color: '#fbbf24' },
      { key: 'done', label: 'Done', color: '#4ade80' }
    ];
    board.innerHTML = cols.map(col => {
      const tasks = data.tasks.filter(t => t.status === col.key);
      return `<div class="kanban-col">
        <div class="kanban-col-header">
          <span class="kanban-col-title" style="color:${col.color}">${col.label}</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="kanban-count">${tasks.length}</span>
            ${window._currentProjectIsAdmin ? `<button class="kanban-add" onclick="openCreateTask('${col.key}')" title="Add task">+</button>` : ''}
          </div>
        </div>
        <div class="kanban-cards">
          ${tasks.length ? tasks.map(t => taskCardHtml(t)).join('') : '<div style="text-align:center;color:var(--text3);padding:20px;font-size:13px">No tasks</div>'}
        </div>
      </div>`;
    }).join('');
  } catch (e) { showToast('Failed to load tasks', 'error'); }
}

function taskCardHtml(t) {
  const overdue = isOverdue(t.due_date, t.status);
  return `<div class="task-card" onclick="openTaskDetail(${t.id})">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
      <div class="task-card-title">${t.title}</div>
      ${priorityBadge(t.priority)}
    </div>
    <div class="task-card-meta">
      <div class="task-card-assignee">
        ${t.assignee_name ? `${avatarEl(t.assignee_name, t.assignee_avatar, 20)}<span>${t.assignee_name}</span>` : '<span style="color:var(--text3)">Unassigned</span>'}
      </div>
      ${t.due_date ? `<span class="due-label ${overdue ? 'overdue' : ''}">${overdue ? '⚠ ' : ''}${formatDate(t.due_date)}</span>` : ''}
    </div>
  </div>`;
}

async function loadTaskList(projectId) {
  const el = document.getElementById('task-list-view');
  el.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const data = await api('/api/tasks/' + projectId + '/list');
    if (!data.tasks.length) { el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><p>No tasks yet</p></div>'; return; }
    el.innerHTML = data.tasks.map(t => `
      <div class="task-list-item" onclick="openTaskDetail(${t.id})">
        ${statusBadge(t.status)}
        <div class="task-list-title">${t.title}</div>
        <div class="task-list-meta">
          ${priorityBadge(t.priority)}
          ${t.assignee_name ? avatarEl(t.assignee_name, t.assignee_avatar, 24) : ''}
          ${t.due_date ? `<span class="due-label ${isOverdue(t.due_date, t.status) ? 'overdue' : ''}">${formatDate(t.due_date)}</span>` : ''}
        </div>
      </div>`).join('');
  } catch (e) { showToast('Failed to load tasks', 'error'); }
}

async function loadMembers(projectId) {
  const el = document.getElementById('members-panel');
  el.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const data = await api('/api/projects/' + projectId);
    const isAdmin = currentUser.role === 'admin' || data.members.find(m => m.id === currentUser.id && m.project_role === 'admin');
    el.innerHTML = `
      <div class="members-list">
        ${data.members.map(m => `
          <div class="member-row">
            ${avatarEl(m.name, m.avatar_color, 36)}
            <div class="member-row-info">
              <div class="member-row-name">${m.name}</div>
              <div class="member-row-email">${m.email}</div>
            </div>
            <span class="badge badge-${m.project_role}">${m.project_role}</span>
            ${isAdmin && m.id !== currentUser.id ? `
              <div class="member-row-actions">
                <button class="btn-secondary btn-sm" onclick="changeMemberRole(${projectId},${m.id},'${m.project_role === 'admin' ? 'member' : 'admin'}')">${m.project_role === 'admin' ? 'Make Member' : 'Make Admin'}</button>
                <button class="btn-danger" onclick="removeMember(${projectId},${m.id})">Remove</button>
              </div>` : ''}
          </div>`).join('')}
      </div>
      ${isAdmin ? `<button class="btn-primary add-member-btn" onclick="openAddMember(${projectId})">+ Add Member</button>` : ''}`;
  } catch (e) { showToast('Failed to load members', 'error'); }
}

async function loadActivity(projectId) {
  const el = document.getElementById('activity-panel');
  el.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const data = await api('/api/projects/' + projectId + '/activity');
    if (!data.activity.length) { el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p>No activity yet</p></div>'; return; }
    el.innerHTML = '<div class="activity-list">' + data.activity.map(a => `
      <div class="activity-item">
        <div class="activity-dot">${a.user_name ? a.user_name[0] : '?'}</div>
        <div>
          <div class="activity-text"><strong>${a.user_name || 'System'}</strong> — ${a.details}</div>
          <div class="activity-time">${new Date(a.created_at).toLocaleString()}</div>
        </div>
      </div>`).join('') + '</div>';
  } catch (e) { }
}

// === TASK MODAL ===
async function openCreateTask(defaultStatus) {
  editingTaskId = null;
  document.getElementById('task-modal-title').textContent = 'New Task';
  document.getElementById('task-save-btn').textContent = 'Create Task';
  document.getElementById('task-title').value = '';
  document.getElementById('task-desc').value = '';
  document.getElementById('task-status').value = defaultStatus || 'todo';
  document.getElementById('task-priority').value = 'medium';
  document.getElementById('task-due').value = '';
  document.getElementById('task-modal-error').classList.add('hidden');
  await loadTaskAssignees();
  openModal('task-modal');
}

async function loadTaskAssignees() {
  const sel = document.getElementById('task-assignee');
  sel.innerHTML = '<option value="">Unassigned</option>';
  try {
    const data = await api('/api/projects/' + currentProject);
    data.members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.name;
      sel.appendChild(opt);
    });
  } catch (e) {}
}

async function handleSaveTask(e) {
  e.preventDefault();
  const err = document.getElementById('task-modal-error');
  err.classList.add('hidden');
  const body = {
    title: document.getElementById('task-title').value,
    description: document.getElementById('task-desc').value,
    status: document.getElementById('task-status').value,
    priority: document.getElementById('task-priority').value,
    assignee_id: document.getElementById('task-assignee').value || null,
    due_date: document.getElementById('task-due').value || null,
    project_id: currentProject
  };
  try {
    if (editingTaskId) {
      await api('/api/tasks/' + editingTaskId, { method: 'PUT', body: JSON.stringify(body) });
      showToast('Task updated!');
    } else {
      await api('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
      showToast('Task created!');
    }
    closeModal('task-modal');
    closeModal('task-detail-modal');
    loadKanban(currentProject);
  } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
}

// === TASK DETAIL ===
async function openTaskDetail(taskId) {
  viewingTaskId = taskId;
  try {
    const data = await api('/api/tasks/detail/' + taskId);
    const t = data.task;
    document.getElementById('td-title').textContent = t.title;
    document.getElementById('td-desc').textContent = t.description || 'No description.';
    document.getElementById('td-status').innerHTML = statusBadge(t.status);
    document.getElementById('td-priority').innerHTML = priorityBadge(t.priority);
    document.getElementById('td-assignee').textContent = t.assignee_name || 'Unassigned';
    document.getElementById('td-due').textContent = t.due_date ? (isOverdue(t.due_date, t.status) ? '⚠ ' : '') + formatDate(t.due_date) : '—';
    document.getElementById('td-project').textContent = t.project_name;
    document.getElementById('td-creator').textContent = t.creator_name;

    const canEdit = currentUser.role === 'admin' || t.creator_id === currentUser.id || t.assignee_id === currentUser.id;
    document.getElementById('td-actions').innerHTML = canEdit ? `
      <select class="status-select" onchange="quickStatus(${t.id},this.value)">
        ${['todo','in_progress','review','done'].map(s => `<option value="${s}" ${t.status===s?'selected':''}>${s.replace('_',' ')}</option>`).join('')}
      </select>
      <button class="btn-secondary btn-sm" onclick="openEditTask(${t.id})">Edit</button>
      <button class="btn-danger" onclick="deleteTask(${t.id})">Delete</button>` : '';

    const cl = document.getElementById('td-comments');
    cl.innerHTML = data.comments.length ? data.comments.map(c => `
      <div class="comment-item">
        ${avatarEl(c.user_name, c.avatar_color, 28)}
        <div class="comment-body">
          <div class="comment-user">${c.user_name} <span class="comment-time">${new Date(c.created_at).toLocaleString()}</span></div>
          <div class="comment-text">${c.content}</div>
        </div>
      </div>`).join('') : '<p style="color:var(--text3);font-size:13px">No comments yet.</p>';

    document.getElementById('comment-input').value = '';
    openModal('task-detail-modal');
  } catch (e) { showToast('Failed to load task', 'error'); }
}

async function quickStatus(taskId, status) {
  try {
    await api('/api/tasks/' + taskId + '/status', { method: 'PATCH', body: JSON.stringify({ status }) });
    showToast('Status updated!');
    if (currentProject) loadKanban(currentProject);
  } catch (e) { showToast('Failed', 'error'); }
}

async function openEditTask(taskId) {
  const data = await api('/api/tasks/detail/' + taskId);
  const t = data.task;
  editingTaskId = taskId;
  document.getElementById('task-modal-title').textContent = 'Edit Task';
  document.getElementById('task-save-btn').textContent = 'Save Changes';
  document.getElementById('task-title').value = t.title;
  document.getElementById('task-desc').value = t.description || '';
  document.getElementById('task-status').value = t.status;
  document.getElementById('task-priority').value = t.priority;
  document.getElementById('task-due').value = t.due_date || '';
  await loadTaskAssignees();
  document.getElementById('task-assignee').value = t.assignee_id || '';
  closeModal('task-detail-modal');
  openModal('task-modal');
}

async function deleteTask(taskId) {
  if (!confirm('Delete this task?')) return;
  try {
    await api('/api/tasks/' + taskId, { method: 'DELETE' });
    showToast('Task deleted!');
    closeModal('task-detail-modal');
    if (currentProject) loadKanban(currentProject);
  } catch (e) { showToast('Failed to delete', 'error'); }
}

async function submitComment(e) {
  e.preventDefault();
  const content = document.getElementById('comment-input').value.trim();
  if (!content) return;
  try {
    await api('/api/tasks/' + viewingTaskId + '/comments', { method: 'POST', body: JSON.stringify({ content }) });
    openTaskDetail(viewingTaskId);
  } catch (ex) { showToast('Failed to post comment', 'error'); }
}

// === MY TASKS ===
async function loadMyTasks() {
  const el = document.getElementById('my-tasks-list');
  el.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const status = document.getElementById('mytask-filter-status').value;
    let url = '/api/tasks/my';
    if (status) url = '/api/tasks?assignee_id=' + currentUser.id + '&status=' + status;
    const data = await api(url);
    const tasks = data.tasks || [];
    if (!tasks.length) { el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎯</div><p>No tasks assigned to you</p></div>'; return; }
    el.innerHTML = tasks.map(t => `
      <div class="task-list-item" onclick="openTaskDetail(${t.id})">
        ${statusBadge(t.status)}
        <div class="task-list-title">${t.title}</div>
        <div class="task-list-meta">
          ${priorityBadge(t.priority)}
          <span style="font-size:12px;color:var(--text3)">${t.project_name}</span>
          ${t.due_date ? `<span class="due-label ${isOverdue(t.due_date, t.status) ? 'overdue' : ''}">${formatDate(t.due_date)}</span>` : ''}
        </div>
      </div>`).join('');
  } catch (e) { showToast('Failed to load tasks', 'error'); }
}

// === MEMBERS ===
async function openAddMember(projectId) {
  const sel = document.getElementById('member-user-select');
  sel.innerHTML = '<option>Loading...</option>';
  try {
    const [allUsers, projData] = await Promise.all([api('/api/auth/users'), api('/api/projects/' + projectId)]);
    const memberIds = new Set(projData.members.map(m => m.id));
    const nonMembers = allUsers.users.filter(u => !memberIds.has(u.id));
    sel.innerHTML = nonMembers.length
      ? nonMembers.map(u => `<option value="${u.id}">${u.name} (${u.email})</option>`).join('')
      : '<option value="">No users to add</option>';
    document.getElementById('member-modal-error').classList.add('hidden');
    openModal('member-modal');
    window._addMemberProjectId = projectId;
  } catch (e) { showToast('Failed', 'error'); }
}

async function handleAddMember(e) {
  e.preventDefault();
  const err = document.getElementById('member-modal-error');
  err.classList.add('hidden');
  try {
    await api('/api/projects/' + window._addMemberProjectId + '/members', {
      method: 'POST',
      body: JSON.stringify({ user_id: parseInt(document.getElementById('member-user-select').value), role: document.getElementById('member-role-select').value })
    });
    showToast('Member added!');
    closeModal('member-modal');
    loadMembers(window._addMemberProjectId);
  } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
}

async function changeMemberRole(projectId, userId, newRole) {
  try {
    await api('/api/projects/' + projectId + '/members/' + userId, { method: 'PUT', body: JSON.stringify({ role: newRole }) });
    showToast('Role updated!');
    loadMembers(projectId);
  } catch (e) { showToast('Failed', 'error'); }
}

async function removeMember(projectId, userId) {
  if (!confirm('Remove this member?')) return;
  try {
    await api('/api/projects/' + projectId + '/members/' + userId, { method: 'DELETE' });
    showToast('Member removed!');
    loadMembers(projectId);
  } catch (e) { showToast('Failed', 'error'); }
}

// === ADMIN ===
async function loadAdmin() {
  const el = document.getElementById('admin-users-table');
  el.innerHTML = '<div class="loading-spinner"></div>';
  try {
    const data = await api('/api/auth/users');
    el.innerHTML = `<div class="card"><table class="data-table">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead>
      <tbody>${data.users.map(u => `<tr>
        <td><div style="display:flex;align-items:center;gap:10px">${avatarEl(u.name, u.avatar_color, 32)}<strong>${u.name}</strong></div></td>
        <td style="color:var(--text2)">${u.email}</td>
        <td><span class="badge badge-${u.role}">${u.role}</span></td>
        <td style="color:var(--text3)">${formatDate(u.created_at)}</td>
        <td>${u.id !== currentUser.id ? `<button class="btn-secondary btn-sm" onclick="toggleUserRole(${u.id},'${u.role}')">${u.role === 'admin' ? 'Make Member' : 'Make Admin'}</button>` : '<span style="color:var(--text3)">You</span>'}</td>
      </tr>`).join('')}
      </tbody></table></div>`;
  } catch (e) { showToast('Failed to load users', 'error'); }
}

async function toggleUserRole(userId, currentRole) {
  const newRole = currentRole === 'admin' ? 'member' : 'admin';
  if (!confirm(`Change role to ${newRole}?`)) return;
  try {
    await api('/api/auth/users/' + userId + '/role', { method: 'PUT', body: JSON.stringify({ role: newRole }) });
    showToast('Role updated!');
    loadAdmin();
  } catch (e) { showToast('Failed', 'error'); }
}

// Close modals on overlay click
['task-modal', 'task-detail-modal', 'member-modal'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => { if (e.target.id === id) closeModal(id); });
});

// === BOOT ===
window.addEventListener('DOMContentLoaded', initApp);
