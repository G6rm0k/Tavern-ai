// ── APP v3 ─────────────────────────────────────────────────────────────────────
const App = {
  user: null,
  chats: [],
  view: 'home',
  _sbOpen: false,

  get isMobile() { return window.innerWidth <= 768; },

  async init() {
    // Apply theme immediately from localStorage to avoid flash
    try {
      const raw = localStorage.getItem('tavern_settings');
      if (raw) {
        const s = JSON.parse(raw);
        if (s.app?.theme)   document.documentElement.setAttribute('data-theme',  s.app.theme);
        if (s.app?.accentColor) {
          const c = s.app.accentColor;
          document.documentElement.style.setProperty('--accent', c);
          document.documentElement.style.setProperty('--accent-glow', c + '66');
          document.documentElement.style.setProperty('--accent-ultra', c + '18');
          document.documentElement.style.setProperty('--accent-bright', c);
        }
        if (s.language)     i18n.lang = s.language;
      }
    } catch {}

    FX.init();
    Sounds.init();

    window.addEventListener('resize', () => {
      if (!this.isMobile && this._sbOpen) this.closeSidebar();
    }, { passive: true });
    window.addEventListener('langChange', () => this.navigate(this.view));

    const hideLoader = () => document.getElementById('loader')?.classList.add('gone');

    try {
      const ok = await Auth.init();
      hideLoader();
      if (!ok) {
        Auth.render();
        this._showPage('auth');
        return;
      }
      await this.afterLogin();
    } catch (e) {
      console.error('App.init error:', e);
      hideLoader();
      // Show auth as fallback — don't leave blank screen
      Auth.render();
      this._showPage('auth');
    }
  },

  async afterLogin() {
    try {
      await Settings.load();
    } catch (e) {
      console.warn('Settings.load failed:', e);
    }
    try {
      if (!Settings.data.providers?.length) {
        Settings.renderSetup();
        this._showPage('setup');
      } else {
        await this.showMain();
      }
    } catch (e) {
      console.error('afterLogin error:', e);
      // Fallback: try to show main anyway
      try { await this.showMain(); } catch {}
    }
  },

  async showMain() {
    try {
      await Promise.all([Characters.load(), this._loadChats()]);
    } catch (e) {
      console.warn('showMain preload error:', e);
    }
    this._renderMain();
    this._showPage('main');
    this.navigate('home');
    try { ElasticNav.init(); } catch {}
    try { LiquidDrop.init(); } catch {}
    this._bindGlobalSwipe();
  },

  async _loadChats() {
    this.chats = await API.getChats().catch(() => []);
  },

  _showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(`page-${name}`);
    if (el) { el.classList.add('active', 'enter'); setTimeout(() => el.classList.remove('enter'), 600); }
  },

  _renderMain() {
    document.getElementById('page-main').innerHTML = `
      <div class="sb-back" id="sb-back" onclick="App.closeSidebar()"></div>

      <div class="sidebar" id="sidebar">
        <div class="sidebar-hd">
          <div class="sidebar-logo">Tavern</div>
          <button class="btn-icon" onclick="App.navigate('create')" style="color:var(--accent)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
        <div class="sidebar-nav">
          ${this._ni('home',     icons.home,     t('nav.home'))}
          ${this._ni('discover', icons.discover, t('nav.discover'))}
          ${this._ni('create',   icons.create,   t('nav.create'))}
          ${this._ni('account',  icons.account,  t('nav.account'))}
          ${this._ni('settings', icons.settings, t('nav.settings'))}
          <div class="nav-sect">${t('home.recent')}</div>
        </div>
        <div class="sidebar-chats" id="sb-chats">${this._chatsHtml()}</div>
        <div class="sidebar-ft">
          <button class="prof-btn" onclick="App.showProfile()">
            <div class="prof-av" id="sb-av">${this._avHtml(this.user)}</div>
            <div style="flex:1;min-width:0">
              <div class="prof-name">${this.user?.displayName || this.user?.username}</div>
              <div class="prof-un">@${this.user?.username}</div>
            </div>
          </button>
        </div>
      </div>

      <div class="main" id="main">
        <div class="view" id="view-home"></div>
        <div class="view" id="view-discover"></div>
        <div class="view" id="view-create"   style="overflow-y:auto;overscroll-behavior:contain"></div>
        <div class="view" id="view-edit"     style="overflow-y:auto;overscroll-behavior:contain"></div>
        <div class="view" id="view-chat"></div>
        <div class="view" id="view-account"  style="overflow-y:auto;overscroll-behavior:contain"></div>
        <div class="view" id="view-settings"></div>
      </div>

      <nav class="mob-nav">
        <div class="mob-nav-pill" id="mob-pill">
          <canvas class="drop-canvas" id="drop-canvas"></canvas>
          ${this._mni('home',     icons.home,     t('nav.home'))}
          ${this._mni('discover', icons.discover, t('nav.discover'))}
          ${this._mni('create',   icons.create,   t('nav.create'))}
          ${this._mni('account',  icons.account,  t('nav.account'))}
          ${this._mni('settings', icons.settings, t('nav.settings'))}
        </div>
      </nav>`;
  },

  _ni(v, icon, label) {
    return `<button class="nav-item" data-v="${v}" onclick="App.navigate('${v}')">${icon}<span>${label}</span></button>`;
  },
  _mni(v, icon, label) {
    return `<button class="mob-nav-item" data-v="${v}" onclick="App.navigate('${v}')">${icon}<span>${label}</span></button>`;
  },

  _avHtml(u) {
    if (u?.avatar) return `<img src="${u.avatar}" />`;
    return (u?.displayName || u?.username || '?')[0].toUpperCase();
  },

  _chatsHtml() {
    if (!this.chats.length) return `<div style="padding:8px 12px;font-size:13px;color:var(--t4)">No chats yet</div>`;
    return this.chats.slice(0, 40).map(c => {
      const last = c.messages[c.messages.length - 1];
      const prev = (last?.content || '').slice(0, 34) || '…';
      const av = c.characterAvatar
        ? `<img src="${c.characterAvatar}" />`
        : `<span>${c.characterAvatarEmoji || '🤖'}</span>`;
      return `<button class="chat-row" data-cid="${c.id}" onclick="Chat.load('${c.id}')">
        <div class="chat-av">${av}</div>
        <div class="chat-info">
          <div class="chat-name">${c.characterName}</div>
          <div class="chat-prev">${prev}</div>
        </div>
        <button class="btn-icon chat-del" onclick="event.stopPropagation();App.delChat('${c.id}')" style="color:var(--red)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </button>`;
    }).join('');
  },

  renderChats() {
    const el = document.getElementById('sb-chats');
    if (el) el.innerHTML = this._chatsHtml();
  },

  navigate(v, opts = {}) {
    this.view = v;
    document.querySelectorAll('.view').forEach(el => el.classList.remove('on'));
    const prevActive = document.querySelector('.mob-nav-item.on');
    document.querySelectorAll('.nav-item, .mob-nav-item').forEach(el => {
      el.classList.toggle('on', el.dataset.v === v);
    });
    const nextActive = document.querySelector('.mob-nav-item.on');
    if (typeof LiquidDrop !== 'undefined' && prevActive && nextActive && prevActive !== nextActive) {
      LiquidDrop.moveTo(prevActive, nextActive);
    } else if (typeof LiquidDrop !== 'undefined' && nextActive) {
      LiquidDrop.snap(nextActive);
    }

    if (v === 'home') {
      const el = document.getElementById('view-home');
      el.classList.add('on');
      const recentChats = this.chats.slice(0, 5);
      const recentHtml = recentChats.length ? recentChats.map(c => {
        const av = c.characterAvatar
          ? `<img src="${c.characterAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />`
          : `<span style="font-size:22px">${c.characterAvatarEmoji||'🤖'}</span>`;
        const last = c.messages[c.messages.length-1];
        const prev = (last?.content||'').slice(0,30)||'…';
        return `<button class="home-recent-item" onclick="Chat.load('${c.id}')">
          <div class="home-recent-av">${av}</div>
          <div class="home-recent-info">
            <div class="home-recent-name">${c.characterName}</div>
            <div class="home-recent-prev">${prev}</div>
          </div>
        </button>`;
      }).join('') : `<div style="color:var(--t4);font-size:13px;padding:4px 0">Нет чатов</div>`;
      el.innerHTML = `
        <div class="view-hd">
          <div>
            <h2>${t('home.welcome')}, ${this.user?.displayName || this.user?.username} 👋</h2>
            <p>${t('home.subtitle')}</p>
          </div>
          <button class="btn btn-primary" onclick="App.navigate('create')" style="flex-shrink:0">+ ${t('home.new')}</button>
        </div>
        <div class="home-stats">
          <div class="home-stat-card">
            <div class="home-stat-n">${Characters.list.length}</div>
            <div class="home-stat-l">персонажей</div>
          </div>
          <div class="home-stat-card">
            <div class="home-stat-n">${this.chats.length}</div>
            <div class="home-stat-l">чатов</div>
          </div>
          <div class="home-stat-card">
            <div class="home-stat-n">${this.chats.reduce((s,c)=>s+c.messages.length,0)}</div>
            <div class="home-stat-l">сообщений</div>
          </div>
        </div>
        ${recentChats.length ? `
        <div class="home-section">
          <div class="home-section-title">${t('home.recent')}</div>
          <div class="home-recent-list">${recentHtml}</div>
        </div>` : ''}
        <div class="home-section">
          <div class="home-section-title">Мои персонажи</div>
          <div class="char-list" id="home-list"></div>
        </div>`;
      Characters.renderList(document.getElementById('home-list'), Characters.list);
    }
    else if (v === 'discover') {
      const el = document.getElementById('view-discover');
      el.classList.add('on');
      Discover.renderView(el);
    }
    else if (v === 'create') {
      Characters._avatarData = null;
      const el = document.getElementById('view-create');
      el.classList.add('on');
      Characters.renderForm(el, null);
    }
    else if (v === 'edit') {
      Characters._avatarData = null;
      const charId = opts.charId;
      const char = Characters.getById(charId);
      const el = document.getElementById('view-edit');
      el.classList.add('on');
      if (char) Characters.renderForm(el, char);
    }
    else if (v === 'chat') {
      document.getElementById('view-chat').classList.add('on');
    }
    else if (v === 'account') {
      const el = document.getElementById('view-account');
      el.classList.add('on');
      App._renderAccountView(el);
    }
    else if (v === 'settings') {
      const el = document.getElementById('view-settings');
      el.classList.add('on');
      Settings.renderView(el);
    }

    if (this.isMobile && v !== 'chat') this.closeSidebar();
    // Show/hide bottom nav depending on view, remove chat padding
    const mobNav = document.querySelector('.mob-nav');
    if (mobNav) {
      if (v === 'chat') mobNav.classList.add('nav-hidden');
      else mobNav.classList.remove('nav-hidden');
    }
    document.body.classList.toggle('in-chat', v === 'chat');
  },

  setActiveChat(id) {
    document.querySelectorAll('.chat-row').forEach(r => r.classList.toggle('on', r.dataset.cid === id));
  },

  openSidebar() {
    this._sbOpen = true;
    document.getElementById('sidebar')?.classList.add('open');
    document.getElementById('sb-back')?.classList.add('open');
  },

  closeSidebar() {
    this._sbOpen = false;
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sb-back')?.classList.remove('open');
  },

  async delChat(id) {
    if (!confirm('Delete this chat?')) return;
    await API.deleteChat(id);
    this.chats = this.chats.filter(c => c.id !== id);
    this.renderChats();
    if (Chat.current?.id === id) { Chat.current = null; this.navigate('home'); }
    toast(t('toast.deleted'), 'success');
  },

  showProfile() {
    const u = this.user;
    showModal(`
      <div class="modal-hd">
        <div class="modal-title">${t('profile.edit')}</div>
        <button class="btn-icon" onclick="closeModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="prof-banner" id="p-banner" onclick="document.getElementById('p-banner-f').click()"
          style="${u.banner?`background-image:url('${u.banner}');background-size:cover;background-position:center`:''}"></div>
        <div style="display:flex;justify-content:center">
          <div class="prof-modal-av" onclick="document.getElementById('p-av-f').click()">
            ${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />` : `<span>${(u.displayName||u.username||'?')[0]}</span>`}
          </div>
        </div>
        <input type="file" id="p-av-f" accept="image/*" class="hidden" />
        <input type="file" id="p-banner-f" accept="image/*" class="hidden" />
        <div class="form-row" style="margin-top:18px">
          <div class="form-group"><label>${t('profile.displayName')}</label><input id="p-dn" value="${u.displayName||''}" /></div>
          <div class="form-group"><label>${t('profile.username')}</label><input id="p-un" value="${u.username||''}" /></div>
        </div>
        <div class="form-group"><label>${t('profile.bio')}</label><textarea id="p-bio" rows="2">${u.bio||''}</textarea></div>
        <div class="form-group"><label>${t('profile.password')}</label><input id="p-pw" type="password" placeholder="Leave blank to keep" /></div>
        <button class="btn btn-danger" onclick="App.logout()" style="width:100%;justify-content:center">🚪 ${t('profile.logout')}</button>
      </div>
      <div class="modal-ft">
        <button class="btn btn-ghost" onclick="closeModal()">${t('char.cancel')}</button>
        <button class="btn btn-primary" onclick="App.saveProfile()">${t('profile.save')}</button>
      </div>`);

    document.getElementById('p-av-f').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      new FileReader().onload = ev => { App._newAv = ev.target.result; };
      const r = new FileReader(); r.onload = ev => { App._newAv = ev.target.result; }; r.readAsDataURL(f);
    });
    document.getElementById('p-banner-f').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = ev => {
        App._newBanner = ev.target.result;
        const b = document.getElementById('p-banner');
        if (b) { b.style.backgroundImage=`url('${ev.target.result}')`;b.style.backgroundSize='cover'; }
      };
      r.readAsDataURL(f);
    });
  },

  async saveProfile() {
    const d = {
      displayName: document.getElementById('p-dn').value.trim(),
      username:    document.getElementById('p-un').value.trim(),
      bio:         document.getElementById('p-bio').value.trim(),
    };
    if (App._newAv)     d.avatar = App._newAv;
    if (App._newBanner) d.banner = App._newBanner;
    const pw = document.getElementById('p-pw').value;
    if (pw) d.password = pw;
    try {
      this.user = await API.updateProfile(d);
      App._newAv = App._newBanner = null;
      const av = document.getElementById('sb-av');
      if (av) av.innerHTML = this._avHtml(this.user);
      closeModal(); toast(t('toast.saved'), 'success');
    } catch (e) { toast(e.message, 'error'); }
  },

  logout() { API.setToken(null); location.reload(); },

  async _renderAccountView(el) {
    const u = this.user;
    const isAdmin = u?.role === 'admin';

    el.innerHTML = `
      <div class="acc-wrap">
        <div class="acc-banner" style="${u.banner?`background-image:url('${u.banner}')`:''}">
          ${!u.banner ? '<div class="acc-banner-grad"></div>' : ''}
        </div>
        <div class="acc-av-row">
          <div class="acc-av">${u.avatar ? `<img src="${u.avatar}" />` : `<span>${(u.displayName||u.username||'?')[0].toUpperCase()}</span>`}</div>
          <button class="btn btn-ghost" onclick="App.showProfile()" style="margin-left:auto">Редактировать</button>
        </div>
        <div class="acc-info">
          <div class="acc-name">${u.displayName||u.username}</div>
          <div class="acc-un">@${u.username}</div>
          ${u.bio ? `<div class="acc-bio">${u.bio}</div>` : ''}
        </div>
        <div class="acc-stats-row">
          <div class="acc-stat"><div class="acc-stat-n">${Characters.list.length}</div><div class="acc-stat-l">персонажей</div></div>
          <div class="acc-stat"><div class="acc-stat-n">${this.chats.length}</div><div class="acc-stat-l">чатов</div></div>
        </div>
        ${isAdmin ? `
        <div class="acc-section">
          <div class="acc-section-title" style="color:var(--red)">⚡ Админ-панель</div>
          <div class="acc-admin-wrap">
            <button class="btn btn-danger acc-admin-btn" onclick="App._adminRestart()">🔄 Рестарт сервера</button>
          </div>
        </div>` : ''}
      </div>`;

  },

  async _adminRestart() {
    if (!confirm('Перезагрузить сервер? Все активные соединения будут разорваны.')) return;
    try {
      await fetch('/api/admin/restart', { method: 'POST', headers: { Authorization: 'Bearer ' + API.token } });
      toast('Сервер перезагружается...', 'info');
    } catch(e) { toast('Отправлено', 'info'); }
    // Poll until server comes back
    const waitForServer = async () => {
      const maxAttempts = 20;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 1500));
        try {
          const resp = await fetch('/api/presets', { signal: AbortSignal.timeout(3000) });
          if (resp.ok) { location.reload(); return; }
        } catch {}
      }
      toast('Сервер не ответил. Перезагрузи страницу вручную.', 'error');
    };
    waitForServer();
  },

  _bindGlobalSwipe() {
    // Swipe sidebar disabled for mobile web app
  }
};

// ── AUTO-LOCK ──────────────────────────────────────────────────────────────────
// Logs out after 30 minutes of inactivity — protects against physical access
// while the device is unattended (RAT or stolen phone scenario).
(function initAutoLock() {
  let _timer = null;
  const reset = () => {
    clearTimeout(_timer);
    const minutes = (typeof Settings !== 'undefined' && Settings.data?.app?.autoLockMin) || 30;
    _timer = setTimeout(() => {
      if (typeof App !== 'undefined' && App.user) {
        App.logout();
      }
    }, minutes * 60 * 1000);
  };
  ['click', 'touchstart', 'keydown', 'mousemove', 'scroll'].forEach(ev =>
    document.addEventListener(ev, reset, { passive: true }));
  reset();
})();

// ── SVG ICONS ──────────────────────────────────────────────────────────────────
const icons = {
  home:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  discover: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`,
  create:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
  account:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
};

