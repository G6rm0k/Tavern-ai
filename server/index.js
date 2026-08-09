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

// Encrypt sensitive character fields before writing to disk.
// Public characters are stored in the clear on purpose: they are encrypted with
// the *owner's* key, so encrypting them made them unreadable to everybody else —
// other users saw "enc:..." as the description and the model got it as the
// system prompt. Sharing simply did not work.
function encryptCharacter(char, key) {
  if (!key || char.visibility === 'public') return char;
  const c = { ...char };
  if (c.systemPrompt && !c.systemPrompt.startsWith('enc:'))
    c.systemPrompt = encryptField(c.systemPrompt, key);
  if (c.description && !c.description.startsWith('enc:'))
    c.description = encryptField(c.description, key);
  if (Array.isArray(c.firstMessages)) {
    c.firstMessages = c.firstMessages.map(m =>
      m && !m.startsWith('enc:') ? encryptField(m, key) : m);
  }
  if (Array.isArray(c.lorebook)) {
    c.lorebook = c.lorebook.map(e => (e?.content && !e.content.startsWith('enc:'))
      ? { ...e, content: encryptField(e.content, key) } : e);
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
  if (Array.isArray(c.lorebook)) {
    c.lorebook = c.lorebook.map(e => e?.content?.startsWith('enc:')
      ? { ...e, content: decryptField(e.content, key) } : e);
  }
  return c;
}

// Encrypt chat messages before writing to disk
function encryptChat(chat, key) {
  if (!key) return chat;
  const c = { ...chat };
  if (c.summary && !c.summary.startsWith('enc:')) c.summary = encryptField(c.summary, key);
  if (c.messages?.length) {
    c.messages = c.messages.map(m => {
      if (!m.content || m.content.startsWith('enc:')) return m;
      // Alternative replies are chat content too — encrypt them the same way.
      const out = { ...m, content: encryptField(m.content, key) };
      if (Array.isArray(m.variants)) {
        out.variants = m.variants.map(v => (v && !v.startsWith('enc:')) ? encryptField(v, key) : v);
      }
      return out;
    });
  }
  return c;
}

// Decrypt chat messages after reading from disk
function decryptChat(chat, key) {
  if (!key) return chat;
  const c = { ...chat };
  if (c.summary?.startsWith('enc:')) c.summary = decryptField(c.summary, key);
  if (c.messages?.length) {
    c.messages = c.messages.map(m => {
      const out = { ...m };
      if (m.content?.startsWith('enc:')) out.content = decryptField(m.content, key);
      if (Array.isArray(m.variants)) {
        out.variants = m.variants.map(v => v?.startsWith('enc:') ? decryptField(v, key) : v);
      }
      return out;
    });
  }
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
initFile(SETTINGS_FILE, {});
initFile(USERS_FILE, []);
initFile(INVITES_FILE, []);
initFile(POSTS_FILE, []);

// ── STORAGE ──────────────────────────────────────────────────────────────────
// Every write used to rewrite a whole file synchronously. chats.json grows to
// tens of MB, so that blocked the event loop in the middle of a stream, and a
// crash mid-write left a truncated file that made every later request fail with
// no way back. Now: parsed data is cached in memory, writes are debounced and
// atomic (tmp + rename), and rolling backups let a damaged file be recovered.

const DEFAULTS = {
  [CHARS_FILE]: [], [CHATS_FILE]: [], [USERS_FILE]: [],
  [INVITES_FILE]: [], [POSTS_FILE]: [], [SETTINGS_FILE]: {},
};

const FLUSH_DELAY_MS  = 300;
const BACKUP_EVERY_MS = 5 * 60 * 1000;

const _cache   = new Map(); // file → parsed data (authoritative while running)
const _dirty   = new Set(); // files with unflushed changes
const _lastBak = new Map(); // file → timestamp of last backup copy
let   _flushTimer = null;

function readJSON(file) {
  if (_cache.has(file)) return _cache.get(file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    data = recoverJSON(file, e);
  }
  _cache.set(file, data);
  return data;
}

// A truncated or corrupted file used to 500 every single request forever.
// Try the rolling backups first, keep the damaged copy for forensics, and only
// fall back to empty data as a last resort — but say so loudly either way.
function recoverJSON(file, err) {
  const name = path.basename(file);
  for (const suffix of ['.bak1', '.bak2']) {
    try {
      const data = JSON.parse(fs.readFileSync(file + suffix, 'utf8'));
      const kept = file + '.damaged-' + Date.now();
      try { fs.renameSync(file, kept); } catch {}
      fs.writeFileSync(file, JSON.stringify(data));
      console.warn(`\n⚠️  Файл ${name} повреждён (${err.message})`);
      console.warn(`    Восстановлен из ${name + suffix}. Повреждённая копия: ${path.basename(kept)}\n`);
      return data;
    } catch {}
  }
  console.error(`\n❌ Файл ${name} повреждён, рабочей резервной копии нет — начинаю с пустого.`);
  console.error(`    Старый файл сохранён рядом с пометкой .damaged-*\n`);
  try { fs.renameSync(file, file + '.damaged-' + Date.now()); } catch {}
  return Array.isArray(DEFAULTS[file]) ? [] : {};
}

function writeJSON(file, data) {
  _cache.set(file, data);
  _dirty.add(file);
  if (!_flushTimer) _flushTimer = setTimeout(flushAll, FLUSH_DELAY_MS);
}

function flushAll() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  for (const file of _dirty) {
    try { flushOne(file); }
    catch (e) { console.error('Не удалось сохранить', path.basename(file) + ':', e.message); }
  }
  _dirty.clear();
}

function flushOne(file) {
  const data = _cache.get(file);
  if (data === undefined) return;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));

  // Rolling backup, but not on every write — copying tens of MB constantly
  // would bring back exactly the stall we are trying to remove.
  const now = Date.now();
  if (fs.existsSync(file) && now - (_lastBak.get(file) || 0) > BACKUP_EVERY_MS) {
    try {
      if (fs.existsSync(file + '.bak1')) fs.copyFileSync(file + '.bak1', file + '.bak2');
      fs.copyFileSync(file, file + '.bak1');
      _lastBak.set(file, now);
    } catch {}
  }

  fs.renameSync(tmp, file); // atomic within one filesystem
}

