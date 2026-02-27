const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const dns = require('dns');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// Persistent JWT secret — survives restarts so users stay logged in.
// Regenerating on every restart invalidated all tokens (broke character saving etc.)
const _jwtFile = path.join(__dirname, '..', 'data', '.jwtsecret');
let JWT_SECRET;
if (fs.existsSync(_jwtFile)) {
  JWT_SECRET = fs.readFileSync(_jwtFile, 'utf8').trim();
} else {
  JWT_SECRET = 'tavern-' + crypto.randomBytes(32).toString('hex');
  try { fs.mkdirSync(path.dirname(_jwtFile), { recursive: true }); fs.writeFileSync(_jwtFile, JWT_SECRET); } catch {}
}

// ── FIELD ENCRYPTION ─────────────────────────────────────────────────────────
// API keys are encrypted at rest with AES-256-GCM.
// The encryption key is derived from the user's login password at session start
// and held only in memory — never written to disk.
const keyStore = new Map(); // userId → Buffer(32)

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
}

function encryptField(plaintext, key) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return 'enc:' + iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex');
}

function decryptField(ciphertext, key) {
  if (!ciphertext || !ciphertext.startsWith('enc:')) return ciphertext; // not encrypted
  const parts = ciphertext.slice(4).split(':');
  if (parts.length < 3) return '';
  const [ivHex, tagHex, encHex] = parts;
  try {
    const iv      = Buffer.from(ivHex, 'hex');
    const tag     = Buffer.from(tagHex, 'hex');
    const enc     = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(enc).toString('utf8') + decipher.final('utf8');
  } catch { return ''; } // wrong key or tampered data
}

// Encrypt providers array before writing to disk; decrypt after reading.
function encryptProviders(providers, key) {
  return providers.map(p => {
    if (!p.apiKey || p.apiKey.startsWith('enc:')) return p; // already encrypted or empty
    return { ...p, apiKey: encryptField(p.apiKey, key) };
  });
}
function decryptProviders(providers, key) {
  return providers.map(p => ({
    ...p,
    apiKey: p.apiKey?.startsWith('enc:') ? decryptField(p.apiKey, key) : (p.apiKey || ''),
  }));
}

// ── ENCRYPT / DECRYPT HELPERS FOR ALL DATA ──────────────────────────────────

// Encrypt sensitive character fields before writing to disk
function encryptCharacter(char, key) {
  if (!key) return char;
  const c = { ...char };
  if (c.systemPrompt && !c.systemPrompt.startsWith('enc:'))
    c.systemPrompt = encryptField(c.systemPrompt, key);
  if (c.description && !c.description.startsWith('enc:'))
    c.description = encryptField(c.description, key);
  if (Array.isArray(c.firstMessages)) {
    c.firstMessages = c.firstMessages.map(m =>
      m && !m.startsWith('enc:') ? encryptField(m, key) : m);
  }
  return c;
}

// Decrypt character fields after reading from disk
function decryptCharacter(char, key) {
  if (!key) return char;
  const c = { ...char };
  if (c.systemPrompt?.startsWith('enc:'))
    c.systemPrompt = decryptField(c.systemPrompt, key);
  if (c.description?.startsWith('enc:'))
    c.description = decryptField(c.description, key);
  if (Array.isArray(c.firstMessages)) {
    c.firstMessages = c.firstMessages.map(m =>
      m?.startsWith('enc:') ? decryptField(m, key) : m);
  }
  return c;
}

// Encrypt chat messages before writing to disk
function encryptChat(chat, key) {
  if (!key || !chat.messages?.length) return chat;
  const c = { ...chat };
  c.messages = c.messages.map(m => {
    if (!m.content || m.content.startsWith('enc:')) return m;
    return { ...m, content: encryptField(m.content, key) };
  });
  return c;
}

// Decrypt chat messages after reading from disk
function decryptChat(chat, key) {
  if (!key || !chat.messages?.length) return chat;
  const c = { ...chat };
  c.messages = c.messages.map(m => {
    if (!m.content?.startsWith('enc:')) return m;
    return { ...m, content: decryptField(m.content, key) };
  });
  return c;
}

// Encrypt settings sensitive fields (globalSystem prompt)
function encryptSettings(settings, key) {
  if (!key) return settings;
  const s = { ...settings };
  if (s.mp?.globalSystem && !s.mp.globalSystem.startsWith('enc:')) {
    s.mp = { ...s.mp, globalSystem: encryptField(s.mp.globalSystem, key) };
  }
  return s;
}

