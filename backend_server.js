// ============================================================
// RoadWatch Backend — Node.js + Express + PostgreSQL + PostGIS
// ============================================================

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'roadwatch_secret_key';

// ── MIDDLEWARE ──
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── DATABASE ──
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'roadwatch',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});

// ── FILE UPLOAD ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

// ── AUTH MIDDLEWARE ──
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ══════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, city } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });

    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await pool.query(
      'INSERT INTO users (id, name, email, password_hash, role, city, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())',
      [id, name, email, hash, 'citizen', city || null]
    );

    const token = jwt.sign({ id, email, name, role: 'citizen' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, name, email, role: 'citizen', city } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, city: user.city } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════
// REPORTS ROUTES
// ══════════════════════════════════════════════

// GET /api/reports — Get all reports (with optional filters)
app.get('/api/reports', async (req, res) => {
  try {
    const { severity, status, lat, lng, radius } = req.query;
    let query = `
      SELECT r.*, u.name as reporter_name,
        ST_X(r.location::geometry) as lng,
        ST_Y(r.location::geometry) as lat
      FROM reports r
      JOIN users u ON r.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (severity) { params.push(severity); query += ` AND r.severity = $${params.length}`; }
    if (status)   { params.push(status);   query += ` AND r.status = $${params.length}`; }

    // Geospatial radius filter (PostGIS)
    if (lat && lng && radius) {
      params.push(parseFloat(lng), parseFloat(lat), parseFloat(radius) * 1000);
      query += ` AND ST_DWithin(r.location::geography, ST_MakePoint($${params.length-2}, $${params.length-1})::geography, $${params.length})`;
    }

    query += ' ORDER BY r.priority_score DESC, r.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/:id
app.get('/api/reports/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, u.name as reporter_name,
        ST_X(r.location::geometry) as lng,
        ST_Y(r.location::geometry) as lat
      FROM reports r JOIN users u ON r.user_id = u.id
      WHERE r.id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Report not found' });
    
    // Get timeline
    const timeline = await pool.query(
      'SELECT * FROM report_timeline WHERE report_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ ...result.rows[0], timeline: timeline.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reports — Submit new report
app.post('/api/reports', authMiddleware, upload.single('photo'), async (req, res) => {
  try {
    const { damage_type, severity, location_text, lat, lng, description } = req.body;
    if (!damage_type || !severity || !lat || !lng) return res.status(400).json({ error: 'Missing required fields' });

    const id = uuidv4();
    const severityScores = { critical: 100, high: 70, medium: 40, low: 15 };
    const priority_score = severityScores[severity] + Math.floor(Math.random() * 15);

    let photo_url = null;
    if (req.file) {
      // In production: upload to Cloudinary/S3, get URL
      // photo_url = await uploadToCloudinary(req.file.buffer);
      photo_url = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    await pool.query(`
      INSERT INTO reports (id, user_id, damage_type, severity, location_text,
        location, description, photo_url, status, priority_score, created_at)
      VALUES ($1,$2,$3,$4,$5,ST_MakePoint($6,$7)::geography,$8,$9,'reported',$10,NOW())
    `, [id, req.user.id, damage_type, severity, location_text, parseFloat(lng), parseFloat(lat), description, photo_url, priority_score]);

    await pool.query(
      'INSERT INTO report_timeline (report_id, status, note, created_by, created_at) VALUES ($1,$2,$3,$4,NOW())',
      [id, 'reported', 'Report submitted by citizen', req.user.id]
    );

    res.status(201).json({ id, message: 'Report submitted successfully', priority_score });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reports/:id/status — Update status (admin only)
app.patch('/api/reports/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status, note } = req.body;
    const validStatuses = ['reported', 'review', 'scheduled', 'fixed'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    await pool.query('UPDATE reports SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.id]);
    await pool.query(
      'INSERT INTO report_timeline (report_id, status, note, created_by, created_at) VALUES ($1,$2,$3,$4,NOW())',
      [req.params.id, status, note || `Status updated to ${status}`, req.user.id]
    );

    // Notify citizen (in production: send email via NodeMailer)
    res.json({ message: 'Status updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════
// ANALYTICS ROUTES
// ══════════════════════════════════════════════

// GET /api/analytics/summary
app.get('/api/analytics/summary', authMiddleware, async (req, res) => {
  try {
    const [total, bySeverity, byStatus, byType, timeline] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM reports'),
      pool.query('SELECT severity, COUNT(*) FROM reports GROUP BY severity'),
      pool.query('SELECT status, COUNT(*) FROM reports GROUP BY status'),
      pool.query('SELECT damage_type, COUNT(*) FROM reports GROUP BY damage_type'),
      pool.query(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM reports WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at) ORDER BY date
      `)
    ]);
    res.json({
      total: parseInt(total.rows[0].count),
      by_severity: bySeverity.rows,
      by_status: byStatus.rows,
      by_type: byType.rows,
      timeline: timeline.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/hotspots — PostGIS clustering
app.get('/api/analytics/hotspots', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ST_X(ST_Centroid(ST_Collect(location::geometry))) as center_lng,
        ST_Y(ST_Centroid(ST_Collect(location::geometry))) as center_lat,
        COUNT(*) as report_count,
        AVG(priority_score) as avg_priority
      FROM reports
      WHERE status != 'fixed'
      GROUP BY ST_SnapToGrid(location::geometry, 0.01)
      HAVING COUNT(*) >= 2
      ORDER BY report_count DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════
// LEADERBOARD
// ══════════════════════════════════════════════
app.get('/api/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.city, COUNT(r.id) as report_count,
        COUNT(CASE WHEN r.status='fixed' THEN 1 END) as resolved_count
      FROM users u LEFT JOIN reports r ON u.id = r.user_id
      WHERE u.role = 'citizen'
      GROUP BY u.id, u.name, u.city
      ORDER BY report_count DESC LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── START ──
app.listen(PORT, () => console.log(`🛣️  RoadWatch API running on http://localhost:${PORT}`));
module.exports = app;
