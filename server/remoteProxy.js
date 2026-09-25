// Modalita' sviluppo: se REMOTE_URL e' impostato, l'app locale serve l'interfaccia
// dai file locali ma inoltra le chiamate /api al server vero, cosi' in locale si
// vedono (e si modificano!) i dati reali. Senza REMOTE_URL non cambia nulla.

function getRemoteBase() {
  const raw = (process.env.REMOTE_URL || '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch (e) {
    throw new Error(`REMOTE_URL non valido: ${raw}`);
  }
  const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !isLocal) {
    throw new Error('REMOTE_URL deve usare https:// (le password non devono viaggiare in chiaro)');
  }
  return url.origin;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Il cookie di sessione del server vero e' "Secure": su http://localhost il browser
// potrebbe scartarlo, quindi si toglie Secure (e Domain) prima di passarlo al browser.
function relaxCookie(cookie) {
  return cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => !/^(secure|domain=)/i.test(part))
    .join('; ');
}

function remoteProxy(base) {
  return async (req, res) => {
    try {
      const headers = {};
      for (const name of ['content-type', 'cookie', 'user-agent', 'accept']) {
        if (req.headers[name]) headers[name] = req.headers[name];
      }
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      const upstream = await fetch(base + req.originalUrl, {
        method: req.method,
        headers,
        body: hasBody ? await readBody(req) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
      });

      res.status(upstream.status);
      const type = upstream.headers.get('content-type');
      if (type) res.set('Content-Type', type);
      const cookies = upstream.headers.getSetCookie ? upstream.headers.getSetCookie() : [];
      if (cookies.length) res.set('Set-Cookie', cookies.map(relaxCookie));
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      console.error('Proxy verso il server remoto fallito:', err.message);
      res.status(502).json({ error: 'Server remoto non raggiungibile' });
    }
  };
}

module.exports = { getRemoteBase, remoteProxy };
