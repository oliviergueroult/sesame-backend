const express = require('express');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const axios   = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET       = process.env.JWT_SECRET       || 'change-me';
const USER_EMAIL       = process.env.USER_EMAIL       || 'admin@sesame.app';
const USER_PASSWORD    = process.env.USER_PASSWORD    || 'changeme';
const TAHOMA_EMAIL     = process.env.TAHOMA_EMAIL;
const TAHOMA_PASSWORD  = process.env.TAHOMA_PASSWORD;

// ── Client TaHoma ────────────────────────────────────────────────────────────
const TAHOMA_SERVERS = [
  'https://ha101-1.overkiz.com/enduser-mobile-web/enduserAPI',
  'https://ha201-1.overkiz.com/enduser-mobile-web/enduserAPI',
  'https://ha401-1.overkiz.com/enduser-mobile-web/enduserAPI',
  'https://www.tahomalink.com/enduser-mobile-web/enduserAPI',
];

class TahomaClient {
  constructor(email, password) {
    this.email     = email;
    this.password  = password;
    this.base      = null;
    this.sessionId = null;
    this.devices   = {}; // { portail: deviceURL, garage: deviceURL }
  }

  async login() {
    for (const base of TAHOMA_SERVERS) {
      try {
        const res = await axios.post(`${base}/login`,
          `userId=${encodeURIComponent(this.email)}&userPassword=${encodeURIComponent(this.password)}`,
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Sesame/1.0 (iPhone; iOS 17)' }, timeout: 10000 }
        );
        const match = JSON.stringify(res.data).match(/JSESSIONID=([^;\"]+)/);
        const cookie = res.headers['set-cookie']?.join('').match(/JSESSIONID=([^;]+)/);
        this.sessionId = (match?.[1] || cookie?.[1]);
        if (this.sessionId) { this.base = base; console.log(`[TaHoma] ✓ ${base}`); return true; }
      } catch (e) {
        console.log(`[TaHoma] ✗ ${base} — ${e.response?.status || e.code}`);
      }
    }
    return false;
  }

  headers() {
    return { Cookie: `JSESSIONID=${this.sessionId}` };
  }

  async call(method, path, data) {
    try {
      const res = await axios({ method, url: `${this.base}${path}`, data, headers: this.headers(), timeout: 10000 });
      return res.data;
    } catch (e) {
      if (e.response?.status === 401) { await this.login(); return this.call(method, path, data); }
      throw e;
    }
  }

  async discoverDevices() {
    const setup = await this.call('GET', '/setup');
    const devices = setup.devices || [];
    for (const d of devices) {
      const name = (d.label || '').toLowerCase();
      if (/gate|portail|barrier/i.test(d.label) && !this.devices.portail)
        this.devices.portail = d.deviceURL;
      if (/garage/i.test(d.label) && !this.devices.garage)
        this.devices.garage = d.deviceURL;
    }
    console.log('[TaHoma] Appareils :', this.devices);
  }

  async open(door) {
    const deviceURL = this.devices[door];
    if (!deviceURL) throw new Error(`Appareil "${door}" introuvable`);
    return this.call('POST', '/exec/apply', {
      label: `Sésame — ouvrir ${door}`,
      actions: [{ deviceURL, commands: [{ name: 'open', parameters: [] }] }],
    });
  }
}

const tahoma = TAHOMA_EMAIL
  ? new TahomaClient(TAHOMA_EMAIL, TAHOMA_PASSWORD)
  : null;

// ── Auth middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Token manquant' });
  try { req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalide' }); }
}

// ── POST /auth/login ─────────────────────────────────────────────────────────
app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (email !== USER_EMAIL || password !== USER_PASSWORD)
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '365d' });
  res.json({ token });
});

// ── POST /open ───────────────────────────────────────────────────────────────
app.post('/open', auth, async (req, res) => {
  const { door } = req.body;
  if (!door) return res.status(400).json({ error: 'Champ door manquant' });
  if (!tahoma) return res.status(503).json({ error: 'TaHoma non configuré' });
  try {
    await tahoma.open(door);
    console.log(`[OPEN] ${door} ✓`);
    res.json({ ok: true });
  } catch (e) {
    console.error(`[OPEN] ${door} ✗`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', devices: tahoma?.devices || {} }));

// ── Démarrage ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Sésame backend démarré sur le port ${PORT}`);
  if (tahoma) {
    const ok = await tahoma.login();
    if (ok) await tahoma.discoverDevices();
    else console.error('[TaHoma] Connexion impossible');
  }
});