// Decrypt settings sensitive fields
function decryptSettings(settings, key) {
  if (!key) return settings;
  const s = { ...settings };
  if (s.mp?.globalSystem?.startsWith('enc:')) {
    s.mp = { ...s.mp, globalSystem: decryptField(s.mp.globalSystem, key) };
  }
  return s;
}

// Force Google DNS — fixes EAI_AGAIN in Docker/WSL/VPN environments
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const app = express();
const PORT = process.env.PORT || 3000;

// Data directory for persistence
const DATA_DIR = path.join(__dirname, '..', 'data');
const CHARS_FILE    = path.join(DATA_DIR, 'characters.json');
const CHATS_FILE    = path.join(DATA_DIR, 'chats.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const USERS_FILE    = path.join(DATA_DIR, 'users.json');
const INVITES_FILE  = path.join(DATA_DIR, 'invites.json');
const POSTS_FILE    = path.join(DATA_DIR, 'posts.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// On startup: clean broken characters (no name or name='undefined'/'Unknown')
try {
  if (fs.existsSync(CHARS_FILE)) {
    const chars = JSON.parse(fs.readFileSync(CHARS_FILE, 'utf8'));
    const cleaned = chars.filter(c => c.name && c.name !== 'undefined' && c.name !== 'Unknown' && c.name !== 'Imported Character');
    if (cleaned.length !== chars.length) {
      fs.writeFileSync(CHARS_FILE, JSON.stringify(cleaned, null, 2));
      console.log(`🧹 Cleaned ${chars.length - cleaned.length} broken character(s)`);
    }
  }
} catch(e) { console.warn('Cleanup error:', e.message); }

// Migrate plaintext passwords to bcrypt hashes
try {
  if (fs.existsSync(USERS_FILE)) {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    let migrated = 0;
    for (const u of users) {
      if (u.password && !u.password.startsWith('$2')) {
        u.password = bcrypt.hashSync(u.password, 10);
        migrated++;
      }
    }
    if (migrated > 0) {
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
      console.log(`🔐 Migrated ${migrated} password(s) to bcrypt`);
    }
  }
} catch(e) { console.warn('Password migration error:', e.message); }


// Init data files
const initFile = (file, defaultData) => {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
};
initFile(CHARS_FILE, []);
initFile(CHATS_FILE, []);
initFile(SETTINGS_FILE, { apiProviders: [], activeProvider: null });
initFile(USERS_FILE, []);
initFile(INVITES_FILE, []);
initFile(POSTS_FILE, []);

// Helpers
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const globalLimit = rateLimit({ windowMs: 15*60*1000, max: 500, standardHeaders: true, legacyHeaders: false });
const authLimit   = rateLimit({ windowMs: 15*60*1000, max: 30,  standardHeaders: true, legacyHeaders: false });
app.use('/api/', globalLimit);
app.use('/api/auth/login',    authLimit);
app.use('/api/auth/register', authLimit);

// Helper to verify JWT token — returns userId or null
const verifyToken = (req) => {
  try {
    const raw = req.headers.authorization?.replace('Bearer ', '');
    if (!raw) return null;
    return jwt.verify(raw, JWT_SECRET).id;
  } catch { return null; }
};

// ─── AUTH ───────────────────────────────────────────────────────────────────

app.post('/api/auth/register', (req, res) => {
  const { username, password, displayName } = req.body;
  const users = readJSON(USERS_FILE);
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Username already taken' });
  }
  const user = {
    id: uuidv4(),
    username,
    password: bcrypt.hashSync(password, 10),
    displayName: displayName || username,
    avatar: null,
    banner: null,
    bio: '',
    role: users.length === 0 ? 'admin' : 'user',
    createdAt: Date.now()
  };
  users.push(user);
  writeJSON(USERS_FILE, users);
  keyStore.set(user.id, deriveKey(password, user.id));
  const { password: _, ...safeUser } = user;
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '90d' });
  res.json({ user: safeUser, token });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  // Derive and cache the encryption key for this session
  keyStore.set(user.id, deriveKey(password, user.id));
  const { password: _, ...safeUser } = user;
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '90d' });
  res.json({ user: safeUser, token });
});

app.get('/api/auth/me', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { password: _, ...safeUser } = user;
  res.json(safeUser);
});

