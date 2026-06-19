const express = require('express');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const cors    = require('cors');
const { pool, init } = require('./db');
const TahomaClient   = require('./systems/tahoma');

const app        = express();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

app.use(cors());
app.use(express.json());

// ── Auth middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Token manquant' });
  try { req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalide' }); }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getUserSystem(userId) {
  const { rows } = await pool.query('SELECT * FROM user_systems WHERE user_id=$1', [userId]);
  return rows[0] || null;
}

async function getClient(userId) {
  const sys = await getUserSystem(userId);
  if (!sys) throw new Error('Système non configuré');
  if (sys.system_type === 'tahoma') {
    const { email, password } = sys.credentials;
    const client = new TahomaClient(email, password);
    await client.login();
    return { client, devices: sys.devices };
  }
  throw new Error(`Système "${sys.system_type}" non supporté`);
}

// ── POST /auth/register ──────────────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
      [email.trim().toLowerCase(), hash]
    );
    const token = jwt.sign({ id: rows[0].id, email: rows[0].email }, JWT_SECRET, { expiresIn: '365d' });
    res.json({ token, user: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email déjà utilisé' });
    res.status(500).json({ error: e.message });
  }
});

// ── POST /auth/login ─────────────────────────────────────────────────────────
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email?.trim().toLowerCase()]);
  if (!rows[0]) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  const ok = await bcrypt.compare(password, rows[0].password);
  if (!ok)  return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  const token = jwt.sign({ id: rows[0].id, email: rows[0].email }, JWT_SECRET, { expiresIn: '365d' });
  res.json({ token });
});

// ── GET /config ──────────────────────────────────────────────────────────────
app.get('/config', auth, async (req, res) => {
  const sys = await getUserSystem(req.user.id);
  if (!sys) return res.json({ configured: false });
  res.json({ configured: true, system_type: sys.system_type, devices: sys.devices });
});

// ── POST /config ─────────────────────────────────────────────────────────────
app.post('/config', auth, async (req, res) => {
  const { system_type, credentials } = req.body;
  if (!system_type || !credentials) return res.status(400).json({ error: 'Données manquantes' });

  // Test de connexion + découverte des appareils
  let devices = {};
  if (system_type === 'tahoma') {
    const client = new TahomaClient(credentials.email, credentials.password);
    const ok = await client.login();
    if (!ok) return res.status(400).json({ error: 'Connexion TaHoma impossible — vérifiez vos identifiants' });
    devices = await client.discoverDevices();
  }

  await pool.query(`
    INSERT INTO user_systems (user_id, system_type, credentials, devices)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id) DO UPDATE SET system_type=$2, credentials=$3, devices=$4, updated_at=NOW()
  `, [req.user.id, system_type, JSON.stringify(credentials), JSON.stringify(devices)]);

  res.json({ ok: true, devices });
});

// ── GET /status ──────────────────────────────────────────────────────────────
app.get('/status', auth, async (req, res) => {
  try {
    const { client, devices } = await getClient(req.user.id);
    const status = await client.getStatus(devices);
    res.json(status);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /open ───────────────────────────────────────────────────────────────
app.post('/open', auth, async (req, res) => {
  const { door, action = 'open' } = req.body;
  if (!door) return res.status(400).json({ error: 'Champ door manquant' });
  try {
    const { client, devices } = await getClient(req.user.id);
    const deviceURL = devices[door];
    if (!deviceURL) return res.status(404).json({ error: `"${door}" introuvable` });
    const cmd = action === 'close' ? 'close' : action === 'stop' ? 'stop' : 'open';
    await client.exec(deviceURL, cmd);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /alarm ──────────────────────────────────────────────────────────────
app.post('/alarm', auth, async (req, res) => {
  const { action } = req.body;
  try {
    const { client, devices } = await getClient(req.user.id);
    if (!devices.alarm) return res.status(404).json({ error: 'Alarme introuvable' });
    await client.exec(devices.alarm, action === 'arm' ? 'arm' : 'disarm');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── Démarrage ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Sésame backend démarré sur le port ${PORT}`);
  await init();
});
