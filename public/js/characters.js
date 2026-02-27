// ─── CHARACTERS ───────────────────────────────────────────────────────────────
const escHtml = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const Characters = {
  list: [],

  async load() {
    this.list = await API.getCharacters();
  },

  getById(id) {
    return this.list.find(c => c.id === id) || null;
  },

  // Render discover/home grid
  renderGrid(container, chars) {
    if (!chars.length) {
      container.innerHTML = `
        <div class="empty">
          <div class="empty-ico">🎭</div>
          <h3>No characters yet</h3>
          <p>Create your first character or import from Chub.ai</p>
          <button class="btn btn-primary" onclick="App.navigate('create')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create Character
          </button>
        </div>
      `;
      return;
    }
    container.innerHTML = chars.map(c => this._cardHtml(c)).join('');
    container.querySelectorAll('.char-card').forEach(card => {
      card.addEventListener('click', () => Chat.startWith(card.dataset.id));
    });
  },

  _cardHtml(c) {
    const avatarHtml = c.avatar
      ? `<img src="${c.avatar}" alt="${c.name}" onerror="this.parentElement.textContent='🤖'" />`
      : `<span>${c.avatar_emoji || '🤖'}</span>`;
    const isPublic = c.visibility === 'public';
    const isOwner = c.ownerId === API.token;
    return `
      <div class="char-card" data-id="${c.id}">
        <div class="char-card-avatar">${avatarHtml}</div>
        <div class="char-card-name">${escHtml(c.name)}</div>
        <div class="char-card-desc">${escHtml(c.description) || 'No description'}</div>
        ${isOwner ? `
          <div style="display:flex;gap:6px;margin-top:4px" onclick="event.stopPropagation()">
            <button class="btn-icon" onclick="Characters.editChar('${c.id}')" style="font-size:12px">✏️</button>
            <button class="btn-icon" onclick="Characters.deleteChar('${c.id}')" style="font-size:12px">🗑️</button>
            <span class="badge ${isPublic ? 'badge-green' : 'badge-purple'}" style="font-size:10px;margin-left:auto">
              ${isPublic ? '🌍' : '🔒'}
            </span>
          </div>
        ` : `<span class="badge badge-green" style="font-size:10px">🌍 Public</span>`}
      </div>
    `;
  },

  editChar(id) {
    App.navigate('edit', { charId: id });
  },

  async deleteChar(id) {
    if (!confirm('Delete this character?')) return;
    await API.deleteCharacter(id);
    this.list = this.list.filter(c => c.id !== id);
    App.navigate('discover');
    toast('Character deleted', 'success');
  },

  // Create/Edit form
  renderForm(container, existing) {
    const c = existing || {};
    const greetings = c.firstMessages || [''];
    const greetingsHtml = greetings.map((msg, i) => this._greetingItem(msg, i)).join('');

    container.innerHTML = `
      <div class="create-wrap">
        <h2>${existing ? 'Edit Character' : 'New Character'}</h2>
        <p class="subtitle">${existing ? 'Update your character\'s details' : 'Create a persona for your AI to embody'}</p>

        <div class="c-sect">
          <div class="create-section-title">Identity</div>

          <div class="avatar-uploader">
            <div class="av-prev" id="avatar-preview" onclick="document.getElementById('avatar-file').click()">
              ${c.avatar ? `<img src="${c.avatar}" id="avatar-img" />` : `<span id="avatar-emoji">${c.avatar_emoji || '🤖'}</span>`}
            </div>
            <div style="flex:1">
              <div style="display:flex;gap:8px;margin-bottom:8px">
                <button class="btn btn-ghost" onclick="document.getElementById('avatar-file').click()" style="font-size:13px">Upload Image</button>
              </div>
              <div class="hint">PNG/JPG, also supports Chub.ai PNG cards</div>
              <input id="avatar-emoji-input" type="text" placeholder="Or enter emoji 🤖" value="${c.avatar_emoji || ''}" style="margin-top:8px" />
            </div>
            <input type="file" id="avatar-file" accept="image/*,.png" class="hidden" />
          </div>

          <div class="form-group">
            <label>Name *</label>
            <input id="char-name" type="text" placeholder="Character name" value="${c.name || ''}" />
          </div>
          <div class="form-group">
            <label>Short Description</label>
            <input id="char-desc" type="text" placeholder="Brief description shown on card" value="${c.description || ''}" />
          </div>
        </div>

        ${!existing ? `
        <div class="wiz-inline-trigger" id="wiz-inline-trigger" onclick="CharWizard.toggle()">
          <span class="wiz-inline-icon">✨</span>
          <span class="wiz-inline-label">AI-помощник создания</span>
          <svg class="wiz-inline-arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        ` : ''}

        <div class="c-sect">
          <div class="create-section-title">Personality</div>

          <div class="form-group">
            <label>System Prompt (Character Definition)</label>
            <textarea id="char-system" rows="7" placeholder="You are {{char}}, a... Describe personality, speaking style, background, traits. Use {{user}} for the user's name and {{char}} for the character name.">${c.systemPrompt || ''}</textarea>
            <div class="hint">This is the main instruction sent to the AI. Be as detailed as you want.</div>
          </div>

          <div class="form-group">
            <label>First Messages <span class="badge badge-purple">${greetings.length}</span></label>
            <div class="hint" style="margin-bottom:8px">One will be randomly chosen when starting a new chat. Add up to 50.</div>
            <div class="greeting-list" id="greeting-list">${greetingsHtml}</div>
            <button class="btn btn-ghost" id="add-greeting" style="font-size:13px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Greeting
            </button>
          </div>
        </div>

        <div class="c-sect">
          <div class="create-section-title">Visibility</div>
          <div class="visibility-toggle">
            <button class="visibility-btn ${c.visibility !== 'public' ? 'selected' : ''}" data-vis="private">
              <span>🔒</span>
              <span>Private</span>
              <span style="font-size:11px;color:var(--text3)">Only you</span>
            </button>
            <button class="visibility-btn ${c.visibility === 'public' ? 'selected' : ''}" data-vis="public">
              <span>🌍</span>
              <span>Public</span>
              <span style="font-size:11px;color:var(--text3)">Listed in Discover</span>
            </button>
          </div>
          <input type="hidden" id="char-visibility" value="${c.visibility || 'private'}" />
        </div>

        <div class="c-sect">
          <div class="create-section-title">Import from File</div>
          <div class="drop-zone" id="import-drop">
            <div style="font-size:32px;margin-bottom:8px">📦</div>
            <div style="font-weight:500;margin-bottom:4px">Drop PNG or JSON here</div>
            <div class="hint">Supports Chub.ai PNG cards and Tavern JSON exports</div>
            <input type="file" id="import-file" accept=".png,.json" class="hidden" />
          </div>
        </div>

        <div style="display:flex;gap:10px;padding-bottom:40px">
          <button class="btn btn-ghost" onclick="App.navigate('discover')">Cancel</button>
          <button class="btn btn-primary" id="save-char-btn" style="flex:1;justify-content:center">
            ${existing ? 'Save Changes' : 'Create Character'}
          </button>
        </div>
      </div>
    `;

    // Visibility toggle
    container.querySelectorAll('.visibility-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.visibility-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('char-visibility').value = btn.dataset.vis;
      });
    });

    // Update wizard inline trigger state if resuming
    if (!existing) CharWizard._updateInlineTrigger();

    // Avatar file
    document.getElementById('avatar-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // Check if PNG might have embedded character data
      if (file.name.endsWith('.png')) {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const base64 = ev.target.result.split(',')[1];
          try {
            const { charData } = await API.importPng(base64);
            this._fillFromImport(charData);
            toast('Character data imported from PNG!', 'success');
          } catch {
            // Not a character card, just use as avatar
          }
          // Set avatar preview
          document.getElementById('avatar-preview').innerHTML = `<img src="${ev.target.result}" id="avatar-img" />`;
          Characters._avatarData = ev.target.result;
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
          document.getElementById('avatar-preview').innerHTML = `<img src="${ev.target.result}" id="avatar-img" />`;
          Characters._avatarData = ev.target.result;
        };
        reader.readAsDataURL(file);
      }
    });

    // Greet add
    document.getElementById('add-greeting').addEventListener('click', () => {
      const list = document.getElementById('greeting-list');
      const idx = list.children.length;
      if (idx >= 50) { toast('Max 50 greeting messages', 'error'); return; }
      const div = document.createElement('div');
      div.className = 'greeting-item';
      div.innerHTML = this._greetingItem('', idx);
      list.appendChild(div.firstElementChild);
      this._bindGreetingDelete();
    });
    this._bindGreetingDelete();

    // Import drop
    const dropEl = document.getElementById('import-drop');
    dropEl.addEventListener('click', () => document.getElementById('import-file').click());
    dropEl.addEventListener('dragover', (e) => { e.preventDefault(); dropEl.classList.add('dragging'); });
    dropEl.addEventListener('dragleave', () => dropEl.classList.remove('dragging'));
    dropEl.addEventListener('drop', async (e) => {
      e.preventDefault(); dropEl.classList.remove('dragging');
      const file = e.dataTransfer.files[0];
      if (file) this._handleImportFile(file);
    });
    document.getElementById('import-file').addEventListener('change', (e) => {
      if (e.target.files[0]) this._handleImportFile(e.target.files[0]);
    });

    // Save
    document.getElementById('save-char-btn').addEventListener('click', () => this.save(existing?.id));
  },

  _greetingItem(msg, i) {
    return `
      <div class="greeting-item">
        <textarea class="greeting-msg" rows="2" placeholder="Hello! I'm here to chat...">${msg}</textarea>
        <button class="btn-icon del-greeting" style="color:var(--danger);flex-shrink:0;margin-top:4px" title="Remove">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;
  },

  _bindGreetingDelete() {
    document.querySelectorAll('.del-greeting').forEach(btn => {
      btn.onclick = () => {
        const item = btn.closest('.greeting-item');
        if (document.querySelectorAll('.greeting-item').length > 1) item.remove();
        else toast('Need at least one greeting', 'error');
      };
    });
  },

  async _handleImportFile(file) {
    if (file.name.endsWith('.png')) {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = ev.target.result.split(',')[1];
        try {
          const { charData } = await API.importPng(base64);
          this._fillFromImport(charData);
          // Set avatar
          document.getElementById('avatar-preview').innerHTML = `<img src="${ev.target.result}" />`;
          Characters._avatarData = ev.target.result;
          toast('Imported from PNG card!', 'success');
        } catch (e) {
          toast('Could not read character from PNG: ' + e.message, 'error');
        }
      };
      reader.readAsDataURL(file);
    } else if (file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const { charData } = await API.importJson(ev.target.result);
          this._fillFromImport(charData);
          toast('Imported from JSON!', 'success');
        } catch (e) {
          toast('Invalid JSON: ' + e.message, 'error');
        }
      };
      reader.readAsText(file);
    }
  },

  _fillFromImport(data) {
    // Support multiple formats: Tavern v1/v2, Chub, CAI export
    const d = data.data || data; // v2 wraps in .data
    if (d.name) document.getElementById('char-name').value = d.name;
    if (d.description) document.getElementById('char-desc').value = typeof d.description === 'string' ? d.description.slice(0, 120) : '';

    // Build system prompt
    let sys = '';
    if (d.personality) sys += d.personality + '\n\n';
    if (d.description && typeof d.description === 'string' && d.description.length > 120) sys += d.description + '\n\n';
    if (d.scenario) sys += 'Scenario: ' + d.scenario + '\n\n';
    if (d.mes_example) sys += 'Example dialogue:\n' + d.mes_example;
    if (!sys && d.system_prompt) sys = d.system_prompt;
    if (!sys && d.char_persona) sys = d.char_persona;
    if (sys) document.getElementById('char-system').value = sys.trim();

    // First message(s)
    const msgs = [];
    if (d.first_mes) msgs.push(d.first_mes);
    if (d.alternate_greetings) msgs.push(...d.alternate_greetings);
    if (msgs.length) {
      const list = document.getElementById('greeting-list');
      list.innerHTML = msgs.map((m, i) => this._greetingItem(m, i)).join('');
      this._bindGreetingDelete();
      // Auto-translate greetings if language mismatch
      Translator.autoTranslateGreetings();
    }
  },

  async save(existingId) {
    const name = document.getElementById('char-name').value.trim();
    if (!name) { toast('Character needs a name!', 'error'); return; }

    const greetings = [...document.querySelectorAll('.greeting-msg')].map(t => t.value.trim()).filter(Boolean);
    if (!greetings.length) { toast('Add at least one greeting message', 'error'); return; }

    const charData = {
      name,
      description: document.getElementById('char-desc').value.trim(),
      systemPrompt: document.getElementById('char-system').value.trim(),
      firstMessages: greetings,
      visibility: document.getElementById('char-visibility').value,
      avatar_emoji: document.getElementById('avatar-emoji-input').value.trim() || '🤖',
      avatar: Characters._avatarData || null
    };

    const btn = document.getElementById('save-char-btn');
    btn.textContent = 'Saving...'; btn.disabled = true;

    try {
      let char;
      if (existingId) {
        char = await API.updateCharacter(existingId, charData);
        const idx = this.list.findIndex(c => c.id === existingId);
        if (idx > -1) this.list[idx] = char;
      } else {
        char = await API.createCharacter(charData);
        this.list.unshift(char); // put at top so user sees it first
      }
      Characters._avatarData = null;
      if (typeof Characters.refreshHome === 'function') Characters.refreshHome();
      toast(existingId ? 'Character updated!' : 'Character created!', 'success');
      App.navigate('home'); // go to home so user sees the new character immediately
    } catch (e) {
      toast('Save failed: ' + e.message, 'error');
      btn.textContent = existingId ? 'Save Changes' : 'Create Character';
      btn.disabled = false;
    }
  }
};
