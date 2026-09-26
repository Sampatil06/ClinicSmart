# ClinicOps: Website + Clinic Management Template

## Overview

ClinicOps is a generic full-stack portfolio template with two connected parts:

1. **Public clinic website** at `/`  
   A responsive marketing website with services, about content and an appointment-request form.

2. **Staff clinic dashboard** at `/admin`  
   A password-protected operations area for patients, medicine names and multi-item prescriptions.

It is deliberately generic. It contains no real clinic name, staff data, patient data, addresses, phone numbers, client images, domains, credentials or private workflow data.

## Architecture

```text
Public browser
  ├─ GET /                     → public/index.html (clinic website)
  ├─ POST /api/bookings        → appointment-request data
  └─ GET /admin                → public/admin.html (staff dashboard)
                                  │
                                  ├─ signed admin session cookie
                                  ├─ patients API
                                  ├─ medicines API
                                  └─ prescriptions API
                                          │
                                          ▼
                                    PostgreSQL database
```

## Features

### Public website

- Responsive navigation
- Hero, services and about sections
- Appointment booking with centre and morning/evening slot selection
- Availability checks, date-range/centre/slot blocking and confirmation popup
- Success/error feedback after request submission
- Link to protected staff dashboard

### Clinic dashboard

- Secure password login/logout
- View, filter, paginate, add, edit and delete appointment requests
- Block booking availability for a date range, specific slot, specific centre or any combination
- Add or update a patient using their phone number
- Add and remove medicine names
- Build prescriptions with medicine, quantity and instructions
- Store prescriptions with an atomic PostgreSQL transaction
- Create and view patient invoices with a service description and total amount
- Responsive dashboard navigation

## Project structure

```text
clinic-management-starter/
├── public/
│   ├── index.html       # public website
│   ├── admin.html       # staff dashboard
│   ├── site.js          # public booking form
│   ├── app.js           # staff dashboard behavior
│   └── style.css        # shared responsive styles
├── server.js            # Express server, API, auth and schema
├── package.json         # Node dependencies and npm start script
├── .env.example         # safe environment-variable template
├── .gitignore           # keeps secrets and node_modules out of Git
└── README.md            # portfolio overview
```

## Run locally

### 1. Requirements

- Node.js 20+
- PostgreSQL
- Git

### 2. Install packages

```powershell
cd C:\Users\Samarth\Documents\Codex\2026-08-13\i\clinic-management-starter
npm install
```

### 3. Create database

Create a PostgreSQL database called `clinic_starter` using pgAdmin, or:

```powershell
createdb -U postgres clinic_starter
```

### 4. Set environment variables

The server does not load `.env` automatically. Copy the example as a reference:

```powershell
Copy-Item .env.example .env
```

Then set values in the terminal where you will start the server:

```powershell
$env:DATABASE_URL = "postgresql://postgres:YOUR_PASSWORD@localhost:5432/clinic_starter"
$env:ADMIN_PASSWORD = "Choose-a-long-unique-password"
$env:SESSION_SECRET = "Paste-a-random-32-character-or-longer-secret"
$env:NODE_ENV = "development"
```

Generate a secret:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. Start

```powershell
npm start
```

Open:

- Public website: http://localhost:3000
- Staff dashboard: http://localhost:3000/admin

The database tables are created automatically on first startup.

## Database tables

| Table | What it stores |
| --- | --- |
| `patients` | Patient name, phone and staff notes |
| `medicines` | Generic medicine-name list |
| `prescriptions` | Prescription header, patient relation and notes |
| `prescription_items` | Medicine, quantity and how-to-take instructions |
| `invoices` | Patient invoices, service description and total amount |
| `bookings` | Public and manual appointment requests, slots, centres and statuses |
| `booking_blocks` | Date ranges unavailable for all or selected slots/centres |

## API endpoints

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/api/bookings` | Public | Create availability-checked appointment request |
| GET/PATCH/DELETE | `/api/bookings` | Staff | List, edit and remove appointment requests |
| POST | `/api/bookings/admin` | Staff | Create manual appointment request |
| GET/POST/DELETE | `/api/booking-blocks` | Staff | Manage unavailable date ranges |
| POST | `/api/login` | Public | Start staff session |
| POST | `/api/logout` | Staff | End session |
| GET | `/api/session` | Staff | Verify session |
| GET/POST | `/api/patients` | Staff | List/create/update patients |
| GET/POST | `/api/medicines` | Staff | List/add medicine names |
| DELETE | `/api/medicines/:id` | Staff | Remove a medicine |
| POST | `/api/prescriptions` | Staff | Create prescription |
| GET/POST | `/api/invoices` | Staff | List/create invoices |
| GET | `/api/bookings` | Staff | List appointment requests |

## Security implemented

- Environment-only database URL, password and signing secret
- Signed HMAC session cookie
- HTTP-only and SameSite=Strict cookie settings
- Secure cookie and HSTS in production
- Same-origin check for state-changing staff actions in production
- Parameterized PostgreSQL queries
- Input length and type validation
- Content Security Policy
- Clickjacking prevention
- MIME-type sniffing prevention
- `.env` excluded from Git

## Important production limitations

This is a portfolio template, not a complete compliant medical-record platform. Before using it with real data, add:

- Individual staff accounts and role-based access
- Multi-factor authentication
- Audit logs
- Enforced rate limits
- Encrypted backups
- Consent, privacy and retention policies
- Applicable legal/compliance review
- Full test suite and security testing
- PDF/WhatsApp integrations if documents must be distributed

## Test checklist

- [ ] Homepage works on mobile, tablet and desktop
- [ ] Public booking rejects invalid phone/date/time
- [ ] Block a date range and confirm that a matching public booking is rejected
- [ ] Add, edit, filter and delete a booking from the dashboard
- [ ] Valid booking shows success message
- [ ] Staff login rejects invalid password
- [ ] Staff login opens dashboard
- [ ] Add patient and verify it appears in list
- [ ] Add/remove medicine
- [ ] Create prescription with more than one medicine
- [ ] Sign out blocks dashboard API access
- [ ] Run `npm audit` before deployment

## Publish to GitHub

The local Git repository is already initialized.

```powershell
git status
git add .
git commit -m "Add public clinic website and staff dashboard"
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

Recommended repository title: `clinic-management-starter`.

For LinkedIn or Upwork:  
**“Built a generic full-stack clinic platform with a responsive public website, online appointment requests, secure staff dashboard, PostgreSQL patient records, medicine management and multi-item prescriptions using Node.js, Express and vanilla JavaScript.”**
