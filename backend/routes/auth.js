const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const requireLogin = require('../middleware/auth');

const router = express.Router();

// REGISTER: creates the user. Drivers also get a customer record,
// linked to an existing walk-in record if the phone number matches.
router.post('/register', async (req, res) => {
  const { full_name, phone, email, password, role } = req.body;
  if (!full_name || !phone || !password || !['driver', 'mechanic'].includes(role)) {
    return res.status(400).json({ error: 'full_name, phone, password and role are required' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const hash = await bcrypt.hash(password, 10);

    const [result] = await conn.query(
      'INSERT INTO users (full_name, phone, email, password_hash, role) VALUES (?,?,?,?,?)',
      [full_name, phone, email || null, hash, role]
    );
    const userId = result.insertId;

    if (role === 'driver') {
      const [walkIn] = await conn.query(
        'SELECT id FROM customers WHERE phone = ? AND user_id IS NULL', [phone]
      );
      if (walkIn.length) {
        await conn.query('UPDATE customers SET user_id = ? WHERE id = ?', [userId, walkIn[0].id]);
      } else {
        await conn.query(
          'INSERT INTO customers (user_id, full_name, phone) VALUES (?,?,?)',
          [userId, full_name, phone]
        );
      }
    }

    await conn.commit();
    res.status(201).json({ message: 'Registered successfully', user_id: userId });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Phone or email already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

// LOGIN: checks the password and returns a token
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'phone and password are required' });
  }
  try {
    const [rows] = await db.query(
      'SELECT id, full_name, password_hash, role FROM users WHERE phone = ?', [phone]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid phone or password' });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, full_name: user.full_name, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ME: a protected route to prove the token works
router.get('/me', requireLogin, async (req, res) => {
  const [rows] = await db.query(
    'SELECT id, full_name, phone, email, role FROM users WHERE id = ?', [req.user.id]
  );
  res.json(rows[0]);
});

module.exports = router;