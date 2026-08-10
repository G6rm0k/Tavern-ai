// Patch: add renderList + refreshHome to Characters after file loads
// NOTE: define local helper — do NOT try to reuse const escHtml from characters.js
// (accessing it here via typeof causes a Temporal Dead Zone ReferenceError that
//  would silently prevent this entire file from executing).
function _patchEsc(s) { return esc(s); }

Characters.renderList = function(container, chars) {
  if (!chars || !chars.length) {
    container.innerHTML = `<div class="empty"><div class="empty-ico">✦</div><h3>${t('char.empty')}</h3><p>${t('char.empty.hint')}</p><button class="btn btn-primary" onclick="App.navigate('create')">+ ${t('home.new')}</button></div>`;
    return;
  }
  container.innerHTML = chars.map(c => {
    const av = c.avatar
      ? `<img src="${escAttr(c.avatar)}" onerror="this.parentElement.textContent='✦'" />`
      : `<span>${esc(c.avatar_emoji || '✦')}</span>`;
    return `<div class="char-card" data-id="${escAttr(c.id)}">
      <div class="char-card-av">${av}</div>
      <div class="char-card-body">
        <div class="char-card-name">${_patchEsc(c.name)}</div>
        <div class="char-card-desc">${_patchEsc(c.description) || t('char.noDesc')}</div>
      </div>
      <div class="char-card-actions" onclick="event.stopPropagation()">
        <button class="btn-icon" onclick="Characters.editChar('${escJs(c.id)}')" style="color:var(--t3)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon" onclick="Characters.deleteChar('${escJs(c.id)}')" style="color:var(--red)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
  container.querySelectorAll('.char-card').forEach(card => {
    card.addEventListener('click', () => Chat.chooseChat(card.dataset.id));
  });
  if (typeof Anim !== 'undefined' && Anim.enabled) Anim.stagger(container, '.char-card', 35);
};

// Refresh the home character list in-place (without navigating to home)
Characters.refreshHome = function() {
  const el = document.getElementById('home-list');
  if (el) Characters.renderList(el, Characters.list);
};
