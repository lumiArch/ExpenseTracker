# Expense Tracker

This is a basic expense tracker system for calculating expense with a adminisation panel    . 


## Tech stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express
- Database: MySQL
- APIs: REST endpoints under /api/expenses
- Auth: JWT + bcryptjs

## Setup and Run

**Prerequisites:** Node.js and MySQL must be installed and running.

1. Clone or download the project folder
2. Open a terminal in the project root and install dependencies:
   ```bash
   npm install
   ```
3. Make sure MySQL is running. By default the app connects to `localhost` with user `root` and no password. To use different credentials, set the following environment variables before the next step: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
4. Start the server:
   ```bash
   npm start
   ```
   The server will automatically create the `expense_tracker` database and all required tables on first run.
5. Open a browser and go to:
   ```
   http://localhost:3000
   ```
6. A default admin account is seeded on first run:
   - Username: `admin`
   - Password: `admin123`

## Folder structure

```
.
├── client/          # Frontend
│   ├── index.html   # one HTML file containing all four views (login, register, expenses, admin)
│   ├── app.js       # all client-side logic — auth, SPA view switching, CRUD, admin panel
│   └── style.css    #  All styling and design tokens
├── server/          # Backend
│   ├── index.js     # Express server, REST routes, JWT middleware, DB init
│   └── db-init.sql  # SQL export for manuel DB setup
├── package.json
└── README.md
```


## Entities

Three entities with CRUD:

- `users` — Create (register), Read (admin list), Update (admin edit), Delete (admin delete)
- `expenses` — Full CRUD by the logged-in user
- `user_activities` — Created automatically on each action, Read and Delete by admin

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create a new user account |
| POST | `/api/auth/login` | Login and receive a JWT token |
| POST | `/api/auth/logout` | Log the logout activity (token cleared client-side) |

### Users (admin only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | Get all users |
| PUT | `/api/users/:id` | Update a user's username, email, or role |
| DELETE | `/api/users/:id` | Delete a user and all their data |

### Activity Log (admin only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/activities` | Get the last 500 activity entries |
| DELETE | `/api/activities` | Clear the entire activity log |

### Expenses (requires login)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/expenses` | Get all expenses for the logged-in user |
| GET | `/api/expenses/:id` | Get a single expense |
| POST | `/api/expenses` | Create a new expense |
| PUT | `/api/expenses/:id` | Update an expense |
| DELETE | `/api/expenses/:id` | Delete an expense |

## Workload allocation
**Brendan Huynh (Student ID: 13202155)**

- `server/index.js` — Express server, REST API routes, JWT middleware, database initialisation and migrations
- `server/db-init.sql` — database schema export
- `client/app.js` — all client-side logic including auth flow, SPA view routing, expense CRUD, and admin panel
- `client/index.html` — single-page HTML structure with all four views (login, register, expenses, admin)
- `client/style.css` — all styling and design tokens



