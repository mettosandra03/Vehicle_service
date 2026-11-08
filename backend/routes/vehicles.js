const express = require('express');
const db = require('../db');
const requireLogin = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin); // every route in this file needs a login token

// Finds the customer record that belongs to the logged-in driver
async function getCustomerId(userId) {
  const [rows] = await db.query('SELECT id FROM customers WHERE user_id = ?', [userId]);
  return rows[0] ? rows[0].id : null;
}

// ADD a vehicle
router.post('/', async (req, res) => {
  const { plate, make, model, year } = req.body;
  if (!plate) return res.status(400).json({ error: 'plate is required' });

  try {
    const customerId = await getCustomerId(req.user.id);
    if (!customerId) return res.status(403).json({ error: 'Only drivers can add vehicles' });

    const cleanPlate = plate.replace(/\s+/g, '').toUpperCase(); // "kdb 123a" -> "KDB123A"
    const [result] = await db.query(
      'INSERT INTO vehicles (customer_id, plate, make, model, year) VALUES (?,?,?,?,?)',
      [customerId, cleanPlate, make || null, model || null, year || null]
    );
    res.status(201).json({ message: 'Vehicle added', vehicle_id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'This plate is already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// LIST my vehicles, each with its latest visit and next service due
router.get('/', async (req, res) => {
  try {
    const customerId = await getCustomerId(req.user.id);
    if (!customerId) return res.status(403).json({ error: 'Only drivers have vehicles' });

    const [rows] = await db.query(
      `SELECT v.id, v.plate, v.make, v.model, v.year,
              lv.visit_date AS last_service_date,
              lv.odometer_km AS last_odometer_km,
              lv.next_service_km, lv.next_service_date
       FROM vehicles v
       LEFT JOIN visits lv ON lv.id = (
         SELECT id FROM visits WHERE vehicle_id = v.id
         ORDER BY visit_date DESC, id DESC LIMIT 1
       )
       WHERE v.customer_id = ?`,
      [customerId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;