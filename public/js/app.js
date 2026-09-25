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
      errEl.textContent = err.message;
      show(errEl);
    }
  });

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
      errEl.textContent = 'Impronta/Face ID non riuscita. Usa il PIN.';
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
  }

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
      document.querySelectorAll('.tab').forEach((t) => hide(t));
      show($(btn.dataset.tab));
    });
  });

  // ---------- Vault list rendering ----------
  function itemCard(item) {
    const div = document.createElement('div');
    div.className = 'item-card';
    const linkBtn = item.url
      ? `<button type="button" class="btn-icon item-card-link" title="Apri il sito" data-url="${escapeHtml(item.url)}">↗</button>`
      : '';
    div.innerHTML = `
      <div class="item-card-main">
        <strong>${escapeHtml(item.name || '(senza nome)')}</strong>
        <span class="muted">${escapeHtml(item.email || item.username || '')}</span>
      </div>
      ${linkBtn}
    `;
    if (iconsEnabled()) div.prepend(siteIcon(item));
    div.addEventListener('click', () => openViewModal(item));
    const btn = div.querySelector('.item-card-link');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Solo http/https: evita schemi come javascript: salvati in un URL.
        const target = normalizeUrl(btn.dataset.url);
        if (target) window.open(target.href, '_blank', 'noopener');
      });
    }
    return div;
  }

  function renderVaultList(items) {
    const list = $('vault-list');
    list.innerHTML = '';
    if (items.length === 0) {
      show($('vault-empty'));
    } else {
      hide($('vault-empty'));
      items.forEach((item) => list.appendChild(itemCard(item)));
    }
  }

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
    const matches = vaultItems.filter((item) =>
      (item.name || '').toLowerCase().includes(q) ||
      (item.email || '').toLowerCase().includes(q) ||
      (item.username || '').toLowerCase().includes(q)
    );
    matches.forEach((item) => results.appendChild(itemCard(item)));
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

  function openItemModal(item) {
    $('item-modal-title').textContent = item ? 'Modifica account' : 'Nuovo account';
    $('item-id').value = item ? item.id : '';
    $('item-name').value = item ? item.name || '' : '';
    $('item-url').value = item ? item.url || '' : '';
    $('item-email').value = item ? item.email || '' : '';
    $('item-username').value = item ? item.username || '' : '';
    $('item-password').value = item ? item.password || '' : '';
    $('item-password').type = 'password';
    $('item-notes').value = item ? item.notes || '' : '';
    $('btn-delete-item').classList.toggle('hidden', !item);
    show(itemModal);
  }

  function closeItemModal() {
    hide(itemModal);
    $('form-item').reset();
  }

  $('btn-new-item').addEventListener('click', () => openItemModal(null));
  $('btn-cancel-item').addEventListener('click', closeItemModal);

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
    };
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

  // ---------- View modal ----------
  const viewModal = $('view-modal');
  let currentViewedItem = null;

  function detailRow(label, value, copyable) {
    const safeVal = escapeHtml(value || '-');
    const copyBtn = copyable && value
      ? `<button type="button" class="btn-icon copy-btn" data-value="${escapeHtml(value)}" data-label="${label}">📋</button>`
      : '';
    return `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${safeVal}</span>${copyBtn}</div>`;
  }

  function openViewModal(item) {
    currentViewedItem = item;
    const modalTitle = $('view-modal-title');
    modalTitle.textContent = '';
    if (iconsEnabled()) modalTitle.appendChild(siteIcon(item));
    modalTitle.appendChild(document.createTextNode(item.name || '(senza nome)'));
    const body = $('view-modal-body');
    body.innerHTML =
      detailRow('URL', item.url, true) +
      detailRow('Email', item.email, true) +
      detailRow('Utente', item.username, true) +
      `<div class="detail-row">
        <span class="detail-label">Password</span>
        <span class="detail-value password-mask" id="view-password-value" data-value="${escapeHtml(item.password || '')}">${item.password ? '••••••••' : '-'}</span>
        ${item.password ? '<button type="button" class="btn-icon" id="toggle-view-password">👁</button><button type="button" class="btn-icon copy-btn" data-value="' + escapeHtml(item.password) + '" data-label="Password">📋</button>' : ''}
      </div>` +
      detailRow('Note', item.notes, false);

    body.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', () => copyToClipboard(btn.dataset.value, btn.dataset.label));
    });
    const togglePwd = $('toggle-view-password');
    if (togglePwd) {
      togglePwd.addEventListener('click', () => {
        const el = $('view-password-value');
        const revealed = el.textContent !== '••••••••';
        el.textContent = revealed ? '••••••••' : el.dataset.value;
      });
    }
    show(viewModal);
  }

  $('btn-close-view').addEventListener('click', () => hide(viewModal));
  $('btn-edit-from-view').addEventListener('click', () => {
    hide(viewModal);
    openItemModal(currentViewedItem);
  });

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
    .then(({ version, commit }) => {
      const text = `VaultPass v${version} · ${commit ? 'build ' + commit : 'esecuzione locale'}`;
      document.querySelectorAll('.app-version').forEach((el) => { el.textContent = text; });
    })
    .catch(() => {});

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js'));
  }

  bootstrap();
})();
