// ── SETTINGS v4 (mobile-first rewrite) ───────────────────────────────────────
const API_PRESETS = [
  { id:'openai',     name:'OpenAI',          baseUrl:'https://api.openai.com/v1',              icon:'🟢', models:['gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-3.5-turbo'] },
  { id:'openrouter', name:'OpenRouter',       baseUrl:'https://openrouter.ai/api/v1',           icon:'🔵', models:['openai/gpt-4o','anthropic/claude-3.5-sonnet','meta-llama/llama-3.1-70b-instruct','google/gemini-pro-1.5'] },
  { id:'vsegpt',     name:'VseGPT',           baseUrl:'https://api.vsegpt.ru/v1',               icon:'🇷🇺', models:['openai/gpt-4o','anthropic/claude-3.5-sonnet','google/gemini-pro'] },
  { id:'ollama',     name:'Ollama (Local)',   baseUrl:'http://localhost:11434/v1',              icon:'🦙', models:['llama3.2','mistral','phi3','gemma2','qwen2.5'] },
  { id:'lmstudio',   name:'LM Studio',        baseUrl:'http://localhost:1234/v1',               icon:'🎨', models:['local-model'] },
  { id:'groq',       name:'Groq',             baseUrl:'https://api.groq.com/openai/v1',         icon:'⚡', models:['llama-3.1-70b-versatile','llama-3.1-8b-instant','mixtral-8x7b-32768'] },
  { id:'together',   name:'Together AI',      baseUrl:'https://api.together.xyz/v1',            icon:'🤝', models:['meta-llama/Llama-3-70b-chat-hf','mistralai/Mixtral-8x7B-Instruct-v0.1'] },
  { id:'mistral',    name:'Mistral AI',       baseUrl:'https://api.mistral.ai/v1',              icon:'🌬️', models:['mistral-large-latest','mistral-medium-latest','mistral-small-latest'] },
  { id:'anthropic',  name:'Anthropic',        baseUrl:'https://api.anthropic.com/v1',           icon:'🟠', models:['claude-3-5-sonnet-20241022','claude-3-opus-20240229','claude-3-haiku-20240307'] },
  { id:'deepseek',   name:'DeepSeek',         baseUrl:'https://api.deepseek.com/v1',            icon:'🔮', models:['deepseek-chat','deepseek-reasoner'] },
  { id:'cohere',     name:'Cohere',           baseUrl:'https://api.cohere.ai/compatibility/v1', icon:'🌊', models:['command-r-plus','command-r'] },
  { id:'xai',        name:'xAI (Grok)',       baseUrl:'https://api.x.ai/v1',                   icon:'𝕏',  models:['grok-beta'] },
  { id:'custom',     name:'Custom',           baseUrl:'',                                       icon:'⚙️', models:[] }
];

const MP_PRESETS = {
  creative: { temperature:1.2, topP:.95, topK:60, maxTokens:2048, contextMessages:30 },
  balanced: { temperature:.8,  topP:.90, topK:40, maxTokens:1024, contextMessages:20 },
  precise:  { temperature:.3,  topP:.70, topK:20, maxTokens:512,  contextMessages:15 },
};

// Model param slider names — only these are saved by saveMP
const MP_SLIDER_NAMES = ['temperature','maxTokens','topP','topK','contextMessages'];

