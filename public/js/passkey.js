// ── PASSKEY UNLOCK (Windows Hello / Touch ID / Android biometrics) ────────────
//
// Deliberately NOT a server-side authentication mechanism. The password is what
// derives the encryption key, so replacing it with a login provider would mean
// either dropping encryption or asking for a second password anyway.
//
// Instead the authenticator acts as a local vault: the account password is
// wrapped with a secret that only this device's authenticator can reproduce (the
// WebAuthn PRF extension), and unwrapping it requires the same PIN, fingerprint
// or face the operating system already asks for. The server keeps checking the
// password exactly as before and never sees any of this.
//
// The wrapped blob stays in localStorage: it is useless on another machine, and
// keeping it off the server means one less thing to leak from data/.

const Passkey = {
  // PRF needs a stable per-user salt so the same secret comes back every time.
  _salt(username) {
    return new TextEncoder().encode('wesaid-prf-v1:' + username);
  },

  _store(username) { return 'wesaid_passkey_' + username; },

  // ── availability ──────────────────────────────────────────────────────────
  // WebAuthn needs a secure context. localhost counts as one, a plain-http LAN
  // address (the phone case) does not — so this is hidden there and the password
  // remains the way in.
  supported() {
    return !!(window.isSecureContext && window.PublicKeyCredential && navigator.credentials?.create);
  },

  async platformAvailable() {
    if (!this.supported()) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch { return false; }
  },

  has(username) { return !!(username && localStorage.getItem(this._store(username))); },

  forget(username) { localStorage.removeItem(this._store(username)); },

  // Remember who logged in last, so the sign-in screen can offer the button
  // before anything has been typed.
  lastUser()          { return localStorage.getItem('wesaid_last_user') || ''; },
  rememberUser(name)  { if (name) localStorage.setItem('wesaid_last_user', name); },

  // ── binary helpers ────────────────────────────────────────────────────────
  _b64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  },
  _unb64(str) {
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
  },
  _rand(n) { return crypto.getRandomValues(new Uint8Array(n)); },

  // ── PRF secret → AES key ──────────────────────────────────────────────────
  async _aesKey(prfOutput) {
    return crypto.subtle.importKey('raw', prfOutput, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  },

  // Ask the authenticator for this credential's PRF secret. Triggers the OS
  // prompt (PIN / fingerprint / face).
  async _prfSecret(credentialId, username) {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: this._rand(32),
        allowCredentials: credentialId
          ? [{ id: this._unb64(credentialId), type: 'public-key' }]
          : [],
        userVerification: 'required',
        timeout: 60000,
        extensions: { prf: { eval: { first: this._salt(username) } } },
      },
    });
    if (!assertion) throw new Error('cancelled');
    const prf = assertion.getClientExtensionResults()?.prf?.results?.first;
    if (!prf) throw new Error('NO_PRF');
    return { secret: new Uint8Array(prf), rawId: this._b64(assertion.rawId) };
  },

  // ── enable ────────────────────────────────────────────────────────────────
  // Needs the password once, to wrap it. Returns true on success.
  async enable(username, displayName, password) {
    if (!this.supported()) throw new Error('UNSUPPORTED');

    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: this._rand(32),
        rp: { name: 'wesaid', id: location.hostname },
        user: {
          id: new TextEncoder().encode(username),
          name: username,
          displayName: displayName || username,
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
        extensions: { prf: {} },
      },
    });
    if (!cred) throw new Error('cancelled');

    // Chrome reports only whether PRF is available at creation time; the secret
    // itself has to be fetched with a follow-up get().
    if (cred.getClientExtensionResults()?.prf?.enabled === false) throw new Error('NO_PRF');

    const credentialId = this._b64(cred.rawId);
    const { secret } = await this._prfSecret(credentialId, username);

    const iv  = this._rand(12);
    const key = await this._aesKey(secret);
    const ct  = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(password));

    localStorage.setItem(this._store(username), JSON.stringify({
      credentialId, iv: this._b64(iv), blob: this._b64(ct), v: 1,
    }));
    this.rememberUser(username);
    return true;
  },

  // ── unwrap ────────────────────────────────────────────────────────────────
  // Returns the account password, after the OS has verified the user.
  async recoverPassword(username) {
    const raw = localStorage.getItem(this._store(username));
    if (!raw) throw new Error('NO_PASSKEY');
    const saved = JSON.parse(raw);

    const { secret } = await this._prfSecret(saved.credentialId, username);
    const key = await this._aesKey(secret);
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: this._unb64(saved.iv) }, key, this._unb64(saved.blob));
      return new TextDecoder().decode(pt);
    } catch {
      // Wrong authenticator, or the credential was recreated — the stored blob
      // can never be opened again, so drop it rather than keep failing.
      this.forget(username);
      throw new Error('STALE');
    }
  },

  // Turn an internal failure into something worth showing a person.
  errorText(e) {
    const m = String(e?.message || e);
    if (m === 'NO_PASSKEY')  return t('pk.err.none');
    if (m === 'NO_PRF')      return t('pk.err.noPrf');
    if (m === 'UNSUPPORTED') return t('pk.err.unsupported');
    if (m === 'STALE')       return t('pk.err.stale');
    if (e?.name === 'NotAllowedError' || m === 'cancelled') return t('pk.err.cancelled');
    return t('pk.err.generic');
  },
};
