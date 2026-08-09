// ─── API CLIENT ──────────────────────────────────────────────────────────────
const API = {
  token: localStorage.getItem('wesaid_token'),

  setToken(t) {
    this.token = t;
    if (t) localStorage.setItem('wesaid_token', t);
    else localStorage.removeItem('wesaid_token');
  },

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  },

  // Set by App: called when the server says the session is locked (the server
  // restarted, so the in-memory encryption key is gone). Without this the client
  // used to receive raw "enc:..." strings and show them as chat messages.
  onLocked: null,

  async req(method, path, body) {
    const res = await fetch(path, {
      method, headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined
    });

    let data = {};
    try { data = await res.json(); } catch {}

    if (!res.ok) {
      if (data.code === 'NEED_UNLOCK' && typeof this.onLocked === 'function') {
        this.onLocked();
      }
      const err = new Error(data.error || `Ошибка ${res.status}`);
      err.status = res.status;
      err.code   = data.code;
      throw err;
    }
    return data;
  },

  get: (path) => API.req('GET', path),
  post: (path, body) => API.req('POST', path, body),
  put: (path, body) => API.req('PUT', path, body),
  patch: (path, body) => API.req('PATCH', path, body),
  del: (path) => API.req('DELETE', path),

  // Auth
  register: (data) => API.post('/api/auth/register', data),
  login: (data) => API.post('/api/auth/login', data),
  me: () => API.get('/api/auth/me'),
  updateProfile: (data) => API.patch('/api/auth/profile', data),
  unlock: (password) => API.post('/api/auth/unlock', { password }),
  changePassword: (current, next) => API.post('/api/auth/password', { current, next }),

  // Settings
  getPresets: () => API.get('/api/presets'),
  getSettings: () => API.get('/api/settings'),
  saveSettings: (data) => API.post('/api/settings', data),

  // Provider helpers (all server-side: the browser cannot reach most providers
  // directly because of CORS, and doing so leaked the key out of the page)
  testProvider: (p) => API.post('/api/provider/test', p),
  listModels: (p) => API.post('/api/models', p),
  detectLocal: () => API.get('/api/local/detect'),
  netInfo: () => API.get('/api/netinfo'),

  // Backup
  getBackup: (withKeys) => API.get(`/api/backup${withKeys ? '?keys=1' : ''}`),
  restore: (data) => API.post('/api/restore', data),

  // Characters
  getCharacters: () => API.get('/api/characters'),
  createCharacter: (data) => API.post('/api/characters', data),
  updateCharacter: (id, data) => API.put(`/api/characters/${id}`, data),
  deleteCharacter: (id) => API.del(`/api/characters/${id}`),
  importPng: (base64) => API.post('/api/characters/import/png', { base64 }),
  importJson: (data) => API.post('/api/characters/import/json', { data }),

  // Chats
  getChats: () => API.get('/api/chats'),
  createChat: (data) => API.post('/api/chats', data),
  getChat: (id) => API.get(`/api/chats/${id}`),
  saveMessages: (id, messages) => API.patch(`/api/chats/${id}/messages`, { messages }),
  deleteChat: (id) => API.del(`/api/chats/${id}`),
  deleteAllChats: () => API.del('/api/chats'),

  // Stream AI
  _streamCtrl: null,

  abortStream() {
    if (this._streamCtrl) { this._streamCtrl.abort(); this._streamCtrl = null; }
  },

  async stream(payload, onChunk, onDone, onError) {
    this.abortStream();
    this._streamCtrl = new AbortController();
    // Declared out here so a user-pressed Stop can still keep what already
    // arrived instead of throwing the half-written reply away.
    let fullText = '';
    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: this._streamCtrl.signal,
      });

      if (!res.ok) {
        let err = {};
        try { err = await res.json(); } catch {}
        if (err.code === 'NEED_UNLOCK' && typeof this.onLocked === 'function') this.onLocked();
        // Hand the whole object over so humanError() can use status and code,
        // not just a raw provider blob.
        onError({ ...err, status: res.status });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const obj = JSON.parse(raw);
            if (obj.error) { onError(obj); return; }
            const delta = obj.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              onChunk(delta, fullText);
            }
          } catch {}
        }
      }
      this._streamCtrl = null;
      onDone(fullText);
    } catch (e) {
      this._streamCtrl = null;
      if (e.name === 'AbortError') { onDone(fullText, true); return; } // Stop pressed — keep what we got
      onError({ error: e.message });
    }
  },

  // Logout
  logout: () => API.post('/api/auth/logout'),
};