app.patch('/api/auth/profile', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const users = readJSON(USERS_FILE);
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return res.status(401).json({ error: 'Unauthorized' });
  const allowed = ['displayName', 'username', 'bio', 'avatar', 'banner'];
  allowed.forEach(key => {
    if (req.body[key] !== undefined) users[idx][key] = req.body[key];
  });
  writeJSON(USERS_FILE, users);
  const { password: _, ...safeUser } = users[idx];
  res.json(safeUser);
});

// ─── SETTINGS / API PROVIDERS ───────────────────────────────────────────────

const API_PRESETS = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', icon: '🟢', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', icon: '🔵', models: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.1-70b-instruct', 'google/gemini-pro-1.5'] },
  { id: 'anthropic-proxy', name: 'Anthropic (via proxy)', baseUrl: 'https://api.anthropic.com/v1', icon: '🟠', models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'] },
  { id: 'vsegpt', name: 'VseGPT', baseUrl: 'https://api.vsegpt.ru/v1', icon: '🇷🇺', models: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro'] },
  { id: 'ollama', name: 'Ollama (Local)', baseUrl: 'http://localhost:11434/v1', icon: '🦙', models: ['llama3.2', 'mistral', 'phi3', 'gemma2'] },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', icon: '🎨', models: ['local-model'] },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', icon: '⚡', models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', icon: '🤝', models: ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1'] },
  { id: 'mistral', name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', icon: '🌬️', models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'] },
  { id: 'cohere', name: 'Cohere', baseUrl: 'https://api.cohere.ai/compatibility/v1', icon: '🌊', models: ['command-r-plus', 'command-r'] },
  { id: 'custom', name: 'Custom / Other', baseUrl: '', icon: '⚙️', models: [] }
];

app.get('/api/presets', (req, res) => res.json(API_PRESETS));

app.get('/api/settings', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const settings = readJSON(SETTINGS_FILE);
  let userSettings = settings[userId] || { providers: [], activeProviderId: null };
  const key = keyStore.get(userId);
  if (key) {
    if (userSettings.providers?.length)
      userSettings.providers = decryptProviders(userSettings.providers, key);
    userSettings = decryptSettings(userSettings, key);
  }
  res.json(userSettings);
});

app.post('/api/settings', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const settings = readJSON(SETTINGS_FILE);
  let data = req.body;
  const key = keyStore.get(userId);
  if (key) {
    if (data.providers?.length)
      data.providers = encryptProviders(data.providers, key);
    data = encryptSettings(data, key);
  }
  settings[userId] = data;
  writeJSON(SETTINGS_FILE, settings);
  res.json({ ok: true });
});

// ─── CHARACTERS ─────────────────────────────────────────────────────────────

app.get('/api/characters', (req, res) => {
  const userId = verifyToken(req);
  const chars = readJSON(CHARS_FILE);
  const key = keyStore.get(userId);
  const visible = chars.filter(c =>
    c.visibility === 'public' ||
    c.ownerId === userId ||
    (userId && !c.ownerId)
  ).map(c => (key && c.ownerId === userId) ? decryptCharacter(c, key) : c);
  res.json(visible);
});

app.post('/api/characters', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const chars = readJSON(CHARS_FILE);
  let char = {
    id: uuidv4(),
    ownerId: userId,
    createdAt: Date.now(),
    ...req.body
  };
  const key = keyStore.get(userId);
  const plainChar = { ...char }; // return unencrypted to client
  if (key) char = encryptCharacter(char, key);
  chars.push(char);
  writeJSON(CHARS_FILE, chars);
  res.json(plainChar);
});

app.put('/api/characters/:id', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const chars = readJSON(CHARS_FILE);
  const idx = chars.findIndex(c => c.id === req.params.id && c.ownerId === userId);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const key = keyStore.get(userId);
  let updated = { ...chars[idx], ...req.body };
  const plainUpdated = { ...updated };
  if (key) updated = encryptCharacter(updated, key);
  chars[idx] = updated;
  writeJSON(CHARS_FILE, chars);
  res.json(plainUpdated);
});

app.delete('/api/characters/:id', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  let chars = readJSON(CHARS_FILE);
  chars = chars.filter(c => !(c.id === req.params.id && c.ownerId === userId));
  writeJSON(CHARS_FILE, chars);
  res.json({ ok: true });
});

