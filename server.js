// backend/server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB error:', err));

// ─── Schemas existants ────────────────────────────────────────────────────────

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

const contentSchema = new mongoose.Schema({
  welcomeTitle: { type: String, default: '' },
  welcomeText:  { type: String, default: '' },
  welcomeImages: { type: [String], default: [] },
  planning: { type: Array, default: [] },
  updatedAt: { type: Date, default: Date.now }
});
const Content = mongoose.model('Content', contentSchema);

// ─── Schemas GPS Hunt ─────────────────────────────────────────────────────────

const huntSchema = new mongoose.Schema({
  name: String,
  status: { type: String, default: 'idle' }, // idle | active | finished
  createdAt: { type: Date, default: Date.now },
  startedAt: Date,
  finishedAt: Date,
});
const Hunt = mongoose.model('Hunt', huntSchema);

const stageSchema = new mongoose.Schema({
  huntId: mongoose.Schema.Types.ObjectId,
  order: Number,
  label: String,
  gpsLat: Number,
  gpsLng: Number,
  radiusMeters: { type: Number, default: 15 },
  activityInstructions: String,
  question: String,
  answerExpected: String,
  clueToReach: String,  // indice pour TROUVER cette étape (affiché à l'équipe avant d'y arriver)
});
const Stage = mongoose.model('Stage', stageSchema);

const teamSchema = new mongoose.Schema({
  huntId: mongoose.Schema.Types.ObjectId,
  name: String,
  accessCode: String,
  stageOrder: [mongoose.Schema.Types.ObjectId],
  currentStageIndex: { type: Number, default: 0 },
  status: { type: String, default: 'playing' }, // playing | finished
  startedAt: Date,
  finishedAt: Date,
});
const Team = mongoose.model('Team', teamSchema);

const stageCompletionSchema = new mongoose.Schema({
  teamId: mongoose.Schema.Types.ObjectId,
  stageId: mongoose.Schema.Types.ObjectId,
  arrivedAt: Date,
  answeredAt: Date,
  attempts: { type: Number, default: 0 },
});
const StageCompletion = mongoose.model('StageCompletion', stageCompletionSchema);

const mediaSchema = new mongoose.Schema({
  huntId: mongoose.Schema.Types.ObjectId,
  teamId: mongoose.Schema.Types.ObjectId,
  stageId: mongoose.Schema.Types.ObjectId,
  teamName: String,
  stageLabel: String,
  url: String,           // Cloudinary secure_url
  publicId: String,      // Cloudinary public_id
  resourceType: String,  // 'image' | 'video'
  caption: String,
  createdAt: { type: Date, default: Date.now },
});
const Media = mongoose.model('Media', mediaSchema);

// ─── Middleware Auth ──────────────────────────────────────────────────────────

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

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Accès administrateur requis' });
  }
  next();
};

const teamMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'team') return res.status(403).json({ error: 'Token équipe requis' });
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeAnswer(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

async function generateUniqueAccessCode() {
  let code;
  let exists = true;
  while (exists) {
    code = String(Math.floor(1000 + Math.random() * 9000));
    exists = await Team.findOne({ accessCode: code });
  }
  return code;
}

// ─── Routes Login famille ─────────────────────────────────────────────────────

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

// ─── Routes Invités ───────────────────────────────────────────────────────────

app.get('/api/guests', authMiddleware, async (req, res) => {
  try {
    const guests = await Guest.find().sort({ createdAt: -1 });
    res.json(guests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/guests/:id', authMiddleware, async (req, res) => {
  try {
    const guest = await Guest.findById(req.params.id);
    res.json(guest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/guests', authMiddleware, adminOnly, async (req, res) => {
  try {
    const guest = await Guest.create(req.body);
    res.json(guest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/guests/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    req.body.updatedAt = new Date();
    const guest = await Guest.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(guest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/guests/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await Guest.findByIdAndDelete(req.params.id);
    res.json({ ok: true, message: 'Guest deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/guests/bulk/import', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { guests } = req.body;
    const created = await Guest.insertMany(guests);
    res.json({ count: created.length, guests: created });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/export', authMiddleware, async (req, res) => {
  try {
    const guests = await Guest.find();
    res.json(guests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Routes Contenu ───────────────────────────────────────────────────────────

app.get('/api/content', authMiddleware, async (req, res) => {
  try {
    let content = await Content.findOne();
    if (!content) content = await Content.create({});
    res.json(content);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/content', authMiddleware, adminOnly, async (req, res) => {
  try {
    req.body.updatedAt = new Date();
    let content = await Content.findOne();
    if (!content) {
      content = await Content.create(req.body);
    } else {
      content = await Content.findByIdAndUpdate(content._id, req.body, { new: true });
    }
    res.json(content);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Routes GPS Hunt — Équipe (AVANT les routes /:huntId) ────────────────────

// Login équipe via code à 4 chiffres
app.post('/api/hunt/team/login', async (req, res) => {
  try {
    const { accessCode } = req.body;
    const team = await Team.findOne({ accessCode: String(accessCode).trim() });
    if (!team) return res.status(401).json({ error: 'Code invalide' });
    const token = jwt.sign(
      { role: 'team', teamId: team._id.toString(), huntId: team.huntId.toString() },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, team: { name: team.name, huntId: team.huntId } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// État actuel de l'équipe
app.get('/api/hunt/team/me', teamMiddleware, async (req, res) => {
  try {
    const team = await Team.findById(req.user.teamId);
    if (!team) return res.status(404).json({ error: 'Équipe non trouvée' });
    const hunt = await Hunt.findById(team.huntId);

    let currentStage = null;
    if (team.status === 'playing' && team.currentStageIndex < team.stageOrder.length) {
      currentStage = await Stage.findById(team.stageOrder[team.currentStageIndex]);
    }

    // L'indice à afficher = clueToReach de l'étape COURANTE (comment y arriver)
    const currentClue = currentStage ? currentStage.clueToReach : null;

    let hasArrived = false;
    let activityInstructions = null;
    let question = null;
    if (currentStage) {
      const completion = await StageCompletion.findOne({
        teamId: team._id,
        stageId: currentStage._id,
        arrivedAt: { $exists: true },
      });
      if (completion) {
        hasArrived = true;
        activityInstructions = currentStage.activityInstructions;
        question = currentStage.question;
      }
    }

    res.json({
      team: {
        _id: team._id,
        name: team.name,
        status: team.status,
        currentStageIndex: team.currentStageIndex,
        totalStages: team.stageOrder.length,
      },
      hunt: { status: hunt ? hunt.status : 'idle', name: hunt ? hunt.name : '' },
      currentStage: currentStage ? {
        _id: currentStage._id,
        label: currentStage.label,
        gpsLat: currentStage.gpsLat,
        gpsLng: currentStage.gpsLng,
        radiusMeters: currentStage.radiusMeters,
        hasArrived,
        activityInstructions,
        question,
      } : null,
      currentClue,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Signaler l'arrivée GPS
app.post('/api/hunt/team/arrive', teamMiddleware, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const team = await Team.findById(req.user.teamId);
    if (!team || team.status === 'finished') return res.status(400).json({ error: 'Équipe non active' });

    const stageId = team.stageOrder[team.currentStageIndex];
    if (!stageId) return res.status(400).json({ error: "Plus d'étape à faire" });

    const stage = await Stage.findById(stageId);
    if (!stage) return res.status(404).json({ error: 'Étape non trouvée' });

    const dist = getDistanceMeters(lat, lng, stage.gpsLat, stage.gpsLng);
    if (dist > stage.radiusMeters) {
      return res.status(400).json({
        error: 'Trop loin (' + Math.round(dist) + 'm, rayon: ' + stage.radiusMeters + 'm)',
        distance: Math.round(dist),
      });
    }

    let completion = await StageCompletion.findOne({ teamId: team._id, stageId: stage._id });
    if (!completion) {
      completion = await StageCompletion.create({
        teamId: team._id,
        stageId: stage._id,
        arrivedAt: new Date(),
        attempts: 0,
      });
    }

    res.json({
      activityInstructions: stage.activityInstructions,
      question: stage.question,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Soumettre une réponse
app.post('/api/hunt/team/answer', teamMiddleware, async (req, res) => {
  try {
    const { answer } = req.body;
    const team = await Team.findById(req.user.teamId);
    if (!team || team.status === 'finished') return res.status(400).json({ error: 'Équipe non active' });

    const stageId = team.stageOrder[team.currentStageIndex];
    const stage = await Stage.findById(stageId);
    if (!stage) return res.status(404).json({ error: 'Étape non trouvée' });

    const completion = await StageCompletion.findOne({ teamId: team._id, stageId: stage._id });
    if (!completion) return res.status(400).json({ error: 'GPS non validé pour cette étape' });

    completion.attempts += 1;
    const correct = normalizeAnswer(answer) === normalizeAnswer(stage.answerExpected);

    if (correct) {
      completion.answeredAt = new Date();
      await completion.save();
      const newIndex = team.currentStageIndex + 1;
      const isFinished = newIndex >= team.stageOrder.length;
      await Team.findByIdAndUpdate(team._id, {
        currentStageIndex: newIndex,
        ...(isFinished ? { status: 'finished', finishedAt: new Date() } : {}),
      });
      // Renvoyer le clueToReach de la prochaine étape réelle de cette équipe
      let nextClue = null;
      if (!isFinished) {
        const nextStage = await Stage.findById(team.stageOrder[newIndex]);
        nextClue = nextStage ? nextStage.clueToReach : null;
      }
      res.json({ correct: true, nextClue, finished: isFinished });
    } else {
      await completion.save();
      res.json({ correct: false, attempts: completion.attempts });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Routes GPS Hunt — Admin ──────────────────────────────────────────────────

app.get('/api/hunt', authMiddleware, adminOnly, async (req, res) => {
  try {
    const hunts = await Hunt.find().sort({ createdAt: -1 });
    res.json(hunts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/hunt', authMiddleware, adminOnly, async (req, res) => {
  try {
    const hunt = await Hunt.create({ name: req.body.name });
    res.json(hunt);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/hunt/:huntId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const hunt = await Hunt.findById(req.params.huntId);
    res.json(hunt);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/hunt/:huntId/start', authMiddleware, adminOnly, async (req, res) => {
  try {
    const hunt = await Hunt.findByIdAndUpdate(
      req.params.huntId,
      { status: 'active', startedAt: new Date() },
      { new: true }
    );
    await Team.updateMany({ huntId: hunt._id, startedAt: null }, { startedAt: new Date() });
    res.json(hunt);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/hunt/:huntId/reset', authMiddleware, adminOnly, async (req, res) => {
  try {
    await Hunt.findByIdAndUpdate(req.params.huntId, { status: 'idle', startedAt: null, finishedAt: null });
    const teams = await Team.find({ huntId: req.params.huntId });
    for (const team of teams) {
      await StageCompletion.deleteMany({ teamId: team._id });
      await Team.findByIdAndUpdate(team._id, {
        currentStageIndex: 0,
        status: 'playing',
        startedAt: null,
        finishedAt: null,
      });
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/hunt/:huntId/finish', authMiddleware, adminOnly, async (req, res) => {
  try {
    const hunt = await Hunt.findByIdAndUpdate(
      req.params.huntId,
      { status: 'finished', finishedAt: new Date() },
      { new: true }
    );
    res.json(hunt);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/hunt/:huntId/stages', authMiddleware, adminOnly, async (req, res) => {
  try {
    const stages = await Stage.find({ huntId: req.params.huntId }).sort({ order: 1 });
    res.json(stages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/hunt/:huntId/stages', authMiddleware, adminOnly, async (req, res) => {
  try {
    const stage = await Stage.create({ ...req.body, huntId: req.params.huntId });
    res.json(stage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/hunt/:huntId/stages/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const stage = await Stage.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(stage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/hunt/:huntId/stages/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await Stage.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/hunt/:huntId/teams', authMiddleware, adminOnly, async (req, res) => {
  try {
    const teams = await Team.find({ huntId: req.params.huntId });
    res.json(teams);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/hunt/:huntId/teams', authMiddleware, adminOnly, async (req, res) => {
  try {
    const stages = await Stage.find({ huntId: req.params.huntId }).sort({ order: 1 });
    const stageOrder = shuffle(stages.map(s => s._id));
    const accessCode = await generateUniqueAccessCode();
    const team = await Team.create({
      huntId: req.params.huntId,
      name: req.body.name,
      accessCode,
      stageOrder,
      currentStageIndex: 0,
      status: 'playing',
    });
    res.json(team);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/hunt/:huntId/teams/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await Team.findByIdAndDelete(req.params.id);
    await StageCompletion.deleteMany({ teamId: req.params.id });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/hunt/:huntId/scoreboard', authMiddleware, adminOnly, async (req, res) => {
  try {
    const teams = await Team.find({ huntId: req.params.huntId });
    const stages = await Stage.find({ huntId: req.params.huntId }).sort({ order: 1 });
    const result = [];
    for (const team of teams) {
      const completions = await StageCompletion.find({ teamId: team._id });
      const totalMs = team.finishedAt && team.startedAt
        ? new Date(team.finishedAt) - new Date(team.startedAt)
        : null;
      result.push({
        teamId: team._id,
        name: team.name,
        status: team.status,
        stagesCompleted: completions.filter(c => c.answeredAt).length,
        totalTime: totalMs,
        finishedAt: team.finishedAt,
        startedAt: team.startedAt,
        completions: completions.map(c => ({
          stageId: c.stageId,
          arrivedAt: c.arrivedAt,
          answeredAt: c.answeredAt,
          attempts: c.attempts,
          time: c.arrivedAt && c.answeredAt
            ? new Date(c.answeredAt) - new Date(c.arrivedAt)
            : null,
        })),
      });
    }
    result.sort((a, b) => {
      if (a.status === 'finished' && b.status !== 'finished') return -1;
      if (b.status === 'finished' && a.status !== 'finished') return 1;
      if (a.status === 'finished' && b.status === 'finished') {
        return new Date(a.finishedAt) - new Date(b.finishedAt);
      }
      return b.stagesCompleted - a.stagesCompleted;
    });
    res.json({ teams: result, stages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Routes Media ─────────────────────────────────────────────────────────────

// Équipe : enregistrer un média uploadé sur Cloudinary
app.post('/api/hunt/team/media', teamMiddleware, async (req, res) => {
  try {
    const { url, publicId, resourceType, caption, stageId, stageLabel } = req.body;
    if (!url) return res.status(400).json({ error: 'URL manquante' });
    const team = await Team.findById(req.user.teamId);
    if (!team) return res.status(404).json({ error: 'Équipe non trouvée' });
    const media = await Media.create({
      huntId: team.huntId,
      teamId: team._id,
      teamName: team.name,
      stageId: stageId || null,
      stageLabel: stageLabel || null,
      url,
      publicId,
      resourceType: resourceType || 'image',
      caption: caption || '',
    });
    res.json(media);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin : lister tous les médias d'une partie
app.get('/api/hunt/:huntId/media', authMiddleware, adminOnly, async (req, res) => {
  try {
    const media = await Media.find({ huntId: req.params.huntId }).sort({ createdAt: -1 });
    res.json(media);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin : supprimer un média
app.delete('/api/hunt/:huntId/media/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await Media.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