// Closing the window must not cost the last few hundred milliseconds of work.
process.on('exit', () => { try { flushAll(); } catch {} });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { flushAll(); } catch {} process.exit(0); });
}
// Staying alive beats dying on a stray async error: this is a local app the user
// may have no obvious way to restart. Persist what we have and keep serving.
process.on('uncaughtException', (e) => {
  console.error('Непредвиденная ошибка (сервер продолжает работать):', e);
  try { flushAll(); } catch {}
});
process.on('unhandledRejection', (e) => {
  console.error('Непредвиденная ошибка в асинхронном коде:', e);
});

app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// Avatars live on disk now and are served as ordinary files, so the browser can
// cache them instead of re-downloading megabytes of base64 with every list.
app.use('/avatars', express.static(path.join(DATA_DIR, 'avatars'), {
  maxAge: '7d', immutable: true, fallthrough: true,
}));

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

// The encryption key is derived from the login password and kept only in memory,
// so a server restart leaves a still-valid 90-day token with no key. Serving
// those requests handed the client raw "enc:..." strings, which then went into
// the model as chat history and as the character's system prompt. Ask for the
// password again instead of serving garbage.
const requireUser = (req, res) => {
  const userId = verifyToken(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  if (!keyStore.has(userId)) {
    res.status(401).json({ error: 'Session locked', code: 'NEED_UNLOCK' });
    return null;
  }
  return userId;
};

// ─── AVATAR STORAGE ─────────────────────────────────────────────────────────
// Avatars used to be embedded as base64 data URLs inside characters.json, which
// is why that file grew to tens of MB: every character list request shipped all
// of them to the browser, and every save rewrote them. They are files now; the
// JSON keeps only a path.

const AVATARS_DIR = path.join(DATA_DIR, 'avatars');
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

const AVATAR_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

// Returns a servable path, or the input unchanged when it is not a data URL.
function storeAvatar(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) return value;
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (!m) return null;
  const ext = AVATAR_EXT[m[1].toLowerCase()] || 'png';
  try {
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) return null;
    const name = `${uuidv4()}.${ext}`;
    fs.writeFileSync(path.join(AVATARS_DIR, name), buf);
    return `/avatars/${name}`;
  } catch (e) {
    console.warn('Не удалось сохранить аватар:', e.message);
    return null;
  }
}

function deleteAvatar(value) {
  if (typeof value !== 'string' || !value.startsWith('/avatars/')) return;
  const name = path.basename(value);
  try { fs.unlinkSync(path.join(AVATARS_DIR, name)); } catch {}
}

// Inline a stored avatar back into a data URL, so a backup file stands alone.
function inlineAvatar(value) {
  if (typeof value !== 'string' || !value.startsWith('/avatars/')) return value;
  try {
    const name = path.basename(value);
    const ext  = path.extname(name).slice(1).toLowerCase();
    const mime = Object.keys(AVATAR_EXT).find(k => AVATAR_EXT[k] === ext) || 'image/png';
    const buf  = fs.readFileSync(path.join(AVATARS_DIR, name));
    return `data:${mime};base64,` + buf.toString('base64');
  } catch { return null; }
}

// One-time migration of anything still embedded in the JSON files.
function migrateEmbeddedAvatars() {
  let moved = 0;
  try {
    const chars = readJSON(CHARS_FILE);
    for (const c of chars) {
      if (typeof c.avatar === 'string' && c.avatar.startsWith('data:image/')) {
        c.avatar = storeAvatar(c.avatar);
        moved++;
      }
    }
    if (moved) writeJSON(CHARS_FILE, chars);

    const users = readJSON(USERS_FILE);
    let userMoved = 0;
    for (const u of users) {
      for (const field of ['avatar', 'banner']) {
        if (typeof u[field] === 'string' && u[field].startsWith('data:image/')) {
          u[field] = storeAvatar(u[field]);
          userMoved++;
        }
      }
    }
    if (userMoved) writeJSON(USERS_FILE, users);
    moved += userMoved;

    const chats = readJSON(CHATS_FILE);
    let chatMoved = 0;
    for (const ch of chats) {
      if (typeof ch.characterAvatar === 'string' && ch.characterAvatar.startsWith('data:image/')) {
        ch.characterAvatar = storeAvatar(ch.characterAvatar);
        chatMoved++;
      }
    }
    if (chatMoved) writeJSON(CHATS_FILE, chats);
    moved += chatMoved;

    if (moved) {
      flushAll();
      console.log(`🖼️  Вынесено ${moved} изображений из JSON в data/avatars`);
    }
  } catch (e) {
    console.warn('Миграция аватаров не удалась:', e.message);
  }
}

