// ─── API CLIENT ──────────────────────────────────────────────────────────────
const API = {
  token: localStorage.getItem('tavern_token'),

  setToken(t) {
    this.token = t;
    if (t) localStorage.setItem('tavern_token', t);
    else localStorage.removeItem('tavern_token');
  },

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  },

  async req(method, path, body) {
    const res = await fetch(path, {
      method, headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
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

  // Settings
  getPresets: () => API.get('/api/presets'),
  getSettings: () => API.get('/api/settings'),
  saveSettings: (data) => API.post('/api/settings', data),

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

  // Stream AI
  async stream(payload, onChunk, onDone, onError) {
    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        onError(err.error || 'Stream failed');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

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
            if (obj.error) { onError(obj.error); return; }
            const delta = obj.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              onChunk(delta, fullText);
            }
          } catch {}
        }
      }
      onDone(fullText);
    } catch (e) {
      onError(e.message);
    }
  }
};