// Import character from PNG — parse metadata AND optionally save to collection
app.post('/api/characters/import/png', (req, res) => {
  const userId = verifyToken(req);
  const { base64, save: shouldSave } = req.body;
  if (shouldSave && !userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const buffer = Buffer.from(base64, 'base64');

    // ── Extract tEXt/zTXt chunk with keyword "chara" ──────────────────────────
    let charData = null;
    let pos = 8; // skip PNG signature
    while (pos < buffer.length - 12) {
      const len      = buffer.readUInt32BE(pos);
      const type     = buffer.slice(pos+4, pos+8).toString('ascii');
      const chunkData= buffer.slice(pos+8, pos+8+len);
      pos += 12 + len;

      if (type === 'tEXt') {
        // tEXt: keyword text
        const nullIdx = chunkData.indexOf(0);
        const keyword = chunkData.slice(0, nullIdx).toString('ascii');
        if (keyword === 'chara') {
          const b64str = chunkData.slice(nullIdx+1).toString('ascii');
          charData = JSON.parse(Buffer.from(b64str, 'base64').toString('utf8'));
          break;
        }
      }
      if (type === 'IEND') break;
    }

    // Fallback: scan raw bytes for "chara" keyword
    if (!charData) {
      const raw = buffer.toString('binary');
      const idx = raw.indexOf('chara\0');
      if (idx !== -1) {
        const start = idx + 6;
        let end = start;
        while (end < buffer.length && raw.charCodeAt(end) !== 0) end++;
        const b64str = raw.slice(start, end);
        charData = JSON.parse(Buffer.from(b64str, 'base64').toString('utf8'));
      }
    }

    if (!charData) return res.status(400).json({ error: 'No character data found in PNG' });

    // ── Normalize fields (supports Tavern v1, v2, Chub, CAI) ─────────────────
    const d = charData.data || charData;
    const name = d.name || 'Imported Character';
    const description = typeof d.description === 'string' ? d.description.slice(0,200) : '';

    let systemPrompt = '';
    if (d.personality)  systemPrompt += d.personality + '\n\n';
    if (typeof d.description === 'string' && d.description.length > 200) systemPrompt += d.description + '\n\n';
    if (d.scenario)     systemPrompt += 'Scenario: ' + d.scenario + '\n\n';
    if (d.mes_example)  systemPrompt += 'Example dialogue:\n' + d.mes_example;
    if (!systemPrompt && d.system_prompt) systemPrompt = d.system_prompt;
    if (!systemPrompt && d.char_persona)  systemPrompt = d.char_persona;

    const firstMessages = [];
    if (d.first_mes) firstMessages.push(d.first_mes);
    if (d.alternate_greetings) firstMessages.push(...d.alternate_greetings);
    if (!firstMessages.length) firstMessages.push('Привет! Рад тебя видеть.');

    const tags = d.tags || charData.topics || [];

    // Embed the PNG itself as avatar (data URL)
    const avatarDataUrl = "data:image/png;base64," + base64;

    if (!shouldSave) {
      // Just return parsed data (for form-filling)
      return res.json({ charData: d });
    }

    // ── Save to collection ────────────────────────────────────────────────────
    const chars = readJSON(CHARS_FILE);
    let char = {
      id:           uuidv4(),
      ownerId:      userId,
      name,
      description,
      systemPrompt: systemPrompt.trim(),
      firstMessages,
      tags,
      visibility:   'private',
      avatar:       avatarDataUrl,
      avatar_emoji: '🎭',
      createdAt:    Date.now(),
    };
    const plainChar = { ...char, firstMessages: [...firstMessages] };
    const key = keyStore.get(userId);
    if (key) char = encryptCharacter(char, key);
    chars.push(char);
    writeJSON(CHARS_FILE, chars);
    res.json(plainChar);
  } catch (e) {
    console.error('PNG import error:', e);
    res.status(400).json({ error: 'Failed to parse PNG: ' + e.message });
  }
});

app.post('/api/characters/import/json', (req, res) => {
  const { data } = req.body;
  try {
    // Support multiple JSON formats (CAI, Tavern, Chub)
    let charData = data;
    if (typeof data === 'string') charData = JSON.parse(data);
    res.json({ charData });
  } catch (e) {
    res.status(400).json({ error: 'Invalid JSON' });
  }
});

// ─── CHATS ───────────────────────────────────────────────────────────────────

app.get('/api/chats', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const chats = readJSON(CHATS_FILE);
  const key = keyStore.get(userId);
  res.json(chats.filter(c => c.userId === userId).map(c => key ? decryptChat(c, key) : c));
});

