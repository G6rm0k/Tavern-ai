// ── MODEL LOADER ───────────────────────────────────────────────────────────────
const ModelLoader = {

  fallbacks: {
    openai:     ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o1-mini', 'o3-mini'],
    anthropic:  ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
    groq:       ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    deepseek:   ['deepseek-chat', 'deepseek-reasoner'],
    mistral:    ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest'],
    xai:        ['grok-2-1212', 'grok-2-vision-1212', 'grok-beta'],
    cohere:     ['command-r-plus', 'command-r', 'command-light'],
    together:   ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],
    openrouter: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro-1.5', 'meta-llama/llama-3.1-70b-instruct'],
    vsegpt:     ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro', 'meta-llama/Llama-3-70b-chat-hf'],
    ollama:     ['llama3.2', 'llama3.1', 'mistral', 'phi3', 'gemma2', 'qwen2.5', 'deepseek-r1'],
    lmstudio:   ['local-model'],
  },

  _key(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('openrouter')) return 'openrouter';
    if (n.includes('vsegpt'))     return 'vsegpt';
    if (n.includes('openai'))     return 'openai';
    if (n.includes('anthropic'))  return 'anthropic';
    if (n.includes('groq'))       return 'groq';
    if (n.includes('deepseek'))   return 'deepseek';
    if (n.includes('mistral'))    return 'mistral';
    if (n.includes('xai') || n.includes('grok')) return 'xai';
    if (n.includes('cohere'))     return 'cohere';
    if (n.includes('together'))   return 'together';
    if (n.includes('ollama'))     return 'ollama';
    if (n.includes('lm studio') || n.includes('lmstudio')) return 'lmstudio';
    return null;
  },

  getFallback(provider) {
    const key = this._key(provider?.name);
    return this.fallbacks[key] || [];
  },

  // Fetch from provider's /models endpoint
  async fetchModels(provider) {
    if (!provider?.baseUrl) return [];
    try {
      const url = provider.baseUrl.replace(/\/$/, '') + '/models';
      const headers = { 'Content-Type': 'application/json' };
      if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      let models = [];
      if (Array.isArray(data))             models = data.map(m => m.id || m.name || m);
      else if (Array.isArray(data.data))   models = data.data.map(m => m.id || m.name || m);
      else if (Array.isArray(data.models)) models = data.models.map(m => m.name || m.id || m);
      models = models.filter(m => typeof m === 'string' && m.length > 0);
      models.sort((a, b) => {
        const ac = /chat|instruct|turbo|sonnet|gpt-4|claude|gemini/i.test(a);
        const bc = /chat|instruct|turbo|sonnet|gpt-4|claude|gemini/i.test(b);
        return (ac === bc) ? a.localeCompare(b) : ac ? -1 : 1;
      });
      return models;
    } catch(e) {
      console.log('fetchModels failed:', e.message);
      return [];
    }
  },

  // ── RENDER: just a text input + dropdown suggestions ─────────────────────────
  // No fancy picker — simple input that user can type in,
  // with a collapsible list below showing available models
  renderModelInput(containerId, provider, currentModel, onChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const fallback = this.getFallback(provider);
    const listId   = containerId + '-list';

    container.innerHTML = `
      <div class="ml-wrap">
        <div class="ml-input-row">
          <input class="ml-input" id="${containerId}-inp"
            value="${currentModel || ''}"
            placeholder="Введи название модели…"
            autocomplete="off" autocorrect="off" spellcheck="false"
            style="-webkit-user-select:text;user-select:text" />
          <button class="ml-load-btn" id="${containerId}-load" title="Загрузить модели с провайдера">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
          </button>
        </div>
        <div class="ml-list" id="${listId}" style="display:none"></div>
      </div>`;

    const inp  = document.getElementById(`${containerId}-inp`);
    const btn  = document.getElementById(`${containerId}-load`);
    const list = document.getElementById(listId);

    // User typing → call onChange immediately
    inp.addEventListener('input', () => {
      if (onChange) onChange(inp.value.trim());
      this._filterList(list, inp.value);
    });
    inp.addEventListener('blur', () => {
      setTimeout(() => { list.style.display = 'none'; }, 200);
    });
    inp.addEventListener('focus', () => {
      if (list.children.length > 0) list.style.display = 'block';
    });

    // Load button → fetch from API then show dropdown
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = '<div class="loader-ring" style="width:14px;height:14px;border-width:2px"></div>';
      let models = await this.fetchModels(provider);
      if (!models.length) models = fallback;
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>`;
      this._fillList(list, models, inp.value, (m) => {
        inp.value = m;
        if (onChange) onChange(m);
        list.style.display = 'none';
      });
      list.style.display = 'block';
      toast(`Загружено ${models.length} моделей`, 'success');
    });

    // Show fallback immediately if available
    if (fallback.length) {
      this._fillList(list, fallback, currentModel, (m) => {
        inp.value = m;
        if (onChange) onChange(m);
        list.style.display = 'none';
      });
    }
  },

  _fillList(list, models, current, onClick) {
    list.innerHTML = models.map(m => `
      <button class="ml-item ${m === current ? 'on' : ''}" data-m="${m.replace(/"/g,'&quot;')}">
        ${m}
        ${m === current ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
      </button>`).join('');
    list.querySelectorAll('.ml-item').forEach(b => {
      b.addEventListener('mousedown', e => { e.preventDefault(); onClick(b.dataset.m); });
    });
  },

  _filterList(list, q) {
    if (!q) { list.querySelectorAll('.ml-item').forEach(b => b.style.display = ''); return; }
    list.querySelectorAll('.ml-item').forEach(b => {
      b.style.display = b.dataset.m.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
    });
    list.style.display = 'block';
  },

  // Legacy — kept for compat but now unused
  async renderPicker(provider, currentModel, onSelect) {
    const d = document.createElement('div');
    d.id = 'ml-compat-' + Date.now();
    document.body.appendChild(d);
    this.renderModelInput(d.id, provider, currentModel, onSelect);
    return d.firstElementChild;
  },
};
