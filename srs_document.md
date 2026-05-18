# Software Requirements Specifications (SRS)

## Cover Page
**Title:** DTR & Payroll Management System  
**Version:** 1.0.0  
**Date:** May 16, 2026  
**Author:** AI System Architect (Generated)

---

## Revisions Page
| Date | Version | Description | Author |
|---|---|---|---|
| 2026-05-16 | 1.0.0 | Initial SRS Document Generation based on source code analysis | System Architect |

---

## Table of Contents
1. [INTRODUCTION](#1-introduction)
   - 1.1 Product Overview
2. [SPECIFIC REQUIREMENTS](#2-specific-requirements)
   - 2.1 External Interface Requirements
   - 2.2 Software Product Features
   - 2.3 Software System Attributes
   - 2.4 Database Requirements
3. [APPENDIX](#3-appendix)

---

## 1 INTRODUCTION

### 1.1 Product Overview
The **DTR (Daily Time Record) & Payroll Management System** is a robust, full-stack web application tailored for Cor Jesu College. It is designated to automate attendance monitoring (DTR logging), handle staff/student cash advances, and generate accurate payroll calculations. The platform supports advanced shift dynamics including session tracking, automated late-clockout flagging, and overtime/undertime calculations directly tied to user-specific hourly rates.

---

## 2 SPECIFIC REQUIREMENTS

### 2.1 External Interface Requirements

#### 2.1.1 User Interfaces
The system provides role-specific dashboards managed entirely via server-rendered EJS templates. 
- **Admin Interfaces:** Comprehensive overviews of system behavior, including `payroll-overview`, `payroll-generate`, `user-form`, and `dtr-maintenance`. These rely on web standards (HTML5/CSS) and provide flash message feedback (via `connect-flash`) for real-time validation of administrative actions (e.g., creating a user, deducting an advance).
- **General Interfaces:** Modals and layout tables logically present data structures like attendance history, current break status, and pay slips.

#### 2.1.2 Hardware Interfaces
The system does not interface with specialized hardware. It requires only standard networking equipment and is accessible via any modern desktop or mobile web browser.

#### 2.1.3 Software Interfaces
- **Database System:** PostgreSQL (provisioned via Supabase or local clusters).
- **ORM Interface:** Prisma Client (`@prisma/client` v6.2.1) is used for schema migration and strict data-type adherence.
- **OS/Environment:** Node.js backend running Express.js (`express` v4.18.2).
- **Spreadsheet Software Interface:** ExcelJS (`exceljs` v4.4.0) is connected for automated DTR and payroll exporting.

#### 2.1.4 Communications Protocols
- **HTTP/HTTPS:** Standard RESTful web routing for handling form submissions (`method-override` allows PUT/DELETE verbs) and page requests.
- **Cookie-Based Sessions:** `express-session` handles browser session states securely. On production environments, cookies are encrypted and flagged as `secure` and `httpOnly`. 

### 2.2 Software Product Features

- **2.2.1 Secure Authentication & Session Management:** Utilizes `bcryptjs` for hashing passwords. Login state is robustly managed via `connect-pg-simple` to ensure serverless or cloud deployment scaling does not lose session data.
- **2.2.2 DTR Shift Processing:** Employees can log complex shifts. Tracking algorithms capture granular `sessions` within a day, correctly mutating state (`in_progress`, `on_break`, `completed`) and automatically calculating `overtimeHours` and `undertimeHours`.
- **2.2.3 Exception & Late Clock-out Handling:** Backend automatically manages forgotten clockouts (flagged as `late_clockout` = true) and late afternoon schedules.
- **2.2.4 Payroll Computation Engine:** Processes user logs within specific timeframe bounds (`periodStart` to `periodEnd`). Connects a User's `hourlyRate` with their `totalHours` to calculate `grossPay`, integrates system-wide `deductions` (from cash advances), and finalizes a trackable `netPay`.
- **2.2.5 Cash Advance Module:** Enables logging of employee debt (`pending` status) which dynamically bridges to the Payroll calculations to mark advances as `deducted` on the `targetPayrollDate`.

### 2.3 Software System Attributes

#### 2.3.1 Reliability
All data relationships are highly reliable due to Relational Cascade deletions. Deleting a user reliably scrubs their associated DTR logs and cash advances to prevent ghost data.

#### 2.3.2 Availability
Using connection pooling built via `pg` (PostgreSQL) and a persistent state table for sessions guarantees uptime, preventing the memory leaks associated with default in-memory session logging under heavy traffic.

#### 2.3.3 Security
Direct database endpoints (`DIRECT_URL`, `DATABASE_URL`) and cookie secrets (`SESSION_SECRET`) are abstracted into `.env` configurations.

#### 2.3.4 Maintainability
Project follows standard MVC structures. Logic is organized modularly (e.g., `adminController.js`, `routes/index.js`), with schema management governed cleanly by `schema.prisma`.

#### 2.3.5 Performance
Throughput requirements rely heavily on Prisma's query capabilities. Session persistence queries are optimized via indexing (`@@index([expire], map: "IDX_session_expire")`) ensuring high-speed lookup time for active users.

---

### 2.4 Database Requirements

#### 2.4.1 Entity Relationship Diagram
- **User:** The core central entity. Has a ONE-TO-MANY relationship with both **DTRLog** and **CashAdvance**.
- **DTRLog:** Belongs to a User. Tracks daily shift data.
- **CashAdvance:** Belongs to a User. Tracks debts and deductions. 
- **Payroll:** Generated standalone records representing a finalized calculation payload for a timeframe. Mentions User data (ID, name) functionally.
- **Session:** System table maintaining express-sessions. 

#### 2.4.2 Data Dictionary

**Table: User**
| Field | Type | Description |
|---|---|---|
| id | UUID | Primary Database ID. |
| userId | String | Display/Login Identifier (Unique). |
| name | String | Full Employee/Student Name. |
| password | String | Hashed verification token. |
| role | Enum | `admin`, `maintenance`, or `student`. |
| hourlyRate | Float | The computation multiplier for payroll (Default: 0). |
| requiredHours| Float | Standard hour block expected per shift (Default: 8). |
| isActive | Boolean | Soft-deletion or suspension flag. |

**Table: DTRLog**
| Field | Type | Description |
|---|---|---|
| id | UUID | Primary Database ID. |
| user_id | String | Foreign key linking to User model. |
| timeIn / timeOut | DateTime | Boundaries of the shift. |
| sessions | Json | Stores arrays representing multiple breaks in/out within a day. |
| totalHours | Float | Evaluated count of hours worked. |
| status | Enum | Shift State: `in_progress`, `on_break`, or `completed`. |
| late_clockout | Boolean | True if the shift wasn't correctly terminated by the user. |

**Table: CashAdvance**
| Field | Type | Description |
|---|---|---|
| employeeId | String | Foreign key linking to User model. |
| amount | Float | Monetary size of the deduction. |
| status | Enum | Current application state: `pending` or `deducted`. |
| targetPayrollDate | String| Intended payroll week for deduction application. |

**Table: Payroll**
| Field | Type | Description |
|---|---|---|
| periodStart/End| String | Date strings bounding the computation period. |
| grossPay | Float | Raw payment derived from total hours × base rate. |
| deductions | Float | Aggregated debts applied during computation. |
| netPay | Float | Final computed take-home calculation. |
| isPaid | Boolean | Represents if funds were manually dispatched. |

---

## 3 APPENDIX

**Appendix A: Glossary**
- **DTR:** Daily Time Record. The log of when an employee clocks in and out.
- **ORM:** Object-Relational Mapping. A programming technique converting data between incompatible systems. We use *Prisma Client*.
- **EJS:** Embedded JavaScript Templating. Used for rendering dynamic HTML content on the server.
- **Session Store:** A persistence mechanism saving user login cookies into a database specifically to prevent server reboot data loss.

**Appendix B: Analysis Models**

*Sequence Output Description: Process of Payroll Computation*
1. **Admin** triggers `POST /payroll/generate`.
2. **Controller** extracts `userId`, `periodStart`, `periodEnd`.
3. **Database** fetches all `DTRLog` matching `completed` statuses within the date bounds.
4. **Database** fetches all `CashAdvance` matching `pending`.
5. **Logic Engine** sums `totalHours`, multiplies by user's `hourlyRate` = `grossPay`.
6. **Logic Engine** sums `CashAdvance.amount` = `deductions`.
7. **Math Execution:** `gross/net` evaluation occurs (`grossPay - deductions`).
8. **Prisma** creates a new `Payroll` record and updates target `CashAdvance` states to `deducted`.
9. **Express** redirects Admin to payroll overview with a flash success message.
