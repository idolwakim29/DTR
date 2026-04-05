# CJC DTR & Payroll Management System

A Daily Time Record and Payroll Management System for Cor Jesu College, Inc.  
Built with **Node.js + Express + MongoDB** using the **MVC architecture**.

---

## Tech Stack

| Layer       | Technology              |
|-------------|-------------------------|
| Runtime     | Node.js                 |
| Framework   | Express.js              |
| Database    | MongoDB (Mongoose ODM)  |
| Template    | EJS                     |
| Auth        | Express-Session + bcryptjs |
| Pattern     | MVC (Model-View-Controller) |

---

## Features

### Admin
- **Dashboard** — Live stats: staff count, student count, DTR logs, payrolls, today's attendance
- **Maintenance DTR** — View, search, filter, edit, delete attendance logs for maintenance staff
- **Student DTR** — View, search, filter, edit, delete attendance logs for students
- **Payroll** — Generate daily/weekly/monthly payroll from DTR data, mark as paid
- **User Management** — Add, edit, deactivate, delete staff and student accounts

### Staff / Students
- **Time In** — Record clock-in (one per day only)
- **Time Out** — Record clock-out (requires Time In)
- **Live Clock** — Real-time clock display on DTR page
- **Today's Status** — View current Time In, Time Out, total hours worked

---

## Project Structure

```
dtr-payroll/
├── config/
│   ├── database.js        # MongoDB connection
│   └── seed.js            # Demo data seeder
├── controllers/
│   ├── authController.js  # Login / Logout
│   ├── dtrController.js   # DTR logging and admin DTR management
│   └── adminController.js # Dashboard, Users, Payroll
├── middleware/
│   └── auth.js            # isAuthenticated, isAdmin, isStaff
├── models/
│   ├── User.js            # User schema (admin/maintenance/student)
│   ├── DTRLog.js          # DTR Log schema
│   └── Payroll.js         # Payroll record schema
├── routes/
│   └── index.js           # All application routes
├── views/
│   ├── auth/login.ejs
│   ├── dtr/index.ejs      # Staff/student DTR page
│   ├── admin/
│   │   ├── dashboard.ejs
│   │   ├── dtr-maintenance.ejs
│   │   ├── dtr-students.ejs
│   │   ├── dtr-edit.ejs
│   │   ├── users.ejs
│   │   ├── user-form.ejs
│   │   ├── payroll.ejs
│   │   └── payroll-generate.ejs
│   ├── partials/
│   │   ├── admin-header.ejs
│   │   └── admin-footer.ejs
│   └── error.ejs
├── public/
│   └── css/style.css
├── .env
├── server.js
└── package.json
```

---

## Setup & Installation

### Prerequisites
- Node.js v18+
- MongoDB (local or Atlas)

### 1. Install dependencies
```bash
cd dtr-payroll
npm install
```

### 2. Configure environment
Edit `.env`:
```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/dtr_payroll_db
SESSION_SECRET=your_secret_key
NODE_ENV=development
AFTERNOON_CUTOFF=13:30
```

### 3. Seed demo data (optional)
```bash
npm run seed
```

### 4. Start the server
```bash
npm start
# or for development with auto-reload:
npm run dev
```

### 5. Open in browser
```
http://localhost:3000
```

---

## Demo Login Credentials

| Role        | User ID   | Password     |
|-------------|-----------|--------------|
| Admin       | ADMIN001  | admin123     |
| Maintenance | MNT001    | password123  |
| Maintenance | MNT002    | password123  |
| Student     | STD001    | password123  |
| Student     | STD002    | password123  |

---

## Color Palette (Cor Jesu Theme)

| Color       | Hex       | Usage                     |
|-------------|-----------|---------------------------|
| Red         | `#C0392B` | Primary, buttons, brand   |
| Dark Red    | `#922B21` | Hover states              |
| Dark Navy   | `#1A1A2E` | Sidebar background        |
| White       | `#FFFFFF` | Cards, content areas      |
| Light Gray  | `#F8F9FA` | Page background           |

---

## Business Rules Enforced

- ✅ One Time In per user per day
- ✅ Time Out requires Time In first
- ✅ No duplicate Time Out
- ✅ Total hours auto-calculated on Time Out
- ✅ Admin only can access dashboard
- ✅ Staff/students can only access DTR page
- ✅ Payroll auto-calculates from DTR records
