const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// serve client/ from the parent directory
app.use(express.static(path.join(__dirname, '../client')));

// DB config — override via env vars for deployment
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

// create the DB and table if missing, then open the connection pool
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
      CREATE TABLE IF NOT EXISTS expenses (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        title           VARCHAR(255)   NOT NULL,
        amount          DECIMAL(10,2)  NOT NULL CHECK (amount >= 0),
        category        VARCHAR(100)   NOT NULL,
        transactionDate DATE           NOT NULL,
        notes           TEXT,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    console.log('DB initialised.');
  } catch (error) {
    console.error('Database initialisation failed:', error.message);
    process.exit(1);
  }
}

// Routes

app.get('/api/expenses', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM expenses ORDER BY transactionDate DESC, id DESC'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load expenses' });
  }
});

app.get('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query('SELECT * FROM expenses WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Expense not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load expense' });
  }
});

app.post('/api/expenses', async (req, res) => {
  const { title, amount, category, transactionDate, notes } = req.body;

  // server-side validation (client also validates, but never trust only the client)
  if (!title || amount == null || !category || !transactionDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO expenses (title, amount, category, transactionDate, notes) VALUES (?, ?, ?, ?, ?)',
      [title.trim(), parseFloat(amount), category.trim(), transactionDate, notes ? notes.trim() : null]
    );
    const [rows] = await pool.query('SELECT * FROM expenses WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

app.put('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  const { title, amount, category, transactionDate, notes } = req.body;

  if (!title || amount == null || !category || !transactionDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const [result] = await pool.query(
      'UPDATE expenses SET title = ?, amount = ?, category = ?, transactionDate = ?, notes = ? WHERE id = ?',
      [title.trim(), parseFloat(amount), category.trim(), transactionDate, notes ? notes.trim() : null, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ error: 'Expense not found' });

    const [rows] = await pool.query('SELECT * FROM expenses WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.query('DELETE FROM expenses WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Expense not found' });
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

// fallback: return the SPA for any unmatched route
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '../client', 'index.html'));
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
});
