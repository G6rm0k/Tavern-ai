// ── CHAT v3 ────────────────────────────────────────────────────────────────────
const Chat = {
  current: null,
  streaming: false,
  swipeX: 0,
  _tokens: 0,

  async startWith(charId) {
    const char = Characters.getById(charId);
    if (!char) return;
    const ex = App.chats.find(c => c.characterId === charId);
    if (ex) return this.load(ex.id);

    const msgs = [];
    if (char.firstMessages?.length) {
      const fm = char.firstMessages[Math.floor(Math.random() * char.firstMessages.length)];
      msgs.push({ role:'assistant', content:fm, id:Date.now().toString(), ts:Date.now() });
    }
    const chat = await API.createChat({
      characterId: charId,
      characterName: char.name,
      characterAvatar: char.avatar || null,
      characterAvatarEmoji: char.avatar_emoji || '🤖',
      messages: msgs
    });
    App.chats.unshift(chat);
    App.renderChats();
    this.load(chat.id);
  },

  async load(id) {
    const chat = await API.getChat(id);
    this.current = chat;
    App.navigate('chat');
    this.render();
    App.setActiveChat(id);
  },

  render() {
    const c = this.current;
    const char = Characters.getById(c.characterId);
    const mp = Settings.getMP();
    const prov = Settings.getActive();
    const av = c.characterAvatar
      ? `<img src="${c.characterAvatar}" />`
      : `<span>${c.characterAvatarEmoji||'🤖'}</span>`;

    document.getElementById('view-chat').innerHTML = `
      ${char?.avatar ? `<div class="chat-bg" style="background-image:url('${char.avatar}')"></div>` : ''}
      <div class="chat-area">
        <div class="chat-hd">
          <button class="btn-icon" onclick="App.navigate('home')" style="color:var(--t2)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div class="chat-hd-av">${av}</div>
          <div style="flex:1;min-width:0">
            <div class="chat-hd-name">${c.characterName}</div>
            <div class="chat-hd-sub">${prov ? `${prov.model} · temp ${mp.temperature}` : 'No provider'}</div>
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
            : `<div class="empty"><div class="empty-ico">💬</div><h3>${t('chat.empty')}</h3><p>${t('chat.empty.sub')}</p></div>`}
        </div>

        <div class="chat-inp-area">
          <div class="inp-row">
            <textarea id="chat-input" placeholder="${t('chat.input')}" rows="1"></textarea>
            <button class="send-btn" id="send-btn" onclick="Chat.send()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
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
      ? `<div class="msg-av">${(App.user?.displayName||'U')[0].toUpperCase()}</div>`
      : `<div class="msg-av">${this.current.characterAvatar ? `<img src="${this.current.characterAvatar}" />` : this.current.characterAvatarEmoji||'🤖'}</div>`;

    return `<div class="msg ${isUser?'user':'bot'}" data-id="${msg.id}">
      ${av}
      <div class="msg-body">
        <div class="msg-bubble">${this._md(msg.content)}</div>
        <div class="msg-meta">
          ${time ? `<span class="msg-time">${time}</span>` : ''}
          <button class="msg-btn" onclick="Chat.copyMsg('${msg.id}')" title="Копировать">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button class="msg-btn" onclick="Chat.editMsg('${msg.id}')" title="Изменить">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          ${!isUser ? `<button class="msg-btn on-accent" onclick="Chat.regen('${msg.id}')" title="Ещё раз">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          </button>` : ''}
          <button class="msg-btn on-red" onclick="Chat.delMsg('${msg.id}')" title="Удалить">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>
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
    inp.addEventListener('input', () => {
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 130) + 'px';
      // token estimate
      const words = inp.value.split(/\s+/).filter(Boolean).length;
      const tok = Math.round(words * 1.3);
      const el = document.getElementById('tok-count');
      if (el) el.textContent = `~${tok} tokens`;
    });
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

  async send() {
    if (this.streaming) return;
    const inp = document.getElementById('chat-input');
    const text = inp?.value.trim();
    if (!text) return;
    const prov = Settings.getActive();
    if (!prov) { toast(t('chat.no.provider'), 'error'); return; }

    inp.value = ''; inp.style.height = 'auto';
    Sounds.play('send');

    const userMsg = { role:'user', content:text, id:Date.now().toString(), ts:Date.now() };
    this.current.messages.push(userMsg);

    const container = document.getElementById('chat-msgs');
    container?.querySelector('.empty')?.remove();
    this._appendMsg(userMsg);
    this._scrollBottom();

    // Typing
    const typing = document.createElement('div');
    typing.id = 'typing-el';
    typing.className = 'msg bot typing-msg';
    typing.innerHTML = `<div class="msg-av">${this.current.characterAvatarEmoji||'🤖'}</div>
      <div class="msg-body"><div class="typing-bub"><div class="t-dot"></div><div class="t-dot"></div><div class="t-dot"></div></div></div>`;
    container?.appendChild(typing);
    Anim.msgIn(typing);
    this._scrollBottom();

    const sbtn = document.getElementById('send-btn');
    if (sbtn) sbtn.disabled = true;
    this.streaming = true;

    const char = Characters.getById(this.current.characterId);
    const mp = Settings.getMP();
    let sys = char?.systemPrompt || '';
    sys = sys.replace(/\{\{char\}\}/g, this.current.characterName).replace(/\{\{user\}\}/g, App.user?.displayName||'User');
    if (mp.globalSystem) sys = mp.globalSystem + '\n\n' + sys;

    const ctx = this.current.messages.slice(-(mp.contextMessages||20)).map(m => ({ role:m.role, content:m.content }));
    const aid = (Date.now()+1).toString();
    let bubble = null;

    await API.stream(
      { messages:ctx, provider:prov, model:prov.model, systemPrompt:sys,
        temperature:mp.temperature, max_tokens:mp.maxTokens, top_p:mp.topP },
      (delta, full) => {
        if (!bubble) {
          typing.remove();
          const m = { role:'assistant', content:full, id:aid, ts:Date.now() };
          this._appendMsg(m);
          bubble = document.querySelector(`[data-id="${aid}"] .msg-bubble`);
        }
        if (bubble) bubble.innerHTML = this._md(full);
        if (Settings.data.app?.autoscroll !== false) this._scrollBottom();
        // update token count
        const tokEl = document.getElementById('tok-count');
        if (tokEl) tokEl.textContent = `~${Math.round(full.split(/\s+/).length * 1.3)} tokens`;
      },
      async full => {
        typing.remove();
        if (full) {
          const am = { role:'assistant', content:full, id:aid, ts:Date.now() };
          this.current.messages.push(am);
          await API.saveMessages(this.current.id, this.current.messages);
          App.renderChats();
          Sounds.play('msg');
        }
        this._done();
      },
      err => {
        typing.remove();
        toast(err, 'error');
        this.current.messages.pop();
        if (inp) inp.value = text;
        this._done();
      }
    );
  },

  _done() {
    this.streaming = false;
    const b = document.getElementById('send-btn');
    if (b) b.disabled = false;
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

  copyMsg(id) {
    const m = this.current.messages.find(x=>x.id===id);
    if (!m) return;
    navigator.clipboard?.writeText(m.content);
    toast(t('toast.copied'), 'success');
  },

  editMsg(id) {
    const m = this.current.messages.find(x=>x.id===id);
    if (!m) return;
    const bubble = document.querySelector(`[data-id="${id}"] .msg-bubble`);
    if (!bubble) return;
    const orig = m.content;
    bubble.innerHTML = `
      <textarea style="width:100%;background:transparent;border:none;color:inherit;font:inherit;resize:vertical;min-height:60px;-webkit-user-select:text;user-select:text">${orig}</textarea>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn btn-primary" style="padding:7px 16px;font-size:13px" onclick="Chat._saveEdit('${id}')">Save</button>
        <button class="btn btn-ghost"   style="padding:7px 14px;font-size:13px" onclick="Chat._cancelEdit('${id}')">Cancel</button>
      </div>`;
    bubble._orig = orig;
    bubble.querySelector('textarea').focus();
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
    const idx = this.current.messages.findIndex(x=>x.id===id);
    if (idx < 0) return;
    // Remove this message and all after it
    this.current.messages = this.current.messages.slice(0, idx);
    // Find and remove last user message (will be re-sent)
    const lastUserIdx = [...this.current.messages].map((m,i)=>({m,i})).reverse().find(x=>x.m.role==='user');
    if (!lastUserIdx) return;
    const lastUserMsg = lastUserIdx.m;
    this.current.messages.splice(lastUserIdx.i, 1);
    await API.saveMessages(this.current.id, this.current.messages);
    this.render();
    // Re-send the last user message
    setTimeout(() => {
      const inp = document.getElementById('chat-input');
      if (inp) { inp.value = lastUserMsg.content; this.send(); }
    }, 80);
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
        <div class="modal-title">${this.current.characterName}</div>
        <button class="btn-icon" onclick="closeModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-ghost" onclick="closeModal();Chat.clearChat()" style="justify-content:flex-start;gap:10px">
          🗑 ${t('chat.clear')}
        </button>
        <button class="btn btn-ghost" onclick="closeModal();Chat.exportChat()" style="justify-content:flex-start;gap:10px">
          📤 Export .txt
        </button>
        <div class="divider"></div>
        <div style="font-size:13px;color:var(--t3)">${this.current.messages.length} messages · ${this.current.characterName}</div>
      </div>`);
  }
};
