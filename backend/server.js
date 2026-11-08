require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());          // lets the app and dashboard call this server
app.use(express.json());  // lets the server read JSON sent to it

app.get('/', (req, res) => res.json({ message: 'Vehicle Service API is running' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/lights', require('./routes/lights'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));