// ─── STARTER CHARACTERS ─────────────────────────────────────────────────────
// A brand new account used to land on an empty screen with nothing to click.
// These are seeded once, at registration, and can be deleted like any other.
const STARTER_CHARACTERS = [
  {
    name: 'Помощник', avatar_emoji: '✦',
    description: 'Отвечает на вопросы, объясняет и помогает с текстами',
    systemPrompt: 'Ты — дружелюбный и толковый помощник по имени {{char}}. Отвечай понятно и по делу, без лишней воды. Если вопрос неоднозначный — уточни. Обращайся к собеседнику по имени {{user}}, когда это уместно. Отвечай на языке собеседника.',
    firstMessages: ['Привет, {{user}}! Спрашивай о чём угодно — помогу разобраться, объясню сложное простыми словами или помогу с текстом.'],
  },
  {
    name: 'Переводчик', avatar_emoji: '🌐',
    description: 'Переводит на любой язык и объясняет нюансы',
    systemPrompt: 'Ты — {{char}}, профессиональный переводчик. Переводи присланный текст, сохраняя смысл и тон. Если язык перевода не указан — переводи русский на английский, а любой другой на русский. После перевода коротко поясняй сложные или неоднозначные места.',
    firstMessages: ['Пришли любой текст — переведу и объясню тонкости. Можешь сразу указать язык, например: «на немецкий».'],
  },
  {
    name: 'Мия', avatar_emoji: '☕',
    description: 'Собеседница для разговоров обо всём',
    systemPrompt: 'Ты — {{char}}, живая и любопытная собеседница лет двадцати пяти. Тебе искренне интересен {{user}}: ты задаёшь вопросы, делишься своими мыслями, шутишь. Говори естественно, короткими репликами, как в настоящей переписке. Действия и жесты оформляй звёздочками, например: *улыбается*. Не будь навязчивой и не изображай ассистента.',
    firstMessages: [
      '*подсаживается за соседний столик с чашкой кофе* Не занято? ...Ужасная погода, да? Я минут двадцать под дождём шла.',
      'О, привет! *машет рукой* Слушай, у меня к тебе странный вопрос — ты веришь в то, что люди меняются?',
    ],
  },
  {
    name: 'English Tutor', avatar_emoji: '🎓',
    description: 'Репетитор английского: практика и разбор ошибок',
    systemPrompt: 'You are {{char}}, a patient English tutor. Talk to {{user}} in simple English, matching their level. After each of their messages, gently point out mistakes and show the corrected version. Keep your own replies short so they do most of the talking. If they clearly struggle, switch briefly to their language to explain, then return to English.',
    firstMessages: ['Hi {{user}}! Let\'s practise a bit. Tell me about your day — don\'t worry about mistakes, I\'ll help you fix them.'],
  },
  {
    name: 'Капитан Рэйк', avatar_emoji: '⚓',
    description: 'Ролевая игра: пиратское приключение',
    systemPrompt: 'Ты — {{char}}, старый пиратский капитан с обветренным лицом и тёмным прошлым. Ты ведёшь {{user}} через приключение: описывай мир, реагируй на решения, подкидывай опасности и находки. Говори грубовато, с морским жаргоном. Описания окружения давай короткими яркими абзацами, действия — звёздочками. Никогда не решай за {{user}}, что он делает.',
    firstMessages: ['*сплёвывает за борт и щурится на горизонт* Значит, ты и есть тот самый новичок. *поворачивается, рука на эфесе* Слушай сюда: карта у меня, корабль у меня, а вот команды не хватает. Что скажешь — идёшь со мной за Сердцем Шторма или проваливай на берег?'],
  },
];

function seedStarterCharacters(userId, key) {
  try {
    const chars = readJSON(CHARS_FILE);
    for (const tpl of STARTER_CHARACTERS) {
      let char = {
        ...tpl,
        id: uuidv4(),
        ownerId: userId,
        avatar: null,
        tags: ['starter'],
        visibility: 'private',
        createdAt: Date.now(),
      };
      if (key) char = encryptCharacter(char, key);
      chars.push(char);
    }
    writeJSON(CHARS_FILE, chars);
  } catch (e) {
    console.warn('Не удалось создать стартовых персонажей:', e.message);
  }
}

// ─── AUTH ───────────────────────────────────────────────────────────────────

