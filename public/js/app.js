(function () {
  const { deriveKeys, generateSalt, encryptJSON, decryptJSON } = window.VaultPassCrypto;
  const Api = window.Api;
  const QuickUnlock = window.QuickUnlock;

  let encKey = null;
  let vaultItems = [];
  let emailEntries = [];
  let currentUsername = null;
  let currentAuthHash = null;

  const $ = (id) => document.getElementById(id);
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    show(t);
    setTimeout(() => hide(t), 2200);
  }

  function confirmDialog(message, confirmLabel) {
    return new Promise((resolve) => {
      $('confirm-message').textContent = message;
      $('btn-confirm-yes').textContent = confirmLabel || 'Elimina';
      show($('confirm-modal'));
      const cleanup = (result) => {
        hide($('confirm-modal'));
        yesBtn.removeEventListener('click', onYes);
        noBtn.removeEventListener('click', onNo);
        resolve(result);
      };
      const yesBtn = $('btn-confirm-yes');
      const noBtn = $('btn-confirm-no');
      const onYes = () => cleanup(true);
      const onNo = () => cleanup(false);
      yesBtn.addEventListener('click', onYes);
      noBtn.addEventListener('click', onNo);
    });
  }

  async function copyToClipboard(text, label) {
    try {
      await navigator.clipboard.writeText(text || '');
      toast(`${label} copiata`);
    } catch (e) {
      toast('Impossibile copiare');
    }
  }

  // ---------- Bootstrap ----------
  function bootstrap() {
    // WebCrypto esiste solo su HTTPS o localhost: altrimenti l'accesso non puo' funzionare.
    if (!window.isSecureContext || !(window.crypto && window.crypto.subtle)) show($('insecure-notice'));
    const lastUsername = QuickUnlock.getLastUsername();
    if (lastUsername && QuickUnlock.isConfigured(lastUsername)) {
      $('quickunlock-username').textContent = `Utente: ${lastUsername}`;
      $('btn-quickunlock-biometric').classList.toggle('hidden', !QuickUnlock.hasBiometric(lastUsername));
      show($('view-quickunlock'));
    } else {
      show($('view-login'));
    }
  }

  $('link-to-setup').addEventListener('click', (e) => {
    e.preventDefault();
    hide($('view-login'));
    show($('view-setup'));
  });

  $('link-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    hide($('view-setup'));
    show($('view-login'));
  });

  $('link-to-full-login').addEventListener('click', (e) => {
    e.preventDefault();
    hide($('view-quickunlock'));
    show($('view-login'));
  });

  $('form-setup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('setup-username').value.trim();
    const pwd = $('setup-password').value;
    const confirm = $('setup-password-confirm').value;
    const errEl = $('setup-error');
    hide(errEl);
    if (pwd !== confirm) {
      errEl.textContent = 'Le password non coincidono.';
      show(errEl);
      return;
    }
    const salt = generateSalt();
    const keys = await deriveKeys(pwd, salt);
    try {
      await Api.register(username, salt, keys.authHashB64);
      encKey = keys.encKey;
      currentUsername = username;
      currentAuthHash = keys.authHashB64;
      hide($('view-setup'));
      await enterMain();
      maybeOfferQuickUnlock();
    } catch (err) {
      errEl.textContent = err.message;
      show(errEl);
    }
  });

  $('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('login-username').value.trim();
    const pwd = $('login-password').value;
    const errEl = $('login-error');
    hide(errEl);
    try {
      const { salt } = await Api.getSalt(username);
      const keys = await deriveKeys(pwd, salt);
      await Api.login(username, keys.authHashB64);
      encKey = keys.encKey;
      currentUsername = username;
      currentAuthHash = keys.authHashB64;
      $('login-password').value = '';
      hide($('view-login'));
      await enterMain();
      maybeOfferQuickUnlock();
    } catch (err) {
      errEl.textContent = 'Nome utente o password non corretti.';
      show(errEl);
    }
  });

  $('form-quickunlock').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = QuickUnlock.getLastUsername();
    const pin = $('quickunlock-pin').value;
    const errEl = $('quickunlock-error');
    hide(errEl);
    try {
      const result = await QuickUnlock.unlockWithPin(username, pin);
      await Api.login(username, result.authHash);
      encKey = result.encKey;
      currentUsername = username;
      currentAuthHash = result.authHash;
      $('quickunlock-pin').value = '';
      hide($('view-quickunlock'));
      await enterMain();
    } catch (err) {
      errEl.textContent = staleQuickUnlock(username, err) || err.message;
      show(errEl);
    }
  });

  // Se la password e' stata cambiata da un altro dispositivo, i dati salvati dallo
  // sblocco rapido non valgono piu': il server risponde 401 e vanno eliminati.
  function staleQuickUnlock(username, err) {
    if (err.status !== 401) return null;
    QuickUnlock.disable(username);
    $('btn-quickunlock-biometric').classList.add('hidden');
    return 'La password principale e\' cambiata: usa la password principale.';
  }

  $('btn-quickunlock-biometric').addEventListener('click', async () => {
    const username = QuickUnlock.getLastUsername();
    const errEl = $('quickunlock-error');
    hide(errEl);
    try {
      const result = await QuickUnlock.unlockWithBiometric(username);
      await Api.login(username, result.authHash);
      encKey = result.encKey;
      currentUsername = username;
      currentAuthHash = result.authHash;
      hide($('view-quickunlock'));
      await enterMain();
    } catch (err) {
      errEl.textContent = staleQuickUnlock(username, err) || 'Impronta/Face ID non riuscita. Usa il PIN.';
      show(errEl);
    }
  });

  // ---------- Sblocco rapido: attivazione ----------
  function maybeOfferQuickUnlock() {
    if (!QuickUnlock.isConfigured(currentUsername)) {
      show($('quickunlock-setup-modal'));
    }
  }

  $('btn-quickunlock-setup-skip').addEventListener('click', () => {
    hide($('quickunlock-setup-modal'));
    $('form-quickunlock-setup').reset();
  });

  $('form-quickunlock-setup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = $('quickunlock-setup-pin').value;
    const confirmPin = $('quickunlock-setup-pin-confirm').value;
    const errEl = $('quickunlock-setup-error');
    hide(errEl);
    if (pin !== confirmPin) {
      errEl.textContent = 'I PIN non coincidono.';
      show(errEl);
      return;
    }
    const result = await QuickUnlock.setup(currentUsername, pin, currentAuthHash, encKey);
    hide($('quickunlock-setup-modal'));
    $('form-quickunlock-setup').reset();
    renderQuickUnlockStatus();
    toast(result.biometric ? 'Sblocco rapido attivato (PIN + impronta)' : 'Sblocco rapido attivato (PIN)');
  });

  function renderQuickUnlockStatus() {
    const configured = currentUsername && QuickUnlock.isConfigured(currentUsername);
    const statusEl = $('quickunlock-status');
    const btn = $('btn-quickunlock-toggle');
    if (configured) {
      statusEl.textContent = QuickUnlock.hasBiometric(currentUsername)
        ? 'Attivo (PIN + impronta/Face ID)'
        : 'Attivo (PIN)';
      btn.textContent = 'Disattiva';
    } else {
      statusEl.textContent = 'Non attivo';
      btn.textContent = 'Attiva';
    }
    $('btn-change-pin').classList.toggle('hidden', !configured);
  }

  // ---------- Opzioni: cambio PIN ----------
  $('btn-change-pin').addEventListener('click', () => {
    hide($('change-pin-error'));
    show($('change-pin-modal'));
  });

  function closeChangePin() {
    hide($('change-pin-modal'));
    $('form-change-pin').reset();
  }
  $('btn-cancel-change-pin').addEventListener('click', closeChangePin);

  $('form-change-pin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('change-pin-error');
    hide(errEl);
    const current = $('change-pin-current').value;
    const next = $('change-pin-new').value;
    if (next !== $('change-pin-confirm').value) {
      errEl.textContent = 'I PIN non coincidono.';
      show(errEl);
      return;
    }
    try {
      await QuickUnlock.changePin(currentUsername, current, next);
      closeChangePin();
      toast('PIN modificato');
    } catch (err) {
      errEl.textContent = err.message;
      show(errEl);
      // Dopo troppi tentativi lo sblocco rapido viene rimosso.
      renderQuickUnlockStatus();
    }
  });

  // ---------- Opzioni: cambio password principale ----------
  $('btn-change-password').addEventListener('click', () => {
    hide($('change-password-error'));
    $('change-password-username').value = currentUsername || '';
    show($('change-password-modal'));
  });

  function closeChangePassword() {
    hide($('change-password-modal'));
    $('form-change-password').reset();
  }
  $('btn-cancel-change-password').addEventListener('click', closeChangePassword);

  // Decifra con la vecchia chiave e ricifra con la nuova. Se anche una sola riga non
  // si decifra si annulla tutto: sovrascriverla la renderebbe irrecuperabile.
  async function reencryptRows(rows, newKey) {
    const out = [];
    for (const row of rows) {
      let data;
      try {
        data = await decryptJSON(encKey, row.iv, row.ciphertext);
      } catch (e) {
        throw new Error('Alcuni dati non sono leggibili: cambio password annullato per non perderli.');
      }
      const { iv, ciphertext } = await encryptJSON(newKey, data);
      out.push({ id: row.id, iv, ciphertext });
    }
    return out;
  }

  $('form-change-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('change-password-error');
    const submitBtn = $('btn-submit-change-password');
    hide(errEl);
    const current = $('change-password-current').value;
    const next = $('change-password-new').value;
    if (next !== $('change-password-confirm').value) {
      errEl.textContent = 'Le password non coincidono.';
      show(errEl);
      return;
    }
    if (next === current) {
      errEl.textContent = 'La nuova password deve essere diversa da quella attuale.';
      show(errEl);
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Attendi...';
    try {
      const { salt: oldSalt } = await Api.getSalt(currentUsername);
      const oldKeys = await deriveKeys(current, oldSalt);
      if (oldKeys.authHashB64 !== currentAuthHash) throw new Error('Password attuale non corretta');

      const newSalt = generateSalt();
      const newKeys = await deriveKeys(next, newSalt);
      const [itemRows, emailRows] = await Promise.all([Api.listItems(), Api.listEmails()]);
      const items = await reencryptRows(itemRows, newKeys.encKey);
      const emails = await reencryptRows(emailRows, newKeys.encKey);

      await Api.changePassword({
        currentAuthHash,
        salt: newSalt,
        authHash: newKeys.authHashB64,
        items,
        emails,
      });

      encKey = newKeys.encKey;
      currentAuthHash = newKeys.authHashB64;
      const hadQuickUnlock = QuickUnlock.isConfigured(currentUsername);
      QuickUnlock.disable(currentUsername);
      closeChangePassword();
      renderQuickUnlockStatus();
      toast('Password modificata');
      if (hadQuickUnlock) show($('quickunlock-setup-modal'));
    } catch (err) {
      errEl.textContent = err.message;
      show(errEl);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Cambia password';
    }
  });

  $('btn-quickunlock-toggle').addEventListener('click', async () => {
    if (QuickUnlock.isConfigured(currentUsername)) {
      if (!(await confirmDialog('Disattivare lo sblocco rapido su questo dispositivo?', 'Disattiva'))) return;
      QuickUnlock.disable(currentUsername);
      renderQuickUnlockStatus();
      toast('Sblocco rapido disattivato');
    } else {
      show($('quickunlock-setup-modal'));
    }
  });

  $('btn-logout').addEventListener('click', async () => {
    await Api.logout();
    if (currentUsername) QuickUnlock.disable(currentUsername);
    encKey = null;
    privateOpen = false;
    vaultItems = [];
    emailEntries = [];
    currentUsername = null;
    currentAuthHash = null;
    document.querySelector('.nav-btn[data-tab="tab-vault"]:not([data-private])').click();
    hide($('view-main'));
    show($('view-login'));
  });

  // ---------- Main ----------
  async function enterMain() {
    await Promise.all([loadItems(), loadEmails()]);
    renderVaultList(vaultItems);
    renderEmailChips();
    renderEmailSuggestions();
    renderQuickUnlockStatus();
    loadRateLimit();
    show($('view-main'));
  }

  async function loadItems() {
    const rows = await Api.listItems();
    vaultItems = [];
    for (const row of rows) {
      try {
        const data = await decryptJSON(encKey, row.iv, row.ciphertext);
        vaultItems.push({ id: row.id, ...data });
      } catch (e) {
        console.error('Impossibile decifrare elemento', row.id, e);
      }
    }
  }

  async function loadEmails() {
    const rows = await Api.listEmails();
    emailEntries = [];
    for (const row of rows) {
      try {
        const data = await decryptJSON(encKey, row.iv, row.ciphertext);
        emailEntries.push({
          id: row.id,
          email: data.email,
          label: data.label || data.email,
          color: data.color || '#6b7280',
        });
      } catch (e) {
        console.error('Impossibile decifrare email', row.id, e);
      }
    }
  }

  // ---------- Riconferma dell'accesso per la tab "Altro" ----------
  // Ogni volta che si apre "Altro" si chiede di nuovo la password principale, il PIN dello
  // sblocco rapido o l'impronta / Face ID (se attivi): chi trova l'app gia' sbloccata non
  // vede gli account nascosti.
  // La password si verifica nel browser, rifacendo il calcolo delle chiavi e confrontandolo
  // con quello dell'accesso in corso: la password non viene inviata al server.
  const REAUTH_MAX_FAILURES = 5;
  const REAUTH_LOCK_MS = 60 * 1000;
  let reauthCallback = null;
  let reauthFailures = 0;
  let reauthLockedUntil = 0;

  function showReauthError(message) {
    const el = $('reauth-error');
    el.textContent = message;
    show(el);
  }

  function requestReauth(onSuccess) {
    reauthCallback = onSuccess;
    $('form-reauth').reset();
    hide($('reauth-error'));
    const hasPin = !!(currentUsername && QuickUnlock.isConfigured(currentUsername));
    $('reauth-label').textContent = hasPin ? 'Password principale o PIN' : 'Password principale';
    $('reauth-hint').textContent = hasPin
      ? 'Per aprire questa sezione inserisci di nuovo la password principale o il PIN di sblocco rapido.'
      : 'Per aprire questa sezione inserisci di nuovo la password principale.';
    $('btn-reauth-biometric').classList.toggle('hidden', !(currentUsername && QuickUnlock.hasBiometric(currentUsername)));
    show($('reauth-modal'));
    $('reauth-password').focus();
  }

  function closeReauth(confirmed) {
    hide($('reauth-modal'));
    $('form-reauth').reset();
    const callback = confirmed ? reauthCallback : null;
    reauthCallback = null;
    if (callback) callback();
  }

  $('form-reauth').addEventListener('submit', async (e) => {
    e.preventDefault();
    const wait = reauthLockedUntil - Date.now();
    if (wait > 0) {
      showReauthError(`Troppi tentativi: riprova tra ${Math.ceil(wait / 1000)} secondi.`);
      return;
    }
    const value = $('reauth-password').value;
    let matches = false;
    try {
      // Un valore di 4-8 cifre si prova prima come PIN dello sblocco rapido (se attivo); se non
      // e' il PIN si prova comunque come password (potrebbe essere una password numerica).
      if (QuickUnlock.isConfigured(currentUsername) && /^\d{4,8}$/.test(value)) {
        try {
          const result = await QuickUnlock.unlockWithPin(currentUsername, value);
          matches = result.authHash === currentAuthHash;
        } catch (pinError) {
          matches = false;
        }
      }
      if (!matches) {
        const { salt } = await Api.getSalt(currentUsername);
        const keys = await deriveKeys(value, salt);
        matches = keys.authHashB64 === currentAuthHash;
      }
    } catch (err) {
      showReauthError('Verifica non riuscita: controlla la connessione e riprova.');
      return;
    }
    if (matches) {
      reauthFailures = 0;
      closeReauth(true);
      return;
    }
    reauthFailures += 1;
    if (reauthFailures >= REAUTH_MAX_FAILURES) {
      reauthFailures = 0;
      reauthLockedUntil = Date.now() + REAUTH_LOCK_MS;
      showReauthError('Troppi tentativi: riprova tra 1 minuto.');
    } else {
      showReauthError('Password non corretta.');
    }
    $('reauth-password').select();
  });

  $('btn-reauth-biometric').addEventListener('click', async () => {
    hide($('reauth-error'));
    try {
      const result = await QuickUnlock.unlockWithBiometric(currentUsername);
      if (result.authHash !== currentAuthHash) throw new Error('non corrisponde');
      closeReauth(true);
    } catch (err) {
      showReauthError('Impronta / Face ID non riuscita: usa la password.');
    }
  });

  $('btn-reauth-cancel').addEventListener('click', () => closeReauth(false));

  // ---------- Navigation ----------
  function activateTab(btn) {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    // "Altro" mostra gli account nascosti nella stessa pagina Account.
    const wantPrivate = btn.dataset.private === '1';
    if (wantPrivate !== privateOpen) {
      privateOpen = wantPrivate;
      renderVaultList(vaultItems);
      window.scrollTo(0, 0);
    }
    document.querySelectorAll('.tab').forEach((t) => hide(t));
    show($(btn.dataset.tab));
  }

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Aprire "Altro" richiede di nuovo la password (o l'impronta / Face ID).
      if (btn.dataset.private === '1' && !privateOpen) requestReauth(() => activateTab(btn));
      else activateTab(btn);
    });
  });

  // ---------- Vault list rendering ----------
  // Indirizzo da mostrare: senza "https://" e senza "/" finale.
  function displayUrl(raw) {
    const url = normalizeUrl(raw);
    if (!url) return String(raw || '').trim();
    return (url.host + (url.pathname === '/' ? '' : url.pathname) + url.search).replace(/^www./, '');
  }

  // ---------- Email associata: etichetta con il colore scelto nelle Opzioni ----------
  function emailEntryFor(address) {
    const key = String(address || '').trim().toLowerCase();
    return key ? emailEntries.find((entry) => (entry.email || '').trim().toLowerCase() === key) : null;
  }

  // Testo bianco o nero, a seconda di quanto e' chiaro il colore di sfondo scelto.
  function readableTextColor(hex) {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!match) return '#ffffff';
    const n = parseInt(match[1], 16);
    const luminance = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return luminance > 0.6 ? '#1c2333' : '#ffffff';
  }

  function emailBadge(address) {
    const entry = emailEntryFor(address);
    const shownAddress = entry ? entry.email : address;
    const wrap = document.createElement('span');
    wrap.className = 'item-card-email';
    let label = '';
    if (entry) {
      const color = entry.color || '#6b7280';
      label = entry.label || entry.email;
      const tag = document.createElement('span');
      tag.className = 'email-tag';
      tag.textContent = label;
      tag.style.background = color;
      tag.style.color = readableTextColor(color);
      wrap.appendChild(tag);
    }
    // Se l'etichetta coincide con l'indirizzo (email senza nome scelto) non si ripete due volte.
    if (label.toLowerCase() !== shownAddress.toLowerCase()) {
      const text = document.createElement('span');
      text.className = 'email-address';
      text.textContent = shownAddress;
      wrap.appendChild(text);
    }
    return wrap;
  }

  // ---------- Vista dell'elenco: per nome oppure raggruppata per email ----------
  const VIEW_MODE_KEY = 'vaultpass_view_mode';
  const COLLAPSED_KEY = 'vaultpass_collapsed_groups';
  let viewMode = 'name';
  let collapsedGroups = new Set();
  try {
    viewMode = localStorage.getItem(VIEW_MODE_KEY) === 'email' ? 'email' : 'name';
    collapsedGroups = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]'));
  } catch (e) {}

  function saveViewState() {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedGroups]));
    } catch (e) {}
  }

  function hashText(text) {
    let h = 5381;
    for (const ch of text) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
    return (h >>> 0).toString(36);
  }

  // Le chiavi dei gruppi non contengono indirizzi email (restano nel browser in chiaro).
  function groupOf(item) {
    const address = String(item.email || '').trim();
    if (!address) return { key: 'none', label: 'Senza email', address: '', color: '#9ca3af' };
    const entry = emailEntryFor(address);
    if (entry) {
      return { key: 'e' + entry.id, label: entry.label || entry.email, address: entry.email, color: entry.color || '#6b7280' };
    }
    return { key: 'x' + hashText(address.toLowerCase()), label: address, address: '', color: '#6b7280' };
  }

  function groupItems(items) {
    const groups = new Map();
    for (const item of items) {
      const info = groupOf(item);
      if (!groups.has(info.key)) groups.set(info.key, { ...info, items: [] });
      groups.get(info.key).items.push(item);
    }
    return [...groups.values()].sort((a, b) =>
      (a.key === 'none') - (b.key === 'none') ||
      a.label.localeCompare(b.label, 'it', { sensitivity: 'base', numeric: true })
    );
  }

  function groupSection(group) {
    const section = document.createElement('div');
    section.className = 'email-group';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'group-header';
    header.style.setProperty('--chip-color', group.color);
    const chevron = document.createElement('span');
    chevron.className = 'group-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.className = 'group-title';
    title.textContent = group.label;
    header.append(chevron, title);
    if (group.address && group.address !== group.label) {
      const address = document.createElement('span');
      address.className = 'group-address';
      address.textContent = group.address;
      header.appendChild(address);
    }
    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = group.items.length;
    header.appendChild(count);

    const body = document.createElement('div');
    body.className = 'group-body';
    sortByName(group.items).forEach((item) => body.appendChild(itemCard(item, { showEmail: false })));

    const apply = () => {
      const collapsed = collapsedGroups.has(group.key);
      chevron.textContent = collapsed ? '▸' : '▾';
      header.setAttribute('aria-expanded', String(!collapsed));
      body.classList.toggle('hidden', collapsed);
    };
    header.addEventListener('click', () => {
      if (collapsedGroups.has(group.key)) collapsedGroups.delete(group.key);
      else collapsedGroups.add(group.key);
      saveViewState();
      apply();
    });
    apply();

    section.append(header, body);
    return section;
  }

  function shownItems(items) {
    return privateOpen ? items.filter((item) => item.hidden) : items.filter((item) => !item.hidden);
  }

  function updateViewToolbar() {
    $('btn-view-name').classList.toggle('active', viewMode === 'name');
    $('btn-view-email').classList.toggle('active', viewMode === 'email');
    $('group-actions').classList.toggle('hidden', viewMode !== 'email');
  }

  function setViewMode(mode) {
    viewMode = mode;
    saveViewState();
    renderVaultList(vaultItems);
  }

  $('btn-view-name').addEventListener('click', () => setViewMode('name'));
  $('btn-view-email').addEventListener('click', () => setViewMode('email'));
  $('btn-collapse-all').addEventListener('click', () => {
    collapsedGroups = new Set(groupItems(shownItems(vaultItems)).map((group) => group.key));
    saveViewState();
    renderVaultList(vaultItems);
  });
  $('btn-expand-all').addEventListener('click', () => {
    collapsedGroups.clear();
    saveViewState();
    renderVaultList(vaultItems);
  });

  function itemCard(item, options = {}) {
    const div = document.createElement('div');
    div.className = 'item-card';
    // Da revisionare: tutta la targhetta e' gialla (nessuna etichetta).
    if (item.review) div.classList.add('needs-review');
    const linkBtn = item.url
      ? `<button type="button" class="btn-icon item-card-link" title="Apri il sito" data-url="${escapeHtml(item.url)}">↗</button>`
      : '';
    const line = (glyph, text) =>
      text ? `<span class="item-card-line"><span class="item-card-glyph" aria-hidden="true">${glyph}</span><span>${escapeHtml(text)}</span></span>` : '';
    div.innerHTML = `
      <div class="item-card-main">
        <strong>${escapeHtml(item.name || '(senza nome)')}</strong>
        ${line('👤', item.username)}
        <span class="item-card-email"></span>
        ${line('🔗', displayUrl(item.url))}
      </div>
      ${linkBtn}
    `;
    const emailSlot = div.querySelector('.item-card-email');
    if (item.email && options.showEmail !== false) emailSlot.replaceWith(emailBadge(item.email));
    else emailSlot.remove();
    div.prepend(siteIcon(item));
    div.addEventListener('click', () => openItemModal(item));
    const btn = div.querySelector('.item-card-link');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSite(btn.dataset.url);
      });
    }
    return div;
  }

  // Solo http/https: evita schemi come javascript: salvati in un URL.
  function openSite(raw) {
    const target = normalizeUrl(raw);
    if (target) window.open(target.href, '_blank', 'noopener');
  }

  // Account nascosti: quelli con "hidden" non stanno nell'elenco principale, si vedono dalla
  // tab "Altro" della barra di navigazione. La tab c'e' SEMPRE, anche senza account nascosti,
  // e non mostra conteggi: chi guarda lo schermo non puo' capire cosa contiene.
  let privateOpen = false;

  // Torna alla tab Account (app in secondo piano): "Altro" non resta aperta.
  function closePrivateFolder() {
    if (!privateOpen) return;
    document.querySelector('.nav-btn[data-tab="tab-vault"]:not([data-private])').click();
  }

  // Ordine alfabetico per nome (senza badare a maiuscole/accenti, numeri in ordine
  // naturale: "Sito 2" prima di "Sito 10"); gli account senza nome vanno in fondo.
  function sortByName(items) {
    return [...items].sort((a, b) => {
      const nameA = (a.name || '').trim();
      const nameB = (b.name || '').trim();
      if (!nameA || !nameB) return (nameA ? 0 : 1) - (nameB ? 0 : 1);
      return nameA.localeCompare(nameB, 'it', { sensitivity: 'base', numeric: true });
    });
  }

  function renderVaultList(items) {
    const list = $('vault-list');
    list.innerHTML = '';
    const hiddenItems = items.filter((item) => item.hidden);
    const pendingReview = items.filter((item) => item.review).length;
    $('review-count').textContent = pendingReview;
    $('review-banner').classList.toggle('hidden', privateOpen || pendingReview === 0);
    $('private-header').classList.toggle('hidden', !privateOpen);
    $('vault-empty').classList.toggle('hidden', privateOpen || items.length > 0);
    $('private-empty').classList.toggle('hidden', !privateOpen || hiddenItems.length > 0);
    updateViewToolbar();
    const shown = sortByName(shownItems(items));
    if (viewMode === 'email') groupItems(shown).forEach((group) => list.appendChild(groupSection(group)));
    else shown.forEach((item) => list.appendChild(itemCard(item)));
  }

  // Per riservatezza la tab "Altro" si chiude mandando l'app in secondo piano.
  document.addEventListener('visibilitychange', () => { if (document.hidden) closePrivateFolder(); });

  // ---------- Icone dei siti ----------

  // Gli URL sono sempre https://: si puo' scrivere solo il dominio (es. "spotify.it")
  // e un eventuale schema digitato (http://, ftp://...) viene sostituito da https://.
  // Restituisce un oggetto URL, oppure null se il valore non e' un indirizzo valido.
  function normalizeUrl(raw) {
    const value = String(raw || '').trim().replace(/^([a-z][a-z0-9+.-]*:)?\/\//i, '');
    if (!value) return null;
    try {
      return new URL('https://' + value);
    } catch (e) {
      return null;
    }
  }

  // Forma salvata nel vault: https://dominio/percorso, senza "/" finale inutile.
  // Se il valore non e' valido resta com'e', cosi' non si perde quanto digitato.
  function storedUrl(raw) {
    const trimmed = String(raw || '').trim();
    const url = normalizeUrl(trimmed);
    if (!url) return trimmed;
    return url.pathname === '/' && !url.search && !url.hash ? url.origin : url.href;
  }

  // Icona del sito; finche' non e' caricata (o se manca) mostra l'iniziale del nome.
  function siteIcon(item) {
    const wrap = document.createElement('span');
    wrap.className = 'site-icon';
    wrap.textContent = (item.name || '?').trim().charAt(0).toUpperCase() || '?';
    const url = normalizeUrl(item.url);
    if (url && url.hostname.includes('.')) {
      const img = new Image();
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('load', () => {
        if (img.naturalWidth <= 1) return;
        wrap.textContent = '';
        wrap.classList.add('has-img');
        wrap.appendChild(img);
      });
      img.src = 'https://icons.duckduckgo.com/ip3/' + encodeURIComponent(url.hostname) + '.ico';
    }
    return wrap;
  }

  function escapeHtml(str) {
    // Usata anche dentro attributi HTML: va fatto l'escape anche delle virgolette.
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------- Search ----------
  $('search-input').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const results = $('search-results');
    results.innerHTML = '';
    if (!q) return;
    // Gli account nascosti non compaiono nella ricerca.
    const matches = vaultItems.filter((item) => !item.hidden && (
      (item.name || '').toLowerCase().includes(q) ||
      (item.email || '').toLowerCase().includes(q) ||
      (item.username || '').toLowerCase().includes(q)
    ));
    sortByName(matches).forEach((item) => results.appendChild(itemCard(item)));
    if (matches.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Nessun risultato.';
      results.appendChild(p);
    }
  });

  // ---------- Item modal (add/edit) ----------
  const itemModal = $('item-modal');

  function renderEmailSuggestions() {
    const dl = $('email-suggestions');
    dl.innerHTML = '';
    emailEntries.forEach((e) => {
      const opt = document.createElement('option');
      opt.value = e.email;
      opt.textContent = e.label;
      dl.appendChild(opt);
    });
  }

  const ITEM_FIELDS = ['name', 'url', 'email', 'username', 'password', 'notes', 'hidden'];

  // Cerca un account identico in tutti i campi (escluso quello che si sta modificando):
  // impedisce di salvare copie doppie, una copia va modificata in almeno un campo.
  function findIdenticalItem(data, ignoreId) {
    const norm = (v) => String(v || '').trim().toLowerCase();
    return vaultItems.find((other) =>
      String(other.id) !== String(ignoreId) &&
      ITEM_FIELDS.every((key) => {
        if (key === 'hidden') return !!other.hidden === !!data.hidden;
        if (key === 'password') return (other.password || '') === data.password;
        if (key === 'url') return norm(storedUrl(other.url)) === norm(data.url);
        return norm(other[key]) === norm(data[key]);
      })
    );
  }

  function showItemError(message) {
    const el = $('item-error');
    el.textContent = message;
    show(el);
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function openItemModal(item) {
    resetReviewUi();
    hide($('item-dup-notice'));
    hide($('item-error'));
    const modalTitle = $('item-modal-title');
    modalTitle.textContent = '';
    if (item) modalTitle.appendChild(siteIcon(item));
    modalTitle.appendChild(document.createTextNode(item ? item.name || '(senza nome)' : 'Nuovo account'));
    $('item-id').value = item ? item.id : '';
    $('item-name').value = item ? item.name || '' : '';
    $('item-url').value = item ? item.url || '' : '';
    $('item-email').value = item ? item.email || '' : '';
    $('item-username').value = item ? item.username || '' : '';
    $('item-password').value = item ? item.password || '' : '';
    $('item-password').type = 'password';
    $('item-notes').value = item ? item.notes || '' : '';
    // Un nuovo account creato dentro la cartella privata nasce gia' nascosto.
    $('item-hidden').checked = item ? !!item.hidden : privateOpen;
    $('btn-delete-item').classList.toggle('hidden', !item);
    $('btn-duplicate-item').classList.toggle('hidden', !item);
    show(itemModal);
  }

  // Duplica: apre un NUOVO account precompilato con i dati di quello scelto.
  // Il salvataggio e' bloccato finche' la copia resta identica all'originale.
  function openDuplicateModal(item) {
    openItemModal(null);
    $('item-modal-title').textContent = `Duplica: ${item.name || '(senza nome)'}`;
    $('item-name').value = item.name || '';
    $('item-url').value = item.url || '';
    $('item-email').value = item.email || '';
    $('item-username').value = item.username || '';
    $('item-password').value = item.password || '';
    $('item-notes').value = item.notes || '';
    $('item-hidden').checked = !!item.hidden;
    const notice = $('item-dup-notice');
    notice.textContent = 'Stai creando una copia. Per evitare account doppi devi modificare almeno un campo (ad esempio email o nome utente) prima di salvare.';
    show(notice);
    $('item-name').focus();
  }

  $('btn-duplicate-item').addEventListener('click', () => {
    const source = vaultItems.find((i) => String(i.id) === $('item-id').value);
    if (source) openDuplicateModal(source);
  });
  $('form-item').addEventListener('input', () => hide($('item-error')));

  function closeItemModal() {
    resetReviewUi();
    hide(itemModal);
    $('form-item').reset();
  }

  $('btn-new-item').addEventListener('click', () => openItemModal(null));
  $('btn-cancel-item').addEventListener('click', closeItemModal);

  document.querySelectorAll('.copy-field').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = $(btn.dataset.copy).value;
      copyToClipboard(btn.dataset.copy === 'item-url' ? storedUrl(value) : value, btn.dataset.label);
    });
  });
  $('open-item-url').addEventListener('click', () => openSite($('item-url').value));

  $('toggle-item-password').addEventListener('click', () => {
    const input = $('item-password');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  $('form-item').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('item-id').value;
    const wasReview = reviewActive;
    const data = {
      name: $('item-name').value.trim(),
      url: storedUrl($('item-url').value),
      email: $('item-email').value.trim(),
      username: $('item-username').value.trim(),
      password: $('item-password').value,
      notes: $('item-notes').value.trim(),
      hidden: $('item-hidden').checked,
    };
    const identical = findIdenticalItem(data, id);
    if (identical) {
      showItemError(`Esiste già un account identico («${identical.name || 'senza nome'}»): modifica almeno un campo per salvare.`);
      return;
    }
    const { iv, ciphertext } = await encryptJSON(encKey, data);

    if (data.email) {
      await ensureEmailSaved(data.email);
    }

    if (id) {
      await Api.updateItem(id, iv, ciphertext);
      const idx = vaultItems.findIndex((i) => String(i.id) === String(id));
      if (idx !== -1) vaultItems[idx] = { id: Number(id), ...data };
    } else {
      const created = await Api.createItem(iv, ciphertext);
      vaultItems.unshift({ id: created.id, ...data });
    }
    renderVaultList(vaultItems);
    closeItemModal();
    toast('Salvato');
    if (wasReview) openReviewItem();
  });

  $('btn-delete-item').addEventListener('click', async () => {
    const id = $('item-id').value;
    if (!id) return;
    const wasReview = reviewActive;
    if (!(await confirmDialog('Eliminare questo account?'))) return;
    await Api.deleteItem(id);
    vaultItems = vaultItems.filter((i) => String(i.id) !== String(id));
    renderVaultList(vaultItems);
    closeItemModal();
    toast('Eliminato');
    if (wasReview) openReviewItem();
  });

  // ---------- Revisione degli account importati ----------
  // Gli account importati hanno "review: true" (nei dati cifrati). La revisione li
  // mostra uno alla volta nel form: "Conferma e avanti" salva (e toglie il flag),
  // "Salta" passa oltre lasciandolo da rivedere, "Esci" interrompe.
  let reviewQueue = [];
  let reviewIndex = 0;
  let reviewActive = false;

  function resetReviewUi() {
    reviewActive = false;
    hide($('item-review-bar'));
    hide($('btn-review-skip'));
    $('btn-save-item').textContent = 'Salva';
    $('btn-cancel-item').textContent = 'Annulla';
  }

  function startReview() {
    const pending = sortByName(vaultItems.filter((item) => item.review));
    if (pending.length === 0) {
      toast('Nessun account da revisionare');
      return;
    }
    reviewQueue = pending.map((item) => item.id);
    reviewIndex = 0;
    openReviewItem();
  }

  // Apre il prossimo account ancora da revisionare (salta quelli confermati o eliminati).
  function openReviewItem() {
    while (reviewIndex < reviewQueue.length) {
      const item = vaultItems.find((i) => i.id === reviewQueue[reviewIndex]);
      if (item && item.review) {
        openItemModal(item);
        reviewActive = true;
        const bar = $('item-review-bar');
        bar.textContent = `Revisione ${reviewIndex + 1} di ${reviewQueue.length}: controlla i dati e conferma.`;
        show(bar);
        show($('btn-review-skip'));
        $('btn-save-item').textContent = 'Conferma e avanti';
        $('btn-cancel-item').textContent = 'Esci';
        return;
      }
      reviewIndex++;
    }
    closeItemModal();
    const left = vaultItems.filter((i) => i.review).length;
    toast(left ? `Revisione terminata: ${left} ancora da rivedere` : 'Revisione completata');
  }

  $('btn-review-start').addEventListener('click', startReview);
  $('btn-review-skip').addEventListener('click', () => {
    reviewIndex++;
    closeItemModal();
    openReviewItem();
  });

  // ---------- Importazione da elenco ----------
  const IMPORT_PASSWORD_KEY = 'vaultpass_import_password';
  const IMPORT_TLD_KEY = 'vaultpass_import_tld';

  // Una riga per account, in tre colonne: nome del sito, etichetta email, password (facoltativa).
  // Copiando dal foglio di calcolo le colonne arrivano separate da tabulazioni; a mano si puo'
  // usare anche ";" o "|" (solo le prime due occorrenze: il resto della riga e' la password).
  function splitImportLine(line) {
    if (line.includes('\t')) return line.split('\t').map(unquoteCell);
    const parts = [];
    let rest = line;
    for (let i = 0; i < 2; i++) {
      const at = rest.search(/[;|]/);
      if (at < 0) break;
      parts.push(rest.slice(0, at));
      rest = rest.slice(at + 1);
    }
    parts.push(rest);
    return parts;
  }

  // Le celle con virgolette copiate da un foglio arrivano racchiuse tra virgolette (con quelle
  // interne raddoppiate): si tolgono per riavere il testo originale, es. "solo ""98""" -> solo "98".
  function unquoteCell(cell) {
    const text = cell.trim();
    return text.length >= 2 && text.startsWith('"') && text.endsWith('"')
      ? text.slice(1, -1).replace(/""/g, '"')
      : cell;
  }

  function parseImportText(text) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name = '', code = '', password = ''] = splitImportLine(line);
        return { name: name.trim(), code: code.trim(), password: password.trim() };
      })
      .filter((row) => row.name);
  }

  function domainSlug(name) {
    return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  }

  // Verifica se un dominio esiste chiedendo il record DNS al resolver pubblico di Cloudflare
  // (DNS over HTTPS): NXDOMAIN o nessuna risposta = non esiste. E' solo un'ipotesi (un dominio
  // "parcheggiato" esiste comunque), per questo poi c'e' la revisione.
  async function domainExists(host) {
    try {
      const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(6000),
      });
      const data = await res.json();
      return data.Status === 0 && Array.isArray(data.Answer) && data.Answer.length > 0;
    } catch (e) {
      return false;
    }
  }

  async function guessUrl(name, tlds) {
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(name)) return 'https://' + name.toLowerCase();
    // Un numero finale separato da uno spazio ("iliad 1", "iliad 2") distingue account dello
    // stesso sito: per l'indirizzo si usa solo il nome ("iliad"). "trading212" resta com'e'.
    const slug = domainSlug(name.replace(/\s+\d+$/, ''));
    if (!slug) return '';
    for (const tld of tlds) {
      if (await domainExists(`${slug}.${tld}`)) return `https://${slug}.${tld}`;
    }
    return '';
  }

  async function mapLimit(list, limit, fn) {
    const results = new Array(list.length);
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = next++;
        results[i] = await fn(list[i], i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
    return results;
  }

  // Modello della password predefinita: {nome} diventa il nome del sito (minuscolo, senza spazi).
  function importPassword(template, siteName) {
    return template.replace(/\{nome\}/gi, () => siteName.toLowerCase().replace(/\s+/g, ''));
  }

  async function runImport() {
    const status = $('import-status');
    const rows = parseImportText($('import-text').value);
    if (rows.length === 0) {
      status.textContent = 'Incolla almeno una riga.';
      return;
    }
    const passwordTemplate = $('import-password').value.trim();
    const preferred = $('import-tld').value;
    // .org e .net solo come ultima possibilita', se non esiste ne' .com ne' .it.
    const tlds = preferred === 'it' ? ['it', 'com', 'org', 'net'] : ['com', 'it', 'org', 'net'];
    try {
      localStorage.setItem(IMPORT_PASSWORD_KEY, passwordTemplate);
      localStorage.setItem(IMPORT_TLD_KEY, preferred);
    } catch (e) {}
    const button = $('btn-import');
    button.disabled = true;
    try {
      // Salta gli account gia' presenti: reimportare non crea doppioni. Con un'email indicata conta
      // la coppia nome + email (lo stesso sito con email diverse resta distinto, es. due
      // "battle.net"); senza email basta lo stesso nome. Vale anche per le righe ripetute nell'elenco.
      const emailKeyFor = (code) => {
        const first = code.split(/[\/,]/)[0].trim().toLowerCase();
        if (!first) return '';
        const match = emailEntries.find((entry) => (entry.label || '').trim().toLowerCase() === first);
        return match ? match.email.trim().toLowerCase() : 'sigla:' + first;
      };
      const knownNames = new Set(vaultItems.map((item) => (item.name || '').trim().toLowerCase()));
      const knownPairs = new Set(
        vaultItems.map((item) => `${(item.name || '').trim().toLowerCase()}|${(item.email || '').trim().toLowerCase()}`)
      );
      const fresh = [];
      let skipped = 0;
      for (const row of rows) {
        const nameKey = row.name.toLowerCase();
        const emailKey = emailKeyFor(row.code);
        const duplicate = emailKey ? knownPairs.has(`${nameKey}|${emailKey}`) : knownNames.has(nameKey);
        if (duplicate) { skipped++; continue; }
        knownNames.add(nameKey);
        knownPairs.add(`${nameKey}|${emailKey}`);
        fresh.push(row);
      }
      if (fresh.length === 0) {
        status.textContent = `Nessun account nuovo: ${skipped} già presenti.`;
        return;
      }

      let searched = 0;
      status.textContent = 'Cerco gli indirizzi dei siti…';
      const urls = await mapLimit(fresh, 6, async (row) => {
        const url = await guessUrl(row.name, tlds);
        status.textContent = `Cerco gli indirizzi dei siti… ${++searched}/${fresh.length}`;
        return url;
      });

      const unknownCodes = new Set();
      const items = fresh.map((row, i) => {
        let email = '';
        let notes = '';
        // Piu' sigle nella stessa cella ("pk / fp"): la prima diventa l'email dell'account,
        // le altre finiscono nelle note per non perderle.
        const codes = row.code.split(/[\/,]/).map((code) => code.trim()).filter(Boolean);
        codes.forEach((code, index) => {
          const match = emailEntries.find((entry) => (entry.label || '').trim().toLowerCase() === code.toLowerCase());
          if (index === 0 && match) {
            email = match.email;
          } else if (index === 0) {
            unknownCodes.add(code);
            notes = `Etichetta email nell'elenco importato: ${code}`;
          } else {
            if (!match) unknownCodes.add(code);
            notes += `${notes ? '\n' : ''}Altra email nell'elenco importato: ${code}${match ? ` (${match.email})` : ''}`;
          }
        });
        return {
          name: row.name,
          url: urls[i],
          email,
          username: '',
          password: row.password || importPassword(passwordTemplate, row.name),
          notes,
          hidden: false,
          review: true,
        };
      });

      let message = `Creo ${items.length} account (${items.filter((item) => item.url).length} con indirizzo trovato)`;
      if (skipped) message += `, ${skipped} già presenti saltati`;
      if (unknownCodes.size) message += `. Nessuna email salvata con etichetta: ${[...unknownCodes].join(', ')}`;
      if (!(await confirmDialog(message + '. Procedo?', 'Importa'))) {
        status.textContent = 'Importazione annullata.';
        return;
      }

      let created = 0;
      try {
        for (const data of items) {
          const { iv, ciphertext } = await encryptJSON(encKey, data);
          const res = await Api.createItem(iv, ciphertext);
          vaultItems.unshift({ id: res.id, ...data });
          status.textContent = `Creo gli account… ${++created}/${items.length}`;
        }
      } finally {
        renderVaultList(vaultItems);
      }
      status.textContent = `Importati ${created} account: li trovi nella pagina Account, con l'avviso «Da revisionare».`;
      $('import-text').value = '';
      toast(`${created} account importati`);
    } catch (err) {
      status.textContent = `Importazione interrotta: ${err.message || 'errore'}. Gli account già creati restano salvati.`;
    } finally {
      button.disabled = false;
    }
  }

  $('btn-import').addEventListener('click', runImport);
  try {
    $('import-password').value = localStorage.getItem(IMPORT_PASSWORD_KEY) || '';
    $('import-tld').value = localStorage.getItem(IMPORT_TLD_KEY) || 'com';
  } catch (e) {}

  // ---------- Options: limite tentativi di accesso ----------
  let rateLimitTimer = null;

  function renderRateLimit(until) {
    clearTimeout(rateLimitTimer);
    const end = until ? new Date(until) : null;
    const active = !!end && end > new Date();
    $('ratelimit-status').textContent = active
      ? `Limite sospeso fino alle ${end.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}.`
      : 'Limite attivo.';
    $('btn-ratelimit-off').classList.toggle('hidden', !active);
    if (active) rateLimitTimer = setTimeout(() => renderRateLimit(null), end - new Date());
  }

  async function loadRateLimit() {
    try {
      renderRateLimit((await Api.getRateLimit()).until);
    } catch (e) {
      $('ratelimit-status').textContent = '';
    }
  }

  async function changeRateLimit(minutes) {
    try {
      renderRateLimit((await Api.setRateLimit(minutes)).until);
      toast(minutes ? 'Limite sospeso' : 'Limite ripristinato');
    } catch (e) {
      toast(e.message || 'Operazione non riuscita');
    }
  }

  document.querySelectorAll('.ratelimit-btn').forEach((btn) => {
    btn.addEventListener('click', () => changeRateLimit(Number(btn.dataset.minutes)));
  });
  $('btn-ratelimit-off').addEventListener('click', () => changeRateLimit(0));

  // ---------- Opzioni: tema ----------
  if (window.VaultPassTheme) {
    $('opt-theme').value = window.VaultPassTheme.get();
    $('opt-theme').addEventListener('change', (e) => window.VaultPassTheme.set(e.target.value));
  }

  // ---------- Opzioni: sezioni comprimibili ----------
  // Ogni sezione parte chiusa; quelle aperte si ricordano su questo dispositivo.
  const OPEN_SECTIONS_KEY = 'vaultpass_open_sections';
  let openSections = [];
  try { openSections = JSON.parse(localStorage.getItem(OPEN_SECTIONS_KEY) || '[]'); } catch (e) {}
  document.querySelectorAll('#tab-options details.card[data-section]').forEach((details) => {
    details.open = openSections.includes(details.dataset.section);
    details.addEventListener('toggle', () => {
      const key = details.dataset.section;
      openSections = openSections.filter((k) => k !== key);
      if (details.open) openSections.push(key);
      try { localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(openSections)); } catch (e) {}
    });
  });

  // ---------- Options: emails ----------
  async function ensureEmailSaved(email, label, color) {
    if (emailEntries.some((e) => e.email.toLowerCase() === email.toLowerCase())) return;
    const payload = { email, label: label || email, color: color || '#6b7280' };
    const { iv, ciphertext } = await encryptJSON(encKey, payload);
    const created = await Api.createEmail(iv, ciphertext);
    emailEntries.push({ id: created.id, ...payload });
    renderEmailChips();
    renderEmailSuggestions();
  }

  function renderEmailChips() {
    const container = $('emails-list');
    container.innerHTML = '';
    emailEntries.forEach((e) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.style.setProperty('--chip-color', e.color || '#6b7280');
      const dot = document.createElement('span');
      dot.className = 'chip-dot';
      const text = document.createElement('div');
      text.className = 'chip-text';
      const labelSpan = document.createElement('span');
      labelSpan.className = 'chip-label';
      labelSpan.textContent = e.label;
      const emailSpan = document.createElement('span');
      emailSpan.className = 'chip-email';
      emailSpan.textContent = e.email;
      text.append(labelSpan, emailSpan);
      const arrow = document.createElement('span');
      arrow.className = 'chip-arrow';
      arrow.textContent = '›';
      chip.append(dot, text, arrow);
      chip.addEventListener('click', () => openEmailModal(e));
      container.appendChild(chip);
    });
    renderVaultList(vaultItems);
  }

  $('form-add-email').addEventListener('submit', async (e) => {
    e.preventDefault();
    const labelInput = $('new-email-label');
    const emailInput = $('new-email-input');
    const colorInput = $('new-email-color');
    const email = emailInput.value.trim();
    if (!email) return;
    await ensureEmailSaved(email, labelInput.value.trim(), colorInput.value);
    labelInput.value = '';
    emailInput.value = '';
  });

  // ---------- Email edit modal ----------
  const emailModal = $('email-modal');
  function openEmailModal(entry) {
    $('email-edit-id').value = entry.id;
    $('email-edit-label').value = entry.label;
    $('email-edit-address').value = entry.email;
    $('email-edit-color').value = entry.color;
    show(emailModal);
  }

  $('btn-cancel-email').addEventListener('click', () => hide(emailModal));

  $('form-email-edit').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('email-edit-id').value;
    const payload = {
      email: $('email-edit-address').value.trim(),
      label: $('email-edit-label').value.trim(),
      color: $('email-edit-color').value,
    };
    const { iv, ciphertext } = await encryptJSON(encKey, payload);
    await Api.updateEmail(id, iv, ciphertext);
    const idx = emailEntries.findIndex((x) => String(x.id) === String(id));
    if (idx !== -1) emailEntries[idx] = { id: Number(id), ...payload };
    renderEmailChips();
    renderEmailSuggestions();
    hide(emailModal);
    toast('Salvato');
  });

  $('btn-delete-email').addEventListener('click', async () => {
    const id = $('email-edit-id').value;
    if (!(await confirmDialog('Eliminare questa email salvata?'))) return;
    await Api.deleteEmail(id);
    emailEntries = emailEntries.filter((x) => String(x.id) !== String(id));
    renderEmailChips();
    renderEmailSuggestions();
    hide(emailModal);
    toast('Eliminata');
  });

  // ---------- Versione dell'app ----------
  fetch('/api/version')
    .then((res) => res.json())
    .then(({ version, commit, remote }) => {
      let text = `VaultPass v${version} · ${commit ? 'build ' + commit : 'esecuzione locale'}`;
      if (remote) text += ` · dati reali da ${remote}`;
      document.querySelectorAll('.app-version').forEach((el) => { el.textContent = text; });
    })
    .catch(() => {});

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js'));
  }

  bootstrap();
})();
