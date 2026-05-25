const state = {
  expenses: [],
  users: [],
  activities: [],
  currentUser: null,  // { id, username, email, role }
  token: null,
  _toastTimer: null
};

// helpers

const el = (id) => document.getElementById(id);

// sanitise before injecting into innerHTML — prevents XSS
const escapeHtml = (str) => {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// MySQL returns "YYYY-MM-DD" and without T00:00:00 JS treats it as UTC midnight,
// which shows yesterday's date for users in timezones behind UTC
const parseLocalDate = (dateStr) => new Date(dateStr.slice(0, 10) + 'T00:00:00');

const formatCurrency = (n) => `$${Number(n).toFixed(2)}`;

// error / toast

const notifyError = (message) => {
  const e = el('apiError');
  if (!e) return;
  e.textContent = message;
  e.hidden = false;
  setTimeout(() => { e.hidden = true; }, 5000);
};

const notifySuccess = (message) => {
  const t = el('toast');
  t.textContent = message;
  // have to remove the class first so the animation re-triggers if called twice in a row
  t.classList.remove('toast-show');
  void t.offsetWidth; // force reflow so the browser notices the class was removed
  t.classList.add('toast-show');
  clearTimeout(state._toastTimer);
  state._toastTimer = setTimeout(() => t.classList.remove('toast-show'), 2500);
};

// auth utils

const authHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${state.token}`
});

// wrapper around fetch that attaches the token and handles session expiry
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });

  if (res.status === 401) {
    logout(false);
    showView('login');
    notifyAuthError('loginError', 'Your session has expired. Please sign in again.');
    throw new Error('Unauthorized');
  }

  return res;
}

function tryRestoreSession() {
  const token = localStorage.getItem('et_token');
  if (!token) return false;

  try {
    // JWT middle section is just base64 JSON — decode it to check if the token is expired
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp * 1000 < Date.now()) {
      localStorage.removeItem('et_token');
      return false;
    }
    state.token = token;
    state.currentUser = {
      id: payload.id,
      username: payload.username,
      email: payload.email,
      role: payload.role
    };
    return true;
  } catch {
    localStorage.removeItem('et_token');
    return false;
  }
}

// view routing — just toggles hidden on the four view divs

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => (v.hidden = true));
  el(`view-${name}`).hidden = false;
}

function updateNav() {
  const nav = el('topNav');
  if (!state.currentUser) {
    nav.hidden = true;
    return;
  }
  nav.hidden = false;
  el('navUser').textContent = `👤 ${state.currentUser.username}`;
  el('navAdminBtn').hidden = state.currentUser.role !== 'admin';
}

// auth form handlers

function notifyAuthError(errorId, message) {
  const e = el(errorId);
  e.textContent = message;
  e.hidden = false;
}

function clearAuthError(errorId) {
  el(errorId).textContent = '';
  el(errorId).hidden = true;
}

async function handleLogin(evt) {
  evt.preventDefault();
  clearAuthError('loginError');

  const username = el('loginUsername').value.trim();
  const password = el('loginPassword').value;

  if (!username || !password) {
    notifyAuthError('loginError', 'Please fill in all fields.');
    return;
  }

  const btn = el('loginSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok) {
      notifyAuthError('loginError', data.error || 'Login failed');
      return;
    }

    state.token = data.token;
    state.currentUser = data.user;
    localStorage.setItem('et_token', data.token);
    el('loginForm').reset();
    updateNav();

    if (state.currentUser.role === 'admin') {
      showView('admin');
      loadAdminUsers();
    } else {
      showView('app');
      fetchExpenses();
    }
  } catch (err) {
    notifyAuthError('loginError', 'Could not reach the server. Try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

async function handleRegister(evt) {
  evt.preventDefault();
  clearAuthError('registerError');

  const username = el('regUsername').value.trim();
  const email    = el('regEmail').value.trim();
  const password = el('regPassword').value;
  const confirm  = el('regConfirm').value;

  if (!username || !email || !password || !confirm) {
    notifyAuthError('registerError', 'Please fill in all fields.');
    return;
  }
  if (password !== confirm) {
    notifyAuthError('registerError', 'Passwords do not match.');
    return;
  }

  const btn = el('registerSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Creating account…';

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      notifyAuthError('registerError', data.error || 'Registration failed');
      return;
    }

    el('registerForm').reset();
    showView('login');
    el('loginUsername').value = username; // pre-fill so they can log in immediately
    el('loginError').hidden = true;
    notifySuccess('Account created — you can now sign in!');
  } catch (err) {
    notifyAuthError('registerError', 'Could not reach the server. Try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
}

async function logout(callServer = true) {
  if (callServer && state.token) {
    // fire and forget — we don't need to wait for this
    fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }).catch(() => {});
  }
  state.token = null;
  state.currentUser = null;
  state.expenses = [];
  state.users = [];
  state.activities = [];
  localStorage.removeItem('et_token');
  updateNav();
  showView('login');
}

// rendering

const renderSummary = () => {
  const total = state.expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  el('totalAmount').textContent = formatCurrency(total);
  el('totalCount').textContent = state.expenses.length;
};

// TODO: add sorting when clicking column headers
function renderTable() {
  const tbody = el('expenseTable').querySelector('tbody');
  const filterText = el('filterInput').value.trim().toLowerCase();
  tbody.innerHTML = '';

  const filtered = state.expenses.filter((item) => {
    if (!filterText) return true;
    return (
      item.title.toLowerCase().includes(filterText) ||
      item.category.toLowerCase().includes(filterText)
    );
  });

  if (!filtered.length) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="6" class="empty">No expenses found.</td>`;
    tbody.appendChild(row);
    return;
  }

  filtered.forEach((expense) => {
    const tr = document.createElement('tr');
    const catClass = `cat-${expense.category.toLowerCase()}`;
    tr.innerHTML = `
      <td>${escapeHtml(parseLocalDate(expense.transactionDate).toLocaleDateString())}</td>
      <td>${escapeHtml(expense.title)}</td>
      <td><span class="cat-badge ${catClass}">${escapeHtml(expense.category)}</span></td>
      <td>${formatCurrency(expense.amount)}</td>
      <td class="notes-cell">${escapeHtml(expense.notes)}</td>
      <td>
        <button class="action-btn" data-id="${expense.id}" data-action="edit">Edit</button>
        <button class="action-btn danger" data-id="${expense.id}" data-action="delete">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

const renderInsights = () => {
  renderCategoryInsights();
  renderMonthlyInsights();
};

const renderCategoryInsights = () => {
  const container = el('categoryList');
  const map = {};

  state.expenses.forEach((e) => {
    if (!map[e.category]) map[e.category] = { total: 0, count: 0 };
    map[e.category].total += Number(e.amount);
    map[e.category].count++;
  });

  if (!Object.keys(map).length) {
    container.innerHTML = '<p class="empty-insight">No data yet.</p>';
    return;
  }

  const sorted = Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  const maxTotal = sorted[0][1].total;

  container.innerHTML = sorted.map(([cat, { total, count }]) => {
    const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
    return `
      <div class="insight-row">
        <span class="insight-label">${escapeHtml(cat)}</span>
        <div class="insight-bar-wrap">
          <div class="insight-bar-fill" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <span class="insight-value">${formatCurrency(total)}</span>
        <span class="insight-count">${count} item${count !== 1 ? 's' : ''}</span>
      </div>
    `;
  }).join('');
};

const renderMonthlyInsights = () => {
  const container = el('monthlyList');
  const map = {};

  state.expenses.forEach((e) => {
    const month = e.transactionDate.slice(0, 7);
    if (!map[month]) map[month] = { total: 0, count: 0 };
    map[month].total += Number(e.amount);
    map[month].count++;
  });

  if (!Object.keys(map).length) {
    container.innerHTML = '<p class="empty-insight">No data yet.</p>';
    return;
  }

  const sorted = Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  const maxTotal = Math.max(...sorted.map(([, v]) => v.total));

  container.innerHTML = sorted.map(([month, { total, count }]) => {
    const [year, mo] = month.split('-');
    const label = new Date(Number(year), Number(mo) - 1)
      .toLocaleString('default', { month: 'short', year: 'numeric' });
    const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
    return `
      <div class="insight-row">
        <span class="insight-label">${escapeHtml(label)}</span>
        <div class="insight-bar-wrap">
          <div class="insight-bar-fill monthly" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <span class="insight-value">${formatCurrency(total)}</span>
        <span class="insight-count">${count} item${count !== 1 ? 's' : ''}</span>
      </div>
    `;
  }).join('');
};

// form helpers

const clearForm = () => {
  el('expenseId').value = '';
  el('expenseForm').reset();
  el('submitButton').textContent = 'Add Expense';
};

const fillForm = (expense) => {
  el('expenseId').value = expense.id;
  el('title').value = expense.title;
  el('amount').value = Number(expense.amount).toFixed(2);
  el('category').value = expense.category;
  el('transactionDate').value = expense.transactionDate.slice(0, 10);
  el('notes').value = expense.notes || '';
  el('submitButton').textContent = 'Update Expense';
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// expense API

const fetchExpenses = async () => {
  try {
    const res = await apiFetch('/api/expenses');
    if (!res.ok) throw new Error('Could not fetch expenses');
    state.expenses = await res.json();
    renderTable();
    renderSummary();
    renderInsights();
  } catch (err) {
    if (err.message !== 'Unauthorized') notifyError(err.message);
  }
};

const saveExpense = async (evt) => {
  evt.preventDefault();

  const payload = {
    title: el('title').value.trim(),
    amount: Number(el('amount').value),
    category: el('category').value,
    transactionDate: el('transactionDate').value,
    notes: el('notes').value.trim()
  };

  // console.log('saving:', payload);

  if (!payload.title || !payload.category || !payload.transactionDate || payload.amount <= 0) {
    notifyError('Title, category, date, and a positive amount are all required.');
    return;
  }

  const id = el('expenseId').value;
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/expenses/${id}` : '/api/expenses';

  try {
    const response = await apiFetch(url, {
      method,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Failed to save expense');
    }

    const saved = await response.json();

    // update local state without refetching the full list
    if (id) {
      const i = state.expenses.findIndex((item) => item.id === saved.id);
      if (i >= 0) state.expenses[i] = saved;
      notifySuccess('Expense updated.');
    } else {
      state.expenses.unshift(saved);
      notifySuccess('Expense added.');
    }

    renderTable();
    renderSummary();
    renderInsights();
    clearForm();
  } catch (err) {
    if (err.message !== 'Unauthorized') notifyError(err.message);
  }
};

const deleteExpense = async (id) => {
  if (!confirm('Delete this expense?')) return;
  try {
    const res = await apiFetch(`/api/expenses/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Could not delete expense');
    state.expenses = state.expenses.filter((item) => item.id !== Number(id));
    renderTable();
    renderSummary();
    renderInsights();
    notifySuccess('Expense deleted.');
  } catch (err) {
    notifyError(err.message);
  }
};

// delegated click handler for edit/delete buttons in the expense table
const onTableAction = (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  const expense = state.expenses.find((item) => item.id === Number(id));
  if (action === 'edit' && expense) fillForm(expense);
  if (action === 'delete') deleteExpense(id);
};

// admin - user management

async function loadAdminUsers() {
  try {
    const res = await apiFetch('/api/users');
    if (!res.ok) throw new Error('Failed to load users');
    state.users = await res.json();
    renderUsers();
  } catch (err) {
    if (err.message !== 'Unauthorized') {
      const e = el('usersError');
      e.textContent = err.message;
      e.hidden = false;
    }
  }
}

function renderUsers() {
  const tbody = el('usersTable').querySelector('tbody');
  tbody.innerHTML = '';

  if (!state.users.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No users found.</td></tr>';
    return;
  }

  state.users.forEach((user) => {
    const tr = document.createElement('tr');
    tr.dataset.userId = user.id;
    tr.innerHTML = userRowHtml(user);
    tbody.appendChild(tr);
  });
}

function userRowHtml(user) {
  const joined = new Date(user.created_at).toLocaleDateString('en-GB');
  return `
    <td>${user.id}</td>
    <td>${escapeHtml(user.username)}</td>
    <td>${escapeHtml(user.email)}</td>
    <td><span class="role-badge role-${user.role}">${user.role}</span></td>
    <td>${joined}</td>
    <td>
      <button class="action-btn" data-action="edit-user" data-id="${user.id}">Edit</button>
      <button class="action-btn danger" data-action="delete-user" data-id="${user.id}">Delete</button>
    </td>
  `;
}

// swap the row to editable inputs in-place
function userEditRowHtml(user) {
  return `
    <td>${user.id}</td>
    <td><input class="edit-input" data-field="username" value="${escapeHtml(user.username)}" /></td>
    <td><input class="edit-input" data-field="email" type="email" value="${escapeHtml(user.email)}" /></td>
    <td>
      <select class="edit-input" data-field="role">
        <option value="user"  ${user.role === 'user'  ? 'selected' : ''}>user</option>
        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>admin</option>
      </select>
    </td>
    <td>${new Date(user.created_at).toLocaleDateString('en-GB')}</td>
    <td>
      <button class="action-btn" data-action="save-user" data-id="${user.id}">Save</button>
      <button class="action-btn secondary" data-action="cancel-user" data-id="${user.id}">Cancel</button>
    </td>
  `;
}

async function saveUser(id) {
  const tr = el('usersTable').querySelector(`tr[data-user-id="${id}"]`);
  if (!tr) return;

  const username = tr.querySelector('[data-field="username"]').value.trim();
  const email    = tr.querySelector('[data-field="email"]').value.trim();
  const role     = tr.querySelector('[data-field="role"]').value;

  if (!username || !email) {
    notifyError('Username and email are required.');
    return;
  }

  try {
    const res = await apiFetch(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ username, email, role })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to update user');
    }

    const updated = await res.json();
    const i = state.users.findIndex((u) => u.id === updated.id);
    if (i >= 0) state.users[i] = updated;

    tr.innerHTML = userRowHtml(updated);
    notifySuccess('User updated.');
  } catch (err) {
    if (err.message !== 'Unauthorized') notifyError(err.message);
  }
}

async function deleteUser(id) {
  if (!confirm('Delete this user and all their data?')) return;
  try {
    const res = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete user');
    }
    state.users = state.users.filter((u) => u.id !== Number(id));
    renderUsers();
    notifySuccess('User deleted.');
  } catch (err) {
    if (err.message !== 'Unauthorized') notifyError(err.message);
  }
}

function onUsersTableClick(event) {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;

  const { action, id } = btn.dataset;
  const numId = Number(id);
  const user = state.users.find((u) => u.id === numId);
  const tr = el('usersTable').querySelector(`tr[data-user-id="${id}"]`);

  switch (action) {
    case 'edit-user':
      if (tr && user) tr.innerHTML = userEditRowHtml(user);
      break;
    case 'cancel-user':
      if (tr && user) tr.innerHTML = userRowHtml(user);
      break;
    case 'save-user':
      saveUser(numId);
      break;
    case 'delete-user':
      deleteUser(numId);
      break;
  }
}

// admin - activity log

async function loadActivities() {
  try {
    const res = await apiFetch('/api/activities');
    if (!res.ok) throw new Error('Failed to load activity log');
    state.activities = await res.json();
    renderActivities();
  } catch (err) {
    if (err.message !== 'Unauthorized') {
      const e = el('activitiesError');
      e.textContent = err.message;
      e.hidden = false;
    }
  }
}

function renderActivities() {
  const tbody = el('activitiesTable').querySelector('tbody');
  tbody.innerHTML = '';

  if (!state.activities.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No activity recorded yet.</td></tr>';
    return;
  }

  state.activities.forEach((row) => {
    const tr = document.createElement('tr');
    const time = new Date(row.created_at).toLocaleString();
    tr.innerHTML = `
      <td class="activity-time">${escapeHtml(time)}</td>
      <td>${escapeHtml(row.username || '(deleted)')}</td>
      <td><span class="activity-action">${escapeHtml(row.action)}</span></td>
      <td class="notes-cell">${escapeHtml(row.details || '—')}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function clearActivities() {
  if (!confirm('Clear the entire activity log? This cannot be undone.')) return;
  try {
    const res = await apiFetch('/api/activities', { method: 'DELETE' });
    if (!res.ok) throw new Error('Could not clear log');
    state.activities = [];
    renderActivities();
    notifySuccess('Activity log cleared.');
  } catch (err) {
    notifyError(err.message);
  }
}

function switchAdminTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
    btn.setAttribute('aria-selected', btn.dataset.tab === tabName);
  });

  el('adminTabUsers').hidden     = tabName !== 'users';
  el('adminTabActivities').hidden = tabName !== 'activities';

  // lazy load activities — only fetch the first time the tab is opened
  if (tabName === 'activities' && !state.activities.length) {
    loadActivities();
  }
}

// init

document.addEventListener('DOMContentLoaded', () => {
  el('loginForm').addEventListener('submit', handleLogin);
  el('registerForm').addEventListener('submit', handleRegister);
  el('goRegister').addEventListener('click', (e) => { e.preventDefault(); showView('register'); });
  el('goLogin').addEventListener('click', (e) => { e.preventDefault(); showView('login'); });

  el('navLogoutBtn').addEventListener('click', () => logout());
  el('navExpensesBtn').addEventListener('click', () => {
    showView('app');
    fetchExpenses();
  });
  el('navAdminBtn').addEventListener('click', () => {
    showView('admin');
    loadAdminUsers();
    switchAdminTab('users');
  });

  el('expenseForm').addEventListener('submit', saveExpense);
  el('resetButton').addEventListener('click', clearForm);
  el('expenseTable').addEventListener('click', onTableAction);
  el('filterInput').addEventListener('input', renderTable);

  el('usersTable').addEventListener('click', onUsersTableClick);
  el('clearActivitiesBtn').addEventListener('click', clearActivities);
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchAdminTab(btn.dataset.tab));
  });

  // check for an existing session on page load
  if (tryRestoreSession()) {
    updateNav();
    if (state.currentUser.role === 'admin') {
      showView('admin');
      loadAdminUsers();
    } else {
      showView('app');
      fetchExpenses();
    }
  } else {
    showView('login');
  }
});
