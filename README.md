# Expense Tracker

## Programming on the Internet Project
This is a basic expense tracker system for calculating expense.

## Tech Stack
- Frontend: HTML, CSS, JavaScript 
- Backend: Node.js, Express
- Database: MySQL 
- APIs: REST endpoints under `/api/expenses`

## Folder Structure
```
expense-tracker/
├── client/              # Frontend (served as static files)
│   ├── index.html       # Single-page app entry point
│   ├── style.css        # All styling and design tokens
│   └── app.js           # Client-side state, rendering, API calls
├── server/              # Backend
│   ├── index.js         # Express server, REST routes, DB init
│   └── db-init.sql      # SQL export for manual DB setup
├── package.json         # Dependencies and npm scripts
└── README.md
```

## Setup and Run
1. Clone or open project folder
2. Install dependencies
3. Prepare MySQL
   - default db name: `expense_tracker`
   - default user: `root`, no password
4. Start app
   - `npm start`
5. Open browser
   - `http://localhost:3000`

## API Endpoints
- `GET /api/expenses` - fetch all expenses
- `POST /api/expenses` - create new expense
- `PUT /api/expenses/:id` - update expense
- `DELETE /api/expenses/:id` - delete expense

## Challenges 
- Full CRUD in a single page with careful state sync between client and server.
- Implemented in-place validation for amount, date, title, category and log.
- Error notification for API failures.
- Database and table initialization run automatically on server start


