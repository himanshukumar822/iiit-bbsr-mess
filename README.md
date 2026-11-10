# IIIT Bhubaneswar Mess Management System

> A centralized, web-based dining automation and mess management portal built for students, mess managers, and institute administration at IIIT Bhubaneswar.

---

## 🛠️ Tech Stack

- **Backend**: Node.js & Express.js
- **Database**: MySQL 8.0 (utilizing `mysql2/promise` connection pool)
- **Session & Auth**: `express-session` with secure httpOnly cookies & `bcryptjs` password hashing (salt rounds 10)
- **Rate Limiting**: `express-rate-limit` for DDoS and brute-force mitigation
- **File Uploads**: `multer` (restricted to JPG/JPEG/PNG, 5MB limit, MIME type validation)
- **Frontend**: Pure Vanilla HTML5, CSS3 (Custom Variables, Flexbox, Grid), and Vanilla JavaScript (No frameworks, Bootstrap, or Tailwind)

---

## 🚀 Getting Started & Setup Instructions

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [MySQL Server](https://dev.mysql.com/downloads/mysql/) (v8.0+)
- npm (Node Package Manager)

### 2. Database Setup & Seeding
Log in to your MySQL terminal or workbench and execute `schema.sql`:

```bash
mysql -u root -p < schema.sql
```

This will automatically:
1. Create the database `iiit_mess`.
2. Create all 10 normalized relational tables (including `wallet_transactions`) with foreign keys and check constraints.
3. Seed default mess settings (`breakfast_price: 30`, `lunch_price: 50`, `snacks_price: 15`, `dinner_price: 50`, `sunday_opt_in: true`, `skip_cutoff_minutes: 60`).
4. Seed the full realistic weekly mess timetable (Monday–Sunday for 4 meals).
5. Seed the Dean / Superadmin account (`ADMIN001`).

### 3. Environment Configuration
Copy the sample environment file and configure your local MySQL credentials:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
# Server Port
PORT=3000

# MySQL Database Connection
DB_HOST=localhost
DB_USER=root
DB_PASS=your_mysql_password
DB_NAME=iiit_mess

# Express Session Secret
SESSION_SECRET=iiit_bbsr_mess_super_secret_production_key_2026
```

### 4. Install Dependencies
```bash
npm install
```

### 5. Start the Application
Run the backend server:
```bash
npm start
# or: node backend/server.js
```

Open your browser and visit:
```
http://localhost:3000/
```

---

## 🔑 Default Credentials

| Role | Roll No / Identifier | Email | Password | Portal URL |
| :--- | :--- | :--- | :--- | :--- |
| **Super Admin (Dean)** | `ADMIN001` | `dean@iiitbbsr.ac.in` | `admin123` | `/superadmin/dashboard.html` |
| **Mess Admin** | Created by Super Admin | E.g. `admin@iiitbbsr.ac.in` | Custom | `/admin/dashboard.html` |
| **Student** | Self-registered | E.g. `B121045@iiitbbsr.ac.in` | Custom | `/student/dashboard.html` |

---

## 📁 Folder Structure Overview

```
iiit-bbsr-mess/
├── package.json               # Project manifest and npm dependencies
├── schema.sql                 # MySQL schema, table DDL, and seed dataset
├── .env.example               # Template for environment configuration
├── .gitignore                 # Excludes node_modules, .env, and uploads
├── README.md                  # Documentation and setup guide
│
├── backend/
│   ├── config/
│   │   └── db.js              # MySQL connection pool (mysql2/promise)
│   ├── middleware/
│   │   ├── auth.js            # isAuthenticated & hasRole RBAC middleware
│   │   └── upload.js          # Multer storage, size limits, and MIME filter
│   ├── routes/
│   │   ├── auth.js            # /api/auth (register, login, logout, me)
│   │   ├── student.js         # /api/student (coupons, leave, complaints, payments)
│   │   ├── admin.js           # /api/admin (verify, claims, spot-coupons, menu)
│   │   └── superadmin.js      # /api/superadmin (admins, settings, audits, reports)
│   ├── utils/
│   │   ├── time.js            # IST (Asia/Kolkata) timezone & meal window helpers
│   │   └── wallet.js          # Mess Wallet schema migration & dynamic meal pricing
│   └── server.js              # Express app, static serving, sessions, routes
│
├── frontend/
│   ├── css/
│   │   └── style.css          # Unified stylesheet, responsive design, components
│   ├── js/
│   │   └── app.js             # API client, toast notifications, auth checks, XSS sanitization
│   ├── index.html             # Landing & Login portal
│   ├── register.html          # Student account self-registration
│   ├── student/
│   │   ├── dashboard.html     # Today's active meal status & menu overview
│   │   ├── menu.html          # Full weekly menu timetable
│   │   ├── buy-coupon.html    # 4-step wizard for date & meal subscriptions
│   │   ├── my-coupons.html    # Coupon cards grouped by date with Skip action
│   │   ├── mess-leave.html    # Leave application and historical rebate tracker
│   │   ├── complaints.html    # Time-window locked complaint submission
│   │   └── payment-history.html # Payment logs & receipt screenshot viewer
│   ├── admin/
│   │   ├── dashboard.html     # Operational metrics and attendance visualizer
│   │   ├── manage-menu.html   # Interactive weekly menu schedule editor
│   │   ├── verify-payments.html # Pending payment verification queue
│   │   ├── mark-claims.html   # Counter meal-claiming station
│   │   ├── spot-coupon.html   # Walk-in instant coupon & cash collection
│   │   ├── leave-requests.html# Pending student leave review queue
│   │   ├── complaints.html    # Complaint review and resolution system
│   │   └── students.html      # Searchable directory of hostel diners
│   └── superadmin/
│       ├── dashboard.html     # Institute-wide revenue & attendance summary
│       ├── daily-reports.html # Date-wise operations & financial audits
│       ├── manage-admins.html # Staff accounts and credentials manager
│       └── settings.html      # Dynamic meal rates & cutoff configurations
│
└── uploads/                   # Storage directory for verified payment receipts
```

---

## ✨ Key Features & Business Logic

### Student Dining Experience
- **Interactive Weekly Menu**: View day-wise schedules; today's row is automatically highlighted.
- **Dynamic Coupon Package Subscriptions**: Choose custom date ranges and pick specific meals (Breakfast, Lunch, Snacks, Dinner). Sunday meals can be opted in or out.
- **Transparent Payment Flow**: Submit cash receipt requests or upload bank UPI payment screenshots.
- **Active Meal Status Check**: Dashboard displays real-time meal eligibility (`✅ Coupon Active` / `❌ No Coupon`).
- **Meal Skipping & Mess Wallet Refunds**: Students can skip upcoming future meals (same-day meal skips/cancellations are disallowed) and receive an automatic refund of the meal price to their **Mess Wallet**.
- **Mess Leave & Automatic Rebates**: Submit leave requests starting tomorrow or later; approved leave freezes coupons as `on_leave` and credits unused meal costs to the student's **Mess Wallet** (auto-applicable on future coupon orders).
- **Regulated Complaints**: Submissions are strictly restricted to active serving hours (Breakfast 7:30–9:00, Lunch 12:00–14:00, Snacks 16:00–17:00, Dinner 19:30–21:00 IST).

### Mess Administration
- **Payment Verification Queue**: Review receipts with full-screen image previews before generating coupons. Prevents duplicate verifications and refunds wallet balance if an order is rejected.
- **Fast Dining Hall Claims**: Real-time counter claiming station filterable by student roll number.
- **Walk-in Spot Coupons**: Issue immediate single-meal spot coupons with automatic cash payment recording.
- **Menu Management**: In-place editing of dishes across all days of the week.
- **Leave Applications**: 1-click approvals/rejections with automatic coupon status updates and wallet refunds.

### Executive Oversight & Policy Control
- **Financial Audit & Reconciliation**: Daily breakdown of meals served, skips, spots, and verified revenue.
- **System Settings Configuration**: Modify meal rates, toggle Sunday opt-ins, and adjust skip cutoffs dynamically without code restarts.
- **Role-Based Access Control**: Strict segregation between `student`, `admin`, and `superadmin` tiers (with seamless cross-portal sidebar switching for `superadmin`).

---

## 🛡️ Security & Guardrails

- **Prepared SQL Statements**: 100% of database queries use parameterized `?` placeholders via `mysql2/promise` to prevent SQL Injection.
- **Rate Limiting**: `express-rate-limit` enforces a strict threshold of 10 failed attempts per 15 minutes on `/api/auth/login` and `/api/auth/register`.
- **XSS Mitigation**: Dynamic user inputs (complaint descriptions, menu items, notes, names) are escaped via client-side sanitizers (`escapeHtml`) before DOM insertion.
- **Strict File Upload Constraints**: Validates MIME types (`image/jpeg`, `image/png`) and file extensions, capped at 5MB.
- **Session Hardening**: Cookies configured with `httpOnly: true`, `sameSite: lax`, and `secure: true` when hosted over HTTPS (`production` / Render / Vercel).
- **CSRF Tokens in Production**: This application runs on cookie-based same-origin sessions. For production deployments exposed across multiple subdomains or external APIs, integrate `csurf` or double-submit CSRF tokens.
- **Automated Coupon Expiration**: Past active coupons can be archived using `POST /api/admin/coupons/expire-past`. In production, schedule this endpoint via a daily cron job (e.g. `0 0 * * *` at midnight IST):
  ```bash
  # Example crontab entry for midnight coupon expiration
  0 0 * * * curl -X POST http://localhost:3000/api/admin/coupons/expire-past -b /path/to/admin-cookies.txt
  ```

---

## 🚀 Deploying to Render (Recommended Full-Stack Hosting)

Both the **frontend** (served by Express from `frontend/`) and the **backend** (`/api/*`) run together in a single **Render Web Service** (pre-configured via `render.yaml`).

### 1. Provision & Initialize Your Cloud MySQL Database
Create a free MySQL-compatible cluster (such as **TiDB Cloud Starter**) and import `schema.sql` once.

### 2. Deploy via Render Blueprint (`render.yaml`) or Web Service
- **Option A — Blueprint (`New → Blueprint`)**: Connect `himanshukumar822/iiit-bbsr-mess` and Render reads `render.yaml` automatically (`npm install`, `npm start`, health check `/api/health`).
- **Option B — Manual Web Service (`New → Web Service`)**:
  - **Runtime**: `Node`
  - **Build Command**: `npm install`
  - **Start Command**: `npm start`
  - **Health Check Path**: `/api/health`
- Add the environment variables (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME=iiit_mess`, `DB_SSL=true`, `DB_SSL_REJECT_UNAUTHORIZED=false`, `SESSION_SECRET`).
- On Render (`RENDER=true`), sessions persist in MySQL (`sessions` table) and payment receipt images are automatically stored as base64 data URLs in `payments.screenshot_path` so uploads survive Render free-tier restarts.

---

## ☁️ Deploying to Vercel

This project is pre-configured for full-stack serverless deployment on **Vercel** (serving `frontend/` as static assets and the Express API via `api/index.js` + `vercel.json`).

### 1. Provision a Cloud MySQL Database
Vercel Serverless Functions are stateless and cannot connect to `localhost` MySQL. Create a managed MySQL 8+ database (such as **TiDB Cloud Serverless**, **Aiven for MySQL**, **Railway**, or **AWS RDS**) and import `schema.sql`:
```bash
mysql -h <DB_HOST> -P <DB_PORT> -u <DB_USER> -p <DB_NAME> < schema.sql
```

### 2. Configure Vercel Environment Variables
In your Vercel Project (**Settings → Environment Variables**), set:

| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `DB_HOST` | Cloud MySQL hostname | `gateway01.ap-southeast-1.prod.aws.tidbcloud.com` |
| `DB_PORT` | Cloud MySQL port | `4000` (or `3306`) |
| `DB_USER` | Database username | `your_db_user` |
| `DB_PASS` | Database password | `your_db_password` |
| `DB_NAME` | Database name | `iiit_mess` |
| `DB_SSL` | Enable TLS for cloud MySQL (`true` / `false`) | `true` |
| `DB_SSL_REJECT_UNAUTHORIZED` | Verify TLS certificate strictly (`true` / `false`) | `false` |
| `SESSION_SECRET` | Strong random secret for signing session cookies | `(long random string)` |

### 3. Deploy
Connect your GitHub repository to Vercel (leaving **Framework Preset** as *Other* and **Root Directory** as `.`). Vercel reads `vercel.json` automatically:
- Routes `/api/*`, `/login`, and `/uploads/*` to `api/index.js`.
- Serves static pages from `frontend/`.
- Persists Express sessions in the MySQL `sessions` table via `backend/utils/sessionStore.js`.
- Stores uploaded payment screenshots directly as base64 data URLs (`MEDIUMTEXT` in `payments.screenshot_path`) instead of ephemeral local disk files.

---

## 🖼️ Screenshots

| Student Dashboard | Weekly Menu Timetable |
| :---: | :---: |
| *(Placeholder: Student Dashboard Overview)* | *(Placeholder: Weekly Menu Grid)* |

| Payment Verification | Daily Audit Reports |
| :---: | :---: |
| *(Placeholder: Admin Payment Queue)* | *(Placeholder: Superadmin Reports)* |

---

## 👥 Contributors & Credits

- **Himanshu Kumar** — [github.com/himanshukumar822](https://github.com/himanshukumar822)
- Designed for the students, faculty, and mess administration of the **International Institute of Information Technology, Bhubaneswar (IIIT-BBSR)**.
