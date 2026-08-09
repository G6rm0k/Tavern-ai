// ── CHAT v3 ────────────────────────────────────────────────────────────────────
const Chat = {
  current: null,
  streaming: false,
  swipeX: 0,
  _tokens: 0,

  // Opens the most recent conversation with this character, or starts one.
  async startWith(charId) {
    const existing = App.chats.filter(c => c.characterId === charId);
    if (existing.length) return this.load(existing[0].id);
    return this.newWith(charId);
  },

  // A character can hold several separate stories now — starting a new one used
  // to be impossible, every click just reopened the same conversation.
  async newWith(charId) {
    const char = Characters.getById(charId);
    if (!char) return;

    const msgs = [];
    if (char.firstMessages?.length) {
      const fm = char.firstMessages[Math.floor(Math.random() * char.firstMessages.length)];
      msgs.push({ role:'assistant', content:fm, id:Date.now().toString(), ts:Date.now(), variants:[fm], vi:0 });
    }
    const nth = App.chats.filter(c => c.characterId === charId).length;
    try {
      const chat = await API.createChat({
        characterId: charId,
        characterName: char.name,
        characterAvatar: char.avatar || null,
        characterAvatarEmoji: char.avatar_emoji || '✦',
        title: nth ? `${char.name} #${nth + 1}` : '',
        messages: msgs
      });
      App.chats.unshift(chat);
      App.renderChats();
      this.load(chat.id);
    } catch (e) { toastError(e); }
  },

  // Pick between existing conversations with this character, or begin another.
  chooseChat(charId) {
    const list = App.chats.filter(c => c.characterId === charId);
    if (!list.length) return this.newWith(charId);
    // Don't make someone pick from a list of one.
    if (list.length === 1) return this.load(list[0].id);
    const char = Characters.getById(charId);
    showModal(`
      <div class="modal-hd">
        <div class="modal-title">${esc(char?.name || '')}</div>
        <button class="btn-icon" onclick="closeModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:8px">
        ${list.map(c => {
          const last = (c.messages || [])[(c.messages || []).length - 1];
          return `<button class="btn btn-ghost chat-pick" onclick="closeModal();Chat.load('${escJs(c.id)}')">
            <span class="chat-pick-name">${esc(c.title || c.characterName)}</span>
            <span class="chat-pick-prev">${esc((last?.content || '').slice(0, 40) || '…')}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="modal-ft">
        <button class="btn btn-primary" style="width:100%;justify-content:center"
          onclick="closeModal();Chat.newWith('${escJs(charId)}')">+ ${t('chat.new')}</button>
      </div>`);
  },

  renameChat() {
    const cur = this.current;
    if (!cur) return;
    const name = prompt(t('chat.rename'), cur.title || cur.characterName);
    if (name === null) return;
    cur.title = name.trim();
    API.updateChat(cur.id, { title: cur.title }).catch(toastError);
    const inList = App.chats.find(c => c.id === cur.id);
    if (inList) inList.title = cur.title;
    App.renderChats();
    this.render();
  },

  async load(id) {
    try {
      const chat = await API.getChat(id);
      if (!chat || !chat.id) throw new Error(t('chat.gone'));
      chat.messages = chat.messages || [];
      this.current = chat;
      App.navigate('chat');
      this.render();
      App.setActiveChat(id);
    } catch (e) {
      // Used to leave a blank screen when the chat was missing or the session
      // had locked: render() would throw on a null current.
      if (e.code !== 'NEED_UNLOCK') toastError(e);
      App.navigate('home');
    }
  },

  render() {
    const c = this.current;
    const char = Characters.getById(c.characterId);
    const mp = Settings.getMP();
    const prov = Settings.getActive();
    const av = c.characterAvatar
      ? `<img src="${escAttr(c.characterAvatar)}" />`
      : `<span>${esc(c.characterAvatarEmoji||'✦')}</span>`;

    document.getElementById('view-chat').innerHTML = `
      ${char?.avatar ? `<div class="chat-bg" style="background-image:url('${escAttr(char.avatar)}')"></div>` : ''}
      <div class="chat-area">
        <div class="chat-hd">
          <button class="btn-icon" onclick="App.navigate('home')" style="color:var(--t2)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div class="chat-hd-av">${av}</div>
          <div style="flex:1;min-width:0">
            <div class="chat-hd-name">${esc(c.title || c.characterName)}</div>
            <div class="chat-hd-sub">${prov
              ? `<span class="conn-dot ok"></span>${esc(prov.model || '—')}`
              : `<span class="conn-dot bad"></span>${t('chat.no.provider.short')}`}</div>
          </div>
          <button class="btn-icon" onclick="Chat._menu()" style="color:var(--t2)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
            </svg>
          </button>
        </div>

        <div class="chat-msgs" id="chat-msgs">
          ${c.messages.length
            ? c.messages.map(m => this._msgHtml(m)).join('')
            : `<div class="empty"><div class="empty-ico">◌</div><h3>${t('chat.empty')}</h3><p>${t('chat.empty.sub')}</p></div>`}
        </div>

        <div class="chat-inp-area">
          <div class="inp-row">
            <textarea id="chat-input" placeholder="${t('chat.input')}" rows="1"></textarea>
            <button class="send-btn" id="send-btn" onclick="Chat.send()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
            </button>
            <button class="send-btn stop-btn" id="stop-btn" onclick="Chat.stop()" title="${t('chat.stop')}" style="display:none">
              <svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>
            </button>
          </div>
          <div style="display:flex;justify-content:flex-end;padding:2px 4px 0">
            <span class="token-count" id="tok-count">0 tokens</span>
          </div>
        </div>
      </div>`;

    this._scrollBottom();
    this._bindInput();
    this._bindSwipe();
    // Hide bottom nav in chat on mobile
    const nav = document.querySelector('.mob-nav');
    if (nav) nav.classList.add('nav-hidden');
  },

  _msgHtml(msg) {
    const isUser = msg.role === 'user';
    const time = msg.ts ? new Date(msg.ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '';
    const av = isUser
      ? `<div class="msg-av">${esc((App.user?.displayName||'U')[0].toUpperCase())}</div>`
      : `<div class="msg-av">${this.current.characterAvatar ? `<img src="${escAttr(this.current.characterAvatar)}" />` : esc(this.current.characterAvatarEmoji||'✦')}</div>`;

    return `<div class="msg ${isUser?'user':'bot'}" data-id="${escAttr(msg.id)}">
      ${av}
      <div class="msg-body">
        <div class="msg-bubble">${this._md(msg.content)}</div>
        <div class="msg-meta">
          ${time ? `<span class="msg-time">${time}</span>` : ''}
          <button class="msg-btn" onclick="Chat.copyMsg('${escJs(msg.id)}')" title="${t('chat.copy')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button class="msg-btn" onclick="Chat.editMsg('${escJs(msg.id)}')" title="${t('chat.edit')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          ${!isUser ? `<button class="msg-btn on-accent" onclick="Chat.regen('${escJs(msg.id)}')" title="${t('chat.regen')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          </button>` : ''}
          <button class="msg-btn on-red" onclick="Chat.delMsg('${escJs(msg.id)}')" title="${t('char.delete')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>
        ${this._variantBar(msg)}
      </div>
    </div>`;
  },

  _md(text) {
    if (!text) return '';
    const slots = [];
    const save = (html) => { const i = slots.length; slots.push(html); return '\x00'+i+'\x00'; };
    const esc  = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    let t = text;
    t = t.replace(/\(\(([^)\n]+)\)\)/g, function(_,x){ return save('<span class="rp-ooc">(('+esc(x)+'))</span>'); });
    t = t.replace(/\[\[([^\]\n]+)\]\]/g, function(_,x){ return save('<span class="rp-ooc">[['+esc(x)+']]</span>'); });
    t = t.replace(/\*\*([^*\n]+)\*\*/g,  function(_,x){ return save('<strong>'+esc(x)+'</strong>'); });
    t = t.replace(/\*([^*\n]+)\*/g,      function(_,x){ return save('<span class="rp-action">'+esc(x)+'</span>'); });
    t = t.replace(/\(([^()\n]{3,})\)/g,  function(_,x){ return save('<span class="rp-thought">('+esc(x)+')</span>'); });
    t = t.replace(/"([^"\n]{2,})"/g,     function(_,x){ return save('<span class="rp-speech">\u201c'+esc(x)+'\u201d</span>'); });
    t = t.replace(/\u00ab([^\u00bb\n]{2,})\u00bb/g, function(_,x){ return save('<span class="rp-speech">\u00ab'+esc(x)+'\u00bb</span>'); });
    t = t.replace(/`([^`\n]+)`/g,        function(_,x){ return save('<code class="rp-code">'+esc(x)+'</code>'); });
    t = t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    t = t.replace(/\x00(\d+)\x00/g, function(_,i){ return slots[+i]; });
    return t.split(/\n\n+/).map(function(p){
      var s = p.trim(); if(!s) return '';
      var inner = s.replace(/\n/g,'<br>');
      var cls = s.indexOf('rp-action')>=0 ? ' rp-p-action'
              : s.indexOf('rp-speech')>=0 ? ' rp-p-speech'
              : s.indexOf('rp-thought')>=0? ' rp-p-thought'
              : s.indexOf('rp-ooc')>=0    ? ' rp-p-ooc' : '';
      return '<p class="rp-p'+cls+'">'+inner+'</p>';
    }).join('');
  },
  _bindInput() {
    const inp = document.getElementById('chat-input');
    if (!inp) return;
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && Settings.data.app?.sendOnEnter !== false) {
        e.preventDefault(); this.send();
      }
    });
    let draftTimer;
    inp.addEventListener('input', () => {
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 130) + 'px';
      // token estimate
      const words = inp.value.split(/\s+/).filter(Boolean).length;
      const tok = Math.round(words * 1.3);
      const el = document.getElementById('tok-count');
      if (el) el.textContent = `~${tok} ${t('chat.tokens')}`;
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => this.saveDraft(), 400);
    });
    this.restoreDraft();
    // Hide bottom nav in chat
    const nav = document.querySelector('.mob-nav');
    if (nav) nav.classList.add('nav-hidden');
    // iOS keyboard fix: shrink #view-chat to visualViewport height so header stays visible.
    // #view-chat is position:fixed in CSS already, preventing iOS from scrolling the page.
    if (window.visualViewport) {
      const view = document.getElementById('view-chat');
      const onVPChange = () => {
        if (!view) return;
        // Auto-cleanup when navigating away from chat
        if (!view.classList.contains('on')) {
          window.visualViewport.removeEventListener('resize', onVPChange);
          window.visualViewport.removeEventListener('scroll', onVPChange);
          view.style.height = '';
          view.classList.remove('kbd-up');
          return;
        }
        const vv = window.visualViewport;
        const kbdOpen = vv.height < window.innerHeight - 80;
        view.style.height = vv.height + 'px';
        view.classList.toggle('kbd-up', kbdOpen);
        if (kbdOpen) setTimeout(() => this._scrollBottom(), 80);
      };
      window.visualViewport.addEventListener('resize', onVPChange);
      window.visualViewport.addEventListener('scroll', onVPChange);
    }
    inp.focus();
  },

  _bindSwipe() {
    // Swipe sidebar disabled for mobile web app
  },

  // ── PROMPT ASSEMBLY ───────────────────────────────────────────────────────
  // Who {{user}} refers to. A persona gives the model something to work with
  // beyond a bare display name.
  _userName() {
    return Settings.data.persona?.name?.trim() || App.user?.displayName || App.user?.username || 'User';
  },

  _fill(text) {
    return String(text || '')
      .replace(/\{\{char\}\}/g, this.current.characterName)
      .replace(/\{\{user\}\}/g, this._userName());
  },

  // Lorebook entries whose keywords appear in the recent conversation. This is
  // how a character can "know" about places, people and events without paying
  // for all of it in every single request.
  // Russian (and most inflected languages) would almost never match on an exact
  // keyword — "башня" in the entry versus "башню" in the message. Matching on the
  // stem covers ordinary declension without needing every form spelled out.
  _matches(key, haystack) {
    const k = String(key).toLowerCase().trim();
    if (!k) return false;
    if (haystack.includes(k)) return true;
    return k.length >= 5 && haystack.includes(k.slice(0, -1));
  },

  _lore(char, recent) {
    const book = char?.lorebook;
    if (!Array.isArray(book) || !book.length) return '';
    const haystack = recent.map(m => m.content || '').join('\n').toLowerCase();
    const hits = book.filter(e =>
      e?.content && (e.keys || []).some(k => this._matches(k, haystack)));
    if (!hits.length) return '';
    return '\n\n[Важные сведения]\n' + hits.map(e => this._fill(e.content)).join('\n');
  },

  _buildSystem(char, recent) {
    const mp = Settings.getMP();
    const parts = [];
    if (mp.globalSystem) parts.push(mp.globalSystem);
    if (char?.systemPrompt) parts.push(this._fill(char.systemPrompt));

    const persona = Settings.data.persona;
    if (persona?.description?.trim()) {
      parts.push(`[О собеседнике по имени ${this._userName()}]\n` + persona.description.trim());
    }
    // Everything that scrolled out of the context window, compressed.
    if (this.current.summary) {
      parts.push('[Что было раньше в этом разговоре]\n' + this.current.summary);
    }
    const lore = this._lore(char, recent);
    if (lore) parts.push(lore.trim());

    return parts.filter(Boolean).join('\n\n');
  },

  // Messages actually sent upstream: the tail of the conversation, with each
  // message reduced to the variant currently on screen.
  _context(excludeId) {
    const mp = Settings.getMP();
    const list = excludeId
      ? this.current.messages.slice(0, this.current.messages.findIndex(m => m.id === excludeId))
      : this.current.messages;
    return list
      .slice(-(mp.contextMessages || 20))
      .map(m => ({ role: m.role, content: m.content }));
  },

  async send() {
    if (this.streaming) return;
    const inp = document.getElementById('chat-input');
    const text = inp?.value.trim();
    if (!text) return;
    if (!Settings.getActive()) { toastError({ code: 'NO_PROVIDER' }); return; }

    inp.value = ''; inp.style.height = 'auto';
    this.clearDraft();
    Sounds.play('send');

    const userMsg = { role:'user', content:text, id:Date.now().toString(), ts:Date.now() };
    this.current.messages.push(userMsg);

    document.getElementById('chat-msgs')?.querySelector('.empty')?.remove();
    this._appendMsg(userMsg);
    this._scrollBottom();

    await this._generate({ restoreOnFail: text });
    await this._maybeSummarise();
  },

  // Produce one assistant reply. With `variantOf` set, the result is added as an
  // alternative to that message instead of a new one, which is what makes the
  // ‹ 1/3 › swipes work.
  async _generate({ variantOf = null, restoreOnFail = null } = {}) {
    const prov = Settings.getActive();
    if (!prov) { toastError({ code: 'NO_PROVIDER' }); return; }

    const container = document.getElementById('chat-msgs');
    const typing = document.createElement('div');
    typing.id = 'typing-el';
    typing.className = 'msg bot typing-msg';
    typing.innerHTML = `<div class="msg-av">${esc(this.current.characterAvatarEmoji||'✦')}</div>
      <div class="msg-body"><div class="typing-bub"><div class="t-dot"></div><div class="t-dot"></div><div class="t-dot"></div></div></div>`;
    container?.appendChild(typing);
    Anim.msgIn(typing);
    this._scrollBottom();
    this._setStreaming(true);

    const char   = Characters.getById(this.current.characterId);
    const mp     = Settings.getMP();
    const ctx    = this._context(variantOf);
    const sys    = this._buildSystem(char, ctx);
    const target = variantOf ? this.current.messages.find(m => m.id === variantOf) : null;
    const aid    = variantOf || (Date.now() + 1).toString();
    let bubble   = null;

    await API.stream(
      { messages: ctx, provider: prov, model: prov.model, systemPrompt: sys,
        temperature: mp.temperature, max_tokens: mp.maxTokens, top_p: mp.topP },
      (delta, full) => {
        if (!bubble) {
          typing.remove();
          if (!target) this._appendMsg({ role:'assistant', content:full, id:aid, ts:Date.now() });
          bubble = document.querySelector(`[data-id="${aid}"] .msg-bubble`);
        }
        if (bubble) bubble.innerHTML = this._md(full);
        if (Settings.data.app?.autoscroll !== false) this._scrollBottom();
        const tokEl = document.getElementById('tok-count');
        if (tokEl) tokEl.textContent = `~${Math.round(full.split(/\s+/).length * 1.3)} ${t('chat.tokens')}`;
      },
      async (full, stopped) => {
        typing.remove();
        if (full) {
          if (target) {
            target.variants = [...(target.variants || [target.content]), full];
            target.vi = target.variants.length - 1;
            target.content = full;
            this.render();
          } else {
            const am = { role:'assistant', content:full, id:aid, ts:Date.now(), variants:[full], vi:0 };
            if (stopped) am.stopped = true;
            this.current.messages.push(am);
          }
          try { await API.saveMessages(this.current.id, this.current.messages); }
          catch (e) { toastError(e); }
          App.renderChats();
          Sounds.play('msg');
        } else if (stopped && restoreOnFail) {
          this.current.messages.pop();
          const inp = document.getElementById('chat-input');
          if (inp) inp.value = restoreOnFail;
          this.render();
        }
        this._done();
      },
      err => {
        typing.remove();
        toastError(err);
        if (restoreOnFail) {
          this.current.messages.pop();
          const inp = document.getElementById('chat-input');
          if (inp) { inp.value = restoreOnFail; this.saveDraft(); }
          this.render();
        }
        this._done();
      }
    );
  },

  // ── SWIPES ────────────────────────────────────────────────────────────────
  // Regenerating used to delete the old reply outright, so a better answer could
  // never be compared with — or gone back to.
  async swipe(id, dir) {
    const m = this.current.messages.find(x => x.id === id);
    if (!m?.variants?.length || this.streaming) return;
    const next = (m.vi ?? 0) + dir;

    // Swiping past the last variant asks for a fresh one.
    if (next >= m.variants.length) return this.regen(id);
    if (next < 0) return;

    m.vi = next;
    m.content = m.variants[next];
    this.render();
    try { await API.saveMessages(this.current.id, this.current.messages); }
    catch (e) { toastError(e); }
  },

  _variantBar(msg) {
    const n = msg.variants?.length || 0;
    const last = this.current.messages[this.current.messages.length - 1];
    // Only the final reply can be re-rolled without rewriting history.
    if (msg.role !== 'assistant' || msg !== last) return '';
    const i = (msg.vi ?? 0) + 1;
    return `<div class="swipe-bar">
      <button class="swipe-btn" ${i <= 1 ? 'disabled' : ''} onclick="Chat.swipe('${escJs(msg.id)}',-1)">‹</button>
      <span class="swipe-n">${n > 1 ? `${i}/${n}` : '1'}</span>
      <button class="swipe-btn" onclick="Chat.swipe('${escJs(msg.id)}',1)" title="${t('chat.regen')}">›</button>
    </div>`;
  },

  // ── MEMORY ────────────────────────────────────────────────────────────────
  // Once a chat outgrows the context window the model simply forgot the start.
  // Compress what fell off into a short recap and keep it in the system prompt.
  async _maybeSummarise() {
    const mp    = Settings.getMP();
    const keep  = mp.contextMessages || 20;
    const msgs  = this.current.messages;
    if (!Settings.data.app?.memory) return;
    if (msgs.length < keep * 2) return;
    if (this._summarising) return;

    const cut = msgs.slice(0, msgs.length - keep);
    if (cut.length <= (this.current.summarisedUpTo || 0)) return;

    const prov = Settings.getActive();
    if (!prov) return;
    this._summarising = true;
    try {
      const transcript = cut.map(m =>
        `${m.role === 'user' ? this._userName() : this.current.characterName}: ${m.content}`).join('\n');
      const text = await API.complete({
        provider: prov, model: prov.model, max_tokens: 400, temperature: 0.3,
        systemPrompt: 'Ты сжимаешь переписку в краткое содержание. Пиши только факты, договорённости, важные события и изменения в отношениях — сухим списком, без вступлений. Не более 200 слов.',
        messages: [{ role: 'user', content:
          (this.current.summary ? 'Уже известно:\n' + this.current.summary + '\n\nНовая часть переписки:\n' : '') + transcript }],
      });
      if (text) {
        this.current.summary = text.trim();
        this.current.summarisedUpTo = cut.length;
        await API.updateChat(this.current.id, {
          summary: this.current.summary, summarisedUpTo: this.current.summarisedUpTo,
        });
      }
    } catch { /* memory is a bonus, never break the chat over it */ }
    finally { this._summarising = false; }
  },

  // Cancel an in-flight reply, keeping whatever already arrived.
  stop() {
    if (!this.streaming) return;
    API.abortStream();
  },

  _setStreaming(on) {
    this.streaming = on;
    const send = document.getElementById('send-btn');
    const stop = document.getElementById('stop-btn');
    if (send) send.style.display = on ? 'none' : '';
    if (stop) stop.style.display = on ? '' : 'none';
  },

  _done() { this._setStreaming(false); },

  // ── DRAFTS ────────────────────────────────────────────────────────────────
  // A half-typed message used to disappear on reload, auto-lock or a stray
  // navigation. Keep it per chat until it is actually sent.
  _draftKey() { return this.current ? `wesaid_draft_${this.current.id}` : null; },

  saveDraft() {
    const k = this._draftKey();
    const v = document.getElementById('chat-input')?.value || '';
    if (!k) return;
    if (v.trim()) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  },

  clearDraft() {
    const k = this._draftKey();
    if (k) localStorage.removeItem(k);
  },

  restoreDraft() {
    const k = this._draftKey();
    const inp = document.getElementById('chat-input');
    if (!k || !inp) return;
    const v = localStorage.getItem(k);
    if (v) {
      inp.value = v;
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 130) + 'px';
    }
  },

  _appendMsg(msg) {
    const c = document.getElementById('chat-msgs');
    if (!c) return;
    const div = document.createElement('div');
    div.innerHTML = this._msgHtml(msg);
    const el = div.firstElementChild;
    c.appendChild(el);
    if (Anim.enabled) Anim.msgIn(el);
  },

  _scrollBottom() {
    const el = document.getElementById('chat-msgs');
    if (el) el.scrollTop = el.scrollHeight;
  },

  async copyMsg(id) {
    const m = this.current.messages.find(x=>x.id===id);
    if (!m) return;
    try {
      await navigator.clipboard.writeText(m.content);
      toast(t('toast.copied'), 'success');
    } catch {
      toast('Copy failed', 'error');
    }
  },

  editMsg(id) {
    const m = this.current.messages.find(x=>x.id===id);
    if (!m) return;
    const bubble = document.querySelector(`[data-id="${id}"] .msg-bubble`);
    if (!bubble) return;
    const orig = m.content;
    bubble.textContent = '';
    const ta = document.createElement('textarea');
    ta.style.cssText = 'width:100%;background:transparent;border:none;color:inherit;font:inherit;resize:vertical;min-height:60px;-webkit-user-select:text;user-select:text';
    ta.textContent = orig;
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:6px;margin-top:8px';
    btns.innerHTML = `
      <button class="btn btn-primary" style="padding:7px 16px;font-size:13px" onclick="Chat._saveEdit('${id}')">Save</button>
      <button class="btn btn-ghost"   style="padding:7px 14px;font-size:13px" onclick="Chat._cancelEdit('${id}')">Cancel</button>`;
    bubble.appendChild(ta);
    bubble.appendChild(btns);
    bubble._orig = orig;
    ta.focus();
  },

  async _saveEdit(id) {
    const bubble = document.querySelector(`[data-id="${id}"] .msg-bubble`);
    const ta = bubble?.querySelector('textarea');
    if (!ta) return;
    const newText = ta.value.trim();
    const m = this.current.messages.find(x=>x.id===id);
    if (m) { m.content = newText; m.edited = true; }
    if (bubble) bubble.innerHTML = this._md(newText);
    await API.saveMessages(this.current.id, this.current.messages);
    toast(t('toast.saved'), 'success');
  },

  _cancelEdit(id) {
    const bubble = document.querySelector(`[data-id="${id}"] .msg-bubble`);
    const m = this.current.messages.find(x=>x.id===id);
    if (bubble && m) bubble.innerHTML = this._md(m.content);
  },

  async regen(id) {
    if (this.streaming) return;
    const msgs = this.current.messages;
    const idx  = msgs.findIndex(x => x.id === id);
    if (idx < 0) return;
    if (msgs[idx].role !== 'assistant') return;

    // Anything after this reply belongs to a branch the user is leaving.
    if (idx < msgs.length - 1) {
      if (!confirm(t('chat.regen.trim'))) return;
      this.current.messages = msgs.slice(0, idx + 1);
      this.render();
    }
    await this._generate({ variantOf: id });
  },

  async delMsg(id) {
    const idx = this.current.messages.findIndex(x => x.id === id);
    if (idx === -1) return;
    const deleted = this.current.messages[idx];

    this.current.messages.splice(idx, 1);
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) {
      el.style.transition = 'opacity .2s, transform .2s';
      el.style.opacity = '0';
      el.style.transform = 'scale(.92)';
      setTimeout(() => el.remove(), 220);
    }

    let undone = false;
    toastUndo(t('toast.deleted'), () => {
      undone = true;
      this.current.messages.splice(idx, 0, deleted);
      const c = document.getElementById('chat-msgs');
      if (c) c.innerHTML = this.current.messages.map(m => this._msgHtml(m)).join('');
      toast('Восстановлено!', 'success');
    });

    setTimeout(async () => {
      if (!undone) await API.saveMessages(this.current.id, this.current.messages);
    }, 5500);
  },

  async clearChat() {
    if (!confirm(t('chat.clear') + '?')) return;
    this.clearDraft();
    this.current.messages = [];
    const char = Characters.getById(this.current.characterId);
    if (char?.firstMessages?.length) {
      const fm = char.firstMessages[Math.floor(Math.random()*char.firstMessages.length)];
      this.current.messages.push({ role:'assistant', content:fm, id:Date.now().toString(), ts:Date.now() });
    }
    await API.saveMessages(this.current.id, this.current.messages);
    this.render();
    toast(t('toast.deleted'), 'success');
  },

  exportChat() {
    if (!this.current) return;
    const lines = this.current.messages.map(m =>
      `[${m.role==='user'?(App.user?.displayName||'You'):this.current.characterName}]\n${m.content}`
    ).join('\n\n---\n\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines], { type:'text/plain' }));
    a.download = `${this.current.characterName}-${Date.now()}.txt`;
    a.click();
    toast('Exported!', 'success');
  },

  _menu() {
    showModal(`
      <div class="modal-hd">
        <div class="modal-title">${esc(this.current.characterName)}</div>
        <button class="btn-icon" onclick="closeModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-ghost" onclick="closeModal();Chat.newWith('${escJs(this.current.characterId)}')" style="justify-content:flex-start;gap:10px">
          ✦ ${t('chat.new')}
        </button>
        <button class="btn btn-ghost" onclick="closeModal();Chat.renameChat()" style="justify-content:flex-start;gap:10px">
          ✏️ ${t('chat.rename')}
        </button>
        <button class="btn btn-ghost" onclick="closeModal();Chat.clearChat()" style="justify-content:flex-start;gap:10px">
          🗑 ${t('chat.clear')}
        </button>
        <button class="btn btn-ghost" onclick="closeModal();Chat.exportChat()" style="justify-content:flex-start;gap:10px">
          📤 Export .txt
        </button>
        <div class="divider"></div>
        <div style="font-size:13px;color:var(--t3)">${this.current.messages.length} · ${esc(this.current.characterName)}</div>
      </div>`);
  }
};
