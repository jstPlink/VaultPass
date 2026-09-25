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

  // ---------- Navigation ----------
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      closePrivateFolder();
      document.querySelectorAll('.tab').forEach((t) => hide(t));
      show($(btn.dataset.tab));
    });
  });

  // ---------- Vault list rendering ----------
  // Indirizzo da mostrare: senza "https://" e senza "/" finale.
  function displayUrl(raw) {
    const url = normalizeUrl(raw);
    if (!url) return String(raw || '').trim();
    return (url.host + (url.pathname === '/' ? '' : url.pathname) + url.search).replace(/^www./, '');
  }

  function itemCard(item) {
    const div = document.createElement('div');
    div.className = 'item-card';
    const linkBtn = item.url
      ? `<button type="button" class="btn-icon item-card-link" title="Apri il sito" data-url="${escapeHtml(item.url)}">↗</button>`
      : '';
    const line = (glyph, text) =>
      text ? `<span class="item-card-line"><span class="item-card-glyph" aria-hidden="true">${glyph}</span><span>${escapeHtml(text)}</span></span>` : '';
    div.innerHTML = `
      <div class="item-card-main">
        <strong>${escapeHtml(item.name || '(senza nome)')}</strong>
        ${line('👤', item.username)}
        ${line('✉', item.email)}
        ${line('🔗', displayUrl(item.url))}
      </div>
      ${linkBtn}
    `;
    if (iconsEnabled()) div.prepend(siteIcon(item));
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

  // Cartella nascosta: gli account con "hidden" non stanno nell'elenco principale, si
  // aprono dalla riga "Altro" in fondo alla lista. La riga c'e' SEMPRE, anche senza account
  // nascosti, e non mostra conteggi: chi guarda lo schermo non puo' capire cosa contiene.
  let privateOpen = false;

  function closePrivateFolder() {
    if (!privateOpen) return;
    privateOpen = false;
    renderVaultList(vaultItems);
  }

  function privateFolderCard() {
    const div = document.createElement('div');
    div.className = 'item-card folder-card';
    const icon = document.createElement('span');
    icon.className = 'site-icon';
    icon.textContent = '📁';
    const main = document.createElement('div');
    main.className = 'item-card-main';
    const title = document.createElement('strong');
    title.textContent = 'Altro';
    main.appendChild(title);
    const arrow = document.createElement('span');
    arrow.className = 'folder-arrow';
    arrow.textContent = '›';
    div.append(icon, main, arrow);
    div.addEventListener('click', () => {
      privateOpen = true;
      renderVaultList(vaultItems);
      window.scrollTo(0, 0);
    });
    return div;
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
    $('private-header').classList.toggle('hidden', !privateOpen);
    $('vault-empty').classList.toggle('hidden', privateOpen || items.length > 0);
    $('private-empty').classList.toggle('hidden', !privateOpen || hiddenItems.length > 0);
    const shown = sortByName(privateOpen ? hiddenItems : items.filter((item) => !item.hidden));
    shown.forEach((item) => list.appendChild(itemCard(item)));
    if (!privateOpen) list.appendChild(privateFolderCard());
  }

  $('btn-private-back').addEventListener('click', closePrivateFolder);
  // Per riservatezza la cartella si richiude cambiando tab o mandando l'app in secondo piano.
  document.addEventListener('visibilitychange', () => { if (document.hidden) closePrivateFolder(); });

  // ---------- Icone dei siti ----------
  const ICONS_KEY = 'vaultpass_show_icons';
  function iconsEnabled() {
    try { return localStorage.getItem(ICONS_KEY) !== 'false'; } catch (e) { return true; }
  }

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
    hide($('item-dup-notice'));
    hide($('item-error'));
    const modalTitle = $('item-modal-title');
    modalTitle.textContent = '';
    if (item && iconsEnabled()) modalTitle.appendChild(siteIcon(item));
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
  });

  $('btn-delete-item').addEventListener('click', async () => {
    const id = $('item-id').value;
    if (!id) return;
    if (!(await confirmDialog('Eliminare questo account?'))) return;
    await Api.deleteItem(id);
    vaultItems = vaultItems.filter((i) => String(i.id) !== String(id));
    renderVaultList(vaultItems);
    closeItemModal();
    toast('Eliminato');
  });

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

  // ---------- Options: icone dei siti ----------
  $('opt-show-icons').checked = iconsEnabled();
  $('opt-show-icons').addEventListener('change', (e) => {
    try { localStorage.setItem(ICONS_KEY, e.target.checked ? 'true' : 'false'); } catch (err) {}
    renderVaultList(vaultItems);
    $('search-input').dispatchEvent(new Event('input'));
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
