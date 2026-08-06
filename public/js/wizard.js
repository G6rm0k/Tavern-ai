// ── SETUP WIZARD ──────────────────────────────────────────────────────────────
// Replaces the old setup screen, which showed a bare "Base URL / API Key / Model"
// form. Those are three meaningless words to someone who just bought their first
// PC, and "Skip" dropped them into an app where every message failed. This walks
// through the choice, explains where a key comes from, and — the important part —
// actually tests the connection before letting them through.

const Wizard = {
  mode: null,          // 'free' | 'local' | 'own'
  _localFound: [],

  render() {
    const el = document.getElementById('page-setup');
    el.innerHTML = `<div class="wz-wrap" id="wz-root"></div>`;
    this.showChoice();
  },

  _shell(inner, opts = {}) {
    const root = document.getElementById('wz-root');
    if (!root) return;
    root.innerHTML = `
      <div class="wz-card">
        ${opts.back ? `<button class="wz-back" onclick="Wizard.showChoice()">← ${t('wiz.back')}</button>` : ''}
        ${inner}
      </div>`;
  },

  // ── STEP 1: what kind of user are you ──────────────────────────────────────
  showChoice() {
    this.mode = null;
    const root = document.getElementById('wz-root');
    root.innerHTML = `
      <div class="wz-hd">
        <h1>${t('wiz.title')}</h1>
        <p>${t('wiz.subtitle')}</p>
      </div>
      <div class="wz-choices">
        <button class="wz-choice" onclick="Wizard.showFree()">
          <div class="wz-choice-ico">🆓</div>
          <div class="wz-choice-name">${t('wiz.free.name')}</div>
          <div class="wz-choice-desc">${t('wiz.free.desc')}</div>
          <div class="wz-choice-tag">${t('wiz.recommended')}</div>
        </button>
        <button class="wz-choice" onclick="Wizard.showLocal()">
          <div class="wz-choice-ico">💻</div>
          <div class="wz-choice-name">${t('wiz.local.name')}</div>
          <div class="wz-choice-desc">${t('wiz.local.desc')}</div>
        </button>
        <button class="wz-choice" onclick="Wizard.showOwn()">
          <div class="wz-choice-ico">🔑</div>
          <div class="wz-choice-name">${t('wiz.own.name')}</div>
          <div class="wz-choice-desc">${t('wiz.own.desc')}</div>
        </button>
      </div>
      <button class="wz-skip" onclick="Wizard.skip()">${t('wiz.skip')}</button>`;

    // Probe for a local model server in the background: if one is already
    // installed we can offer the zero-configuration path up front.
    this._probeLocal();
  },

  async _probeLocal() {
    try {
      const { found } = await API.detectLocal();
      this._localFound = found || [];
      if (!found?.length) return;
      const box = document.querySelector('.wz-choices');
      if (!box || this.mode) return;
      const hint = document.createElement('div');
      hint.className = 'wz-found';
      hint.innerHTML = `${esc(found[0].icon)} ${t('wiz.found').replace('%s', esc(found[0].name))}`;
      hint.onclick = () => this.showLocal();
      box.after(hint);
    } catch {}
  },

  // ── FREE: OpenRouter walkthrough ───────────────────────────────────────────
  showFree() {
    this.mode = 'free';
    this._shell(`
      <div class="wz-step-hd">
        <span class="wz-step-ico">🆓</span>
        <div>
          <div class="wz-step-title">${t('wiz.free.name')}</div>
          <div class="wz-step-sub">${t('wiz.free.sub')}</div>
        </div>
      </div>

      <ol class="wz-steps">
        <li>${t('wiz.free.s1')} <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" class="wz-link">openrouter.ai/keys</a></li>
        <li>${t('wiz.free.s2')}</li>
        <li>${t('wiz.free.s3')}</li>
        <li>${t('wiz.free.s4')}</li>
      </ol>

      <div class="form-group">
        <label>${t('setup.key')}</label>
        <input id="wz-key" type="password" placeholder="sk-or-v1-..." autocomplete="off" />
      </div>
      <div class="form-group">
        <label>${t('setup.model')}</label>
        <select id="wz-model" class="wz-select">
          <option value="deepseek/deepseek-chat-v3-0324:free">DeepSeek V3 — ${t('wiz.model.free')}</option>
          <option value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B — ${t('wiz.model.free')}</option>
          <option value="google/gemini-2.0-flash-exp:free">Gemini 2.0 Flash — ${t('wiz.model.free')}</option>
          <option value="openai/gpt-4o-mini">GPT-4o mini — ${t('wiz.model.paid')}</option>
        </select>
        <div class="hint">${t('wiz.free.modelHint')}</div>
      </div>

      ${this._testBlock()}
    `, { back: true });
  },

  // ── LOCAL: Ollama / LM Studio ──────────────────────────────────────────────
  async showLocal() {
    this.mode = 'local';
    this._shell(`
      <div class="wz-step-hd">
        <span class="wz-step-ico">💻</span>
        <div>
          <div class="wz-step-title">${t('wiz.local.name')}</div>
          <div class="wz-step-sub">${t('wiz.local.sub')}</div>
        </div>
      </div>
      <div id="wz-local-body">
        <div class="wz-scanning"><div class="loader-ring"></div> ${t('wiz.local.scanning')}</div>
      </div>`, { back: true });

    let found = this._localFound;
    try { found = (await API.detectLocal()).found || []; } catch {}
    this._localFound = found;

    const body = document.getElementById('wz-local-body');
    if (!body) return;

    if (!found.length) {
      body.innerHTML = `
        <div class="notice notice-warn">${t('wiz.local.none')}</div>
        <ol class="wz-steps">
          <li>${t('wiz.local.i1')} <a href="https://ollama.com/download" target="_blank" rel="noopener" class="wz-link">ollama.com/download</a></li>
          <li>${t('wiz.local.i2')}</li>
          <li>${t('wiz.local.i3')}</li>
        </ol>
        <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="Wizard.showLocal()">
          ${t('wiz.local.rescan')}
        </button>`;
      return;
    }

    body.innerHTML = found.map((srv, i) => `
      <div class="wz-local-card">
        <div class="wz-local-hd">
          <span class="wz-local-ico">${esc(srv.icon)}</span>
          <div>
            <div class="wz-local-name">${esc(srv.name)}</div>
            <div class="wz-local-sub">${srv.models.length
              ? t('wiz.local.models').replace('%s', srv.models.length)
              : t('wiz.local.nomodels')}</div>
          </div>
        </div>
        ${srv.models.length ? `
          <select class="wz-select" id="wz-local-model-${i}">
            ${srv.models.map(m => `<option value="${escAttr(m)}">${esc(m)}</option>`).join('')}
          </select>
          <button class="btn btn-primary wz-local-btn" onclick="Wizard.useLocal(${i})">
            ${t('wiz.local.connect')}
          </button>
        ` : `<div class="hint">${t('wiz.local.pullHint')}</div>`}
      </div>`).join('');
  },

  async useLocal(i) {
    const srv = this._localFound[i];
    if (!srv) return;
    const model = document.getElementById(`wz-local-model-${i}`)?.value || srv.models[0];
    await this._save({ name: srv.name, baseUrl: srv.baseUrl, apiKey: '', model });
  },

  // ── OWN KEY: the classic form, but with a working test ─────────────────────
  showOwn() {
    this.mode = 'own';
    this._shell(`
      <div class="wz-step-hd">
        <span class="wz-step-ico">🔑</span>
        <div>
          <div class="wz-step-title">${t('wiz.own.name')}</div>
          <div class="wz-step-sub">${t('wiz.own.sub')}</div>
        </div>
      </div>

      <label class="wz-label">${t('wiz.own.pick')}</label>
      <div class="preset-grid" id="wz-presets">
        ${API_PRESETS.filter(p => p.id !== 'custom').map(p => `
          <button class="preset-btn" data-name="${escAttr(p.name)}" data-url="${escAttr(p.baseUrl)}" data-model="${escAttr(p.models[0]||'')}">
            <span class="preset-icon">${esc(p.icon)}</span><span>${esc(p.name)}</span>
          </button>`).join('')}
      </div>

      <div class="form-group"><label>${t('setup.name')}</label><input id="wz-name" placeholder="My Provider" /></div>
      <div class="form-group"><label>${t('setup.url')}</label><input id="wz-url" placeholder="https://api.openai.com/v1" /></div>
      <div class="form-group"><label>${t('setup.key')}</label><input id="wz-key" type="password" placeholder="sk-..." autocomplete="off" /></div>
      <div class="form-group"><label>${t('setup.model')}</label><input id="wz-model" placeholder="gpt-4o-mini" /></div>

      ${this._testBlock()}
    `, { back: true });

    document.querySelectorAll('#wz-presets .preset-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#wz-presets .preset-btn').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        document.getElementById('wz-name').value  = b.dataset.name;
        document.getElementById('wz-url').value   = b.dataset.url;
        document.getElementById('wz-model').value = b.dataset.model;
      });
    });
  },

  _testBlock() {
    return `
      <div class="wz-test" id="wz-test-result"></div>
      <div class="wz-actions">
        <button class="btn btn-ghost" id="wz-test-btn" onclick="Wizard.test()">${t('wiz.test')}</button>
        <button class="btn btn-primary" id="wz-save-btn" onclick="Wizard.saveCurrent()" style="flex:1">${t('wiz.saveGo')}</button>
      </div>`;
  },

  _currentProvider() {
    if (this.mode === 'free') {
      return {
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: document.getElementById('wz-key')?.value.trim() || '',
        model: document.getElementById('wz-model')?.value || '',
      };
    }
    return {
      name:    document.getElementById('wz-name')?.value.trim() || '',
      baseUrl: document.getElementById('wz-url')?.value.trim() || '',
      apiKey:  document.getElementById('wz-key')?.value.trim() || '',
      model:   document.getElementById('wz-model')?.value.trim() || '',
    };
  },

  // ── THE TEST ───────────────────────────────────────────────────────────────
  // The whole point of the wizard: find out here that the key is wrong, instead
  // of after writing a message to a character and getting a raw API blob back.
  async test() {
    const p   = this._currentProvider();
    const box = document.getElementById('wz-test-result');
    const btn = document.getElementById('wz-test-btn');

    if (!p.baseUrl) { this._showTest(box, false, t('wiz.err.noUrl')); return; }

    btn.disabled = true;
    box.className = 'wz-test on';
    box.innerHTML = `<div class="loader-ring" style="width:16px;height:16px;border-width:2px"></div> ${t('wiz.testing')}`;

    try {
      const r = await API.testProvider({ baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model });
      if (r.ok) {
        this._showTest(box, true, t('wiz.test.ok').replace('%s', ((r.ms || 0) / 1000).toFixed(1)));
      } else {
        this._showTest(box, false, humanError(r).text);
      }
    } catch (e) {
      this._showTest(box, false, humanError(e).text);
    } finally {
      btn.disabled = false;
    }
    return box.classList.contains('good');
  },

  _showTest(box, ok, text) {
    box.className = `wz-test on ${ok ? 'good' : 'bad'}`;
    box.textContent = `${ok ? '✅' : '❌'} ${text}`;
  },

  async saveCurrent() {
    const p = this._currentProvider();
    if (!p.baseUrl) { toast(t('wiz.err.noUrl'), 'error'); return; }
    if (!p.name) p.name = new URL(p.baseUrl).hostname;
    await this._save(p);
  },

  async _save(p) {
    const btn = document.getElementById('wz-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    Settings.data.providers.push({ id: Date.now().toString(), ...p });
    Settings.data.activeProviderId = Settings.data.providers[Settings.data.providers.length - 1].id;
    try {
      await Settings.save();
      await App.showMain();
      toast(t('wiz.done'), 'success');
    } catch (e) {
      toastError(e);
      if (btn) { btn.disabled = false; btn.textContent = t('wiz.saveGo'); }
    }
  },

  // Skipping is allowed, but say plainly what it means rather than dropping the
  // user into an app where everything errors.
  skip() {
    showModal(`
      <div class="modal-hd"><div class="modal-title">${t('wiz.skip.title')}</div></div>
      <div class="modal-body">
        <p style="color:var(--t3);font-size:14px;line-height:1.55">${t('wiz.skip.body')}</p>
      </div>
      <div class="modal-ft">
        <button class="btn btn-ghost" onclick="closeModal()">${t('wiz.skip.back')}</button>
        <button class="btn btn-primary" onclick="closeModal();App.showMain()">${t('wiz.skip.go')}</button>
      </div>`);
  },
};