app.post('/api/auth/register', (req, res) => {
  const username    = String(req.body.username || '').trim();
  const password    = String(req.body.password || '');
  const displayName = String(req.body.displayName || '').trim();

  if (username.length < 2)  return res.status(400).json({ error: 'Имя пользователя — минимум 2 символа' });
  if (username.length > 32) return res.status(400).json({ error: 'Имя пользователя — максимум 32 символа' });
  if (!/^[a-zA-Z0-9_.-]+$/.test(username))
    return res.status(400).json({ error: 'В имени можно использовать латиницу, цифры, _ . -' });
  if (password.length < 4)  return res.status(400).json({ error: 'Пароль — минимум 4 символа' });

  const users = readJSON(USERS_FILE);
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Это имя уже занято' });
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
  const key = deriveKey(password, user.id);
  keyStore.set(user.id, key);
  seedStarterCharacters(user.id, key);
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

app.post('/api/auth/logout', (req, res) => {
  const userId = verifyToken(req);
  if (userId) keyStore.delete(userId);
  res.json({ ok: true });
});

// Deliberately does NOT require the encryption key: the client uses this to tell
// "token still valid" from "must log in again". It reports the locked state so
// the app can ask for the password without throwing the session away.
app.get('/api/auth/me', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { password: _, ...safeUser } = user;
  res.json({ ...safeUser, locked: !keyStore.has(userId) });
});

// Re-derive the encryption key after a server restart, keeping the session.
app.post('/api/auth/unlock', async (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const password = String(req.body.password || '');
  const users = readJSON(USERS_FILE);
  const user  = users.find(u => u.id === userId);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  keyStore.set(userId, deriveKey(password, userId));
  const { password: _, ...safeUser } = user;
  res.json({ user: safeUser });
});

// Changing the password means changing the encryption key, so everything this
// user owns has to be re-encrypted in the same operation. Writing the new hash
// without this step would silently destroy every chat, character and setting.
app.post('/api/auth/password', async (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const current = String(req.body.current || '');
  const next    = String(req.body.next || '');
  if (next.length < 4) return res.status(400).json({ error: 'Новый пароль — минимум 4 символа' });

  const users = readJSON(USERS_FILE);
  const idx   = users.findIndex(u => u.id === userId);
  if (idx === -1) return res.status(401).json({ error: 'Unauthorized' });
  if (!(await bcrypt.compare(current, users[idx].password))) {
    return res.status(401).json({ error: 'Текущий пароль неверный' });
  }

  const oldKey = deriveKey(current, userId);
  const newKey = deriveKey(next, userId);

  try {
    const chars = readJSON(CHARS_FILE);
    for (let i = 0; i < chars.length; i++) {
      if (chars[i].ownerId === userId)
        chars[i] = encryptCharacter(decryptCharacter(chars[i], oldKey), newKey);
    }
    writeJSON(CHARS_FILE, chars);

    const chats = readJSON(CHATS_FILE);
    for (let i = 0; i < chats.length; i++) {
      if (chats[i].userId === userId)
        chats[i] = encryptChat(decryptChat(chats[i], oldKey), newKey);
    }
    writeJSON(CHATS_FILE, chats);

    const settings = readJSON(SETTINGS_FILE);
    if (settings[userId]) {
      let s = JSON.parse(JSON.stringify(settings[userId]));
      if (s.providers?.length) s.providers = decryptProviders(s.providers, oldKey);
      s = decryptSettings(s, oldKey);
      if (s.providers?.length) s.providers = encryptProviders(s.providers, newKey);
      settings[userId] = encryptSettings(s, newKey);
      writeJSON(SETTINGS_FILE, settings);
    }

    users[idx].password = bcrypt.hashSync(next, 10);
    writeJSON(USERS_FILE, users);
    keyStore.set(userId, newKey);
    flushAll(); // a password change is worth persisting immediately
    res.json({ ok: true });
  } catch (e) {
    console.error('Password change failed:', e);
    res.status(500).json({ error: 'Не удалось сменить пароль, данные не тронуты' });
  }
});

app.patch('/api/auth/profile', (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const users = readJSON(USERS_FILE);
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return res.status(401).json({ error: 'Unauthorized' });
  // Passwords are never changed here — that needs re-encryption, see
  // POST /api/auth/password. Silently dropping the field used to make the UI
  // report success while nothing happened.
  if (req.body.password !== undefined) {
    return res.status(400).json({ error: 'Пароль меняется отдельно', code: 'USE_PASSWORD_ENDPOINT' });
  }
  const allowed = ['displayName', 'username', 'bio', 'avatar', 'banner'];
  allowed.forEach(key => {
    if (req.body[key] === undefined) return;
    if (key === 'avatar' || key === 'banner') {
      const stored = storeAvatar(req.body[key]);
      if (stored === null) return; // unreadable image, keep the old one
      if (stored !== users[idx][key]) deleteAvatar(users[idx][key]);
      users[idx][key] = stored;
    } else {
      users[idx][key] = req.body[key];
    }
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
  const userId = requireUser(req, res);
  if (!userId) return;
  const settings = readJSON(SETTINGS_FILE);
  // Deep copy before decrypting: readJSON now returns the live cached object, so
  // decrypting in place would put plaintext API keys back into the stored data.
  let userSettings = settings[userId]
    ? JSON.parse(JSON.stringify(settings[userId]))
    : { providers: [], activeProviderId: null };
  const key = keyStore.get(userId);
  if (key) {
    if (userSettings.providers?.length)
      userSettings.providers = decryptProviders(userSettings.providers, key);
    userSettings = decryptSettings(userSettings, key);
  }
  res.json(userSettings);
});

app.post('/api/settings', (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
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
  const userId = requireUser(req, res);
  if (!userId) return;
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
  const userId = requireUser(req, res);
  if (!userId) return;
  const chars = readJSON(CHARS_FILE);
  let char = {
    ...req.body,
    avatar: storeAvatar(req.body.avatar) || null,
    id: uuidv4(),
    ownerId: userId,
    createdAt: Date.now(),
  };
  const key = keyStore.get(userId);
  const plainChar = { ...char }; // return unencrypted to client
  if (key) char = encryptCharacter(char, key);
  chars.push(char);
  writeJSON(CHARS_FILE, chars);
  res.json(plainChar);
});

app.put('/api/characters/:id', (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const chars = readJSON(CHARS_FILE);
  const idx = chars.findIndex(c => c.id === req.params.id && c.ownerId === userId);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const key = keyStore.get(userId);
  // Decrypt what is stored before merging: otherwise fields the client did not
  // send stay encrypted, which breaks the moment the character is made public.
  const current = key ? decryptCharacter(chars[idx], key) : chars[idx];
  let updated = { ...current, ...req.body, id: chars[idx].id, ownerId: userId };
  if (req.body.avatar !== undefined) {
    const stored = storeAvatar(req.body.avatar);
    updated.avatar = stored === null ? current.avatar : stored;
    if (updated.avatar !== current.avatar) deleteAvatar(current.avatar);
  }
  const plainUpdated = { ...updated };
  if (key) updated = encryptCharacter(updated, key);
  chars[idx] = updated;
  writeJSON(CHARS_FILE, chars);
  res.json(plainUpdated);
});

app.delete('/api/characters/:id', (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const chars = readJSON(CHARS_FILE);
  const doomed = chars.find(c => c.id === req.params.id && c.ownerId === userId);
  if (doomed) deleteAvatar(doomed.avatar); // don't leave orphan files behind
  writeJSON(CHARS_FILE, chars.filter(c => c !== doomed));
  res.json({ ok: true });
});

// Import character from PNG — parse metadata AND optionally save to collection
app.post('/api/characters/import/png', (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const { base64, save: shouldSave } = req.body;
  if (typeof base64 !== 'string' || !base64) return res.status(400).json({ error: 'Нет данных изображения' });
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

    // Keep the card art, but on disk rather than inside the JSON.
    const avatarPath = storeAvatar("data:image/png;base64," + base64);

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
      avatar:       avatarPath,
      avatar_emoji: '✦',
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
  const userId = requireUser(req, res);
  if (!userId) return;
  const chats = readJSON(CHATS_FILE);
  const key = keyStore.get(userId);
  res.json(chats.filter(c => c.userId === userId).map(c => key ? decryptChat(c, key) : c));
});

app.post('/api/chats', (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
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
  const userId = requireUser(req, res);
  if (!userId) return;
  const chats = readJSON(CHATS_FILE);
  const chat = chats.find(c => c.id === req.params.id && c.userId === userId);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  const key = keyStore.get(userId);
  res.json(key ? decryptChat(chat, key) : chat);
});

// Chat metadata: title and the rolling memory summary. Kept separate from the
// message list so saving a summary never rewrites the whole conversation.
app.patch('/api/chats/:id', (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const chats = readJSON(CHATS_FILE);
  const idx = chats.findIndex(c => c.id === req.params.id && c.userId === userId);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const key = keyStore.get(userId);
  if (req.body.title !== undefined) chats[idx].title = String(req.body.title).slice(0, 120);
  if (req.body.summary !== undefined) {
    const s = String(req.body.summary);
    chats[idx].summary = key && s ? encryptField(s, key) : s;
  }
  if (req.body.summarisedUpTo !== undefined) {
    chats[idx].summarisedUpTo = parseInt(req.body.summarisedUpTo, 10) || 0;
  }
  chats[idx].updatedAt = Date.now();
  writeJSON(CHATS_FILE, chats);
  res.json({ ok: true });
});

app.patch('/api/chats/:id/messages', (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
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

// Deleting every chat one by one meant one full file rewrite per chat, which
// froze the UI for minutes on a large collection. One call, one write.
app.delete('/api/chats', (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const chats = readJSON(CHATS_FILE);
  const kept  = chats.filter(c => c.userId !== userId);
  const removed = chats.length - kept.length;
  writeJSON(CHATS_FILE, kept);
  res.json({ ok: true, removed });
});

app.delete('/api/chats/:id', (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  let chats = readJSON(CHATS_FILE);
  chats = chats.filter(c => !(c.id === req.params.id && c.userId === userId));
  writeJSON(CHATS_FILE, chats);
  res.json({ ok: true });
});

// ─── AI PROXY (Stream) ───────────────────────────────────────────────────────

// Anthropic speaks a different dialect: POST /v1/messages, an x-api-key header,
// a separate `system` field and its own SSE event shape. The old code sent every
// provider to /chat/completions with a Bearer token, so the built-in "Anthropic"
// preset could never work — it just produced a confusing error.
const isAnthropic = (host) => /(^|\.)anthropic\.com$/i.test(host);

function buildUpstream({ provider, host, model, messages, systemPrompt, temperature, max_tokens, top_p }) {
  const base   = provider.baseUrl.replace(/\/+$/, '');
  const tokens = typeof max_tokens === 'number' ? Math.min(max_tokens, 16384) : 2048;

  if (isAnthropic(host)) {
    const body = {
      model: model || 'claude-sonnet-5',
      max_tokens: tokens,                       // required by Anthropic
      messages: messages.filter(m => m.role !== 'system'),
      stream: true,
    };
    if (systemPrompt) body.system = systemPrompt;
    if (typeof temperature === 'number') body.temperature = Math.min(temperature, 1); // caps at 1
    if (typeof top_p === 'number') body.top_p = top_p;
    return {
      url: `${base}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
        ...(provider.extraHeaders || {}),
      },
      body,
      dialect: 'anthropic',
    };
  }

  const body = {
    model: model || 'gpt-4o-mini',
    messages: systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages,
    stream: true,
    max_tokens: tokens,
  };
  if (typeof temperature === 'number') body.temperature = temperature;
  if (typeof top_p === 'number') body.top_p = top_p;
  return {
    url: `${base}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
      ...(provider.extraHeaders || {}),
    },
    body,
    dialect: 'openai',
  };
}

// Re-emit Anthropic's SSE as OpenAI-shaped chunks so the browser parser, and
// every other consumer, stays dialect-agnostic.
function anthropicToOpenAI(buffer, write) {
  let rest = buffer;
  let nl;
  while ((nl = rest.indexOf('\n')) !== -1) {
    const line = rest.slice(0, nl).trim();
    rest = rest.slice(nl + 1);
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const ev = JSON.parse(raw);
      if (ev.type === 'content_block_delta' && ev.delta?.text) {
        write(`data: ${JSON.stringify({ choices: [{ delta: { content: ev.delta.text } }] })}\n\n`);
      } else if (ev.type === 'message_stop') {
        write('data: [DONE]\n\n');
      } else if (ev.type === 'error') {
        write(`data: ${JSON.stringify({ error: ev.error?.message || 'Ошибка Anthropic' })}\n\n`);
      }
    } catch {}
  }
  return rest;
}

app.post('/api/chat/stream', async (req, res) => {
  // This used to be completely unauthenticated while the server listens on
  // 0.0.0.0, which let anyone on the network use it as an open proxy to any URL.
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { messages, provider, model, systemPrompt, temperature, max_tokens, top_p } = req.body;

  if (!provider || !provider.baseUrl) {
    return res.status(400).json({ error: 'Провайдер не настроен', code: 'NO_PROVIDER' });
  }
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  let target;
  try { target = new URL(provider.baseUrl); }
  catch { return res.status(400).json({ error: 'Некорректный адрес сервиса (Base URL)', code: 'BAD_URL' }); }
  if (!/^https?:$/.test(target.protocol)) {
    return res.status(400).json({ error: 'Base URL должен начинаться с http:// или https://', code: 'BAD_URL' });
  }
  // Local model servers (Ollama, LM Studio) legitimately have no key.
  const isLocal = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(target.hostname);
  if (!provider.apiKey && !isLocal) {
    return res.status(400).json({ error: 'Не указан API-ключ', code: 'NO_KEY' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let aborted = false;
  let upstream = null;
  req.on('close', () => {
    aborted = true;
    try { upstream?.body?.destroy(); } catch {}
  });

  try {
    const fetch = require('node-fetch');
    const spec = buildUpstream({
      provider, host: target.hostname, model, messages, systemPrompt, temperature, max_tokens, top_p,
    });

    upstream = await fetch(spec.url, {
      method: 'POST',
      headers: spec.headers,
      body: JSON.stringify(spec.body),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      // Pass the status through so the client can say something human
      // ("key is wrong", "out of credit") instead of dumping raw JSON.
      res.write(`data: ${JSON.stringify({ error: errText, status: upstream.status })}\n\n`);
      res.end();
      return;
    }

    if (spec.dialect === 'anthropic') {
      let buf = '';
      upstream.body.on('data', chunk => {
        if (aborted) return;
        buf += chunk.toString('utf8');
        buf = anthropicToOpenAI(buf, s => res.write(s));
      });
    } else {
      upstream.body.on('data', chunk => { if (!aborted) res.write(chunk); });
    }
    upstream.body.on('end',   () => { if (!aborted) res.end(); });
    upstream.body.on('error', () => { if (!aborted) res.end(); });

  } catch (e) {
    if (!aborted) {
      const code = e.code === 'ECONNREFUSED' ? 'CONN_REFUSED'
                 : /ENOTFOUND|EAI_AGAIN/.test(e.code || '') ? 'NO_NETWORK' : null;
      res.write(`data: ${JSON.stringify({ error: e.message, code })}\n\n`);
      res.end();
    }
  }
});

// ── ONE-SHOT COMPLETION ─────────────────────────────────────────────────────
// Used for chat summaries: a normal, non-streaming request whose answer the app
// needs in one piece rather than token by token.
app.post('/api/chat/complete', async (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { messages, provider, model, systemPrompt, temperature, max_tokens } = req.body || {};
  if (!provider?.baseUrl || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Провайдер не настроен', code: 'NO_PROVIDER' });
  }
  let target;
  try { target = new URL(provider.baseUrl); }
  catch { return res.status(400).json({ error: 'Некорректный адрес сервиса', code: 'BAD_URL' }); }
  if (!/^https?:$/.test(target.protocol)) {
    return res.status(400).json({ error: 'Некорректный адрес сервиса', code: 'BAD_URL' });
  }

  try {
    const fetch = require('node-fetch');
    const spec = buildUpstream({
      provider, host: target.hostname, model, messages, systemPrompt,
      temperature, max_tokens, top_p: undefined,
    });
    spec.body.stream = false;

    const r = await fetch(spec.url, { method: 'POST', headers: spec.headers, body: JSON.stringify(spec.body) });
    const raw = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: raw.slice(0, 400), status: r.status });

    const data = JSON.parse(raw);
    // OpenAI shape first, then Anthropic's.
    const text = data.choices?.[0]?.message?.content
              ?? (Array.isArray(data.content) ? data.content.map(b => b.text || '').join('') : '');
    res.json({ text: String(text || '') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CONNECTION TEST ─────────────────────────────────────────────────────────
// Lets the setup wizard tell the user "your key works" before they discover it
// doesn't by sending a message to a character and getting a raw API error.
app.post('/api/provider/test', async (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { baseUrl, apiKey, model } = req.body || {};
  let target;
  try { target = new URL(String(baseUrl || '')); }
  catch { return res.json({ ok: false, code: 'BAD_URL', error: 'Некорректный адрес сервиса' }); }
  if (!/^https?:$/.test(target.protocol)) {
    return res.json({ ok: false, code: 'BAD_URL', error: 'Адрес должен начинаться с http:// или https://' });
  }

  const started = Date.now();
  try {
    const fetch = require('node-fetch');
    const spec = buildUpstream({
      provider: { baseUrl, apiKey }, host: target.hostname, model,
      messages: [{ role: 'user', content: 'Hi' }],
      systemPrompt: '', temperature: 0, max_tokens: 8, top_p: 1,
    });
    spec.body.stream = false;

    const r = await fetch(spec.url, {
      method: 'POST', headers: spec.headers, body: JSON.stringify(spec.body),
    });
    const text = await r.text();

    if (r.ok) return res.json({ ok: true, ms: Date.now() - started, model: spec.body.model });
    return res.json({ ok: false, status: r.status, error: text.slice(0, 400) });
  } catch (e) {
    const code = e.code === 'ECONNREFUSED' ? 'CONN_REFUSED'
               : /ENOTFOUND|EAI_AGAIN/.test(e.code || '') ? 'NO_NETWORK' : null;
    return res.json({ ok: false, code, error: e.message });
  }
});

// ── MODEL LIST ──────────────────────────────────────────────────────────────
// The browser used to call the provider's /models directly, which most of them
// block by CORS — so the button silently fell back to a hardcoded 2024 list and
// leaked the API key straight out of the page. Go through the server instead.
app.post('/api/models', async (req, res) => {
  const userId = verifyToken(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { baseUrl, apiKey } = req.body || {};
  let target;
  try { target = new URL(String(baseUrl || '')); }
  catch { return res.status(400).json({ error: 'Некорректный адрес сервиса' }); }
  if (!/^https?:$/.test(target.protocol)) {
    return res.status(400).json({ error: 'Некорректный адрес сервиса' });
  }

  const base = String(baseUrl).replace(/\/+$/, '');
  const headers = isAnthropic(target.hostname)
    ? { 'x-api-key': apiKey || '', 'anthropic-version': '2023-06-01' }
    : { 'Authorization': `Bearer ${apiKey || ''}` };

  try {
    const result = await proxyFetch(`${base}/models`, { headers });
    if (result.status !== 200) {
      return res.status(result.status).json({ error: `Сервис вернул ${result.status}`, models: [] });
    }
    const data = JSON.parse(result.body);
    let models = [];
    if (Array.isArray(data))             models = data;
    else if (Array.isArray(data.data))   models = data.data;
    else if (Array.isArray(data.models)) models = data.models;
    models = models
      .map(m => (typeof m === 'string' ? m : (m.id || m.name || '')))
      .filter(Boolean);
    res.json({ models });
  } catch (e) {
    res.status(500).json({ error: e.message, models: [] });
  }
});


// ─── CHUB.AI PROXY ──────────────────────────────────────────────────────────
// Browser can't hit Chub directly (CORS), we proxy through here

const https = require('https');
const http  = require('http');
const os    = require('os');

// Every non-internal IPv4 address, so the app can show a "open this on your
// phone" address instead of telling a beginner to run ipconfig.
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

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
        'User-Agent':  'Mozilla/5.0 (compatible)',
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
    // Without this, probing a local port that nothing answers on hangs until the
    // OS gives up, which would stall the "is Ollama running?" check on startup.
    req.setTimeout(options.timeout || 15000, () => {
      req.destroy(new Error('timeout'));
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
    // Only allow chub domains — validate hostname properly to prevent SSRF
    try {
      const parsed = new URL(decodeURIComponent(url));
      const host = parsed.hostname.toLowerCase();
      const allowed = ['chub.ai', 'charhub.io', 'characterhub.io'];
      if (!allowed.some(d => host === d || host.endsWith('.' + d))) {
        return res.status(403).send('Forbidden');
      }
    } catch { return res.status(400).send('Invalid URL'); }
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
  // Used to be open: anyone reaching the port could enumerate every account.
  if (!verifyToken(req)) return res.status(401).json({ error: 'Unauthorized' });
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
  if (!verifyToken(req)) return res.status(401).json({ error: 'Unauthorized' });
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
  flushAll(); // never restart on top of unflushed writes
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

// ─── LOCAL MODEL SERVERS ────────────────────────────────────────────────────
// A newcomer with no API key and no idea what one is can still be up and running
// in one click if Ollama or LM Studio is already installed. Look for them.
const LOCAL_SERVERS = [
  { id: 'ollama',   name: 'Ollama',    baseUrl: 'http://localhost:11434/v1', icon: '🦙' },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1',  icon: '🎨' },
];

app.get('/api/local/detect', async (req, res) => {
  if (!verifyToken(req)) return res.status(401).json({ error: 'Unauthorized' });
  const found = [];
  await Promise.all(LOCAL_SERVERS.map(async srv => {
    try {
      const r = await proxyFetch(`${srv.baseUrl}/models`, { timeout: 1200 });
      if (r.status !== 200) return;
      const data = JSON.parse(r.body);
      const list = (data.data || data.models || [])
        .map(m => (typeof m === 'string' ? m : (m.id || m.name || '')))
        .filter(Boolean);
      found.push({ ...srv, models: list });
    } catch {}
  }));
  res.json({ found });
});

// ─── BACKUP / RESTORE ───────────────────────────────────────────────────────
// "Экспорт данных" used to write only the settings — with the API keys in the
// clear and no way to import them back. This is the real thing.
app.get('/api/backup', (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const withKeys = req.query.keys === '1';
  const key = keyStore.get(userId);

  // Avatars are inlined so the backup file is self-contained and can be moved
  // to another machine on its own.
  const chars = readJSON(CHARS_FILE)
    .filter(c => c.ownerId === userId)
    .map(c => ({ ...decryptCharacter(c, key), avatar: inlineAvatar(c.avatar) }));
  const chats = readJSON(CHATS_FILE)
    .filter(c => c.userId === userId)
    .map(c => ({ ...decryptChat(c, key), characterAvatar: inlineAvatar(c.characterAvatar) }));

  const allSettings = readJSON(SETTINGS_FILE);
  let settings = allSettings[userId] ? JSON.parse(JSON.stringify(allSettings[userId])) : {};
  if (key) {
    if (settings.providers?.length) settings.providers = decryptProviders(settings.providers, key);
    settings = decryptSettings(settings, key);
  }
  if (!withKeys && settings.providers) {
    settings.providers = settings.providers.map(p => ({ ...p, apiKey: '' }));
  }

  res.json({
    format: 'wesaid-backup', version: 1, exportedAt: Date.now(),
    containsApiKeys: withKeys, characters: chars, chats, settings,
  });
});

app.post('/api/restore', (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const backup = req.body || {};
  if (backup.format !== 'wesaid-backup') {
    return res.status(400).json({ error: 'Это не файл резервной копии wesaid' });
  }
  const key = keyStore.get(userId);
  const stats = { characters: 0, chats: 0, settings: false };

  try {
    if (Array.isArray(backup.characters) && backup.characters.length) {
      const chars = readJSON(CHARS_FILE);
      const existing = new Set(chars.filter(c => c.ownerId === userId).map(c => c.id));
      for (const c of backup.characters) {
        if (!c?.name || existing.has(c.id)) continue; // never clobber what is already here
        chars.push(encryptCharacter({
          ...c, id: c.id || uuidv4(), ownerId: userId, avatar: storeAvatar(c.avatar) || null,
        }, key));
        stats.characters++;
      }
      writeJSON(CHARS_FILE, chars);
    }

    if (Array.isArray(backup.chats) && backup.chats.length) {
      const chats = readJSON(CHATS_FILE);
      const existing = new Set(chats.filter(c => c.userId === userId).map(c => c.id));
      for (const c of backup.chats) {
        if (!c?.id || existing.has(c.id)) continue;
        chats.push(encryptChat({
          ...c, userId, characterAvatar: storeAvatar(c.characterAvatar) || null,
        }, key));
        stats.chats++;
      }
      writeJSON(CHATS_FILE, chats);
    }

    if (backup.settings && typeof backup.settings === 'object') {
      const all = readJSON(SETTINGS_FILE);
      let s = JSON.parse(JSON.stringify(backup.settings));
      // A backup made without keys must not wipe the keys already configured.
      const currentProviders = all[userId]?.providers || [];
      if (s.providers?.length) {
        s.providers = s.providers.map(p => {
          if (p.apiKey) return p;
          const known = currentProviders.find(x => x.id === p.id);
          return known ? { ...p, apiKey: known.apiKey } : p;
        });
        s.providers = encryptProviders(s.providers, key);
      }
      all[userId] = encryptSettings(s, key);
      writeJSON(SETTINGS_FILE, all);
      stats.settings = true;
    }

    flushAll();
    res.json({ ok: true, ...stats });
  } catch (e) {
    console.error('Restore failed:', e);
    res.status(500).json({ error: 'Не удалось восстановить: ' + e.message });
  }
});

// ─── NETWORK INFO (for the phone QR code) ───────────────────────────────────
app.get('/api/netinfo', (req, res) => {
  if (!verifyToken(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ port: ACTIVE_PORT, addresses: lanAddresses().map(ip => `http://${ip}:${ACTIVE_PORT}`) });
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

// Unknown API routes must not fall through to the SPA — the client then tried to
// JSON.parse an HTML page and reported "Unexpected token <" instead of a 404.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Неизвестный запрос: ${req.method} /api${req.path}` });
});

// Serve SPA for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── START ───────────────────────────────────────────────────────────────────
// A busy port used to print a raw Node stack trace into a black window, which
// tells a first-time user nothing. Try the next few ports, then explain.
function start(port, attemptsLeft = 10) {
  const server = app.listen(port, '0.0.0.0', () => {
    ACTIVE_PORT = port;
    const lan = lanAddresses();
    console.log('');
    console.log('  ┌─────────────────────────────────────────────┐');
    console.log('  │  wesaid запущен                             │');
    console.log('  └─────────────────────────────────────────────┘');
    console.log('');
    console.log(`  На этом компьютере:  http://localhost:${port}`);
    if (lan.length) {
      console.log(`  С телефона (та же сеть):  http://${lan[0]}:${port}`);
      console.log('  (QR-код для телефона есть в Настройках)');
    }
    console.log('');
    console.log('  Чтобы остановить — закройте это окно или нажмите Ctrl+C');
    console.log('');
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      if (attemptsLeft > 0) {
        console.log(`  Порт ${port} занят, пробую ${port + 1}…`);
        return start(port + 1, attemptsLeft - 1);
      }
      console.error('');
      console.error('  ❌ Не удалось занять ни один порт.');
      console.error('');
      console.error('  Скорее всего wesaid уже запущен в другом окне.');
      console.error('  Проверьте панель задач, либо перезагрузите компьютер и попробуйте снова.');
      console.error('');
    } else if (e.code === 'EACCES') {
      console.error(`\n  ❌ Нет прав на порт ${port}. Попробуйте порт больше 1024.\n`);
    } else {
      console.error('\n  ❌ Не удалось запустить сервер:', e.message, '\n');
    }
    process.exit(1);
  });
}

let ACTIVE_PORT = PORT;
migrateEmbeddedAvatars();
start(PORT);
