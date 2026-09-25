async function apiRequest(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Errore ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

window.Api = {
  register: (username, salt, authHash) => apiRequest('POST', '/api/auth/register', { username, salt, authHash }),
  getSalt: (username) => apiRequest('GET', `/api/auth/salt?username=${encodeURIComponent(username)}`),
  login: (username, authHash) => apiRequest('POST', '/api/auth/login', { username, authHash }),
  logout: () => apiRequest('POST', '/api/auth/logout'),
  changePassword: (payload) => apiRequest('POST', '/api/auth/change-password', payload),
  getRateLimit: () => apiRequest('GET', '/api/auth/rate-limit'),
  setRateLimit: (minutes) => apiRequest('POST', '/api/auth/rate-limit', { minutes }),

  listItems: () => apiRequest('GET', '/api/vault/items'),
  createItem: (iv, ciphertext) => apiRequest('POST', '/api/vault/items', { iv, ciphertext }),
  updateItem: (id, iv, ciphertext) => apiRequest('PUT', `/api/vault/items/${id}`, { iv, ciphertext }),
  deleteItem: (id) => apiRequest('DELETE', `/api/vault/items/${id}`),

  listEmails: () => apiRequest('GET', '/api/emails'),
  createEmail: (iv, ciphertext) => apiRequest('POST', '/api/emails', { iv, ciphertext }),
  updateEmail: (id, iv, ciphertext) => apiRequest('PUT', `/api/emails/${id}`, { iv, ciphertext }),
  deleteEmail: (id) => apiRequest('DELETE', `/api/emails/${id}`),
};
