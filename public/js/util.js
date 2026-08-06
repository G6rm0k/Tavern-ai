// ── SHARED HELPERS ────────────────────────────────────────────────────────────
// Loaded first. Uses function declarations on purpose: they are hoisted, so any
// module can call these regardless of script order.

// Escape text destined for innerHTML. Character names, descriptions and greetings
// come from Chub.ai — that is third-party content, and it used to be injected
// raw, which let a crafted name run scripts on the page where the decrypted API
// key lives.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escape for use inside an HTML attribute, e.g. value="...".
function escAttr(s) { return esc(s); }

// Escape for use inside a single-quoted JS string in an inline handler,
// e.g. onclick="Foo.bar('...')".
function escJs(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/</g, '\\u003c')
    .replace(/\r?\n/g, ' ');
}

// ── HUMAN-READABLE ERRORS ────────────────────────────────────────────────────
// Providers answer with raw JSON blobs that mean nothing to someone who just
// bought their first PC. Translate the common ones and, where possible, hand
// back an action so the toast can offer a way out.

function humanError(err) {
  const raw    = typeof err === 'string' ? err : (err?.error || err?.message || '');
  const status = err?.status;
  const code   = err?.code;
  const low    = String(raw).toLowerCase();

  const R = (text, action) => ({ text, action: action || null });

  if (code === 'NO_PROVIDER')  return R('Сервис не подключён — зайди в Настройки и добавь его', 'settings');
  if (code === 'NO_KEY')       return R('Не указан API-ключ', 'settings');
  if (code === 'BAD_URL')      return R('Неверный адрес сервиса (Base URL)', 'settings');
  if (code === 'CONN_REFUSED' || low.includes('econnrefused')) {
    if (low.includes('11434')) return R('Ollama не запущена. Открой приложение Ollama и попробуй снова');
    if (low.includes('1234'))  return R('LM Studio не запущен. Включи в нём сервер (вкладка Server)');
    return R('Не удалось подключиться к сервису. Он точно запущен?', 'settings');
  }
  if (code === 'NO_NETWORK' || low.includes('enotfound') || low.includes('eai_again')) {
    return R('Нет интернета — проверь подключение');
  }

  if (status === 401 || status === 403 || low.includes('invalid api key') || low.includes('unauthorized')) {
    return R('Ключ не подошёл. Проверь, что скопировал его целиком', 'settings');
  }
  if (status === 402 || low.includes('insufficient') || low.includes('quota') || low.includes('credit') || low.includes('billing')) {
    return R('На балансе сервиса кончились деньги', 'settings');
  }
  if (status === 429 || low.includes('rate limit') || low.includes('too many requests')) {
    return R('Слишком много запросов подряд. Подожди минуту и повтори');
  }
  if (status === 404 || low.includes('model_not_found') || low.includes('does not exist') || low.includes('unknown model')) {
    return R('Такой модели нет у этого сервиса. Выбери другую', 'settings');
  }
  if (status === 400 && low.includes('context')) {
    return R('Слишком длинная переписка для этой модели. Уменьши «Контекст» в настройках', 'settings');
  }
  if (status >= 500) return R('Сервис временно недоступен. Попробуй через пару минут');

  // Try to dig a message out of the provider's JSON before giving up.
  try {
    const j = JSON.parse(raw);
    const m = j.error?.message || j.error || j.message;
    if (m) return R(String(m).slice(0, 200));
  } catch {}

  return R(String(raw || 'Что-то пошло не так').slice(0, 200));
}

// Show a mapped error, with a button when there is something to do about it.
function toastError(err) {
  const { text, action } = humanError(err);
  if (action === 'settings') {
    toastAction(text, 'Настройки', () => App.navigate('settings'));
  } else {
    toast(text, 'error');
  }
}
