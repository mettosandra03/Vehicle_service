const express = require('express');
const db = require('../db');
const requireLogin = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

// Only accounts with the "mechanic" role may use anything in this file
router.use((req, res, next) => {
  if (req.user.role !== 'mechanic') return res.status(403).json({ error: 'Mechanics only' });
  next();
});

// Finds the shop owned by the logged-in mechanic
async function getShopId(userId) {
  const [rows] = await db.query('SELECT id FROM shops WHERE owner_user_id = ?', [userId]);
  return rows[0] ? rows[0].id : null;
}

// CREATE my shop profile (one shop per mechanic account)
router.post('/', async (req, res) => {
  const { name, phone, address, latitude, longitude } = req.body;
  if (!name || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'name, latitude and longitude are required' });
  }
  try {
    if (await getShopId(req.user.id)) {
      return res.status(409).json({ error: 'You already have a shop profile' });
    }
    const [result] = await db.query(
      'INSERT INTO shops (owner_user_id, name, phone, address, latitude, longitude) VALUES (?,?,?,?,?,?)',
      [req.user.id, name, phone || null, address || null, latitude, longitude]
    );
    res.status(201).json({ message: 'Shop created', shop_id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// VIEW my shop profile
router.get('/me', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM shops WHERE owner_user_id = ?', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'No shop profile yet' });
  res.json(rows[0]);
});

// SEARCH any customer by name, phone or plate (finds app users and walk-ins)
router.get('/customers/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Type something to search' });
  const like = `%${q}%`;
  const plateLike = `%${q.replace(/\s+/g, '').toUpperCase()}%`;
  try {
    const [rows] = await db.query(
      `SELECT c.id AS customer_id, c.full_name, c.phone,
              v.id AS vehicle_id, v.plate, v.make, v.model
       FROM customers c
       LEFT JOIN vehicles v ON v.customer_id = c.id
       WHERE c.full_name LIKE ? OR c.phone LIKE ? OR v.plate LIKE ?
       ORDER BY c.full_name LIMIT 50`,
      [like, like, plateLike]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// LIST my customers: everyone who has had at least one visit at my shop
router.get('/customers', async (req, res) => {
  try {
    const shopId = await getShopId(req.user.id);
    if (!shopId) return res.status(400).json({ error: 'Create your shop profile first' });
    const [rows] = await db.query(
      `SELECT c.id AS customer_id, c.full_name, c.phone,
              (c.user_id IS NOT NULL) AS has_app,
              COUNT(vi.id) AS visit_count, MAX(vi.visit_date) AS last_visit
       FROM visits vi
       JOIN vehicles v ON v.id = vi.vehicle_id
       JOIN customers c ON c.id = v.customer_id
       WHERE vi.shop_id = ?
       GROUP BY c.id
       ORDER BY last_visit DESC`,
      [shopId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// REGISTER a walk-in customer (no app needed). If the phone already exists, return that customer.
router.post('/customers', async (req, res) => {
  const { full_name, phone } = req.body;
  if (!full_name || !phone) return res.status(400).json({ error: 'full_name and phone are required' });
  try {
    const [existing] = await db.query('SELECT id FROM customers WHERE phone = ?', [phone]);
    if (existing.length) {
      return res.json({ message: 'Customer already exists', customer_id: existing[0].id });
    }
    const [result] = await db.query(
      'INSERT INTO customers (user_id, full_name, phone) VALUES (NULL, ?, ?)', [full_name, phone]
    );
    res.status(201).json({ message: 'Customer added', customer_id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ADD a vehicle to a customer
router.post('/customers/:id/vehicles', async (req, res) => {
  const { plate, make, model, year } = req.body;
  if (!plate) return res.status(400).json({ error: 'plate is required' });
  try {
    const [cust] = await db.query('SELECT id FROM customers WHERE id = ?', [req.params.id]);
    if (!cust.length) return res.status(404).json({ error: 'Customer not found' });
    const cleanPlate = plate.replace(/\s+/g, '').toUpperCase();
    const [result] = await db.query(
      'INSERT INTO vehicles (customer_id, plate, make, model, year) VALUES (?,?,?,?,?)',
      [req.params.id, cleanPlate, make || null, model || null, year || null]
    );
    res.status(201).json({ message: 'Vehicle added', vehicle_id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This plate is already registered' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// RECORD a visit, with the work done and parts changed (all saved together or not at all)
router.post('/visits', async (req, res) => {
  const { vehicle_id, visit_date, odometer_km, summary, next_service_km, next_service_date, items } = req.body;
  if (!vehicle_id || odometer_km == null) {
    return res.status(400).json({ error: 'vehicle_id and odometer_km are required' });
  }
  const conn = await db.getConnection();
  try {
    const shopId = await getShopId(req.user.id);
    if (!shopId) return res.status(400).json({ error: 'Create your shop profile first' });

    const [veh] = await conn.query('SELECT id FROM vehicles WHERE id = ?', [vehicle_id]);
    if (!veh.length) return res.status(404).json({ error: 'Vehicle not found' });

    await conn.beginTransaction();
    const date = visit_date || new Date().toISOString().slice(0, 10);
    const [result] = await conn.query(
      `INSERT INTO visits (vehicle_id, shop_id, visit_date, odometer_km, summary, next_service_km, next_service_date)
       VALUES (?,?,?,?,?,?,?)`,
      [vehicle_id, shopId, date, odometer_km, summary || null, next_service_km || null, next_service_date || null]
    );
    const visitId = result.insertId;

    for (const item of items || []) {
            await conn.query(
        'INSERT INTO visit_items (visit_id, item_type, problem_id, description, quantity, cost) VALUES (?,?,?,?,?,?)',
        [visitId, item.item_type, item.problem_id || null, item.description || '', item.quantity || 1, item.cost || null]
      );
    }
    await conn.commit();
    res.status(201).json({ message: 'Visit recorded', visit_id: visitId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

// HISTORY: this shop's detailed records for one customer
router.get('/customers/:id/visits', async (req, res) => {
  try {
    const shopId = await getShopId(req.user.id);
    if (!shopId) return res.status(400).json({ error: 'Create your shop profile first' });

    const [visits] = await db.query(
      `SELECT vi.id, vi.visit_date, vi.odometer_km, vi.summary,
              vi.next_service_km, vi.next_service_date, v.plate
       FROM visits vi
       JOIN vehicles v ON v.id = vi.vehicle_id
       WHERE v.customer_id = ? AND vi.shop_id = ?
       ORDER BY vi.visit_date DESC, vi.id DESC`,
      [req.params.id, shopId]
    );
    if (!visits.length) return res.json([]);

    const [items] = await db.query(
            `SELECT vi.visit_id, vi.item_type, p.problem, vi.description, vi.quantity, vi.cost
       FROM visit_items vi LEFT JOIN problem_catalog p ON p.id = vi.problem_id
       WHERE vi.visit_id IN (?)`,
      [visits.map(v => v.id)]
    );
    res.json(visits.map(v => ({ ...v, items: items.filter(i => i.visit_id === v.id) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});
// SUGGESTED PROBLEMS for a vehicle's make, most-used first this will help those who aren't conversant with tech.
// Call: /api/shop/problems?vehicle_id=1   (or ?make=Toyota)
router.get('/problems', async (req, res) => {
  try {
    let make = (req.query.make || '').trim();
    if (req.query.vehicle_id) {
      const [v] = await db.query('SELECT make FROM vehicles WHERE id = ?', [req.query.vehicle_id]);
      if (v[0] && v[0].make) make = v[0].make;
    }
    const [rows] = await db.query(
      `SELECT p.id, p.category, p.problem, p.typical_fix, p.icon,
         (SELECT COUNT(*) FROM visit_items vi
            JOIN visits vs ON vs.id = vi.visit_id
            JOIN vehicles ve ON ve.id = vs.vehicle_id
          WHERE vi.problem_id = p.id AND LOWER(ve.make) = LOWER(?)) AS times_seen
       FROM problem_catalog p
       WHERE p.make IS NULL OR LOWER(p.make) = LOWER(?)
       ORDER BY times_seen DESC, (p.make IS NULL), p.problem`,
      [make, make]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});
module.exports = router;