const express = require('express');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const cors    = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET    = process.env.JWT_SECRET    || 'change-me-in-production';
const DEVICE_TOKEN  = process.env.DEVICE_TOKEN  || 'esp32-secret-token';
const USER_EMAIL    = process.env.USER_EMAIL    || 'admin@sesame.app';
const USER_PASSWORD = process.env.USER_PASSWORD || 'changeme';

// File d'attente des commandes (en mémoire — une commande à la fois)
let pendingCommand = null;

// ── Auth middleware ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Token manquant' });
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
}

// ── POST /auth/login ─────────────────────────────────────────────────────────
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (email !== USER_EMAIL || password !== USER_PASSWORD) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '365d' });
  res.json({ token });
});

// ── POST /open ───────────────────────────────────────────────────────────────
// L'app envoie une commande d'ouverture
app.post('/open', authMiddleware, (req, res) => {
  const { door } = req.body; // 'portail' | 'garage'
  if (!door) return res.status(400).json({ error: 'Champ door manquant' });

  pendingCommand = { door, ts: Date.now() };
  console.log(`[OPEN] Commande reçue : ${door}`);
  res.json({ ok: true });
});

// ── GET /pending ─────────────────────────────────────────────────────────────
// L'ESP32 poll cet endpoint toutes les 3s
app.get('/pending', (req, res) => {
  const token = req.headers['x-device-token'];
  if (token !== DEVICE_TOKEN) return res.status(401).json({ error: 'Non autorisé' });

  if (!pendingCommand) return res.json({ command: null });

  // Expire après 30s pour éviter les doublons
  if (Date.now() - pendingCommand.ts > 30000) {
    pendingCommand = null;
    return res.json({ command: null });
  }

  const cmd = pendingCommand;
  pendingCommand = null; // consommée
  res.json({ command: cmd.door });
});

// ── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sésame backend démarré sur le port ${PORT}`));
