const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// In a real deployment this should come from an env variable, not hardcoded
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../client')));

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'expense_tracker',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool;

// writes to the activity log — try/catch so it never blows up the main response
async function logActivity(userId, action, details = null) {
  try {
    await pool.query(
      'INSERT INTO user_activities (user_id, action, details) VALUES (?, ?, ?)',
      [userId, action, details]
    );
  } catch (err) {
    console.error('Activity log error:', err.message);
  }
}

// check the Authorization header and bail early if the token is missing/invalid
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// create the DB + tables on startup, run any migrations, seed admin if needed
async function initDb() {
  try {
    const tempConn = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password
    });
    await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\`;`);
    await tempConn.end();

    pool = mysql.createPool(dbConfig);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('user', 'admin') DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    // Expenses table — includes user_id from the start
    await pool.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        title VARCHAR(255) NOT NULL,
        amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
        category VARCHAR(100) NOT NULL,
        transactionDate DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    // Migration: add user_id to existing expenses tables that don't have it
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'expenses' AND COLUMN_NAME = 'user_id'
    `, [dbConfig.database]);
    if (!cols.length) {
      await pool.query('ALTER TABLE expenses ADD COLUMN user_id INT AFTER id');
      console.log('Migrated expenses table: added user_id column.');
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_activities (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        action VARCHAR(60) NOT NULL,
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    // Create default admin account if no admin exists yet
    const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (!admins.length) {
      const hash = await bcrypt.hash('admin123', 12);
      await pool.query(
        "INSERT IGNORE INTO users (username, email, password_hash, role) VALUES ('admin', 'admin@example.com', ?, 'admin')",
        [hash]
      );
      console.log('Default admin account created — username: admin  password: admin123');
    }

    console.log('DB initialised.');
  } catch (error) {
    console.error('Database init failed:', error.message);
    process.exit(1);
  }
}

// --- auth routes ---

app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password are required' });
  }
  if (username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username.trim(), email.trim().toLowerCase()]
    );
    if (existing.length) {
      return res.status(409).json({ error: 'Username or email already in use' });
    }

    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username.trim(), email.trim().toLowerCase(), hash]
    );

    await logActivity(result.insertId, 'register', `New account: ${username.trim()}`);
    res.status(201).json({ message: 'Account created. You can now sign in.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // allow login with either username or email
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [username, username]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    await logActivity(user.id, 'login', null);
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Token invalidation is client-side; this just writes the logout activity
app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await logActivity(req.user.id, 'logout', null);
  res.json({ ok: true });
});

// user management — admin only

app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Could not load users' });
  }
});

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { username, email, role } = req.body;
  const id = Number(req.params.id);

  if (!username || !email || !['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    const [result] = await pool.query(
      'UPDATE users SET username = ?, email = ?, role = ? WHERE id = ?',
      [username.trim(), email.trim().toLowerCase(), role, id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'User not found' });
    }
    await logActivity(req.user.id, 'update_user', `Updated user #${id} (role → ${role})`);
    const [rows] = await pool.query(
      'SELECT id, username, email, role, created_at FROM users WHERE id = ?', [id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  if (id === req.user.id) {
    return res.status(400).json({ error: "You can't delete your own account" });
  }

  try {
    const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'User not found' });
    await logActivity(req.user.id, 'delete_user', `Deleted user #${id}`);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// activity log

app.get('/api/activities', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT ua.id, ua.action, ua.details, ua.created_at, u.username
      FROM user_activities ua
      LEFT JOIN users u ON u.id = ua.user_id
      ORDER BY ua.created_at DESC
      LIMIT 500
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error loading activity log' });
  }
});

// clear all
app.delete('/api/activities', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('TRUNCATE TABLE user_activities');
    res.json({ cleared: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear activity log' });
  }
});

// expenses — auth required, each user only sees their own

// TODO: pagination if the list grows large
app.get('/api/expenses', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM expenses WHERE user_id = ? ORDER BY transactionDate DESC, id DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Could not load expenses' });
  }
});

app.get('/api/expenses/:id', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM expenses WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Expense not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load expense' });
  }
});

app.post('/api/expenses', requireAuth, async (req, res) => {
  const { title, amount, category, transactionDate, notes } = req.body;

  if (!title || amount == null || !category || !transactionDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO expenses (user_id, title, amount, category, transactionDate, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, title.trim(), parseFloat(amount), category.trim(), transactionDate, notes ? notes.trim() : null]
    );
    const [rows] = await pool.query('SELECT * FROM expenses WHERE id = ?', [result.insertId]);
    await logActivity(req.user.id, 'create_expense', `"${title.trim()}" — ${category}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

app.put('/api/expenses/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  const { title, amount, category, transactionDate, notes } = req.body;

  if (!title || amount == null || !category || !transactionDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const [result] = await pool.query(
      'UPDATE expenses SET title=?, amount=?, category=?, transactionDate=?, notes=? WHERE id=? AND user_id=?',
      [title.trim(), parseFloat(amount), category.trim(), transactionDate,
       notes ? notes.trim() : null, id, req.user.id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    const [rows] = await pool.query('SELECT * FROM expenses WHERE id = ?', [id]);
    await logActivity(req.user.id, 'update_expense', `Updated "${title.trim()}"`);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

app.delete('/api/expenses/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  try {
    const [before] = await pool.query(
      'SELECT title FROM expenses WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (!before.length) return res.status(404).json({ error: 'Expense not found' });

    await pool.query('DELETE FROM expenses WHERE id = ? AND user_id = ?', [id, req.user.id]);
    await logActivity(req.user.id, 'delete_expense', `Deleted "${before[0].title}"`);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

// catch-all — everything else goes to the frontend
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../client', 'index.html'));
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
});
