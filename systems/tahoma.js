const axios = require('axios');

const SERVERS = [
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
  }

  async login() {
    for (const base of SERVERS) {
      try {
        const res = await axios.post(`${base}/login`,
          `userId=${encodeURIComponent(this.email)}&userPassword=${encodeURIComponent(this.password)}`,
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Sesame/1.0' }, timeout: 10000 }
        );
        const cookie = res.headers['set-cookie']?.join('').match(/JSESSIONID=([^;]+)/);
        if (cookie?.[1]) { this.base = base; this.sessionId = cookie[1]; return true; }
      } catch {}
    }
    return false;
  }

  headers() { return { Cookie: `JSESSIONID=${this.sessionId}` }; }

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
    const setup   = await this.call('GET', '/setup');
    const devices = {};
    const labels  = (setup.devices || []).map(d => d.label);
    console.log('[TaHoma] devices found:', labels);
    for (const d of (setup.devices || [])) {
      if (/gate|portail|barrier|entr[ée]e|porte.ext/i.test(d.label) && !devices.portail) devices.portail = d.deviceURL;
      if (/garage/i.test(d.label)                                   && !devices.garage)  devices.garage  = d.deviceURL;
      if (/alarm|alarme|sir[eè]ne/i.test(d.label)                   && !devices.alarm)   devices.alarm   = d.deviceURL;
    }
    console.log('[TaHoma] matched:', devices);
    return devices;
  }

  async getStatus(devices) {
    const entries = Object.entries(devices).filter(([, url]) => url);
    const results = await Promise.all(entries.map(async ([name, deviceURL]) => {
      try {
        const states = await this.call('GET', `/setup/devices/${encodeURIComponent(deviceURL)}/states`);
        const map = {};
        (Array.isArray(states) ? states : []).forEach(s => { map[s.name] = s.value; });
        const open     = map['core:OpenClosedState'];
        const moving   = map['core:MovingState'];
        const isMoving = moving === true || moving === 'true' || moving === 1;
        return [name, isMoving ? 'moving' : open === 'open' ? 'open' : 'closed'];
      } catch {
        return [name, null]; // état inconnu si l'appel échoue pour cet appareil
      }
    }));
    const result = {};
    results.forEach(([name, state]) => { if (state) result[name] = state; });
    return result;
  }

  async exec(deviceURL, command) {
    return this.call('POST', '/exec/apply', {
      label: `Sésame — ${command}`,
      actions: [{ deviceURL, commands: [{ name: command, parameters: [] }] }],
    });
  }
}

module.exports = TahomaClient;
