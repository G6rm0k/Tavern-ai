// ── CHAR WIZARD — AI-помощник создания персонажа ───────────────────────────────
const CharWizard = {
  history: [],
  pending: null,   // { field, value } — proposal waiting for accept/reject
  open: false,
  _editingField: null,
  _initialized: false, // whether greeting was shown at least once

  SYSTEM: `Ты — эксперт по созданию персонажей для AI-roleplay приложения (аналог TavernAI/SillyTavern).
Твоя задача — помочь пользователю создать детального, живого персонажа через диалог.

Ты работаешь поэтапно:
1. Сначала спроси: какой тип персонажа хочет пользователь (аниме, реалистичный, фэнтези, sci-fi, ассистент и т.д.)
2. Спроси имя и краткую идею
3. Уточни тон: серьёзный / игривый / романтичный / с пошлинками / строгий / etc
4. Спроси про 18+ контент — да/нет/иногда
5. Затем ГЕНЕРИРУЙ поля одно за другим, каждый раз предлагая пользователю принять/отредактировать

Когда предлагаешь поле — ВСЕГДА отвечай СТРОГО в формате JSON:
{"action":"propose","field":"fieldName","value":"...значение...","explanation":"...почему так..."}

Поля которые ты заполняешь:
- name: имя персонажа
- description: краткое описание (1-2 предложения, показывается на карточке)
- systemPrompt: подробный системный промпт (характер, манера речи, background, отношение к пользователю, особенности. Используй {{char}} и {{user}})
- firstMessage: первое сообщение персонажа (живое, в характере, 2-4 предложения)

После того как все поля приняты — скажи {"action":"done","message":"Персонаж готов! 🎉"}

Если пользователь просто болтает (не в формате ответа на поле) — отвечай обычным текстом без JSON.
Пиши на том же языке что и пользователь.
Будь живым, немного игривым, помогай раскрыть персонажа полностью.`,

  // Toggle open/close from inline trigger
  toggle() {
    if (this.open) {
      this.hide();
    } else {
      this.show();
    }
  },

  // Update the inline trigger appearance based on state
  _updateInlineTrigger() {
    const trigger = document.getElementById('wiz-inline-trigger');
    if (!trigger) return;
    if (this.open) {
      trigger.classList.add('active');
    } else {
      trigger.classList.remove('active');
    }
    // Show dot indicator if there's chat history
    if (this._initialized && this.history.length > 0) {
      trigger.classList.add('has-history');
    } else {
      trigger.classList.remove('has-history');
    }
  },

  show() {
    if (document.getElementById('wiz-overlay')) {
      // Already exists, just show it
      const sheet = document.getElementById('wiz-sheet');
      if (sheet) {
        document.getElementById('wiz-overlay').style.display = '';
        requestAnimationFrame(() => sheet.classList.add('open'));
      }
      this.open = true;
      this._updateInlineTrigger();
      return;
    }
    this.open = true;

    const ov = document.createElement('div');
    ov.id = 'wiz-overlay';
    ov.innerHTML = `
      <div class="wiz-sheet" id="wiz-sheet">
        <div class="wiz-hd">
          <div class="wiz-title">
            <span class="wiz-sparkle">✨</span>
            <span>AI-помощник</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <button class="btn-icon wiz-newchat" id="wiz-newchat" onclick="CharWizard.newChat()" title="Новый чат">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
            <button class="btn-icon wiz-close" onclick="CharWizard.hide()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="wiz-msgs" id="wiz-msgs"></div>

        <!-- Proposal card — shown when AI proposes a field value -->
        <div class="wiz-proposal hidden" id="wiz-proposal">
          <div class="wiz-prop-label" id="wiz-prop-label">Системный промпт</div>
          <div class="wiz-prop-text" id="wiz-prop-text"></div>
          <div class="wiz-prop-actions">
            <button class="wiz-btn wiz-btn-accept" onclick="CharWizard.accept()">
              ✓ Принять
            </button>
            <button class="wiz-btn wiz-btn-edit" onclick="CharWizard.editProposal()">
              ✏️ Изменить
            </button>
            <button class="wiz-btn wiz-btn-reject" onclick="CharWizard.reject()">
              ✕ Другой
            </button>
          </div>
        </div>

        <div class="wiz-inp-row">
          <textarea class="wiz-inp" id="wiz-inp" rows="1"
            placeholder="Напиши что-нибудь…"
            style="-webkit-user-select:text;user-select:text"></textarea>
          <button class="wiz-send" id="wiz-send" onclick="CharWizard.send()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="18" height="18">
              <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
            </svg>
          </button>
        </div>
      </div>`;

    document.body.appendChild(ov);

    // Auto-resize textarea
    const inp = document.getElementById('wiz-inp');
    inp.addEventListener('input', () => {
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
    });

    // Close on overlay click (outside sheet)
    ov.addEventListener('click', (e) => {
      if (e.target === ov) this.hide();
    });

    // Slide in
    requestAnimationFrame(() => {
      document.getElementById('wiz-sheet')?.classList.add('open');
    });

    this._updateInlineTrigger();

    // Start conversation only if fresh
    if (!this._initialized) {
      setTimeout(() => this._greeting(), 300);
      this._initialized = true;
    }
  },

  hide() {
    const sheet = document.getElementById('wiz-sheet');
    if (sheet) {
      sheet.classList.remove('open');
      // Don't remove — just hide so history persists
      setTimeout(() => {
        const ov = document.getElementById('wiz-overlay');
        if (ov) ov.style.display = 'none';
      }, 400);
    }
    this.open = false;
    this._updateInlineTrigger();
  },

  // New chat — clears history and starts fresh
  newChat() {
    this.history = [];
    this.pending = null;
    this._editingField = null;
    this._initialized = false;

    const msgs = document.getElementById('wiz-msgs');
    if (msgs) msgs.innerHTML = '';

    const proposal = document.getElementById('wiz-proposal');
    if (proposal) proposal.classList.add('hidden');

    setTimeout(() => this._greeting(), 200);
    this._initialized = true;
    this._updateInlineTrigger();
  },

  _greeting() {
    this._addMsg('bot', 'Привет! 👋 Я помогу тебе создать крутого персонажа для чата.\n\nРасскажи мне — какой персонаж тебе нужен? Это может быть:\n🎭 Аниме-герой или героиня\n🧙 Фэнтезийный персонаж\n🤖 AI-ассистент с характером\n💋 Романтический компаньон\n👾 Sci-Fi персонаж\n\nИли просто опиши идею своими словами!');
  },

  async send() {
    const inp = document.getElementById('wiz-inp');
    const text = inp?.value.trim();
    if (!text) return;

    if (this._editingField) {
      // User edited a field value manually
      inp.value = ''; inp.style.height = 'auto';
      this._addMsg('user', text);
      this._applyField(this._editingField, text);
      this._editingField = null;
      this.history.push({ role: 'user', content: `Принято моё значение для поля: "${text}". Переходи к следующему полю.` });
      await this._ask();
    } else {
      inp.value = ''; inp.style.height = 'auto';
      this._addMsg('user', text);
      this.history.push({ role: 'user', content: text });

      // Hide proposal if visible
      document.getElementById('wiz-proposal')?.classList.add('hidden');
      this.pending = null;

      await this._ask();
    }
  },

  async _ask() {
    const sendBtn = document.getElementById('wiz-send');
    if (sendBtn) sendBtn.disabled = true;
    const typing = this._addMsg('bot', '...', true);

    try {
      const provider = Settings.getActive();
      if (!provider) throw new Error('Нет активного провайдера. Настрой API в настройках.');

      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API.token}` },
        body: JSON.stringify({
          provider: { baseUrl: provider.baseUrl, apiKey: provider.apiKey, extraHeaders: provider.extraHeaders },
          model: provider.model || 'gpt-4o-mini',
          systemPrompt: this.SYSTEM,
          messages: this.history,
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Сервер ответил ${res.status}`);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = '';
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (raw === '[DONE]') break;
          try {
            const j = JSON.parse(raw);
            if (j.error) throw new Error(typeof j.error === 'string' ? j.error : JSON.stringify(j.error));
            const chunk = j.choices?.[0]?.delta?.content
                       || j.choices?.[0]?.text
                       || j.delta?.text
                       || '';
            if (chunk) {
              full += chunk;
              if (typing) {
                const display = full.replace(/\{[\s\S]*$/, '').trim() || full;
                typing.querySelector('.wiz-msg-text').textContent = display || '...';
              }
            }
          } catch(parseErr) {
            if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
          }
        }
      }

      if (typing) typing.classList.remove('typing');
      this.history.push({ role: 'assistant', content: full });

      this._parseResponse(full, typing);

    } catch(e) {
      if (typing) {
        typing.classList.remove('typing');
        typing.querySelector('.wiz-msg-text').innerHTML = '⚠️ <b>Ошибка:</b> ' + e.message;
      } else {
        this._addMsg('bot', '⚠️ Ошибка: ' + e.message);
      }
    } finally {
      if (sendBtn) sendBtn.disabled = false;
      document.getElementById('wiz-inp')?.focus();
    }
  },

  _parseResponse(text, bubble) {
    const jsonMatch = text.match(/\{[\s\S]*"action"[\s\S]*\}/);
    if (!jsonMatch) return;

    try {
      const data = JSON.parse(jsonMatch[0]);

      if (data.action === 'propose' && data.field && data.value) {
        if (bubble) bubble.style.display = 'none';

        this.pending = { field: data.field, value: data.value };

        const LABELS = {
          name: '📛 Имя персонажа',
          description: '📝 Краткое описание',
          systemPrompt: '🧠 Системный промпт',
          firstMessage: '💬 Первое сообщение',
        };

        document.getElementById('wiz-prop-label').textContent = LABELS[data.field] || data.field;
        document.getElementById('wiz-prop-text').textContent = data.value;
        document.getElementById('wiz-proposal').classList.remove('hidden');

        if (data.explanation) {
          this._addMsg('bot', '💡 ' + data.explanation);
        }
        this._scrollDown();
      }

      if (data.action === 'done') {
        if (bubble) {
          bubble.querySelector('.wiz-msg-text').textContent = data.message || 'Персонаж готов! 🎉';
        }
        this._addMsg('bot', '👆 Все поля заполнены! Закрой помощника и продолжи редактировать вручную если нужно.');
        this._scrollDown();
      }
    } catch {}
  },

  accept() {
    if (!this.pending) return;
    const { field, value } = this.pending;
    this._applyField(field, value);
    document.getElementById('wiz-proposal').classList.add('hidden');
    this._addMsg('user', '✓ Принято');
    this.history.push({ role: 'user', content: 'Принято, переходи к следующему полю.' });
    this.pending = null;
    setTimeout(() => this._ask(), 300);
  },

  reject() {
    if (!this.pending) return;
    document.getElementById('wiz-proposal').classList.add('hidden');
    this._addMsg('user', '✕ Предложи другой вариант');
    this.history.push({ role: 'user', content: 'Не подходит, предложи другой вариант для того же поля.' });
    this.pending = null;
    setTimeout(() => this._ask(), 300);
  },

  editProposal() {
    if (!this.pending) return;
    const { value } = this.pending;
    const inp = document.getElementById('wiz-inp');
    if (inp) {
      inp.value = value;
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
      inp.focus();
      inp.setSelectionRange(0, inp.value.length);
    }
    document.getElementById('wiz-proposal').classList.add('hidden');
    this._addMsg('bot', '✏️ Отредактируй и отправь свой вариант:');
    const field = this.pending.field;
    this.pending = null;
    this._editingField = field;
    this._scrollDown();
  },

  _applyField(field, value) {
    const map = {
      name:         'char-name',
      description:  'char-desc',
      systemPrompt: 'char-system',
      firstMessage: null,
    };

    if (field === 'firstMessage') {
      const list = document.getElementById('greeting-list');
      if (list) {
        const items = list.querySelectorAll('.greeting-msg');
        if (items.length === 1 && !items[0].value.trim()) {
          items[0].value = value;
        } else {
          const idx = list.querySelectorAll('.greeting-item').length;
          const div = document.createElement('div');
          div.className = 'greeting-item';
          div.innerHTML = Characters._greetingItem(value, idx);
          list.appendChild(div);
          Characters._bindGreetingDelete();
        }
      }
    } else if (map[field]) {
      const el = document.getElementById(map[field]);
      if (el) {
        el.value = value;
        el.dispatchEvent(new Event('input'));
      }
    }

    const elId = map[field];
    if (elId) {
      const el = document.getElementById(elId);
      if (el) {
        el.style.borderColor = 'var(--accent)';
        el.style.boxShadow = '0 0 0 3px var(--accent-ultra)';
        setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 1500);
      }
    }
  },

  _addMsg(role, text, isTyping = false) {
    const msgs = document.getElementById('wiz-msgs');
    if (!msgs) return null;

    const div = document.createElement('div');
    div.className = `wiz-msg wiz-msg-${role}${isTyping ? ' typing' : ''}`;
    div.innerHTML = `<div class="wiz-msg-text">${text.replace(/\n/g, '<br>')}</div>`;
    msgs.appendChild(div);
    this._scrollDown();
    return div;
  },

  _scrollDown() {
    const msgs = document.getElementById('wiz-msgs');
    if (msgs) setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 50);
  },
};
