// ── DISCOVER v3 — widget layout + fixed filters ────────────────────────────
const Discover = {
  page: 1,
  loading: false,
  lastQuery: '',
  activeCategory: null,   // null = no filter (show all)
  results: [],
  favorites: JSON.parse(localStorage.getItem('tavern_favs') || '[]'),

  CATS: [
    { id:'russian',    label:'🇷🇺 Русские',   tags:'russian',      nsfw:false },
    { id:'anime',      label:'⛩ Аниме',        tags:'anime',        nsfw:false },
    { id:'game',       label:'🎮 Игры',         tags:'video-game',   nsfw:false },
    { id:'fantasy',    label:'🧙 Фэнтези',      tags:'fantasy',      nsfw:false },
    { id:'romance',    label:'💕 Романтика',    tags:'romance',      nsfw:false },
    { id:'assistant',  label:'🤖 Ассистент',    tags:'assistant',    nsfw:false },
    { id:'historical', label:'🏛 История',       tags:'historical',   nsfw:false },
    { id:'scifi',      label:'🚀 Sci-Fi',        tags:'sci-fi',       nsfw:false },
    { id:'nsfw',       label:'🔞 18+',           tags:'nsfw',         nsfw:true  },
  ],

  // ── Helpers ───────────────────────────────────────────────────────────────
  // Check if char with given name is already in local collection
  _isAdded(name) {
    return Characters.list.some(c => c.name === name);
  },

  // Get existing chat for a character (match by name → local char → chat)
  _existingChat(name) {
    const localChar = Characters.list.find(c => c.name === name);
    if (!localChar) return null;
    return App.chats.find(c => c.characterId === localChar.id) || null;
  },

  // ── Low-level Chub fetch (returns array of nodes) ─────────────────────────
  async _fetch(query, tags, page, sort, pageSize) {
    const cat = this.CATS.find(c => c.id === this.activeCategory);
    const p = new URLSearchParams({
      search:    query    || '',
      page:      page     || 1,
      page_size: pageSize || 24,
      sort:      sort     || 'download_count',
      min_tokens: 50,
      nsfw:      cat?.nsfw ? 'true' : 'false',
      nsfw_only: cat?.nsfw ? 'true' : 'false',
    });
    if (tags) p.set('tags', tags); // only add tags when a category is selected

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res   = await fetch(`/api/chub/search?${p}`, { signal: ctrl.signal }).catch(e => {
      if (e.name === 'AbortError') throw new Error('Chub.ai не отвечает (таймаут 10с)');
      throw e;
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Chub вернул ${res.status}`);
    const data = await res.json();
    return data.data?.nodes || data.nodes || [];
  },

  // ── Flat search (for filter/search mode) ─────────────────────────────────
  async search(query, tags, page) {
    if (this.loading) return;
    this.loading = true;
    this._setLoading(true);
    try {
      const nodes = await this._fetch(query, tags, page, 'download_count', 24);
      if ((page || 1) === 1) this.results = nodes;
      else this.results = [...this.results, ...nodes];
      this._renderGrid(page || 1);
    } catch(e) {
      this._showError(e.message);
    } finally {
      this.loading = false;
      this._setLoading(false);
    }
  },

  // ── Import character from Chub ────────────────────────────────────────────
  async importChar(fullPath, name, btnEl) {
    if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '⏳'; }
    try {
      // Step 1: download PNG via server proxy
      const dlRes  = await fetch('/api/chub/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullPath }),
      });
      const dlData = await dlRes.json();
      if (!dlRes.ok || !dlData.base64) throw new Error(dlData.error || 'Нет данных от Chub');

      // Step 2: parse PNG and save character
      const impRes = await fetch('/api/characters/import/png', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API.token}` },
        body: JSON.stringify({ base64: dlData.base64, save: true }),
      });
      const char = await impRes.json();
      if (!impRes.ok) throw new Error(char.error || 'Ошибка сохранения');

      Characters.list.unshift(char);
      if (typeof Characters.refreshHome === 'function') Characters.refreshHome();

      toast('✓ ' + char.name + ' добавлен!', 'success');
      Translator.translateCharFirstMessages(char);

      // Update button → open chat
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = '💬 Чат';
        btnEl.style.background = 'var(--accent-ultra)';
        btnEl.style.color      = 'var(--accent)';
        btnEl.style.border     = '1px solid var(--accent-glow)';
        btnEl.style.boxShadow  = 'none';
        btnEl.onclick = (e) => { e.stopPropagation(); Chat.startWith(char.id); };
      }
    } catch(e) {
      toast('Ошибка: ' + e.message, 'error');
      if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '+ Добавить'; }
    }
  },

  toggleFav(fullPath, name, avatar) {
    const idx = this.favorites.findIndex(f => f.fullPath === fullPath);
    if (idx >= 0) { this.favorites.splice(idx, 1); toast('Убрано из избранного', 'info'); }
    else          { this.favorites.push({ fullPath, name, avatar, addedAt: Date.now() }); toast('⭐ В избранном!', 'success'); }
    localStorage.setItem('tavern_favs', JSON.stringify(this.favorites));
    const card = document.querySelector(`.disc-card[data-path="${CSS.escape(fullPath)}"]`);
    if (card) {
      const fav = this.isFav(fullPath);
      const btn = card.querySelector('.disc-fav-btn');
      if (btn) { btn.textContent = fav ? '⭐' : '☆'; btn.classList.toggle('on', fav); }
    }
    if (this.activeCategory === 'favorites') this._showFavs();
  },

  isFav(fp) { return this.favorites.some(f => f.fullPath === fp); },

  // ── RENDER VIEW ───────────────────────────────────────────────────────────
  renderView(el) {
    el.innerHTML = `
      <div class="disc-wrap">

        <div class="disc-hd">
          <div class="disc-search-row">
            <div class="disc-search-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="disc-ico">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input id="disc-q" class="disc-inp" placeholder="Поиск персонажей на Chub.ai…" autocomplete="off" />
              <button id="disc-clr" class="disc-clr-btn" style="display:none">✕</button>
            </div>
          </div>
          <div class="disc-cats-row" id="disc-cats">
            <button class="disc-cat-btn ${!this.activeCategory ? 'on' : ''}" data-id=""
              onclick="Discover._pickCat(this)">✨ Все</button>
            ${this.CATS.map(c => `
              <button class="disc-cat-btn ${c.id === this.activeCategory ? 'on' : ''}"
                data-id="${c.id}" data-tags="${c.tags}"
                onclick="Discover._pickCat(this)">${c.label}</button>`).join('')}
            <button class="disc-cat-btn ${this.activeCategory === 'favorites' ? 'on' : ''}"
              data-id="favorites" data-tags=""
              onclick="Discover._pickCat(this)">⭐ Избранное</button>
          </div>
        </div>

        <div class="disc-body" id="disc-body"></div>

      </div>`;

    // Search input
    let timer;
    const inp = el.querySelector('#disc-q');
    const clr = el.querySelector('#disc-clr');
    inp.addEventListener('input', () => {
      clr.style.display = inp.value ? 'flex' : 'none';
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.lastQuery = inp.value.trim();
        this.page = 1;
        if (this.lastQuery) this._showSearchMode();
        else                this._showCurrentMode();
      }, 420);
    });
    clr.addEventListener('click', () => {
      inp.value = ''; clr.style.display = 'none';
      this.lastQuery = ''; this.page = 1;
      this._showCurrentMode();
    });

    // Initial render
    this._showCurrentMode();
  },

  _showCurrentMode() {
    if (this.activeCategory === 'favorites') this._showSearchMode();
    else if (this.activeCategory)            this._showSearchMode();
    else                                     this._showWidgetMode();
  },

  _pickCat(btn) {
    this.activeCategory = btn.dataset.id || null;
    document.querySelectorAll('.disc-cat-btn').forEach(b => b.classList.toggle('on', b === btn));
    this.page = 1; this.results = [];
    this._showCurrentMode();
  },

  _doSearch() {
    const cat  = this.CATS.find(c => c.id === this.activeCategory);
    const tags = cat?.tags || undefined; // no tags when no category
    this.search(this.lastQuery, tags, this.page);
  },

  _more() { this.page++; this._doSearch(); },

  // ── WIDGET MODE (no filter, no search query) ──────────────────────────────
  _showWidgetMode() {
    const body = document.getElementById('disc-body');
    if (!body) return;

    body.innerHTML = `
      <div class="disc-widgets" id="disc-widgets">

        ${this._recentSection()}
        ${this._myCharsSection()}

        <div class="disc-section">
          <div class="disc-section-hd">
            <span class="disc-section-title">🔥 Популярные</span>
            <button class="disc-section-more" onclick="Discover._pickCatById('russian')">Все →</button>
          </div>
          <div class="disc-hscroll-wrap">
            <div class="disc-hscroll" id="dw-pop">
              ${this._hplaceholder(8)}
            </div>
          </div>
        </div>

        <div class="disc-section">
          <div class="disc-section-hd">
            <span class="disc-section-title">✨ Новинки</span>
            <button class="disc-section-more" onclick="Discover._pickCatById('anime')">Все →</button>
          </div>
          <div class="disc-hscroll-wrap">
            <div class="disc-hscroll" id="dw-new">
              ${this._hplaceholder(8)}
            </div>
          </div>
        </div>

        <div class="disc-section">
          <div class="disc-section-hd">
            <span class="disc-section-title">🎲 Случайные</span>
            <button class="disc-section-more" onclick="Discover._pickCatById('fantasy')">Все →</button>
          </div>
          <div class="disc-hscroll-wrap">
            <div class="disc-hscroll" id="dw-rnd">
              ${this._hplaceholder(8)}
            </div>
          </div>
        </div>

        <div class="disc-section">
          <div class="disc-section-hd">
            <span class="disc-section-title">🎮 Игровые</span>
            <button class="disc-section-more" onclick="Discover._pickCatById('game')">Все →</button>
          </div>
          <div class="disc-hscroll-wrap">
            <div class="disc-hscroll" id="dw-game">
              ${this._hplaceholder(8)}
            </div>
          </div>
        </div>

        <div style="height:90px"></div>
      </div>`;

    // Load sections concurrently
    const rndPage = Math.floor(Math.random() * 6) + 2; // page 2-7 for variety
    this._loadSection('dw-pop',  '',  null,      1,       'download_count', 12);
    this._loadSection('dw-new',  '',  null,      1,       'created_at',     12);
    this._loadSection('dw-rnd',  '',  'fantasy', rndPage, 'download_count', 12);
    this._loadSection('dw-game', '',  'video-game', 1,    'download_count', 12);
  },

  _hplaceholder(count) {
    return Array(count).fill(0).map(() => `<div class="disc-hcard-skeleton"></div>`).join('');
  },

  _recentSection() {
    if (!App.chats || !App.chats.length) return '';
    const items = App.chats.slice(0, 12).map(chat => {
      const av = chat.characterAvatar
        ? `<img src="${chat.characterAvatar}" onerror="this.style.display='none'" />`
        : `<span>${chat.characterAvatarEmoji || '🤖'}</span>`;
      return `<button class="disc-recent-card" onclick="Chat.load('${this._safe(chat.id)}')">
        <div class="disc-recent-av">${av}</div>
        <div class="disc-recent-name">${this._html(chat.characterName)}</div>
      </button>`;
    }).join('');

    return `<div class="disc-section">
      <div class="disc-section-hd">
        <span class="disc-section-title">🕐 Недавние чаты</span>
      </div>
      <div class="disc-hscroll-wrap">
        <div class="disc-hscroll">${items}</div>
      </div>
    </div>`;
  },

  _myCharsSection() {
    if (!Characters.list.length) return '';
    // Shuffle for variety each time discover is opened
    const shuffled = [...Characters.list].sort(() => Math.random() - 0.5).slice(0, 12);
    const items = shuffled.map(c => {
      const av = c.avatar
        ? `<img src="${c.avatar}" onerror="this.style.display='none'" />`
        : `<span>${c.avatar_emoji || '🤖'}</span>`;
      return `<button class="disc-recent-card" onclick="Chat.startWith('${this._safe(c.id)}')">
        <div class="disc-recent-av">${av}</div>
        <div class="disc-recent-name">${this._html(c.name)}</div>
      </button>`;
    }).join('');

    return `<div class="disc-section">
      <div class="disc-section-hd">
        <span class="disc-section-title">🎭 Мои персонажи</span>
        <button class="disc-section-more" onclick="App.navigate('home')">Все →</button>
      </div>
      <div class="disc-hscroll-wrap">
        <div class="disc-hscroll">${items}</div>
      </div>
    </div>`;
  },

  async _loadSection(containerId, query, tags, page, sort, pageSize) {
    const el = document.getElementById(containerId);
    if (!el) return;
    try {
      const nodes = await this._fetch(query, tags, page, sort, pageSize);
      if (!el.isConnected) return; // user navigated away
      if (!nodes.length) { el.innerHTML = '<div class="disc-hload">Нет данных</div>'; return; }
      el.innerHTML = nodes.slice(0, 10).map(n => this._hcard(n)).join('');
    } catch(e) {
      if (el.isConnected) el.innerHTML = `<div class="disc-hload">Ошибка загрузки</div>`;
    }
  },

  _pickCatById(id) {
    const btn = document.querySelector(`.disc-cat-btn[data-id="${id}"]`);
    if (btn) this._pickCat(btn);
  },

  // ── SEARCH MODE (filter or query active) ─────────────────────────────────
  _showSearchMode() {
    const body = document.getElementById('disc-body');
    if (!body) return;

    if (this.activeCategory === 'favorites') {
      body.innerHTML = `<div class="disc-grid" id="disc-grid"></div>`;
      this._showFavs();
      return;
    }

    body.innerHTML = `
      <div class="disc-grid" id="disc-grid"></div>
      <div class="disc-spinner" id="disc-spin" style="display:none">
        <div class="loader-ring"></div><span>Загружаю…</span>
      </div>
      <div class="disc-more-row">
        <button class="btn btn-ghost disc-more-btn" id="disc-more"
          onclick="Discover._more()" style="display:none">Загрузить ещё</button>
      </div>`;

    this._doSearch();
  },

  // ── GRID ──────────────────────────────────────────────────────────────────
  _renderGrid(page) {
    const grid = document.getElementById('disc-grid');
    const more = document.getElementById('disc-more');
    if (!grid) return;

    if (!this.results.length) {
      grid.innerHTML = `<div class="disc-empty">
        <div style="font-size:48px">🔍</div>
        <h3>Ничего не найдено</h3>
        <p>Попробуй другой запрос или фильтр</p>
      </div>`;
      if (more) more.style.display = 'none';
      return;
    }

    if (page === 1) {
      grid.innerHTML = this.results.map((n, i) => this._card(n, i)).join('');
    } else {
      const fresh = this.results.slice((page - 1) * 24);
      fresh.forEach(n => {
        const d = document.createElement('div');
        d.innerHTML = this._card(n, 0);
        grid.appendChild(d.firstElementChild);
      });
    }
    if (more) more.style.display = this.results.length >= 24 ? 'block' : 'none';
  },

  _showFavs() {
    const grid = document.getElementById('disc-grid');
    const more = document.getElementById('disc-more');
    if (more) more.style.display = 'none';
    if (!grid) return;
    if (!this.favorites.length) {
      grid.innerHTML = `<div class="disc-empty">
        <div style="font-size:48px">⭐</div>
        <h3>Избранное пусто</h3>
        <p>Нажми ☆ на карточке чтобы сохранить</p>
      </div>`;
      return;
    }
    grid.innerHTML = this.favorites.map(f => `
      <div class="disc-card" data-path="${this._safe(f.fullPath)}">
        <div class="disc-card-cover">
          ${f.avatar
            ? `<img class="disc-cover-img" src="/api/chub/avatar?url=${encodeURIComponent(f.avatar)}" loading="lazy" onerror="this.style.display='none'" />`
            : '<div class="disc-cover-placeholder">🎭</div>'}
        </div>
        <div class="disc-card-info">
          <div class="disc-card-name">${this._html(f.name)}</div>
          <div class="disc-card-row">
            <button class="disc-fav-btn on"
              onclick="event.stopPropagation();Discover.toggleFav('${this._safe(f.fullPath)}','${this._safe(f.name)}','${this._safe(f.avatar||'')}')">⭐</button>
            ${this._addBtn(f.fullPath, f.name, f.avatar)}
          </div>
        </div>
      </div>`).join('');
  },

  // ── COMPACT HORIZONTAL CARD ───────────────────────────────────────────────
  _hcard(n) {
    const fp     = n.fullPath || n.full_path || '';
    const name   = n.name || n.title || '?';
    const avatar = n.avatar_url || n.main_image_url || '';
    const proxied = avatar ? `/api/chub/avatar?url=${encodeURIComponent(avatar)}` : '';
    const added   = this._isAdded(name);

    return `<div class="disc-hcard" data-path="${this._safe(fp)}"
      onclick="Discover._hcardClick('${this._safe(fp)}','${this._safe(name)}','${this._safe(avatar)}',this)">
      <div class="disc-hcard-av">
        ${proxied
          ? `<img src="${proxied}" loading="lazy" onerror="this.style.display='none'" />`
          : '<span>🎭</span>'}
        ${added ? '<div class="disc-hcard-badge">✓</div>' : ''}
      </div>
      <div class="disc-hcard-name">${this._html(name)}</div>
    </div>`;
  },

  _hcardClick(fp, name, avatar, el) {
    const localChar = Characters.list.find(c => c.name === name);
    if (localChar) {
      const chat = App.chats.find(c => c.characterId === localChar.id);
      if (chat) Chat.load(chat.id);
      else      Chat.startWith(localChar.id);
    } else {
      // Import: dim the card while loading
      el.style.opacity = '0.5';
      el.style.pointerEvents = 'none';
      this.importChar(fp, name, null).then(() => {
        if (!el.isConnected) return;
        el.style.opacity = '1';
        const lc = Characters.list.find(c => c.name === name);
        if (lc) {
          // Show ✓ badge and re-wire click to open chat
          const av = el.querySelector('.disc-hcard-av');
          if (av && !av.querySelector('.disc-hcard-badge')) {
            const badge = document.createElement('div');
            badge.className = 'disc-hcard-badge';
            badge.textContent = '✓';
            av.appendChild(badge);
          }
          el.onclick = () => Chat.startWith(lc.id);
        } else {
          // Import failed (toast already shown), re-enable
          el.style.pointerEvents = 'auto';
        }
      });
    }
  },

  // ── FULL CARD ─────────────────────────────────────────────────────────────
  _card(n, i) {
    const fp      = n.fullPath || n.full_path || '';
    const name    = n.name || n.title || '?';
    const desc    = (n.tagline || n.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 120);
    const avatar  = n.avatar_url || n.main_image_url || '';
    const tags    = (n.topics || n.tags || []).slice(0, 5);
    const tokens  = n.n_tokens  ? `${Math.round(n.n_tokens / 1000)}k` : '';
    const msgs    = n.num_messages || '';
    const fav     = this.isFav(fp);
    const proxied = avatar ? `/api/chub/avatar?url=${encodeURIComponent(avatar)}` : '';

    return `<div class="disc-card" data-path="${this._safe(fp)}" style="animation-delay:${i * 20}ms">

      <div class="disc-card-cover">
        ${proxied
          ? `<img class="disc-cover-img" src="${proxied}" loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
             <div class="disc-cover-placeholder" style="display:none">🎭</div>`
          : '<div class="disc-cover-placeholder">🎭</div>'}
        ${(tokens || msgs) ? `<div class="disc-cover-stats">
          ${tokens ? `<span>🪙 ${tokens}</span>` : ''}
          ${msgs   ? `<span>💬 ${msgs}</span>` : ''}
        </div>` : ''}
      </div>

      <div class="disc-card-info">
        <div class="disc-card-name">${this._html(name)}</div>
        ${desc ? `<div class="disc-card-desc">${this._html(desc)}</div>` : ''}
        ${tags.length ? `<div class="disc-card-tags">
          ${tags.map(t => `<span class="disc-tag">${this._html(t)}</span>`).join('')}
        </div>` : ''}
        <div class="disc-card-row">
          <button class="disc-fav-btn ${fav ? 'on' : ''}"
            onclick="event.stopPropagation();Discover.toggleFav('${this._safe(fp)}','${this._safe(name)}','${this._safe(avatar)}')"
            title="${fav ? 'Убрать из' : 'В'} избранное">
            ${fav ? '⭐' : '☆'}
          </button>
          ${this._addBtn(fp, name, avatar)}
        </div>
      </div>
    </div>`;
  },

  // ── Add / Chat button depending on status ─────────────────────────────────
  _addBtn(fp, name, avatar) {
    const localChar = Characters.list.find(c => c.name === name);
    if (localChar) {
      const chat = App.chats.find(c => c.characterId === localChar.id);
      if (chat) {
        return `<button class="disc-add-btn disc-chat-btn"
          onclick="event.stopPropagation();Chat.load('${this._safe(chat.id)}')">💬 Чат</button>`;
      }
      return `<button class="disc-add-btn disc-chat-btn"
        onclick="event.stopPropagation();Chat.startWith('${this._safe(localChar.id)}')">💬 Чат</button>`;
    }
    return `<button class="disc-add-btn"
      onclick="event.stopPropagation();Discover.importChar('${this._safe(fp)}','${this._safe(name)}',this)">
      + Добавить</button>`;
  },

  _showError(msg) {
    const grid = document.getElementById('disc-grid');
    if (grid) grid.innerHTML = `<div class="disc-empty">
      <div style="font-size:40px">😕</div>
      <h3>Ошибка</h3>
      <p style="font-size:12px;word-break:break-all">${msg}</p>
      <button class="btn btn-ghost" onclick="Discover._doSearch()" style="margin-top:14px">Повторить</button>
    </div>`;
  },

  _setLoading(on) {
    const el = document.getElementById('disc-spin');
    if (el) el.style.display = on ? 'flex' : 'none';
  },

  // Escape for use in HTML attribute strings
  _safe(s) { return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); },
  _html(s)  { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
};
