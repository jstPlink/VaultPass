window.QuickUnlock = (function () {
  const { encryptJSON, decryptJSON, deriveKeyFromPin, exportRawKeyB64, importRawAesKey, generateSalt, randomBytes, bufToB64, b64ToBuf } = window.VaultPassCrypto;

  const LAST_USER_KEY = 'vaultpass_last_username';
  const storageKey = (username) => `vaultpass_quickunlock_${username}`;

  // Migrazione delle chiavi salvate con il vecchio prefisso "vault_".
  try {
    for (const oldKey of Object.keys(localStorage)) {
      if (oldKey.startsWith('vault_')) {
        const newKey = 'vaultpass_' + oldKey.slice('vault_'.length);
        if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, localStorage.getItem(oldKey));
        localStorage.removeItem(oldKey);
      }
    }
  } catch (e) {}
  const MAX_ATTEMPTS = 5;
  // Sale fisso non segreto usato per l'estensione PRF di WebAuthn: serve solo a
  // separare questo utilizzo da altre app che potrebbero usare lo stesso authenticator.
  const PRF_SALT = new TextEncoder().encode('vault-quickunlock-prf-v1').slice(0, 32);

  function getLastUsername() {
    return localStorage.getItem(LAST_USER_KEY);
  }
  function setLastUsername(username) {
    localStorage.setItem(LAST_USER_KEY, username);
  }

  function readEntry(username) {
    try {
      const raw = localStorage.getItem(storageKey(username));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function writeEntry(username, entry) {
    localStorage.setItem(storageKey(username), JSON.stringify(entry));
  }
  function removeEntry(username) {
    localStorage.removeItem(storageKey(username));
  }

  function isConfigured(username) {
    return !!readEntry(username);
  }
  function hasBiometric(username) {
    const e = readEntry(username);
    return !!(e && e.webauthn);
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
  }

  async function registerBiometric() {
    if (!window.PublicKeyCredential || !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return null;
    try {
      const available = await withTimeout(PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(), 3000);
      if (!available) return null;
    } catch (e) {
      return null;
    }
    try {
      const cred = await withTimeout(navigator.credentials.create({
        publicKey: {
          challenge: randomBytes(32),
          rp: { name: 'VaultPass' },
          user: { id: randomBytes(16), name: 'vaultpass-quickunlock', displayName: 'VaultPass' },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' },
            { alg: -257, type: 'public-key' },
          ],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
          timeout: 60000,
          extensions: { prf: {} },
        },
      }), 65000);
      if (!cred || !cred.getClientExtensionResults().prf?.enabled) return null;

      const assertion = await withTimeout(navigator.credentials.get({
        publicKey: {
          challenge: randomBytes(32),
          allowCredentials: [{ id: cred.rawId, type: 'public-key' }],
          userVerification: 'required',
          extensions: { prf: { eval: { first: PRF_SALT } } },
        },
      }), 65000);
      const secret = assertion.getClientExtensionResults().prf?.results?.first;
      if (!secret) return null;
      const key = await crypto.subtle.importKey('raw', secret, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      return { credentialId: bufToB64(cred.rawId), key };
    } catch (e) {
      console.warn('Impronta/Face ID non disponibile su questo dispositivo', e);
      return null;
    }
  }

  async function getBiometricKey(credentialIdB64) {
    const assertion = await withTimeout(navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ id: b64ToBuf(credentialIdB64), type: 'public-key' }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: PRF_SALT } } },
      },
    }), 65000);
    const secret = assertion.getClientExtensionResults().prf?.results?.first;
    if (!secret) throw new Error('Impronta non disponibile');
    return crypto.subtle.importKey('raw', secret, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async function setup(username, pin, authHash, encKey) {
    const payload = { authHash, encKeyRaw: await exportRawKeyB64(encKey) };
    const pinSalt = generateSalt();
    const pinKey = await deriveKeyFromPin(pin, pinSalt);
    const pinWrapped = await encryptJSON(pinKey, payload);

    const entry = { pinSalt, pinWrapped, failedAttempts: 0, webauthn: null };

    const bio = await registerBiometric();
    if (bio) {
      entry.webauthn = { credentialId: bio.credentialId, wrapped: await encryptJSON(bio.key, payload) };
    }

    writeEntry(username, entry);
    setLastUsername(username);
    return { biometric: !!entry.webauthn };
  }

  async function unlockWithPin(username, pin) {
    const entry = readEntry(username);
    if (!entry) throw new Error('Sblocco rapido non configurato');
    if ((entry.failedAttempts || 0) >= MAX_ATTEMPTS) {
      removeEntry(username);
      throw new Error('Troppi tentativi falliti: usa la password principale.');
    }
    try {
      const pinKey = await deriveKeyFromPin(pin, entry.pinSalt);
      const payload = await decryptJSON(pinKey, entry.pinWrapped.iv, entry.pinWrapped.ciphertext);
      entry.failedAttempts = 0;
      writeEntry(username, entry);
      return { authHash: payload.authHash, encKey: await importRawAesKey(payload.encKeyRaw) };
    } catch (e) {
      entry.failedAttempts = (entry.failedAttempts || 0) + 1;
      writeEntry(username, entry);
      throw new Error('PIN non corretto');
    }
  }

  async function unlockWithBiometric(username) {
    const entry = readEntry(username);
    if (!entry || !entry.webauthn) throw new Error('Impronta non configurata');
    const key = await getBiometricKey(entry.webauthn.credentialId);
    const payload = await decryptJSON(key, entry.webauthn.wrapped.iv, entry.webauthn.wrapped.ciphertext);
    return { authHash: payload.authHash, encKey: await importRawAesKey(payload.encKeyRaw) };
  }

  function disable(username) {
    removeEntry(username);
  }

  return {
    getLastUsername,
    setLastUsername,
    isConfigured,
    hasBiometric,
    setup,
    unlockWithPin,
    unlockWithBiometric,
    disable,
  };
})();
