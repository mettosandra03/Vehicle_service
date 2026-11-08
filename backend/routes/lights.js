const express = require('express');
const db = require('../db');

const router = express.Router();

// All warning lights, optionally filtered: /api/lights?severity=critical
router.get('/', async (req, res) => {
  try {
    const { severity } = req.query;
    const [rows] = severity
      ? await db.query('SELECT * FROM warning_lights WHERE severity = ? ORDER BY name', [severity])
      : await db.query('SELECT * FROM warning_lights ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;