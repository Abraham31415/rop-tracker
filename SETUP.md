# ROP Tracker Uganda — Setup Guide

## Option A: Docker (easiest — one command)

### Requirements
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed

### Steps
```bash
# From the project root:
docker-compose up --build

# In a separate terminal, seed the database:
docker-compose exec backend python seed.py
```

Open http://localhost:3000 in your browser.

---

## Option B: Local Development

### Requirements
- [Node.js 20+](https://nodejs.org/) (for the frontend)
- [Python 3.11+](https://www.python.org/)
- [PostgreSQL 15+](https://www.postgresql.org/)

---

### 1. PostgreSQL — create the database

```sql
CREATE USER rop_user WITH PASSWORD 'rop_password';
CREATE DATABASE rop_tracker OWNER rop_user;
```

---

### 2. Backend

```bash
cd backend

# Create a virtual environment
python -m venv venv

# Activate it (Windows PowerShell)
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Copy and edit the env file if needed
copy .env.example .env

# Start the API server
uvicorn app.main:app --reload --port 8000

# In a second terminal, seed demo data
python seed.py
```

API docs: http://localhost:8000/docs

---

### 3. Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open http://localhost:3000 in your browser.

---

## Demo Accounts

| Role                  | Email                          | Password    |
|-----------------------|--------------------------------|-------------|
| Central Coordinator   | central@rop.ug                 | password123 |
| Hospital Coordinator  | coordinator.mulago@rop.ug      | password123 |
| Ophthalmologist       | ophth.mulago@rop.ug            | password123 |
| NICU Nurse            | nurse.mulago@rop.ug            | password123 |

---

## Project Structure

```
ROP tracker/
├── backend/
│   ├── app/
│   │   ├── models/          # SQLAlchemy ORM models
│   │   │   ├── baby.py      # Baby, Sex, Language, BabyStatus enums
│   │   │   ├── exam.py      # Exam, Zone, Stage, PlusDisease
│   │   │   ├── appointment.py
│   │   │   ├── reminder.py
│   │   │   ├── user.py      # User + UserRole enum
│   │   │   └── hospital.py
│   │   ├── schemas/         # Pydantic request/response models
│   │   ├── routers/         # FastAPI route handlers
│   │   │   ├── auth.py      # /api/auth/login, /register, /me
│   │   │   ├── babies.py    # /api/babies + /dashboard/urgency
│   │   │   ├── exams.py     # /api/exams (auto-schedules next appt)
│   │   │   └── hospitals.py
│   │   ├── services/
│   │   │   ├── scheduling.py  # ROP follow-up interval logic
│   │   │   └── messaging.py   # SMS/WhatsApp templates + dispatch
│   │   ├── auth/jwt.py        # JWT + role-based access
│   │   ├── config.py
│   │   ├── database.py
│   │   └── main.py
│   ├── seed.py              # Demo data seeder
│   └── requirements.txt
│
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── LoginPage.jsx
│       │   ├── DashboardPage.jsx   # Urgency-sorted baby list
│       │   ├── EnrollBabyPage.jsx  # Full enrollment form
│       │   └── BabyDetailPage.jsx  # Profile + exam history
│       ├── components/
│       │   └── AppShell.jsx        # Sidebar nav + layout
│       ├── contexts/AuthContext.jsx
│       └── services/api.js
│
├── docker-compose.yml
└── SETUP.md
```

---

## What's built (Phase 1)

- [x] JWT auth with 4 roles (NICU Nurse, Ophthalmologist, Hospital Coordinator, Central Coordinator)
- [x] Baby enrollment form (all clinical fields)
- [x] Hospital coordinator dashboard — urgency-sorted (LTFU → Due Today → Due Soon → On Track)
- [x] Exam recording with auto-scheduling of next appointment per ROP guidelines
- [x] SMS/WhatsApp message templates in 5 languages (English, Luganda, Runyankole, Acholi, Ateso)
- [x] Africa's Talking API integration skeleton
- [x] Progressive Web App (installable, offline-capable via Service Worker)
- [x] PostgreSQL schema: Baby, Exam, Appointment, Reminder, User, Hospital

## What's next (Phase 2)

- [ ] Reminder scheduler (APScheduler job to fire SMS/WhatsApp at T-3, T-1, Day-of, LTFU+48h)
- [ ] Central coordinator network-wide dashboard
- [ ] Mark appointment attended / missed UI
- [ ] Record exam UI (ophthalmologist view)
- [ ] LTFU escalation workflow
- [ ] DigitalOcean deployment
