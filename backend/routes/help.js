const express = require('express');
const db = require('../db');
const requireLogin = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

// Distance in km between (lat, lng) and a shop. Needs the params: lat, lng, lat
const DIST = `(6371 * ACOS(LEAST(1,
  COS(RADIANS(?)) * COS(RADIANS(latitude)) * COS(RADIANS(longitude) - RADIANS(?))
  + SIN(RADIANS(?)) * SIN(RADIANS(latitude)))))`;

// NEAREST shops to a location: /api/help/nearby-shops?lat=-0.30&lng=36.08
router.get('/nearby-shops', async (req, res) => {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'lat and lng are required' });
  try {
    const [rows] = await db.query(
      `SELECT id, name, phone, address, latitude, longitude, ${DIST} AS distance_km
       FROM shops ORDER BY distance_km LIMIT 10`,
      [lat, lng, lat]
    );
    res.json(rows.map(r => ({ ...r, distance_km: Math.round(r.distance_km * 10) / 10 })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// SEND a help request (driver). If shop_id is left out, the nearest shop is chosen.
router.post('/', async (req, res) => {
  if (req.user.role !== 'driver') return res.status(403).json({ error: 'Drivers only' });
  const { vehicle_id, latitude, longitude, issue } = req.body;
  let { shop_id } = req.body;
  if (latitude == null || longitude == null) {
    return res.status(400).json({ error: 'latitude and longitude are required' });
  }
  try {
    const [c] = await db.query('SELECT id FROM customers WHERE user_id = ?', [req.user.id]);
    if (!c.length) return res.status(403).json({ error: 'Driver profile not found' });

    if (vehicle_id) {
      const [v] = await db.query('SELECT id FROM vehicles WHERE id = ? AND customer_id = ?', [vehicle_id, c[0].id]);
      if (!v.length) return res.status(404).json({ error: 'Vehicle not found' });
    }
    if (!shop_id) {
      const [n] = await db.query(`SELECT id FROM shops ORDER BY ${DIST} LIMIT 1`, [latitude, longitude, latitude]);
      if (!n.length) return res.status(404).json({ error: 'No shops available' });
      shop_id = n[0].id;
    }
    const [result] = await db.query(
      `INSERT INTO help_requests (customer_id, vehicle_id, shop_id, latitude, longitude, issue)
       VALUES (?,?,?,?,?,?)`,
      [c[0].id, vehicle_id || null, shop_id, latitude, longitude, issue || null]
    );
    res.status(201).json({ message: 'Help request sent', request_id: result.insertId, shop_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// MY requests (driver), with the shop's name and phone
router.get('/mine', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT h.id, h.issue, h.status, h.created_at, s.name AS shop_name, s.phone AS shop_phone
       FROM help_requests h
       JOIN customers c ON c.id = h.customer_id
       JOIN shops s ON s.id = h.shop_id
       WHERE c.user_id = ? ORDER BY h.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// REQUESTS sent to my shop (mechanic)
router.get('/shop', async (req, res) => {
  if (req.user.role !== 'mechanic') return res.status(403).json({ error: 'Mechanics only' });
  try {
    const [shop] = await db.query('SELECT id FROM shops WHERE owner_user_id = ?', [req.user.id]);
    if (!shop.length) return res.status(400).json({ error: 'Create your shop profile first' });
    const [rows] = await db.query(
      `SELECT h.id, h.issue, h.status, h.latitude, h.longitude, h.created_at,
              c.full_name, c.phone, v.plate, v.make, v.model
       FROM help_requests h
       JOIN customers c ON c.id = h.customer_id
       LEFT JOIN vehicles v ON v.id = h.vehicle_id
       WHERE h.shop_id = ? ORDER BY h.created_at DESC`,
      [shop[0].id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// UPDATE a request's status (mechanic): accepted, completed or cancelled
router.patch('/:id', async (req, res) => {
  if (req.user.role !== 'mechanic') return res.status(403).json({ error: 'Mechanics only' });
  const { status } = req.body;
  if (!['accepted', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'status must be accepted, completed or cancelled' });
  }
  try {
    const [shop] = await db.query('SELECT id FROM shops WHERE owner_user_id = ?', [req.user.id]);
    if (!shop.length) return res.status(400).json({ error: 'Create your shop profile first' });
    const [result] = await db.query(
      'UPDATE help_requests SET status = ? WHERE id = ? AND shop_id = ?',
      [status, req.params.id, shop[0].id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Request not found' });
    res.json({ message: 'Status updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;