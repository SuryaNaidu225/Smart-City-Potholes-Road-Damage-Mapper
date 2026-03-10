-- ============================================================
-- RoadWatch Database Schema
-- PostgreSQL + PostGIS
-- ============================================================

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── USERS ──
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) DEFAULT 'citizen' CHECK (role IN ('citizen', 'admin')),
  city          VARCHAR(100),
  phone         VARCHAR(20),
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- ── REPORTS ──
CREATE TABLE reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  damage_type     VARCHAR(50) NOT NULL CHECK (damage_type IN ('pothole', 'crack', 'subsidence', 'debris', 'other')),
  severity        VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  location_text   TEXT NOT NULL,
  location        GEOGRAPHY(POINT, 4326) NOT NULL,  -- PostGIS spatial column
  description     TEXT,
  photo_url       TEXT,
  status          VARCHAR(30) DEFAULT 'reported' CHECK (status IN ('reported', 'review', 'scheduled', 'fixed', 'rejected')),
  priority_score  INTEGER DEFAULT 0,
  upvotes         INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- Spatial index for fast geospatial queries
CREATE INDEX idx_reports_location ON reports USING GIST (location);
CREATE INDEX idx_reports_severity ON reports (severity);
CREATE INDEX idx_reports_status ON reports (status);
CREATE INDEX idx_reports_created ON reports (created_at DESC);

-- ── REPORT TIMELINE ──
CREATE TABLE report_timeline (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id   UUID REFERENCES reports(id) ON DELETE CASCADE,
  status      VARCHAR(30) NOT NULL,
  note        TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ── UPVOTES ──
CREATE TABLE report_upvotes (
  report_id  UUID REFERENCES reports(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (report_id, user_id)
);

-- ── SEED ADMIN USER ──
INSERT INTO users (name, email, password_hash, role, city)
VALUES (
  'City Admin',
  'admin@city.gov',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', -- admin123
  'admin',
  'Vijayawada'
);

-- ── USEFUL VIEWS ──

-- Pending reports sorted by priority
CREATE VIEW priority_queue AS
SELECT r.id, r.damage_type, r.severity, r.location_text,
  ST_X(r.location::geometry) as lng,
  ST_Y(r.location::geometry) as lat,
  r.priority_score, r.status, r.created_at, u.name as reporter
FROM reports r JOIN users u ON r.user_id = u.id
WHERE r.status != 'fixed'
ORDER BY r.priority_score DESC;

-- Damage hotspots (clustered by ~1km grid)
CREATE VIEW damage_hotspots AS
SELECT
  ST_X(ST_Centroid(ST_Collect(location::geometry))) as center_lng,
  ST_Y(ST_Centroid(ST_Collect(location::geometry))) as center_lat,
  COUNT(*) as report_count,
  AVG(priority_score) as avg_priority,
  MODE() WITHIN GROUP (ORDER BY severity) as dominant_severity
FROM reports
WHERE status != 'fixed'
GROUP BY ST_SnapToGrid(location::geometry, 0.01);
