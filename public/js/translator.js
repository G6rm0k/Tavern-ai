// ── TRANSLATOR ─────────────────────────────────────────────────────────────────
// Auto-translates character first messages to match UI language
const Translator = {

  // Detect text language by checking char codes (simple heuristic)
  detect(text) {
    if (!text) return 'en';
    // Count Cyrillic vs Latin chars
    let cyrillic = 0, latin = 0;
    for (const ch of text.slice(0, 200)) {
      const c = ch.charCodeAt(0);
      if (c >= 0x0400 && c <= 0x04FF) cyrillic++;
      else if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) latin++;
    }
    if (cyrillic > latin * 0.3) return 'ru';
    return 'en';
  },

  // Translate a single text via server proxy
  async translate(text, from, to) {
    if (!text?.trim() || from === to) return text;
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, from, to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data.translated || text;
    } catch(e) {
      console.warn('Translate error:', e.message);
      return text; // fallback — return original
    }
  },

  // ── Auto-translate greeting textareas in the form ─────────────────────────
  async autoTranslateGreetings() {
    const uiLang = i18n.lang || 'ru';
    const areas  = document.querySelectorAll('.greeting-msg');
    if (!areas.length) return;

    // Detect language of first greeting
    const sample  = areas[0].value;
    const textLang = this.detect(sample);
    if (textLang === uiLang) return; // already correct lang, skip

    // Show subtle toast
    toast(`🌐 Переводю приветствия на ${uiLang === 'ru' ? 'русский' : 'English'}…`, 'info');

    for (const area of areas) {
      if (!area.value.trim()) continue;
      const detected = this.detect(area.value);
      if (detected === uiLang) continue;

      // Animate while translating
      area.style.opacity = '0.5';
      const translated = await this.translate(area.value, detected, uiLang);
      area.value = translated;
      area.style.opacity = '1';
      area.style.transition = 'opacity 0.3s';
    }

    toast('✓ Приветствия переведены', 'success');
  },

  // ── Translate first messages of an already-saved char (from discover) ──────
  async translateCharFirstMessages(char) {
    const uiLang = i18n.lang || 'ru';
    if (!char?.firstMessages?.length) return;

    // Detect language of first message
    const textLang = this.detect(char.firstMessages[0]);
    if (textLang === uiLang) return;

    toast(`🌐 Перевожу сообщения ${char.name}…`, 'info');

    const translated = [];
    for (const msg of char.firstMessages) {
      if (!msg.trim()) { translated.push(msg); continue; }
      const t = await this.translate(msg, textLang, uiLang);
      translated.push(t);
    }

    // Save translated messages back to server
    try {
      const res = await fetch(`/api/characters/${char.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API.token}`,
        },
        body: JSON.stringify({ ...char, firstMessages: translated }),
      });
      if (res.ok) {
        const updated = await res.json();
        // Update in local list
        const idx = Characters.list.findIndex(c => c.id === char.id);
        if (idx >= 0) Characters.list[idx] = updated;
        toast(`✓ ${char.name}: сообщения переведены`, 'success');
      }
    } catch(e) {
      console.warn('Save translated char failed:', e);
    }
  },

  // ── Manual translate button for chat — translate last message ─────────────
  async translateMessage(msgId, targetLang) {
    const el = document.querySelector(`[data-msg-id="${msgId}"] .msg-text`);
    if (!el) return;
    const orig = el.dataset.orig || el.textContent;
    el.dataset.orig = orig;
    const detected = this.detect(orig);
    if (detected === targetLang) {
      // Toggle back to original
      el.textContent = orig;
      return;
    }
    el.style.opacity = '0.5';
    const t = await this.translate(orig, detected, targetLang);
    el.textContent = t;
    el.style.opacity = '1';
    el.style.transition = 'opacity 0.3s';
  },
};