// ── MODAL ──────────────────────────────────────────────────────────────────────
function showModal(html) {
  const ov = document.getElementById('modal-overlay');
  ov.innerHTML = `<div class="modal">${html}</div>`;
  ov.offsetHeight; // reflow
  ov.classList.add('open');
  ov.onclick = e => { if (e.target === ov) closeModal(); };
}
function closeModal() {
  const ov = document.getElementById('modal-overlay');
  ov.classList.remove('open');
  setTimeout(() => { if (!ov.classList.contains('open')) ov.innerHTML = ''; }, 350);
}

// ── TOAST ──────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const icons = { success:'✅', error:'❌', info:'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]||''}</span><span style="flex:1">${msg}</span>`;
  el.onclick = () => { el.classList.add('out'); setTimeout(()=>el.remove(), 200); };
  document.getElementById('toast-wrap').appendChild(el);
  setTimeout(() => { if (el.parentNode) { el.classList.add('out'); setTimeout(()=>el.remove(),200); } }, 3500);
}

function toastUndo(msg, onUndo) {
  const el = document.createElement('div');
  el.className = 'toast info';
  el.innerHTML = `<span>🗑</span><span style="flex:1">${msg}</span><button class="toast-undo-btn">Undo</button>`;
  el.querySelector('.toast-undo-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
    onUndo();
  });
  el.onclick = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  document.getElementById('toast-wrap').appendChild(el);
  setTimeout(() => { if (el.parentNode) { el.classList.add('out'); setTimeout(() => el.remove(), 200); } }, 5000);
}

// ── BOOT ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