app.post('/api/chats', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const chats = readJSON(CHATS_FILE);
  let chat = {
    id: uuidv4(),
    userId: userId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    ...req.body
  };
  const plainChat = { ...chat, messages: [...(chat.messages || [])] };
  const key = keyStore.get(userId);
  if (key) chat = encryptChat(chat, key);
  chats.push(chat);
  writeJSON(CHATS_FILE, chats);
  res.json(plainChat);
});

app.get('/api/chats/:id', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const chats = readJSON(CHATS_FILE);
  const chat = chats.find(c => c.id === req.params.id && c.userId === userId);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  const key = keyStore.get(userId);
  res.json(key ? decryptChat(chat, key) : chat);
});

app.patch('/api/chats/:id/messages', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const chats = readJSON(CHATS_FILE);
  const idx = chats.findIndex(c => c.id === req.params.id && c.userId === userId);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const key = keyStore.get(userId);
  const plainMessages = req.body.messages || [];
  // Encrypt messages before writing
  if (key) {
    chats[idx].messages = plainMessages.map(m => {
      if (!m.content || m.content.startsWith('enc:')) return m;
      return { ...m, content: encryptField(m.content, key) };
    });
  } else {
    chats[idx].messages = plainMessages;
  }
  chats[idx].updatedAt = Date.now();
  writeJSON(CHATS_FILE, chats);
  // Return decrypted version to client
  res.json({ ...chats[idx], messages: plainMessages });
});

app.delete('/api/chats/:id', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  let chats = readJSON(CHATS_FILE);
  chats = chats.filter(c => !(c.id === req.params.id && c.userId === userId));
  writeJSON(CHATS_FILE, chats);
  res.json({ ok: true });
});

// ─── AI PROXY (Stream) ───────────────────────────────────────────────────────