const Settings = {
  data: {
    providers:[], activeProviderId:null,
    mp: { temperature:.8, maxTokens:1024, topP:.9, topK:40, contextMessages:20, globalSystem:'' },
    app: { theme:'dark', accent:'orange', animations:true, autoscroll:true, sound:false },
    language:'ru',
  },

  async load() {
    try {
      const s = await API.getSettings();
      if (s && Object.keys(s).length) {
        this.data = { ...this.data, ...s };
        if (!this.data.mp)  this.data.mp  = MP_PRESETS.balanced;
        if (!this.data.app) this.data.app = { theme:'dark', accent:'purple', animations:true, autoscroll:true, sound:false };
        // Clean stale keys that leaked into mp from old bug
        for (const k of Object.keys(this.data.mp)) {
          if (!MP_SLIDER_NAMES.includes(k) && k !== 'globalSystem') delete this.data.mp[k];
        }
      }
    } catch {}
    this._apply();
    i18n.setLang(this.data.language || 'ru');
    Anim.enabled      = this.data.app?.animations !== false;
    Anim.speedFactor  = this.data.app?.animSpeed ?? 1;
    Sounds.enabled    = !!this.data.app?.sound;
  },

  async save() { try { await API.saveSettings(this.data); } catch {} },

  _apply() {
    document.documentElement.setAttribute('data-theme',  this.data.app?.theme  || 'dark');
    const color = this.data.app?.accentColor || '#f97316';
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--accent-glow', color + '66');
    document.documentElement.style.setProperty('--accent-ultra', color + '18');
    document.documentElement.style.setProperty('--accent-bright', color);
  },

  getActive() { return this.data.providers.find(p => p.id === this.data.activeProviderId) || null; },
  getMP()     { return this.data.mp || MP_PRESETS.balanced; },

  // ── SETUP PAGE ──────────────────────────────────────────────────────────────
  renderSetup() {
    const el = document.getElementById('page-setup');
    el.innerHTML = `
      <div class="setup-wrap">
        <div class="setup-hd">
          <h1>${t('setup.title')}</h1>
          <p>${t('setup.subtitle')}</p>
        </div>
        <div class="setup-card">
          <label style="margin-bottom:10px">Quick Presets</label>
          <div class="preset-grid" id="setup-presets">
            ${API_PRESETS.map(p=>`
              <button class="preset-btn" data-name="${p.name}" data-url="${p.baseUrl}" data-model="${p.models[0]||''}">
                <span class="preset-icon">${p.icon}</span><span>${p.name}</span>
              </button>`).join('')}
          </div>
          <div class="form-group"><label>${t('setup.name')}</label><input id="su-name" placeholder="My Provider" /></div>
          <div class="form-group"><label>${t('setup.url')}</label><input id="su-url" placeholder="https://api.openai.com/v1" /></div>
          <div class="form-group"><label>${t('setup.key')}</label><input id="su-key" type="password" placeholder="sk-..." /></div>
          <div class="form-group">
            <label>${t('setup.model')}</label>
            <div id="su-model-wrap"></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button class="btn btn-ghost" id="su-skip">${t('setup.skip')}</button>
            <button class="btn btn-primary" style="flex:1" id="su-save">${t('setup.save')}</button>
          </div>
        </div>
      </div>`;

    ModelLoader.renderModelInput('su-model-wrap', { name:'', baseUrl:'', apiKey:'' }, '', () => {});

    el.querySelectorAll('.preset-btn').forEach(b => b.addEventListener('click', () => {
      el.querySelectorAll('.preset-btn').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); Anim.bounce(b);
      document.getElementById('su-name').value = b.dataset.name;
      document.getElementById('su-url').value  = b.dataset.url;
      ModelLoader.renderModelInput('su-model-wrap',
        { name: b.dataset.name, baseUrl: b.dataset.url, apiKey: '' }, b.dataset.model, () => {});
    }));
    document.getElementById('su-skip').onclick = () => App.showMain();
    document.getElementById('su-save').onclick = () => this._saveSetup();
  },

  async _saveSetup() {
    const name = document.getElementById('su-name').value.trim();
    const url  = document.getElementById('su-url').value.trim();
    const key  = document.getElementById('su-key').value.trim();
    const mdl  = document.getElementById('su-model-wrap-inp')?.value.trim() || '';
    if (!name || !url) { toast('Name and URL required', 'error'); return; }
    const p = { id: Date.now().toString(), name, baseUrl: url, apiKey: key, model: mdl || 'gpt-4o-mini' };
    this.data.providers.push(p);
    this.data.activeProviderId = p.id;
    await this.save();
    App.showMain();
  },

  // ── MAIN SETTINGS VIEW (mobile-first rewrite v2) ───────────────────────────
  renderView(el) {
    const a      = this.data.app || {};
    const mp     = this.data.mp  || MP_PRESETS.balanced;
    const ai     = this.data.activeProviderId;
    const accent = a.accentColor || '#f97316';

    const provRows = this.data.providers.map(p => {
      const active = p.id === ai;
      const pre    = API_PRESETS.find(x => x.name === p.name);
      return `
        <div class="sp-row ${active ? 'active' : ''}">
          <span class="sp-icon">${pre?.icon || '⚙️'}</span>
          <div class="sp-body">
            <div class="sp-name">${p.name}${active ? ' <span class="sp-badge">✓</span>' : ''}</div>
            <div class="sp-sub">${p.model || '—'}</div>
          </div>
          <div class="sp-btns">
            ${!active ? `<button class="sp-pill" onclick="Settings.setActive('${p.id}')">✓</button>` : ''}
            <button class="sp-icon-btn" onclick="Settings.editProv('${p.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="sp-icon-btn danger" onclick="Settings.delProv('${p.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
            </button>
          </div>
        </div>`;
    }).join('') || `<div class="sp-empty">Нет провайдеров</div>`;

    const tp     = mp.temperature;
    const curPre = tp >= 1.1 ? 'creative' : tp <= .45 ? 'precise' : 'balanced';

    el.innerHTML = `
    <div class="sv-wrap">

      <!-- AI Providers -->
      <div class="sv-card">
        <div class="sv-title">✦ Сервисы</div>
        <div class="sv-provs">${provRows}</div>
        <button class="sv-add" onclick="Settings.addProv()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Добавить провайдера
        </button>
      </div>

      <!-- Model params -->
      <div class="sv-card">
        <div class="sv-title">◆ Параметры модели</div>
        <div class="sv-chips">
          ${[['creative','◇','Творч.'],['balanced','◈','Баланс'],['precise','◆','Точный']]
            .map(([k,ico,lbl]) => `
              <button class="sv-chip ${curPre===k?'on':''}" onclick="Settings.applyPreset('${k}')">
                <span>${ico}</span><small>${lbl}</small>
              </button>`).join('')}
        </div>
        <div class="sv-sliders" id="sv-mp-sliders">
          ${this._sl('temperature',     'Температура',  mp.temperature,     0,   2,    .05)}
          ${this._sl('maxTokens',       'Макс. токены', mp.maxTokens,       64,  4096, 64)}
          ${this._sl('topP',            'Top P',        mp.topP,            .1,  1,    .05)}
          ${this._sl('topK',            'Top K',        mp.topK,            1,   100,  1)}
          ${this._sl('contextMessages', 'Контекст',     mp.contextMessages, 2,   100,  2)}
        </div>
        <div class="sv-field">
          <div class="sv-label">Инструкции</div>
          <textarea id="sv-gsys" class="sv-textarea" rows="3"
            placeholder="Отвечай только на русском языке.">${mp.globalSystem || ''}</textarea>
        </div>
        <button class="sv-save" onclick="Settings.saveMP()">Сохранить</button>
      </div>

      <!-- Appearance -->
      <div class="sv-card">
        <div class="sv-title">◈ Внешний вид</div>
        <div class="sv-label">Тема</div>
        <div class="sv-2col">
          <button class="sv-opt ${a.theme !== 'light' ? 'on' : ''}" onclick="Settings.setTheme('dark')">🌙 Тёмная</button>
          <button class="sv-opt ${a.theme === 'light'  ? 'on' : ''}" onclick="Settings.setTheme('light')">☀️ Светлая</button>
        </div>
        <div class="sv-label">Цвет акцента</div>
        <div class="sv-color-row">
          <label class="sv-color-circle" style="background:${accent}" id="sv-color-circle">
            <input type="color" id="sv-color-inp" value="${accent}"
              oninput="document.getElementById('sv-color-circle').style.background=this.value;document.getElementById('sv-color-hex').textContent=this.value"
              onchange="Settings.setAccentColor(this.value)" />
            <div class="sv-color-shine"></div>
          </label>
          <div class="sv-color-info">
            <span class="sv-color-hex" id="sv-color-hex">${accent}</span>
            <span class="sv-color-hint">Нажми на круг</span>
          </div>
        </div>
        <div class="sv-sep"></div>
        ${this._tog('animations', '✦ Анимации',   'Плавные переходы',        a.animations !== false)}
        <div id="sv-speed-wrap" style="${a.animations === false ? 'opacity:.4;pointer-events:none' : ''}">
          ${this._sl('animSpeed', 'Скорость', a.animSpeed ?? 1, 0.2, 3, 0.1, v => (v*100).toFixed(0)+'%')}
        </div>
        ${this._tog('autoscroll', '⬇️ Автоскролл', 'К новым сообщениям',      a.autoscroll !== false)}
        ${this._tog('sound',      '🔔 Звуки',      'При получении сообщения',  !!a.sound)}
      </div>

      <!-- Language -->
      <div class="sv-card">
        <div class="sv-title">🌐 Язык</div>
        <div class="sv-2col">
          <button class="sv-opt ${i18n.lang === 'ru' ? 'on' : ''}" onclick="Settings.setLang('ru')">🇷🇺 Русский</button>
          <button class="sv-opt ${i18n.lang === 'en' ? 'on' : ''}" onclick="Settings.setLang('en')">🇬🇧 English</button>
        </div>
      </div>

      <!-- Data -->
      <div class="sv-card">
        <div class="sv-title">🗃️ Данные</div>
        <button class="sv-action" onclick="Settings.exportData()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Экспорт данных
        </button>
        <button class="sv-action danger" onclick="Settings.clearAllChats()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          Удалить все чаты
        </button>
        <button class="sv-action danger" onclick="Settings.resetSettings()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          Сбросить настройки
        </button>
      </div>

      <!-- About -->
      <div class="sv-card">
        <div class="sv-about">
          <div class="sv-about-logo">wesaid</div>
          <div class="sv-about-ver">v3.0.0</div>
          <div class="sv-about-desc">Chat Frontend</div>
        </div>
      </div>

    </div>`;

    // Bind model param sliders (inside #sv-mp-sliders only)
    const mpWrap = document.getElementById('sv-mp-sliders');
    if (mpWrap) mpWrap.querySelectorAll('input[type="range"]').forEach(s => this._bindSlider(s));

    // Bind anim speed slider (outside mp-sliders)
    const animSlider = el.querySelector('#sv-speed-wrap input[type="range"]');
    if (animSlider) {
      this._bindSlider(animSlider);
      animSlider.addEventListener('change', () => {
        this.data.app.animSpeed = parseFloat(animSlider.value);
        Anim.speedFactor = this.data.app.animSpeed;
        this.save();
      });
    }

    // Bind toggles
    el.querySelectorAll('.sv-tog').forEach(tog =>
      tog.addEventListener('change', () => this._handleTog(tog.name, tog.checked)));
  },

  _sl(name, label, value, min, max, step, fmt) {
    const pct  = ((value - min) / (max - min) * 100).toFixed(1);
    const disp = fmt ? fmt(value) : (Number.isInteger(value) ? value : parseFloat(value).toFixed(2));
    return `
      <div class="sv-slider">
        <div class="sv-slider-hd">
          <span class="sv-label">${label}</span>
          <span class="sv-val" id="sv-${name}">${disp}</span>
        </div>
        <input type="range" name="${name}" min="${min}" max="${max}" step="${step}"
               value="${value}" style="--pct:${pct}%" />
      </div>`;
  },

  _bindSlider(s) {
    const valEl = document.getElementById(`sv-${s.name}`);
    const isInt = Number.isInteger(parseFloat(s.step));
    const isAnimSpeed = s.name === 'animSpeed';
    const update = () => {
      const v   = parseFloat(s.value);
      const pct = ((v - parseFloat(s.min)) / (parseFloat(s.max) - parseFloat(s.min)) * 100).toFixed(1);
      s.style.setProperty('--pct', pct + '%');
      if (valEl) valEl.textContent = isAnimSpeed ? (v * 100).toFixed(0) + '%' : isInt ? Math.round(v) : v.toFixed(2);
    };
    s.addEventListener('input', update);
    update();
  },

  _tog(name, label, desc, checked) {
    return `
      <div class="sv-tog-row">
        <div class="sv-tog-text">
          <div class="sv-tog-name">${label}</div>
          <div class="sv-tog-desc">${desc}</div>
        </div>
        <label class="sv-toggle">
          <input class="sv-tog" type="checkbox" name="${name}" ${checked ? 'checked' : ''}>
          <span class="sv-track"></span>
        </label>
      </div>`;
  },

  _handleTog(name, val) {
    if (!this.data.app) this.data.app = {};
    this.data.app[name] = val;
    if (name === 'animations') {
      Anim.enabled = val;
      const wrap = document.getElementById('sv-speed-wrap');
      if (wrap) { wrap.style.opacity = val ? '1' : '.4'; wrap.style.pointerEvents = val ? 'auto' : 'none'; }
    }
    if (name === 'sound') Sounds.enabled = val;
    this.save();
  },

  applyPreset(k) {
    const p = MP_PRESETS[k]; if (!p) return;
    Object.entries(p).forEach(([key, val]) => {
      const s = document.querySelector(`#sv-mp-sliders input[name="${key}"]`);
      if (s) { s.value = val; s.dispatchEvent(new Event('input')); }
    });
    document.querySelectorAll('.sv-chip').forEach(b => {
      const txt = b.textContent.toLowerCase();
      b.classList.toggle('on', txt.includes(k === 'creative' ? 'творч' : k === 'balanced' ? 'баланс' : 'точный'));
    });
  },

  async saveMP() {
    const mp = {};
    const mpWrap = document.getElementById('sv-mp-sliders');
    if (mpWrap) {
      mpWrap.querySelectorAll('input[type="range"]').forEach(s => {
        mp[s.name] = parseFloat(s.value);
      });
    }
    const g = document.getElementById('sv-gsys');
    if (g) mp.globalSystem = g.value.trim();
    this.data.mp = { ...this.data.mp, ...mp };
    await this.save();
    toast(t('toast.saved'), 'success');
  },

  // ── Theme / Accent / Lang ──────────────────────────────────────────────────
  async setTheme(v)  { this.data.app.theme  = v; this._apply(); await this.save(); App.navigate('settings'); },
  async setAccentColor(hex) {
    this.data.app.accentColor = hex;
    this._apply();
    await this.save();
  },
  async setLang(v)   { this.data.language   = v; i18n.setLang(v); await this.save(); App.navigate('settings'); },

  async exportData() {
    const data = { settings: this.data, exportedAt: Date.now() };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type:'application/json' }));
    a.download = `wesaid-settings-${Date.now()}.json`;
    a.click();
    toast('Экспортировано!', 'success');
  },

  async clearAllChats() {
    if (!confirm('Удалить ВСЕ чаты? Это действие нельзя отменить!')) return;
    for (const c of App.chats) {
      try { await API.deleteChat(c.id); } catch {}
    }
    App.chats = [];
    App.renderChats();
    Chat.current = null;
    toast('Все чаты удалены', 'success');
  },

  async resetSettings() {
    if (!confirm('Сбросить все настройки? Провайдеры останутся.')) return;
    const providers = this.data.providers;
    const active = this.data.activeProviderId;
    this.data.mp = { ...MP_PRESETS.balanced };
    this.data.app = { theme:'dark', accent:'purple', animations:true, autoscroll:true, sound:false };
    this.data.language = 'ru';
    this.data.providers = providers;
    this.data.activeProviderId = active;
    this._apply();
    i18n.setLang('ru');
    await this.save();
    App.navigate('settings');
    toast('Настройки сброшены', 'success');
  },

  // ── Providers ──────────────────────────────────────────────────────────────
  addProv()    { this._provModal(null); },
  editProv(id) { this._provModal(this.data.providers.find(p => p.id === id) || null); },

  async setActive(id) {
    this.data.activeProviderId = id;
    await this.save();
    App.navigate('settings');
    toast(t('toast.saved'), 'success');
  },

  async delProv(id) {
    this.data.providers = this.data.providers.filter(p => p.id !== id);
    if (this.data.activeProviderId === id)
      this.data.activeProviderId = this.data.providers[0]?.id || null;
    await this.save();
    App.navigate('settings');
    toast(t('toast.deleted'), 'success');
  },

  _provModal(ex) {
    const pre = API_PRESETS.map(p => `
      <button class="preset-btn" data-name="${p.name}" data-url="${p.baseUrl}" data-model="${p.models[0]||''}">
        <span class="preset-icon">${p.icon}</span><span>${p.name}</span>
      </button>`).join('');

    showModal(`
      <div class="modal-hd">
        <div class="modal-title">${ex ? 'Edit Provider' : 'Add Provider'}</div>
        <button class="btn-icon" onclick="closeModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group"><label>Quick Presets</label><div class="preset-grid">${pre}</div></div>
        <div class="form-group"><label>${t('setup.name')}</label><input id="mp-name" value="${ex?.name||''}" placeholder="My Provider" /></div>
        <div class="form-group"><label>${t('setup.url')}</label><input id="mp-url" value="${ex?.baseUrl||''}" placeholder="https://..." /></div>
        <div class="form-group"><label>${t('setup.key')}</label><input id="mp-key" type="password" value="${ex?.apiKey||''}" placeholder="sk-..." /></div>
        <div class="form-group">
          <label>${t('setup.model')}</label>
          <div id="mp-model-wrap"></div>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn btn-ghost" onclick="closeModal()">${t('char.cancel')}</button>
        <button class="btn btn-primary" onclick="Settings._saveModal('${ex?.id||''}')">${ex ? t('char.save') : 'Add'}</button>
      </div>`);

    ModelLoader.renderModelInput('mp-model-wrap',
      { name: ex?.name||'', baseUrl: ex?.baseUrl||'', apiKey: ex?.apiKey||'' },
      ex?.model || '', () => {});

    document.querySelectorAll('#modal-overlay .preset-btn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#modal-overlay .preset-btn').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      document.getElementById('mp-name').value = b.dataset.name;
      document.getElementById('mp-url').value  = b.dataset.url;
      ModelLoader.renderModelInput('mp-model-wrap',
        { name: b.dataset.name, baseUrl: b.dataset.url, apiKey: document.getElementById('mp-key')?.value || '' },
        b.dataset.model, () => {});
    }));
  },

  async _saveModal(eid) {
    const name = document.getElementById('mp-name').value.trim();
    const url  = document.getElementById('mp-url').value.trim();
    const key  = document.getElementById('mp-key').value.trim();
    const mdl  = document.getElementById('mp-model-wrap-inp')?.value.trim() || '';
    if (!name || !url) { toast('Name and URL required', 'error'); return; }
    if (eid) {
      const i = this.data.providers.findIndex(p => p.id === eid);
      if (i > -1) this.data.providers[i] = { id: eid, name, baseUrl: url, apiKey: key, model: mdl };
    } else {
      const p = { id: Date.now().toString(), name, baseUrl: url, apiKey: key, model: mdl };
      this.data.providers.push(p);
      if (!this.data.activeProviderId) this.data.activeProviderId = p.id;
    }
    await this.save();
    closeModal();
    App.navigate('settings');
    toast(t('toast.saved'), 'success');
  },
};
