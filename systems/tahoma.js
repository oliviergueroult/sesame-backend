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
    (setup.devices || []).forEach(d => console.log(`[device] "${d.label}" → ${d.controllableName} (${d.deviceURL})`));
    for (const d of (setup.devices || [])) {
      const label = d.label || '';
      const ctrl  = d.controllableName || '';
      // Portail : label ou controllableName
      if (!devices.portail && (/gate|portail|barrier|entr[ée]e|porte.ext/i.test(label) || /Gate|Pedestrian/i.test(ctrl)))
        devices.portail = d.deviceURL;
      // Garage
      if (!devices.garage && (/garage/i.test(label) || /Garage/i.test(ctrl)))
        devices.garage = d.deviceURL;
      // Alarme : label OU controllableName (AlarmController, AlarmIO, AlarmSystem, Siren)
      if (!devices.alarm && (/alarm|alarme|sir[eè]ne/i.test(label) || /Alarm|Siren/i.test(ctrl)))
        devices.alarm = d.deviceURL;
    }
    console.log('[TaHoma] matched:', devices);
    return devices;
  }

  async getStatus(devices) {
    const setup  = await this.call('GET', '/setup');
    const result = {};
    for (const [name, deviceURL] of Object.entries(devices)) {
      if (!deviceURL) continue;
      const device = (setup.devices || []).find(d => d.deviceURL === deviceURL);
      if (!device) continue;
      const map = {};
      (device.states || []).forEach(s => { map[s.name] = s.value; });

      if (name === 'alarm') {
        const mode = map['internal:CurrentAlarmModeState']
                  || map['myfox:AlarmStatusState']
                  || map['TSKAlarm:AlarmModeState']
                  || map['core:ActiveState'];
        console.log('[TaHoma] alarm states:', JSON.stringify(map));
        // "total" et "partial*" = armé ; "off" = désarmé
        const armed = mode && mode !== 'off' && mode !== 'disarmed' && mode !== false && mode !== 'false';
        result[name] = armed ? 'armed' : 'disarmed';
      } else {
        const open     = map['core:OpenClosedState'];
        const moving   = map['core:MovingState'];
        const isMoving = moving === true || moving === 'true' || moving === 1;
        result[name]   = isMoving ? 'moving' : open === 'open' ? 'open' : 'closed';
      }
    }
    return result;
  }

  async exec(deviceURL, command, parameters = []) {
    console.log(`[TaHoma] exec ${deviceURL} → ${command}`, parameters);
    const result = await this.call('POST', '/exec/apply', {
      label: `Sésame — ${command}`,
      actions: [{ deviceURL, commands: [{ name: command, parameters }] }],
    });
    console.log(`[TaHoma] exec result:`, JSON.stringify(result));
    return result;
  }
}

module.exports = TahomaClient;
