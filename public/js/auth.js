// ─── AUTH ─────────────────────────────────────────────────────────────────────
const Auth = {
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
        <div class="auth-logo">Tavern</div>
        <div class="auth-tagline">Your local AI companion hub</div>

        <div class="auth-card">
          <div class="auth-tabs">
            <button class="auth-tab active" data-tab="login">Sign In</button>
            <button class="auth-tab" data-tab="register">Create Account</button>
          </div>

          <div id="auth-login">
            <div class="form-group">
              <label>Username</label>
              <input id="login-username" type="text" placeholder="your_username" autocomplete="username" />
            </div>
            <div class="form-group">
              <label>Password</label>
              <input id="login-password" type="password" placeholder="••••••••" autocomplete="current-password" />
            </div>
            <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px" id="login-btn">
              Sign In
            </button>
            <div id="login-error" class="text-muted mt-2" style="color:#ef4444;display:none"></div>
          </div>

          <div id="auth-register" class="hidden">
            <div class="form-row">
              <div class="form-group">
                <label>Username</label>
                <input id="reg-username" type="text" placeholder="cool_username" autocomplete="username" />
              </div>
              <div class="form-group">
                <label>Display Name</label>
                <input id="reg-displayname" type="text" placeholder="Your Name" />
              </div>
            </div>
            <div class="form-group">
              <label>Password</label>
              <input id="reg-password" type="password" placeholder="••••••••" autocomplete="new-password" />
            </div>
            <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px" id="register-btn">
              Create Account
            </button>
            <div id="reg-error" class="text-muted mt-2" style="color:#ef4444;display:none"></div>
          </div>
        </div>
        <div class="text-muted mt-2" style="text-align:center;font-size:12px">
          Local only — your data stays on this machine 🔒
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
  },

  async login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';

    if (!username || !password) {
      errEl.textContent = 'Please fill in all fields';
      errEl.style.display = 'block'; return;
    }

    const btn = document.getElementById('login-btn');
    btn.textContent = 'Signing in...'; btn.disabled = true;
    try {
      const { user, token } = await API.login({ username, password });
      API.setToken(token);
      App.user = user;
      App.afterLogin();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
      btn.textContent = 'Sign In'; btn.disabled = false;
    }
  },

  async register() {
    const username = document.getElementById('reg-username').value.trim();
    const displayName = document.getElementById('reg-displayname').value.trim();
    const password = document.getElementById('reg-password').value;
    const errEl = document.getElementById('reg-error');
    errEl.style.display = 'none';

    if (!username || !password) {
      errEl.textContent = 'Username and password required';
      errEl.style.display = 'block'; return;
    }

    const btn = document.getElementById('register-btn');
    btn.textContent = 'Creating...'; btn.disabled = true;
    try {
      const { user, token } = await API.register({ username, displayName, password });
      API.setToken(token);
      App.user = user;
      App.afterLogin();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
      btn.textContent = 'Create Account'; btn.disabled = false;
    }
  }
};
