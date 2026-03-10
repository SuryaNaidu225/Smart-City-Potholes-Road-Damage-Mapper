# 🛣️ RoadWatch — Smart City Pothole & Road Damage Mapper

> A full-stack crowdsourced web application connecting citizens with their municipal road authority through a structured, map-driven reporting system.

---

## 🎯 Problem Statement

Road infrastructure suffers from a critical information gap: no unified real-time system exists for citizens to report damage, and municipalities lack geospatial visibility to prioritize repairs. This causes delayed fixes (costing 4–5× more), citizen frustration, and wasted resources.

---

## 💡 Solution

RoadWatch provides:
- **Citizens** → Report potholes/damage instantly by pinning a map location
- **Live Heatmap** → City-wide visualization of damage concentration
- **Status Tracking** → Reported → In Review → Scheduled → Fixed
- **Admin Dashboard** → Priority queue with scores to guide repair decisions
- **Analytics** → Charts, hotspots, resolution rates, citizen leaderboard

---

## 🖥️ Live Demo

**Open `index.html` in your browser — zero setup, fully functional.**

### Demo Accounts
| Role | Email | Password |
|------|-------|----------|
| 👤 Citizen | demo@citizen.com | demo123 |
| 🏛️ Admin | admin@city.gov | admin123 |

### Demo Flow
1. Log in as **Citizen** → Click map to drop a pin → Fill form → Submit report
2. Log in as **Admin** → See priority queue → Update status → View analytics
3. Toggle **Heatmap** layer on the map to see damage density

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (React / HTML)               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ Auth     │  │ Map View │  │  Admin   │  │Analytics│ │
│  │ JWT      │  │ Leaflet  │  │Dashboard │  │ Charts │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
└─────────────────────────┬───────────────────────────────┘
                          │ REST API
┌─────────────────────────▼───────────────────────────────┐
│                 BACKEND (Node.js + Express)              │
│  /api/auth  /api/reports  /api/analytics  /api/leaderboard│
│  JWT Auth   Role-based Access Control (citizen/admin)    │
└─────────────────────────┬───────────────────────────────┘
                          │ pg driver
┌─────────────────────────▼───────────────────────────────┐
│           DATABASE (PostgreSQL + PostGIS)                │
│  users  reports  report_timeline  report_upvotes         │
│  Spatial index (GIST) for geospatial queries             │
│  ST_DWithin() — radius search                           │
│  ST_SnapToGrid() — hotspot clustering                   │
└─────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React + Tailwind CSS | Component-based, rapid UI |
| Maps | Leaflet.js + leaflet-heat | Lightweight, open-source maps |
| Charts | Chart.js | Flexible analytics visualization |
| Backend | Node.js + Express | Fast REST API, JS ecosystem |
| Database | PostgreSQL + PostGIS | Relational + native geospatial |
| Auth | JWT + bcryptjs | Stateless, secure auth |
| Files | Cloudinary (prod) | CDN-hosted image storage |
| Deploy | Vercel (frontend) + Railway (backend) | Free tier, easy CI/CD |

---

## 🗃️ Database Schema

```sql
users          — id, name, email, password_hash, role, city
reports        — id, user_id, damage_type, severity, location (GEOGRAPHY),
                 description, photo_url, status, priority_score
report_timeline — id, report_id, status, note, created_by, created_at
report_upvotes  — report_id, user_id (composite PK)
```

### Key PostGIS Queries
```sql
-- Radius search (reports within 2km of a point)
WHERE ST_DWithin(location::geography, ST_MakePoint(80.65, 16.51)::geography, 2000)

-- Hotspot clustering (group by ~1km grid)
GROUP BY ST_SnapToGrid(location::geometry, 0.01)
```

---

## 🚀 Running Locally (Full Stack)

### Prerequisites
- Node.js 18+
- PostgreSQL 14+ with PostGIS extension

### Backend Setup
```bash
cd backend
npm install
cp .env.example .env    # Fill in your DB credentials
psql -U postgres -c "CREATE DATABASE roadwatch"
psql -U postgres -d roadwatch -f schema.sql
node server.js
# API running at http://localhost:5000
```

### Frontend Setup
```bash
cd frontend
npm install
npm start
# App at http://localhost:3000
```

### Or just open index.html
```bash
# Zero setup — all features work in the browser directly
open index.html
```

---

## ✨ Key Features

### 🗺️ Interactive Map
- Click any point on the map to auto-fill coordinates in the report form
- Toggle between **Markers** view (per-report pins) and **Heatmap** view (density overlay)
- Color-coded by severity: 🔴 Critical, 🟠 High, 🟡 Medium, 🟢 Low
- Fly-to animation when selecting a report from the sidebar
- Custom SVG markers with damage type emoji

### 📋 Report Submission
- 4 damage types: Pothole, Road Crack, Subsidence, Road Debris
- 4 severity levels with visual selectors
- Photo upload with preview
- Priority score auto-calculated (0–115) based on severity

### 📊 Admin Dashboard
- Live stats: Total / Pending / In Progress / Fixed
- Sortable priority queue (highest score first)
- One-click status updates with automatic timeline logging
- Search + filter by status
- Direct link to view report on map

### 📈 Analytics
- Severity distribution (doughnut chart)
- Reports over time (7-day line chart)
- Damage type breakdown (bar chart)
- Status pipeline (horizontal bar)
- Citizen leaderboard with badges

---

## 🔐 API Reference

### Auth
```
POST /api/auth/register   { name, email, password, city }
POST /api/auth/login      { email, password }
```

### Reports
```
GET  /api/reports         ?severity=&status=&lat=&lng=&radius=
GET  /api/reports/:id
POST /api/reports         (auth) multipart/form-data
PATCH /api/reports/:id/status  (admin) { status, note }
```

### Analytics
```
GET /api/analytics/summary   (auth)
GET /api/analytics/hotspots  (admin)
GET /api/leaderboard
```

---

## 🌐 Deployment

### Frontend → Vercel
```bash
npm run build
vercel deploy
```

### Backend → Railway
```bash
# Connect GitHub repo, set env vars, auto-deploy
railway up
```

### Environment Variables
```
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
JWT_SECRET
CLOUDINARY_URL
FRONTEND_URL
```

---

## 🔮 Future Roadmap

- [ ] AI severity classification from uploaded photo (TensorFlow.js)
- [ ] Progressive Web App (PWA) for offline mobile reporting
- [ ] WhatsApp Bot integration for non-tech users
- [ ] Municipality API for direct repair dispatch
- [ ] Gamification — badges, streaks, neighborhood rankings
- [ ] Real-time notifications via WebSocket

---

## 👤 Author

Built as part of the Smart City internship screening challenge — Website/App Development track.

**Stage 1 Deliverables:** ✅ Idea Proposal  ✅ Working Prototype  ✅ Presentation Ready
