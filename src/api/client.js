const api = {

  async request(path, options = {}) {
    const token = localStorage.getItem('doolulu.token');
    const res = await fetch(path, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || '请求失败');
    }
    return data;
  },
  login(payload) {
    return this.request('/api/login', { method: 'POST', body: JSON.stringify(payload) });
  },
  register(payload) {
    return this.request('/api/register', { method: 'POST', body: JSON.stringify(payload) });
  },
  me() {
    return this.request('/api/me');
  },
  contacts() {
    return this.request('/api/contacts');
  },
  addContact(username) {
    return this.request('/api/contacts', { method: 'POST', body: JSON.stringify({ username }) });
  },
  deleteContact(contactId) {
    return this.request(`/api/contacts/${encodeURIComponent(contactId)}`, { method: 'DELETE' });
  },
  messages(contactId, params = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') search.set(key, value);
    }
    const suffix = search.toString() ? `?${search}` : '';
    return this.request(`/api/messages/${contactId}${suffix}`);
  },
  sendMessage(toId, text) {
    return this.request('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ toId, text })
    });
  },
  sendQuotedMessage(toId, text, quoteId) {
    return this.request('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ toId, text, quoteId })
    });
  },
  sendSticker(toId, stickerId, quoteId) {
    return this.request('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ toId, stickerId, quoteId, kind: 'sticker' })
    });
  },
  markRead(contactId) {
    return this.request(`/api/messages/${contactId}/read`, { method: 'POST' });
  },
  recallMessage(messageId) {
    return this.request(`/api/messages/${messageId}/recall`, { method: 'PATCH' });
  },
  inviteSecureConversation(payload) {
    return this.request('/api/secure-conversations/invite', { method: 'POST', body: JSON.stringify(payload) });
  },
  acceptSecureConversation(payload) {
    return this.request('/api/secure-conversations/accept', { method: 'POST', body: JSON.stringify(payload) });
  },
  completeSecureConversation(payload) {
    return this.request('/api/secure-conversations/complete', { method: 'POST', body: JSON.stringify(payload) });
  },
  requestCloseSecureConversation(conversationId) {
    return this.request('/api/secure-conversations/close/request', {
      method: 'POST',
      body: JSON.stringify({ conversationId })
    });
  },
  confirmCloseSecureConversation(conversationId) {
    return this.request('/api/secure-conversations/close/confirm', {
      method: 'POST',
      body: JSON.stringify({ conversationId })
    });
  },
  cancelCloseSecureConversation(conversationId) {
    return this.request('/api/secure-conversations/close/cancel', {
      method: 'POST',
      body: JSON.stringify({ conversationId })
    });
  },
  secureKeyMaterial(conversationId) {
    return this.request(`/api/secure-conversations/${encodeURIComponent(conversationId)}/key-material`);
  },
  updateSecureUserWrappedKey(conversationId, payload) {
    return this.request(`/api/secure-conversations/${encodeURIComponent(conversationId)}/user-wrapped-key`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },
  verifyLoginPassword(password) {
    return this.request('/api/me/verify-password', { method: 'POST', body: JSON.stringify({ password }) });
  },
  changeLoginPassword(currentPassword, newPassword, extras = {}) {
    return this.request('/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword, ...extras })
    });
  },
  mySecureKeyWraps() {
    return this.request('/api/secure-conversations/my-key-wraps');
  },
  rewrapSecureKeys(userWrappedKeys, handshakeKeys) {
    return this.request('/api/secure-conversations/rewrap-keys', {
      method: 'POST',
      body: JSON.stringify({ userWrappedKeys, handshakeKeys })
    });
  },
  disableSecureConversation(conversationId) {
    return this.request(`/api/secure-conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
  },
  encryptedMessages(contactId, params = {}) {
    const search = new URLSearchParams({ contactId });
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') search.set(key, value);
    }
    return this.request(`/api/messages/encrypted?${search}`);
  },
  nextEncryptedSequence(contactId, keyVersion) {
    const search = new URLSearchParams({ contactId, keyVersion: String(keyVersion) });
    return this.request(`/api/messages/encrypted/next-sequence?${search}`);
  },
  sendEncryptedMessage(payload) {
    return this.request('/api/messages/encrypted', { method: 'POST', body: JSON.stringify(payload) });
  },
  plannerTasks(contactId) {
    return this.request(`/api/planner/${contactId}`);
  },
  addPlannerTask(contactId, payload) {
    return this.request(`/api/planner/${contactId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  updatePlannerTask(taskId, payload) {
    return this.request(`/api/planner/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  },
  confirmPlannerTask(taskId, confirmed) {
    return this.request(`/api/planner/tasks/${taskId}/confirm`, {
      method: 'PATCH',
      body: JSON.stringify({ confirmed })
    });
  },
  deletePlannerTask(taskId) {
    return this.request(`/api/planner/tasks/${taskId}`, { method: 'DELETE' });
  },
  moments(contactId) {
    return this.request(`/api/moments/${contactId}`);
  },
  addMoment(contactId, payload) {
    return this.request(`/api/moments/${contactId}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  updateMoment(momentId, payload) {
    return this.request(`/api/moments/items/${momentId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  },
  deleteMoment(momentId) {
    return this.request(`/api/moments/items/${momentId}`, { method: 'DELETE' });
  },
  updateProfile(displayName) {
    return this.request('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({ displayName })
    });
  },
  updateBio(bio) {
    return this.request('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({ bio })
    });
  },
  updateAvatar(avatarDataUrl) {
    return this.request('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({ avatarDataUrl })
    });
  },
  updateBubbleTheme(bubbleTheme) {
    return this.request('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({ bubbleTheme })
    });
  },
  stickers() {
    return this.request('/api/stickers');
  },
  addSticker(payload) {
    return this.request('/api/stickers', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  deleteSticker(stickerId) {
    return this.request(`/api/stickers/${stickerId}`, { method: 'DELETE' });
  },
  deleteAccount() {
    return this.request('/api/me', { method: 'DELETE' });
  },
  adminUsers() {
    return this.request('/api/admin/users');
  },
  adminResetPassword(userId, password) {
    return this.request(`/api/admin/users/${userId}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ password })
    });
  },
  adminCleanupUserData(userId) {
    return this.request(`/api/admin/users/${userId}/data`, { method: 'DELETE' });
  },
  adminDisableUsers(userIds) {
    return this.request('/api/admin/users/disable', {
      method: 'POST',
      body: JSON.stringify({ userIds })
    });
  },
  adminCleanupUsersData(userIds) {
    return this.request('/api/admin/users/cleanup-data', {
      method: 'POST',
      body: JSON.stringify({ userIds })
    });
  }
};

export { api };