app.post('/api/chat/stream', async (req, res) => {
  const { messages, provider, model, systemPrompt } = req.body;

  if (!provider || !provider.baseUrl || !provider.apiKey) {
    return res.status(400).json({ error: 'Provider not configured' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const fetch = require('node-fetch');
    const payload = {
      model: model || 'gpt-4o-mini',
      messages: systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...messages]
        : messages,
      stream: true,
      max_tokens: 2048
    };

    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
        ...(provider.extraHeaders || {})
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
      res.end();
      return;
    }

    response.body.on('data', chunk => {
      res.write(chunk);
    });
    response.body.on('end', () => res.end());
    response.body.on('error', () => res.end());

  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});


// ─── CHUB.AI PROXY ──────────────────────────────────────────────────────────
// Browser can't hit Chub directly (CORS), we proxy through here

const https = require('https');
const http  = require('http');

function proxyFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   options.method || 'GET',
      headers:  {
        'User-Agent':  'Mozilla/5.0 (compatible; TavernAI/3.0; +https://github.com)',
        'Accept':      options.binary ? '*/*' : 'application/json',
        'Content-Type':'application/json',
        ...(options.headers || {}),
      }
    };
    const req = lib.request(reqOpts, res => {
      // Always collect as Buffer for correct binary handling
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => resolve({
        status:  res.statusCode,
        buffer:  Buffer.concat(chunks),
        body:    Buffer.concat(chunks).toString('utf8'),
        headers: res.headers,
      }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Search characters
app.get('/api/chub/search', async (req, res) => {
  try {
    const params = new URLSearchParams({
      search:    req.query.search    || '',
      page:      req.query.page      || 1,
      page_size: req.query.page_size || 24,
      sort:      req.query.sort      || 'download_count',
      min_tokens:req.query.min_tokens|| 50,
      nsfw:      req.query.nsfw      || 'false',
      nsfw_only: req.query.nsfw_only || 'false',
    });
    if (req.query.tags) params.set('tags', req.query.tags);
    const result = await proxyFetch(`https://api.chub.ai/search?${params}`);
    res.set('Content-Type', 'application/json');
    res.status(result.status).send(result.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download character PNG and return as base64
app.post('/api/chub/download', async (req, res) => {
  try {
    const { fullPath } = req.body;
    if (!fullPath) return res.status(400).json({ error: 'fullPath required' });

    // Try direct avatar URL first (most reliable)
    const alt = await proxyFetch(`https://avatars.charhub.io/avatars/${fullPath}/chara_card_v2.png`);
    if (alt.status === 200 && alt.buffer.length > 100) {
      const b64 = alt.buffer.toString('base64');
      return res.json({ base64: b64, contentType: alt.headers['content-type'] || 'image/png' });
    }

    // Fallback to Chub API
    const result = await proxyFetch('https://api.chub.ai/api/characters/download', {
      method: 'POST',
      body: JSON.stringify({ fullPath, format: 'tavern', version: 'main' }),
    });

    if (result.status !== 200) {
      return res.status(result.status).json({ error: `Chub returned ${result.status}` });
    }

    const contentType = result.headers['content-type'] || 'image/png';
    const b64 = result.buffer.toString('base64');
    res.json({ base64: b64, contentType });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Proxy avatar images (avoids CORS on img tags)
app.get('/api/chub/avatar', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');
    // Only allow chub domains
    if (!url.includes('chub.ai') && !url.includes('charhub.io') && !url.includes('characterhub')) {
      return res.status(403).send('Forbidden');
    }
    const result = await proxyFetch(decodeURIComponent(url));
    const ct = result.headers['content-type'] || 'image/jpeg';
    res.set('Content-Type', ct);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(result.buffer);
  } catch (e) {
    res.status(500).send(e.message);
  }
});



// ─── SEARCH ─────────────────────────────────────────────────────────────────

app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json({ users: [], chars: [] });
  const users = readJSON(USERS_FILE)
    .filter(u => u.username.toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q))
    .map(u => { const { password: _, ...safe } = u; return safe; })
    .slice(0, 20);
  const chars = readJSON(CHARS_FILE)
    .filter(c => c.visibility === 'public' && (c.name || '').toLowerCase().includes(q))
    .slice(0, 20);
  res.json({ users, chars });
});

// ─── USER PROFILES ───────────────────────────────────────────────────────────

app.get('/api/users/:username', (req, res) => {
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { password: _, ...safe } = user;
  res.json(safe);
});

// ─── POSTS ───────────────────────────────────────────────────────────────────

app.get('/api/posts', (req, res) => {
  const posts = readJSON(POSTS_FILE);
  const { userId } = req.query;
  const list = userId ? posts.filter(p => p.userId === userId) : posts;
  res.json(list.slice(0, 50));
});

app.post('/api/posts', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user || !['admin', 'creator', 'media'].includes(user.role)) {
    return res.status(403).json({ error: 'Only creators can post' });
  }
  const posts = readJSON(POSTS_FILE);
  const post = {
    id: uuidv4(),
    userId,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    content: String(req.body.content || '').slice(0, 1000),
    charId: req.body.charId || null,
    image: req.body.image || null,
    createdAt: Date.now(),
    likes: 0,
  };
  posts.unshift(post);
  writeJSON(POSTS_FILE, posts);
  res.json(post);
});

app.delete('/api/posts/:id', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  const posts = readJSON(POSTS_FILE);
  const post = posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (post.userId !== userId && user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  writeJSON(POSTS_FILE, posts.filter(p => p.id !== req.params.id));
  res.json({ ok: true });
});

// ─── ADMIN ───────────────────────────────────────────────────────────────────

const requireAdmin = (req, res) => {
  const userId = verifyToken(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user || user.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return null; }
  return userId;
};

app.post('/api/admin/restart', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ok: true, message: 'Restarting server...' });
  setTimeout(() => {
    const { spawn } = require('child_process');
    const child = spawn(process.argv[0], process.argv.slice(1), {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    process.exit(0);
  }, 500);
});

// ─── TRANSLATE ───────────────────────────────────────────────────────────────
app.post('/api/translate', async (req, res) => {
  const { text, from, to } = req.body;
  if (!text || !to) return res.status(400).json({ error: 'text and to required' });

  // Split into chunks ≤500 chars for MyMemory free tier
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, 490));
    remaining = remaining.slice(490);
  }

  try {
    const translated = [];
    for (const chunk of chunks) {
      const langPair = `${from||'en'}|${to}`;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${langPair}`;
      const result = await proxyFetch(url);
      const data = JSON.parse(result.body);
      if (data.responseStatus === 200) {
        translated.push(data.responseData.translatedText);
      } else {
        // fallback: return original chunk
        translated.push(chunk);
      }
    }
    res.json({ translated: translated.join('') });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve SPA for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🟣 Tavern running at http://localhost:${PORT}`);
  console.log(`📡 Network access via Tailscale also available\n`);
});
