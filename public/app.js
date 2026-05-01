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
