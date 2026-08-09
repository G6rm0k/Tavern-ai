// ─── AUTH ─────────────────────────────────────────────────────────────────────
const Auth = {
  FINGER_ICON: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" width="17" height="17" style="vertical-align:-3px"><path d="M12 11v3a9 9 0 01-.6 3.2"/><path d="M8.5 8.6a5 5 0 017 4.4v1a13 13 0 01-.8 4.5"/><path d="M5 12a7 7 0 0111-5.7"/><path d="M19 12a7 7 0 00-1-3.6"/><path d="M8.5 19.5A11 11 0 0010 14v-2a2 2 0 114 0v2a17 17 0 01-.5 4"/></svg>`,

  async init() {
    const token = API.token;
    if (token) {
      try {
        const user = await API.me();
        App.user = user;
        return true; // logged in
      } catch {
        API.setToken(null);
      }
    }
    return false;
  },

  render() {
    const el = document.getElementById('page-auth');
    el.innerHTML = `
      <div class="auth-container">
        <div class="auth-logo">wesaid</div>
        <div class="auth-tagline">${t('auth.tagline')}</div>

        <div class="auth-card">
          <div class="auth-tabs">
            <button class="auth-tab active" data-tab="login">${t('auth.login')}</button>
            <button class="auth-tab" data-tab="register">${t('auth.register')}</button>
          </div>

          <div id="auth-login">
            <div class="form-group">
              <label>${t('auth.username')}</label>
              <input id="login-username" type="text" placeholder="your_username" autocomplete="username" />
            </div>
            <div class="form-group">
              <label>${t('auth.password')}</label>
              <input id="login-password" type="password" placeholder="••••••••" autocomplete="current-password" />
            </div>
            <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px" id="login-btn">
              ${t('auth.login')}
            </button>
            <button class="btn btn-ghost pk-btn" id="pk-login-btn" style="width:100%;justify-content:center;margin-top:8px;display:none">
              ${Auth.FINGER_ICON} ${t('pk.login')}
            </button>
            <div id="login-error" class="text-muted mt-2" style="color:#ef4444;display:none"></div>
          </div>

          <div id="auth-register" class="hidden">
            <div class="form-row">
              <div class="form-group">
                <label>${t('auth.username')}</label>
                <input id="reg-username" type="text" placeholder="cool_username" autocomplete="username" />
                <div class="hint">${t('auth.usernameHint')}</div>
              </div>
              <div class="form-group">
                <label>${t('auth.displayName')}</label>
                <input id="reg-displayname" type="text" placeholder="Your Name" />
              </div>
            </div>
            <div class="form-group">
              <label>${t('auth.password')}</label>
              <input id="reg-password" type="password" placeholder="••••••••" autocomplete="new-password" />
            </div>
            <!-- The password is the encryption key. Losing it means losing every
                 chat, so say so before the account exists, not after. -->
            <div class="notice notice-warn">⚠️ ${t('auth.pwWarn')}</div>
            <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px" id="register-btn">
              ${t('auth.register')}
            </button>
            <div id="reg-error" class="text-muted mt-2" style="color:#ef4444;display:none"></div>
          </div>
        </div>
        <div class="text-muted mt-2" style="text-align:center;font-size:12px">
          ${t('auth.local')}
        </div>
      </div>
    `;

    // Tab switching
    el.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        el.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const which = tab.dataset.tab;
        document.getElementById('auth-login').classList.toggle('hidden', which !== 'login');
        document.getElementById('auth-register').classList.toggle('hidden', which !== 'register');
      });
    });

    // Enter key
    el.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const isLogin = !inp.closest('#auth-register');
          if (isLogin) document.getElementById('login-btn')?.click();
          else document.getElementById('register-btn')?.click();
        }
      });
    });

    document.getElementById('login-btn').addEventListener('click', () => Auth.login());
    document.getElementById('register-btn').addEventListener('click', () => Auth.register());

    // Prefill the last account and offer the fingerprint button when this device
    // has a passkey stored for it.
    const last = Passkey.lastUser();
    if (last) document.getElementById('login-username').value = last;
    this._refreshPasskeyBtn();
    document.getElementById('login-username').addEventListener('input', () => this._refreshPasskeyBtn());
    document.getElementById('pk-login-btn').addEventListener('click', () => Auth.loginWithPasskey());
  },

  _refreshPasskeyBtn() {
    const btn = document.getElementById('pk-login-btn');
    if (!btn) return;
    const name = document.getElementById('login-username')?.value.trim();
    btn.style.display = (Passkey.supported() && Passkey.has(name)) ? '' : 'none';
  },

  async loginWithPasskey() {
    const username = document.getElementById('login-username').value.trim();
    const errEl = document.getElementById('login-error');
    const btn   = document.getElementById('pk-login-btn');
    errEl.style.display = 'none';
    btn.disabled = true;
    try {
      const password = await Passkey.recoverPassword(username);
      const { user, token } = await API.login({ username, password });
      API.setToken(token);
      Passkey.rememberUser(username);
      App.user = user;
      App.afterLogin();
    } catch (e) {
      errEl.textContent = Passkey.errorText(e);
      errEl.style.display = 'block';
      btn.disabled = false;
      this._refreshPasskeyBtn();
    }
  },

  async login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';

    if (!username || !password) {
      errEl.textContent = t('auth.fill');
      errEl.style.display = 'block'; return;
    }

    const btn = document.getElementById('login-btn');
    btn.textContent = t('auth.signing'); btn.disabled = true;
    try {
      const { user, token } = await API.login({ username, password });
      API.setToken(token);
      Passkey.rememberUser(username);
      App.user = user;
      App.afterLogin();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
      btn.textContent = t('auth.login'); btn.disabled = false;
    }
  },

  async register() {
    const username = document.getElementById('reg-username').value.trim();
    const displayName = document.getElementById('reg-displayname').value.trim();
    const password = document.getElementById('reg-password').value;
    const errEl = document.getElementById('reg-error');
    errEl.style.display = 'none';

    if (!username || !password) {
      errEl.textContent = t('auth.fill');
      errEl.style.display = 'block'; return;
    }

    const btn = document.getElementById('register-btn');
    btn.textContent = t('auth.creating'); btn.disabled = true;
    try {
      const { user, token } = await API.register({ username, displayName, password });
      API.setToken(token);
      App.user = user;
      App.afterLogin();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
      btn.textContent = t('auth.register'); btn.disabled = false;
    }
  }
};
