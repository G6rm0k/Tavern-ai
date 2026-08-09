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
    // Chat text size — the CSS variable already existed, nothing ever set it.
    document.documentElement.style.setProperty('--chat-font', (this.data.app?.fontSize || 15) + 'px');
  },

  getActive() { return this.data.providers.find(p => p.id === this.data.activeProviderId) || null; },
  getMP()     { return this.data.mp || MP_PRESETS.balanced; },

  // The old setup screen lived here. It is now Wizard (js/wizard.js), which
  // explains the choice instead of asking for a Base URL out of nowhere.

  // ── MAIN SETTINGS VIEW ─────────────────────────────────────────────────────
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
          <span class="sp-icon">${esc(pre?.icon || '⚙️')}</span>
          <div class="sp-body">
            <div class="sp-name">${esc(p.name)}${active ? ' <span class="sp-badge">✓</span>' : ''}</div>
            <div class="sp-sub">${esc(p.model || '—')}</div>
          </div>
          <div class="sp-btns">
            ${!active ? `<button class="sp-pill" onclick="Settings.setActive('${escJs(p.id)}')">✓</button>` : ''}
            <button class="sp-icon-btn" onclick="Settings.testProv('${escJs(p.id)}')" title="${t('wiz.test')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
            <button class="sp-icon-btn" onclick="Settings.editProv('${escJs(p.id)}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="sp-icon-btn danger" onclick="Settings.delProv('${escJs(p.id)}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
            </button>
          </div>
        </div>`;
    }).join('') || `<div class="sp-empty">${t('settings.no.providers')}</div>`;

    const tp     = mp.temperature;
    const curPre = tp >= 1.1 ? 'creative' : tp <= .45 ? 'precise' : 'balanced';

    el.innerHTML = `
    <div class="sv-wrap">

      <!-- AI Providers -->
      <div class="sv-card">
        <div class="sv-title">✦ ${t('settings.providers')}</div>
        <div class="sv-provs">${provRows}</div>
        <button class="sv-add" onclick="Settings.addProv()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${t('settings.add.provider')}
        </button>
      </div>

      <!-- Model params: three plain-language presets up front, the numbers
           tucked away — "Top P" means nothing to a first-time user. -->
      <div class="sv-card">
        <div class="sv-title">◆ ${t('settings.model')}</div>
        <div class="sv-chips">
          ${[['creative','◇',t('param.preset.creative')],
             ['balanced','◈',t('param.preset.balanced')],
             ['precise','◆',t('param.preset.precise')]]
            .map(([k,ico,lbl]) => `
              <button class="sv-chip ${curPre===k?'on':''}" onclick="Settings.applyPreset('${k}')">
                <span>${ico}</span><small>${esc(lbl)}</small>
              </button>`).join('')}
        </div>

        <div class="sv-field">
          <div class="sv-label">${t('settings.instructions')}</div>
          <textarea id="sv-gsys" class="sv-textarea" rows="3"
            placeholder="${escAttr(t('settings.instructions.ph'))}">${esc(mp.globalSystem || '')}</textarea>
        </div>

        <details class="sv-adv" ${this._advOpen ? 'open' : ''} ontoggle="Settings._advOpen=this.open">
          <summary class="sv-adv-sum">
            <span>${t('settings.advanced')}</span>
            <small>${t('settings.advanced.hint')}</small>
          </summary>
          <div class="sv-sliders" id="sv-mp-sliders">
            ${this._sl('temperature',     t('param.temperature'), mp.temperature,     0,   2,    .05, null, t('param.temperature.hint'))}
            ${this._sl('maxTokens',       t('param.maxTokens'),   mp.maxTokens,       64,  4096, 64,  null, t('param.maxTokens.hint'))}
            ${this._sl('contextMessages', t('param.context'),     mp.contextMessages, 2,   100,  2,   null, t('param.context.hint'))}
            ${this._sl('topP',            t('param.topP'),        mp.topP,            .1,  1,    .05, null, t('param.topP.hint'))}
            ${this._sl('topK',            t('param.topK'),        mp.topK,            1,   100,  1,   null, t('param.topK.hint'))}
          </div>
        </details>

        <button class="sv-save" onclick="Settings.saveMP()">${t('char.save')}</button>
      </div>

      <!-- Persona: who {{user}} is. Without it the character talks to a blank. -->
      <div class="sv-card">
        <div class="sv-title">🎭 ${t('persona.title')}</div>
        <div class="hint" style="margin-bottom:10px">${t('persona.hint')}</div>
        <div class="form-group">
          <label>${t('persona.name')}</label>
          <input id="sv-persona-name" value="${escAttr(this.data.persona?.name || '')}"
            placeholder="${escAttr(App.user?.displayName || '')}" />
        </div>
        <div class="form-group">
          <label>${t('persona.desc')}</label>
          <textarea id="sv-persona-desc" class="sv-textarea" rows="3"
            placeholder="${escAttr(t('persona.ph'))}">${esc(this.data.persona?.description || '')}</textarea>
        </div>
        ${this._tog('memory', '🧠 ' + t('memory.title'), t('memory.desc'), !!a.memory)}
        <button class="sv-save" onclick="Settings.savePersona()">${t('char.save')}</button>
      </div>

      <!-- Appearance -->
      <div class="sv-card">
        <div class="sv-title">◈ ${t('settings.appearance')}</div>
        <div class="sv-label">${t('settings.theme')}</div>
        <div class="sv-2col">
          <button class="sv-opt ${a.theme !== 'light' ? 'on' : ''}" onclick="Settings.setTheme('dark')">🌙 ${t('settings.theme.dark')}</button>
          <button class="sv-opt ${a.theme === 'light'  ? 'on' : ''}" onclick="Settings.setTheme('light')">☀️ ${t('settings.theme.light')}</button>
        </div>
        <div class="sv-label">${t('settings.accent')}</div>
        <div class="sv-color-row">
          <label class="sv-color-circle" style="background:${escAttr(accent)}" id="sv-color-circle">
            <input type="color" id="sv-color-inp" value="${escAttr(accent)}"
              oninput="document.getElementById('sv-color-circle').style.background=this.value;document.getElementById('sv-color-hex').textContent=this.value"
              onchange="Settings.setAccentColor(this.value)" />
            <div class="sv-color-shine"></div>
          </label>
          <div class="sv-color-info">
            <span class="sv-color-hex" id="sv-color-hex">${esc(accent)}</span>
            <span class="sv-color-hint">${t('settings.accent.hint')}</span>
          </div>
        </div>
        <div class="sv-sep"></div>
        <div class="sv-slider-wrap">
          ${this._sl('fontSize', t('settings.fontSize'), a.fontSize ?? 15, 12, 24, 1, v => v + 'px', t('settings.fontSize.desc'))}
        </div>
        <div class="sv-sep"></div>
        ${this._tog('animations', '✦ ' + t('settings.animations'), t('settings.animations.desc'), a.animations !== false)}
        <div id="sv-speed-wrap" style="${a.animations === false ? 'opacity:.4;pointer-events:none' : ''}">
          ${this._sl('animSpeed', t('settings.animSpeed'), a.animSpeed ?? 1, 0.2, 3, 0.1, v => (v*100).toFixed(0)+'%')}
        </div>
        ${this._tog('autoscroll', '⬇️ ' + t('settings.autoscroll'), t('settings.autoscroll.desc'), a.autoscroll !== false)}
        ${this._tog('sound',      '🔔 ' + t('settings.sound'),      t('settings.sound.desc'),      !!a.sound)}
      </div>

      <!-- Language -->
      <div class="sv-card">
        <div class="sv-title">🌐 ${t('settings.language')}</div>
        <div class="sv-2col">
          <button class="sv-opt ${i18n.lang === 'ru' ? 'on' : ''}" onclick="Settings.setLang('ru')">🇷🇺 Русский</button>
          <button class="sv-opt ${i18n.lang === 'en' ? 'on' : ''}" onclick="Settings.setLang('en')">🇬🇧 English</button>
        </div>
      </div>

      <!-- Phone access: beats telling a beginner to run ipconfig -->
      <div class="sv-card">
        <div class="sv-title">📱 ${t('settings.phone')}</div>
        <div id="sv-qr-wrap" class="sv-qr-wrap"></div>
      </div>

      <!-- Security -->
      <div class="sv-card">
        <div class="sv-title">🔒 ${t('settings.security')}</div>
        <div class="sv-tog-row">
          <div class="sv-tog-text">
            <div class="sv-tog-name">${t('settings.autolock')}</div>
            <div class="sv-tog-desc">${t('settings.autolock.desc')}</div>
          </div>
          <select class="sv-select-sm" id="sv-autolock" onchange="Settings.setAutoLock(this.value)">
            ${[[0, t('settings.autolock.off')], [15,'15 мин'], [30,'30 мин'], [120,'2 ч']]
              .map(([v,l]) => `<option value="${v}" ${(a.autoLockMin ?? 0) == v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </div>
        <div id="sv-passkey"></div>
        <button class="sv-action" onclick="App.showPasswordChange()">
          🔑 ${t('profile.changePassword')}
        </button>
      </div>

      <!-- Data -->
      <div class="sv-card">
        <div class="sv-title">🗃️ ${t('settings.data')}</div>
        <label class="sv-check">
          <input type="checkbox" id="sv-backup-keys" />
          <span>${t('settings.backup.keys')}</span>
        </label>
        <div class="hint" style="margin:-4px 0 10px">${t('settings.backup.warn')}</div>
        <button class="sv-action" onclick="Settings.downloadBackup()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          ${t('settings.backup')}
        </button>
        <button class="sv-action" onclick="document.getElementById('sv-restore-file').click()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          ${t('settings.restore')}
        </button>
        <input type="file" id="sv-restore-file" accept=".json" class="hidden" onchange="Settings.restoreBackup(this)" />
        <button class="sv-action danger" onclick="Settings.clearAllChats()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          ${t('settings.clearChats')}
        </button>
        <button class="sv-action danger" onclick="Settings.resetSettings()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          ${t('settings.reset')}
        </button>
      </div>

      <!-- About -->
      <div class="sv-card">
        <div class="sv-about">
          <div class="sv-about-logo">wesaid</div>
          <div class="sv-about-ver">v3.1.0</div>
          <div class="sv-about-desc">Chat Frontend</div>
        </div>
      </div>

    </div>`;

    this._renderQR();
    this._renderPasskey();

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

    // Font size applies live so the effect is visible while dragging.
    const fontSlider = el.querySelector('input[name="fontSize"]');
    if (fontSlider) {
      this._bindSlider(fontSlider);
      fontSlider.addEventListener('input', () => {
        this.data.app.fontSize = parseFloat(fontSlider.value);
        this._apply();
      });
      fontSlider.addEventListener('change', () => this.save());
    }

    // Bind toggles
    el.querySelectorAll('.sv-tog').forEach(tog =>
      tog.addEventListener('change', () => this._handleTog(tog.name, tog.checked)));
  },

  _sl(name, label, value, min, max, step, fmt, hint) {
    const pct  = ((value - min) / (max - min) * 100).toFixed(1);
    const disp = fmt ? fmt(value) : (Number.isInteger(value) ? value : parseFloat(value).toFixed(2));
    return `
      <div class="sv-slider">
        <div class="sv-slider-hd">
          <span class="sv-label">${esc(label)}</span>
          <span class="sv-val" id="sv-${name}">${esc(disp)}</span>
        </div>
        <input type="range" name="${name}" min="${min}" max="${max}" step="${step}"
               value="${value}" style="--pct:${pct}%" />
        ${hint ? `<div class="sv-slider-hint">${esc(hint)}</div>` : ''}
      </div>`;
  },

  _bindSlider(s) {
    const valEl = document.getElementById(`sv-${s.name}`);
    const isInt = Number.isInteger(parseFloat(s.step));
    const suffix = s.name === 'animSpeed' ? '%' : s.name === 'fontSize' ? 'px' : '';
    const update = () => {
      const v   = parseFloat(s.value);
      const pct = ((v - parseFloat(s.min)) / (parseFloat(s.max) - parseFloat(s.min)) * 100).toFixed(1);
      s.style.setProperty('--pct', pct + '%');
      if (!valEl) return;
      valEl.textContent = s.name === 'animSpeed' ? (v * 100).toFixed(0) + suffix
                        : isInt ? Math.round(v) + suffix
                        : v.toFixed(2) + suffix;
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
    // Was matching Russian substrings against the button text, so the highlight
    // silently stopped working in English.
    const order = ['creative', 'balanced', 'precise'];
    document.querySelectorAll('.sv-chip').forEach((b, i) => b.classList.toggle('on', order[i] === k));
    // The sliders now live inside a collapsed "Advanced" block, so picking a
    // preset has to save by itself — otherwise it looks like nothing happened.
    this.saveMP();
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

  _advOpen: false,

  async savePersona() {
    this.data.persona = {
      name:        document.getElementById('sv-persona-name').value.trim(),
      description: document.getElementById('sv-persona-desc').value.trim(),
    };
    await this.save();
    toast(t('toast.saved'), 'success');
  },

  // ── PASSKEY ────────────────────────────────────────────────────────────────
  async _renderPasskey() {
    const wrap = document.getElementById('sv-passkey');
    if (!wrap) return;
    const username = App.user?.username;

    // Hidden entirely where it cannot work (a plain-http LAN address, or a
    // machine with no Hello / Touch ID) rather than shown and failing.
    if (!Passkey.supported() || !(await Passkey.platformAvailable())) {
      wrap.innerHTML = '';
      return;
    }

    if (Passkey.has(username)) {
      wrap.innerHTML = `
        <div class="sv-pk-on">${Auth.FINGER_ICON} <span>${t('pk.on')}</span></div>
        <button class="sv-action danger" onclick="Settings.disablePasskey()">${t('pk.disable')}</button>`;
    } else {
      wrap.innerHTML = `
        <div class="hint" style="margin-bottom:8px">${t('pk.desc')}</div>
        <button class="sv-action" onclick="Settings.enablePasskey()">
          ${Auth.FINGER_ICON} ${t('pk.enable')}
        </button>`;
    }
    wrap.insertAdjacentHTML('beforeend', `<div class="hint" style="margin:6px 0 12px">${t('pk.note')}</div>`);
  },

  // Wrapping the password needs the password, so ask for it once.
  enablePasskey() {
    showModal(`
      <div class="modal-hd"><div class="modal-title">${t('pk.title')}</div></div>
      <div class="modal-body">
        <p style="color:var(--t3);font-size:14px;line-height:1.5;margin-bottom:14px">${t('pk.needPw')}</p>
        <div class="form-group">
          <label>${t('auth.password')}</label>
          <input id="pk-pw" type="password" autocomplete="current-password" />
        </div>
        <div id="pk-err" style="color:var(--red);font-size:13px;display:none"></div>
      </div>
      <div class="modal-ft">
        <button class="btn btn-ghost" onclick="closeModal()">${t('char.cancel')}</button>
        <button class="btn btn-primary" id="pk-go" onclick="Settings._doEnablePasskey()">${t('pk.enable')}</button>
      </div>`);
    document.getElementById('pk-pw')?.focus();
  },

  async _doEnablePasskey() {
    const pw  = document.getElementById('pk-pw').value;
    const err = document.getElementById('pk-err');
    const btn = document.getElementById('pk-go');
    const show = m => { err.textContent = m; err.style.display = 'block'; btn.disabled = false; };
    if (!pw) return show(t('profile.pwFill'));

    btn.disabled = true;
    // Verify the password against the server before storing it, so a typo does
    // not get sealed into the authenticator.
    try {
      await API.unlock(pw);
    } catch {
      return show(t('pk.wrongPw'));
    }
    try {
      await Passkey.enable(App.user.username, App.user.displayName, pw);
      closeModal();
      await this._renderPasskey();
      toast(t('pk.enabled'), 'success');
    } catch (e) {
      show(Passkey.errorText(e));
    }
  },

  async disablePasskey() {
    Passkey.forget(App.user?.username);
    await this._renderPasskey();
    toast(t('pk.disabled'), 'info');
  },

  async setAutoLock(v) {
    this.data.app.autoLockMin = parseInt(v, 10) || 0;
    await this.save();
    AutoLock.reset();
  },

  // ── PHONE ACCESS ───────────────────────────────────────────────────────────
  async _renderQR() {
    const wrap = document.getElementById('sv-qr-wrap');
    if (!wrap) return;
    try {
      const { addresses } = await API.netInfo();
      if (!addresses?.length) {
        wrap.innerHTML = `<div class="hint">${t('settings.phone.same')}</div>`;
        return;
      }
      const url = addresses[0];
      wrap.innerHTML = `
        <div class="sv-qr">${QR.svg(url, 200)}</div>
        <div class="sv-qr-info">
          <div class="sv-qr-url" id="sv-qr-url">${esc(url)}</div>
          <div class="hint">${t('settings.phone.desc')}</div>
          <div class="hint">${t('settings.phone.same')}</div>
          <button class="btn btn-ghost" style="margin-top:8px" onclick="Settings.copyUrl('${escJs(url)}')">
            ${t('toast.copied').replace('!','')} URL
          </button>
        </div>`;
    } catch {
      wrap.innerHTML = `<div class="hint">${t('settings.phone.same')}</div>`;
    }
  },

  async copyUrl(url) {
    try { await navigator.clipboard.writeText(url); toast(t('toast.copied'), 'success'); }
    catch { toast(url, 'info'); }
  },

  // ── BACKUP ─────────────────────────────────────────────────────────────────
  // The old "export" wrote only the settings — with the API keys in the clear,
  // no warning, and no way to import it back.
  async downloadBackup() {
    const withKeys = document.getElementById('sv-backup-keys')?.checked;
    try {
      const data = await API.getBackup(withKeys);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `wesaid-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`${t('toast.saved')}: ${data.characters.length} + ${data.chats.length}`, 'success');
    } catch (e) { toastError(e); }
  },

  async restoreBackup(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const r = await API.restore(backup);
      await Settings.load();
      await Characters.load();
      await App._loadChats();
      App.renderChats();
      App.navigate('settings');
      toast(`${t('toast.imported')}: ${r.characters} + ${r.chats}`, 'success');
    } catch (e) { toastError(e); }
  },

  // Quick health check for an already-configured service.
  async testProv(id) {
    const p = this.data.providers.find(x => x.id === id);
    if (!p) return;
    toast(t('wiz.testing'), 'info');
    try {
      const r = await API.testProvider({ baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model });
      if (r.ok) toast(t('wiz.test.ok').replace('%s', ((r.ms||0)/1000).toFixed(1)), 'success');
      else toastError(r);
    } catch (e) { toastError(e); }
  },

  async clearAllChats() {
    if (!confirm(t('settings.clearChats') + '?')) return;
    try {
      // One request, one file write. Deleting them one by one used to rewrite
      // the whole store per chat and froze the UI for minutes.
      await API.deleteAllChats();
      App.chats = [];
      App.renderChats();
      Chat.current = null;
      toast(t('toast.deleted'), 'success');
    } catch (e) { toastError(e); }
  },

  async resetSettings() {
    if (!confirm(t('settings.reset') + '?')) return;
    const providers = this.data.providers;
    const active = this.data.activeProviderId;
    this.data.mp = { ...MP_PRESETS.balanced };
    // Was writing `accent`, while everything reads `accentColor` — so the colour
    // was the one thing a reset never actually reset.
    this.data.app = { theme:'dark', accentColor:'#f97316', animations:true, autoscroll:true, sound:false, fontSize:15, autoLockMin:0 };
    this.data.language = i18n.lang;
    this.data.providers = providers;
    this.data.activeProviderId = active;
    this._apply();
    await this.save();
    App.navigate('settings');
    toast(t('toast.saved'), 'success');
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
      <button class="preset-btn" data-name="${escAttr(p.name)}" data-url="${escAttr(p.baseUrl)}" data-model="${escAttr(p.models[0]||'')}">
        <span class="preset-icon">${esc(p.icon)}</span><span>${esc(p.name)}</span>
      </button>`).join('');

    showModal(`
      <div class="modal-hd">
        <div class="modal-title">${ex ? t('char.edit') : t('settings.add.provider')}</div>
        <button class="btn-icon" onclick="closeModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group"><label>${t('wiz.own.pick')}</label><div class="preset-grid">${pre}</div></div>
        <div class="form-group"><label>${t('setup.name')}</label><input id="mp-name" value="${escAttr(ex?.name||'')}" placeholder="My Provider" /></div>
        <div class="form-group"><label>${t('setup.url')}</label><input id="mp-url" value="${escAttr(ex?.baseUrl||'')}" placeholder="https://..." /></div>
        <div class="form-group"><label>${t('setup.key')}</label><input id="mp-key" type="password" value="${escAttr(ex?.apiKey||'')}" placeholder="sk-..." /></div>
        <div class="form-group">
          <label>${t('setup.model')}</label>
          <div id="mp-model-wrap"></div>
        </div>
        <div class="wz-test" id="mp-test-result"></div>
      </div>
      <div class="modal-ft">
        <button class="btn btn-ghost" onclick="Settings._testModal()">${t('wiz.test')}</button>
        <button class="btn btn-primary" onclick="Settings._saveModal('${escJs(ex?.id||'')}')">${ex ? t('char.save') : t('settings.add.provider')}</button>
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

  async _testModal() {
    const box = document.getElementById('mp-test-result');
    const p = {
      baseUrl: document.getElementById('mp-url').value.trim(),
      apiKey:  document.getElementById('mp-key').value.trim(),
      model:   document.getElementById('mp-model-wrap-inp')?.value.trim() || '',
    };
    if (!p.baseUrl) { box.className = 'wz-test on bad'; box.textContent = '❌ ' + t('wiz.err.noUrl'); return; }
    box.className = 'wz-test on';
    box.textContent = t('wiz.testing');
    try {
      const r = await API.testProvider(p);
      box.className = `wz-test on ${r.ok ? 'good' : 'bad'}`;
      box.textContent = r.ok
        ? '✅ ' + t('wiz.test.ok').replace('%s', ((r.ms||0)/1000).toFixed(1))
        : '❌ ' + humanError(r).text;
    } catch (e) {
      box.className = 'wz-test on bad';
      box.textContent = '❌ ' + humanError(e).text;
    }
  },

  async _saveModal(eid) {
    const name = document.getElementById('mp-name').value.trim();
    const url  = document.getElementById('mp-url').value.trim();
    const key  = document.getElementById('mp-key').value.trim();
    const mdl  = document.getElementById('mp-model-wrap-inp')?.value.trim() || '';
    if (!name || !url) { toast(t('wiz.err.noUrl'), 'error'); return; }
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
