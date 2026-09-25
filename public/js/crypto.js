const PBKDF2_ITERATIONS = 210000;

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

// Deriva dalla master password due chiavi indipendenti (HMAC domain separation):
// una per l'autenticazione col server (authHash) e una per cifrare/decifrare i dati
// (encKey). Il server non vede mai la password ne' la chiave di cifratura.
async function deriveKeys(password, saltB64) {
  const salt = b64ToBuf(saltB64);
  const enc = new TextEncoder();

  const passKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const masterBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    passKey,
    256
  );

  const hmacKey = await crypto.subtle.importKey('raw', masterBits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const authBits = await crypto.subtle.sign('HMAC', hmacKey, enc.encode('auth'));
  const encBits = await crypto.subtle.sign('HMAC', hmacKey, enc.encode('enc'));

  const encKey = await crypto.subtle.importKey('raw', encBits, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

  return { authHashB64: bufToB64(authBits), encKey };
}

function generateSalt() {
  return bufToB64(randomBytes(16));
}

async function encryptJSON(encKey, obj) {
  const iv = randomBytes(12);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encKey, enc.encode(JSON.stringify(obj)));
  return { iv: bufToB64(iv), ciphertext: bufToB64(ciphertext) };
}

async function decryptJSON(encKey, ivB64, ciphertextB64) {
  const iv = b64ToBuf(ivB64);
  const ciphertext = b64ToBuf(ciphertextB64);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encKey, ciphertext);
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(plainBuf));
}

async function exportRawKeyB64(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bufToB64(raw);
}

async function importRawAesKey(rawB64) {
  return crypto.subtle.importKey('raw', b64ToBuf(rawB64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// Deriva una chiave di "sblocco rapido" da un PIN locale: stessa logica di
// deriveKeys ma con meno iterazioni, perche' protegge solo l'accesso rapido
// sul dispositivo (la sicurezza reale resta affidata alla password principale).
async function deriveKeyFromPin(pin, saltB64) {
  const salt = b64ToBuf(saltB64);
  const enc = new TextEncoder();
  const passKey = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, passKey, 256);
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

window.VaultPassCrypto = {
  deriveKeys,
  generateSalt,
  encryptJSON,
  decryptJSON,
  exportRawKeyB64,
  importRawAesKey,
  deriveKeyFromPin,
  randomBytes,
  bufToB64,
  b64ToBuf,
};
