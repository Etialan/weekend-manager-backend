// backend/server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB error:', err));

// Guest Schema
const guestSchema = new mongoose.Schema({
  name: String,
  attending: Boolean,
  adults: Number,
  boys: Number,
  girls: Number,
  nightSatSun: Boolean,
  nightSunMon: Boolean,
  mealSatMid: Boolean,
  mealSatEvn: Boolean,
  mealSunMid: Boolean,
  mealSunEvn: Boolean,
  mealMonMid: Boolean,
  roomAdultsSatSun: Number || null,
  roomChildrenSatSun: Object,
  roomAdultsSunMon: Number || null,
  roomChildrenSunMon: Object,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Guest = mongoose.model('Guest', guestSchema);

// Auth Middleware — tout utilisateur connecté (admin ou viewer)
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Admin Middleware — uniquement le rôle admin
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Accès administrateur requis' });
  }
  next();
};

// Routes

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || process.env.FAMILY_PASSWORD;
    const viewPassword = process.env.VIEW_PASSWORD;

    let role = null;
    if (password === adminPassword) role = 'admin';
    else if (viewPassword && password === viewPassword) role = 'viewer';

    if (role) {
      const token = jwt.sign({ family: true, role }, process.env.JWT_SECRET, { expiresIn: '30d' });
      res.json({ token, role, success: true });
    } else {
      res.status(401).json({ error: 'Mot de passe incorrect', success: false });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all guests — admin + viewer
app.get('/api/guests', authMiddleware, async (req, res) => {
  try {
    const guests = await Guest.find().sort({ createdAt: -1 });
    res.json(guests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single guest — admin + viewer
app.get('/api/guests/:id', authMiddleware, async (req, res) => {
  try {
    const guest = await Guest.findById(req.params.id);
    res.json(guest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create guest — admin uniquement
app.post('/api/guests', authMiddleware, adminOnly, async (req, res) => {
  try {
    const guest = await Guest.create(req.body);
    res.json(guest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update guest — admin uniquement
app.put('/api/guests/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    req.body.updatedAt = new Date();
    const guest = await Guest.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(guest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete guest — admin uniquement
app.delete('/api/guests/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await Guest.findByIdAndDelete(req.params.id);
    res.json({ ok: true, message: 'Guest deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk import — admin uniquement
app.post('/api/guests/bulk/import', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { guests } = req.body;
    const created = await Guest.insertMany(guests);
    res.json({ count: created.length, guests: created });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export all guests — admin + viewer
app.get('/api/export', authMiddleware, async (req, res) => {
  try {
    const guests = await Guest.find();
    res.json(guests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
