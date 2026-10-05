export class Gmail {
  constructor(token, fetcher = fetch) { this.token = token; this.fetcher = fetcher; }
  async request(path, options = {}) {
    // Native Workers fetch rejects being invoked with a Gmail instance as its receiver.
    const fetcher = this.fetcher;
    const response = await fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      ...options, headers: {Authorization:`Bearer ${this.token}`, 'Content-Type':'application/json'},
      signal:AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Gmail ${response.status}`);
    if (response.status === 204) return null;
    return response.json();
  }
  profile() { return this.request('profile'); }
  list(pageToken) {
    const query = new URLSearchParams({q:'in:inbox {newer_than:30d is:unread}', maxResults:'100'});
    if (pageToken) query.set('pageToken', pageToken);
    return this.request(`messages?${query}`);
  }
  get(id) { return this.request(`messages/${encodeURIComponent(id)}?format=full`); }
  thread(id) { return this.request(`threads/${encodeURIComponent(id)}?format=metadata`); }
  async delete(id) {
    // Message IDs come only from revalidated classifier selections. Never empty Trash.
    await this.request('messages/batchDelete', {method:'POST', body:JSON.stringify({ids:[id]})});
  }
}
export async function accessToken(account, env, fetcher = fetch) {
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID, client_secret:env.GOOGLE_CLIENT_SECRET,
      refresh_token:account.refreshToken, grant_type:'refresh_token'}), signal:AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Google token refresh ${response.status}`);
  const value = await response.json();
  if (!value.access_token) throw new Error('Missing access token');
  return value.access_token;
}
