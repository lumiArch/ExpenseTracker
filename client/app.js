const API = '/api/expenses';

// local cache; all renders read from here
const state = {
  expenses: [],
  _toastTimer: null
};

const el = (id) => document.getElementById(id);

// sanitise user input before injecting into innerHTML (prevents XSS)
const escapeHtml = (str) => {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// append T00:00:00 so MySQL's "YYYY-MM-DD" is parsed as local time, not UTC
const parseLocalDate = (dateStr) => new Date(dateStr.slice(0, 10) + 'T00:00:00');

const formatCurrency = (n) => `$${Number(n).toFixed(2)}`;

// Notifications

const notifyError = (message) => {
  const e = el('apiError');
  e.textContent = message;
  e.hidden = false;
  setTimeout(() => { e.hidden = true; }, 4000);
};

const notifySuccess = (message) => {
  const t = el('toast');
  t.textContent = message;
  // remove then re-add to restart the CSS transition
  t.classList.remove('toast-show');
  void t.offsetWidth;
  t.classList.add('toast-show');
  clearTimeout(state._toastTimer);
  state._toastTimer = setTimeout(() => t.classList.remove('toast-show'), 2500);
};

// Render

const renderSummary = () => {
  const total = state.expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  el('totalAmount').textContent = formatCurrency(total);
  el('totalCount').textContent = state.expenses.length;
};

const renderTable = () => {
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
    const catClass = `cat-${escapeHtml(expense.category.toLowerCase())}`;
    tr.innerHTML = `
      <td>${escapeHtml(parseLocalDate(expense.transactionDate).toLocaleDateString())}</td>
      <td>${escapeHtml(expense.title)}</td>
      <td><span class="cat-badge ${catClass}">${escapeHtml(expense.category)}</span></td>
      <td>${formatCurrency(expense.amount)}</td>
      <td class="notes-cell">${escapeHtml(expense.notes)}</td>
      <td>
        <button class="action-btn" data-id="${expense.id}" data-action="edit"
          aria-label="Edit ${escapeHtml(expense.title)}">Edit</button>
        <button class="action-btn danger" data-id="${expense.id}" data-action="delete"
          aria-label="Delete ${escapeHtml(expense.title)}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
};

const renderInsights = () => {
  renderCategoryInsights();
  renderMonthlyInsights();
};

const renderCategoryInsights = () => {
  const container = el('categoryList');

  // tally totals per category
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
  const maxTotal = sorted[0][1].total; // top value = 100% bar width

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

  // group by YYYY-MM
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

// Form

const clearForm = () => {
  el('expenseId').value = '';
  el('expenseForm').reset();
  el('submitButton').textContent = 'Add Expense';
};

// pre-fill form fields and switch button to "Update"
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

// API

const fetchExpenses = async () => {
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error('Could not fetch expenses');
    state.expenses = await res.json();
    renderTable();
    renderSummary();
    renderInsights();
  } catch (err) {
    notifyError(err.message);
  }
};

// POST or PUT depending on whether expenseId is set
const saveExpense = async (evt) => {
  evt.preventDefault();

  const payload = {
    title: el('title').value.trim(),
    amount: Number(el('amount').value),
    category: el('category').value,
    transactionDate: el('transactionDate').value,
    notes: el('notes').value.trim()
  };

  if (!payload.title || !payload.category || !payload.transactionDate || payload.amount <= 0) {
    notifyError('Title, category, date, and a positive amount are all required.');
    return;
  }

  const id = el('expenseId').value;
  const method = id ? 'PUT' : 'POST';
  const url = id ? `${API}/${id}` : API;

  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Failed to save expense');
    }

    const saved = await response.json();

    // update local state without refetching
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
    notifyError(err.message);
  }
};

const deleteExpense = async (id) => {
  if (!confirm('Delete this expense?')) return;
  try {
    const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Could not delete expense');
    state.expenses = state.expenses.filter((item) => item.id !== Number(id));
    renderTable();
    renderSummary();
    renderInsights();
  } catch (err) {
    notifyError(err.message);
  }
};

// delegated click handler for edit/delete buttons in the table
const onTableAction = (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  const expense = state.expenses.find((item) => item.id === Number(id));
  if (action === 'edit' && expense) fillForm(expense);
  if (action === 'delete') deleteExpense(id);
};

// Init

document.addEventListener('DOMContentLoaded', () => {
  fetchExpenses();
  el('expenseForm').addEventListener('submit', saveExpense);
  el('resetButton').addEventListener('click', clearForm);
  el('expenseTable').addEventListener('click', onTableAction);
  el('filterInput').addEventListener('input', renderTable);
});
