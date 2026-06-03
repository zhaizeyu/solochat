import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const bubblePresets = [
  { id: 'mint', name: '蓝绿色', start: '#1597ff', end: '#12b886', soft: '#eaf8f5', shadow: 'rgba(18, 184, 134, 0.18)' },
  { id: 'pink', name: '粉色', start: '#ff7ab6', end: '#ff9f8f', soft: '#fff0f6', shadow: 'rgba(255, 122, 182, 0.2)' },
  { id: 'purple', name: '紫粉', start: '#9b7bff', end: '#ff7ab6', soft: '#f6f0ff', shadow: 'rgba(155, 123, 255, 0.2)' },
  { id: 'sky', name: '天空蓝', start: '#4facfe', end: '#7bdff2', soft: '#ecf8ff', shadow: 'rgba(79, 172, 254, 0.18)' },
  { id: 'peach', name: '蜜桃', start: '#ff9a8b', end: '#ffd36e', soft: '#fff6e8', shadow: 'rgba(255, 154, 139, 0.2)' },
  { id: 'lavender', name: '薰衣草', start: '#a18cd1', end: '#fbc2eb', soft: '#f8f0ff', shadow: 'rgba(161, 140, 209, 0.2)' }
];

const api = {
  async request(path, options = {}) {
    const token = localStorage.getItem('solochat.token');
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
  messages(contactId) {
    return this.request(`/api/messages/${contactId}`);
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
  updateProfile(displayName) {
    return this.request('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({ displayName })
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
  }
};

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) {
      reject(new Error('请选择图片文件'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function Avatar({ user, size = '' }) {
  const className = `avatar ${size}`.trim();
  if (user?.avatarDataUrl) {
    return <img className={className} src={user.avatarDataUrl} alt="" />;
  }
  return <div className={className}>{(user?.displayName || '?').slice(0, 1).toUpperCase()}</div>;
}

function AuthPanel({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'register') {
        await api.register(form);
      }
      const data = await api.login(form);
      localStorage.setItem('solochat.token', data.token);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand-block">
          <div className="brand-mark">S</div>
          <div>
            <h1>SoloChat</h1>
            <p>多人联系人私聊</p>
          </div>
        </div>

        <div className="mode-tabs" role="tablist">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            登录
          </button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
            注册
          </button>
        </div>

        <form onSubmit={submit} className="auth-form">
          <label>
            用户名
            <input
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              placeholder="alice"
              autoComplete="username"
            />
          </label>
          {mode === 'register' && (
            <label>
              昵称
              <input
                value={form.displayName}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                placeholder="Alice"
                autoComplete="name"
              />
            </label>
          )}
          <label>
            密码
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              placeholder="至少 6 位"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
          {error && <div className="error-line">{error}</div>}
          <button className="primary-button" disabled={busy}>
            {busy ? '处理中...' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>
      </section>
    </main>
  );
}

function ContactList({
  contacts,
  selectedId,
  onSelect,
  onAddContact,
  self,
  bubbleTheme,
  bubblePresets,
  onBubbleThemeChange,
  onUpdateProfile,
  onUpdateAvatar,
  onLogout,
  onDeleteAccount
}) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [displayName, setDisplayName] = useState(self.displayName);
  const [profileError, setProfileError] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);

  useEffect(() => {
    setDisplayName(self.displayName);
  }, [self.displayName]);

  const selectedBubblePreset = bubblePresets.find((preset) => preset.id === bubbleTheme) || bubblePresets[0];

  async function add(event) {
    event.preventDefault();
    if (!username.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onAddContact(username);
      setUsername('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    const nextName = displayName.trim();
    if (!nextName || nextName === self.displayName) {
      setEditingName(false);
      setDisplayName(self.displayName);
      return;
    }
    setProfileBusy(true);
    setProfileError('');
    try {
      await onUpdateProfile(nextName);
      setEditingName(false);
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileBusy(false);
    }
  }

  async function confirmDeleteAccount() {
    const ok = window.confirm('注销后账号不能再登录，并会从联系人列表中移除。确定注销吗？');
    if (!ok) return;
    setProfileBusy(true);
    setProfileError('');
    try {
      await onDeleteAccount();
    } catch (err) {
      setProfileError(err.message);
      setProfileBusy(false);
    }
  }

  async function changeAvatar(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setProfileBusy(true);
    setProfileError('');
    try {
      const avatarDataUrl = await readImageFile(file);
      await onUpdateAvatar(avatarDataUrl);
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileBusy(false);
    }
  }

  async function changeBubbleTheme(themeId) {
    if (themeId === bubbleTheme) return;
    setProfileBusy(true);
    setProfileError('');
    try {
      await onBubbleThemeChange(themeId);
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileBusy(false);
    }
  }

  return (
    <aside className="sidebar">
      <div className="profile-row">
        <label className="avatar-upload" title="更换头像">
          <Avatar user={self} />
          <input type="file" accept="image/*" onChange={changeAvatar} disabled={profileBusy} />
        </label>
        <div className="profile-copy">
          {editingName ? (
            <form className="profile-edit" onSubmit={saveProfile}>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={24}
                autoFocus
              />
              <div className="profile-actions">
                <button type="submit" disabled={profileBusy}>保存</button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingName(false);
                    setDisplayName(self.displayName);
                    setProfileError('');
                  }}
                  disabled={profileBusy}
                >
                  取消
                </button>
              </div>
            </form>
          ) : (
            <>
              <strong>{self.displayName}</strong>
              <span>@{self.username}</span>
            </>
          )}
        </div>
      </div>
      <div className="account-actions">
        {self.avatarDataUrl && (
          <button type="button" onClick={() => onUpdateAvatar('')} disabled={profileBusy}>
            清除头像
          </button>
        )}
        <button type="button" onClick={() => setEditingName(true)}>改昵称</button>
        <button type="button" onClick={onLogout}>退出</button>
        <button type="button" className="danger-link" onClick={confirmDeleteAccount} disabled={profileBusy}>
          注销
        </button>
      </div>
      {profileError && <div className="inline-error">{profileError}</div>}

      <section
        className="bubble-theme-picker"
        aria-label="气泡颜色"
        style={{
          '--bubble-start': selectedBubblePreset.start,
          '--bubble-end': selectedBubblePreset.end,
          '--bubble-soft': selectedBubblePreset.soft,
          '--bubble-shadow': selectedBubblePreset.shadow
        }}
      >
        <div className="contact-title">气泡颜色</div>
        <div className="bubble-theme-grid">
          {bubblePresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={bubbleTheme === preset.id ? 'selected' : ''}
              onClick={() => changeBubbleTheme(preset.id)}
              disabled={profileBusy}
              title={preset.name}
              aria-label={preset.name}
              aria-pressed={bubbleTheme === preset.id}
              style={{
                '--swatch-start': preset.start,
                '--swatch-end': preset.end,
                '--swatch-soft': preset.soft
              }}
            >
              <span />
            </button>
          ))}
        </div>
        <div
          className="bubble-theme-preview"
          style={{
            background: `linear-gradient(135deg, ${selectedBubblePreset.start}, ${selectedBubblePreset.end})`,
            boxShadow: `0 10px 26px ${selectedBubblePreset.shadow}`
          }}
        >
          {selectedBubblePreset.name}气泡预览
        </div>
      </section>

      <form className="add-contact" onSubmit={add}>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="输入用户名添加联系人"
        />
        <button title="添加联系人" disabled={busy}>+</button>
      </form>
      {error && <div className="inline-error">{error}</div>}

      <div className="contact-title">联系人</div>
      <div className="contact-list">
        {contacts.length === 0 && <div className="empty-list">暂无联系人</div>}
        {contacts.map((contact) => (
          <button
            key={contact.id}
            className={`contact-item ${selectedId === contact.id ? 'selected' : ''}`}
            onClick={() => onSelect(contact)}
          >
            <Avatar user={contact} size="small" />
            <div className="contact-copy">
              <strong>{contact.displayName}</strong>
              <span>{contact.lastMessage || `@${contact.username}`}</span>
            </div>
            {contact.unreadCount > 0 && <span className="unread-badge">{contact.unreadCount > 99 ? '99+' : contact.unreadCount}</span>}
          </button>
        ))}
      </div>
    </aside>
  );
}

function ChatWindow({ contact, messages, self, stickers, bubblePresets, onSend, onSendSticker, onAddSticker, onDeleteStickers, onRecall }) {
  const [text, setText] = useState('');
  const [quote, setQuote] = useState(null);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [stickerBusy, setStickerBusy] = useState(false);
  const [stickerManage, setStickerManage] = useState(false);
  const [selectedStickerIds, setSelectedStickerIds] = useState([]);
  const [savingStickerMessageIds, setSavingStickerMessageIds] = useState([]);
  const bottomRef = useRef(null);
  const streamRef = useRef(null);
  const textareaRef = useRef(null);
  const messageRefs = useRef(new Map());
  const isNearBottomRef = useRef(true);
  const previousContactIdRef = useRef(null);
  const pendingScrollToBottomRef = useRef(false);

  useEffect(() => {
    const contactChanged = previousContactIdRef.current !== contact?.id;
    if (contactChanged || pendingScrollToBottomRef.current || isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: contactChanged ? 'auto' : 'smooth' });
    }
    previousContactIdRef.current = contact?.id || null;
    pendingScrollToBottomRef.current = false;
  }, [messages, contact?.id]);

  useEffect(() => {
    setQuote(null);
  }, [contact?.id]);

  useEffect(() => {
    if (!stickerOpen) {
      setStickerManage(false);
      setSelectedStickerIds([]);
    }
  }, [stickerOpen]);

  async function submit(event) {
    event.preventDefault();
    const content = text.trim();
    if (!content || !contact) return;
    const currentQuote = quote;
    setText('');
    setQuote(null);
    pendingScrollToBottomRef.current = true;
    try {
      await onSend(content, currentQuote?.id || '');
    } catch (err) {
      pendingScrollToBottomRef.current = false;
      setText(content);
      setQuote(currentQuote);
      alert(err.message);
    }
  }

  function insertLineBreak(event) {
    event.preventDefault();
    const textarea = event.currentTarget;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const nextText = `${textarea.value.slice(0, start)}\n${textarea.value.slice(end)}`;
    setText(nextText);
    requestAnimationFrame(() => {
      textarea.setSelectionRange(start + 1, start + 1);
    });
  }

  function updateScrollPosition(event) {
    const node = event.currentTarget;
    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    isNearBottomRef.current = distanceToBottom < 80;
  }

  function handleWheel(event) {
    if (event.deltaY < 0) {
      isNearBottomRef.current = false;
    }
  }

  function scrollToMessage(messageId) {
    const node = messageRefs.current.get(messageId);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.add('message-highlight');
    window.setTimeout(() => node.classList.remove('message-highlight'), 900);
  }

  function quoteMessage(message) {
    setQuote(message);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }

  function renderQuote(quoted, interactive = false) {
    if (!quoted) return null;
    const quotedSticker = quoted.kind === 'sticker' && quoted.sticker;
    return (
      <button
        type="button"
        className={`quote-card ${interactive ? 'quote-link' : ''}`}
        onClick={interactive ? () => scrollToMessage(quoted.id) : undefined}
      >
        <strong>{quoted.authorName || (quoted.fromId === self.id ? self.displayName : contact.displayName)}</strong>
        {quoted.recalledAt ? (
          <span>消息已撤回</span>
        ) : quotedSticker ? (
          <span className="quote-sticker-line">
            <img src={quoted.sticker.imageDataUrl} alt={quoted.sticker.name || '表情包'} />
            <span>{quoted.sticker.name || '表情包'}</span>
          </span>
        ) : (
          <span>{quoted.text}</span>
        )}
      </button>
    );
  }

  function getBubblePreset(themeId) {
    return bubblePresets.find((preset) => preset.id === themeId) || bubblePresets[0];
  }

  function getMessageBubbleStyle(preset, transparent = false) {
    if (transparent) {
      return {
        background: 'transparent',
        borderColor: 'transparent',
        boxShadow: 'none'
      };
    }
    return {
      '--bubble-start': preset.start,
      '--bubble-end': preset.end,
      '--bubble-shadow': preset.shadow,
      background: `linear-gradient(135deg, ${preset.start}, ${preset.end})`,
      borderColor: 'transparent',
      boxShadow: `0 10px 26px ${preset.shadow}`
    };
  }

  function hasSavedSticker(sticker) {
    return Boolean(sticker?.imageDataUrl && stickers.some((item) => item.imageDataUrl === sticker.imageDataUrl));
  }

  async function addStickerFromMessage(message) {
    if (!message.sticker || hasSavedSticker(message.sticker) || savingStickerMessageIds.includes(message.id)) return;
    setSavingStickerMessageIds((ids) => [...ids, message.id]);
    try {
      await onAddSticker({
        name: message.sticker.name || '表情包',
        imageDataUrl: message.sticker.imageDataUrl
      });
      setStickerOpen(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingStickerMessageIds((ids) => ids.filter((id) => id !== message.id));
    }
  }

  async function recall(message) {
    const ok = window.confirm('确定撤回这条消息吗？');
    if (!ok) return;
    try {
      await onRecall(message.id);
      if (quote?.id === message.id) setQuote(null);
    } catch (err) {
      alert(err.message);
    }
  }

  async function importSticker(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setStickerBusy(true);
    try {
      const imageDataUrl = await readImageFile(file);
      await onAddSticker({
        name: file.name.replace(/\.[^.]+$/, ''),
        imageDataUrl
      });
      setStickerOpen(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setStickerBusy(false);
    }
  }

  async function sendSticker(sticker) {
    if (!contact) return;
    const currentQuote = quote;
    setQuote(null);
    setStickerOpen(false);
    pendingScrollToBottomRef.current = true;
    try {
      await onSendSticker(sticker.id, currentQuote?.id || '');
    } catch (err) {
      pendingScrollToBottomRef.current = false;
      setQuote(currentQuote);
      alert(err.message);
    }
  }

  function toggleStickerSelection(stickerId) {
    setSelectedStickerIds((ids) =>
      ids.includes(stickerId) ? ids.filter((id) => id !== stickerId) : [...ids, stickerId]
    );
  }

  async function deleteSelectedStickers() {
    if (selectedStickerIds.length === 0) return;
    const ok = window.confirm(`确定删除选中的 ${selectedStickerIds.length} 个表情包吗？`);
    if (!ok) return;
    try {
      await onDeleteStickers(selectedStickerIds);
      setSelectedStickerIds([]);
      setStickerManage(false);
    } catch (err) {
      alert(err.message);
    }
  }

  if (!contact) {
    return (
      <section className="chat-empty">
        <div className="empty-orbit">QQ</div>
        <h2>选择一个联系人开始聊天</h2>
        <p>添加用户后即可发送私聊消息，聊天记录会保存在后台文件中。</p>
      </section>
    );
  }

  return (
    <section className="chat-panel">
      <header className="chat-header">
        <Avatar user={contact} />
        <div>
          <h2>{contact.displayName}</h2>
          <span>@{contact.username}</span>
        </div>
      </header>

      <div className="message-stream" ref={streamRef} onScroll={updateScrollPosition} onWheel={handleWheel}>
        {messages.map((message) => {
          const mine = message.fromId === self.id;
          const sender = mine ? self : contact;
          const bubblePreset = getBubblePreset(sender?.bubbleTheme);
          const recalled = Boolean(message.recalledAt);
          const stickerBubble = message.kind === 'sticker' && !recalled;
          const canAddSticker = stickerBubble && !mine && message.sticker;
          const stickerSaved = canAddSticker && hasSavedSticker(message.sticker);
          const savingSticker = savingStickerMessageIds.includes(message.id);
          const canRecall = mine && !recalled && Date.now() - new Date(message.createdAt).getTime() <= 8 * 60 * 1000;
          return (
            <div
              key={message.id}
              className={`message-row ${mine ? 'mine' : ''}`}
              ref={(node) => {
                if (node) messageRefs.current.set(message.id, node);
                else messageRefs.current.delete(message.id);
              }}
            >
              {!mine && <Avatar user={contact} size="tiny" />}
              <div
                className={`message-bubble ${stickerBubble ? 'sticker-bubble' : ''}`}
                style={getMessageBubbleStyle(bubblePreset, stickerBubble)}
              >
                <div>
                  {recalled ? (
                    <p className="message-recalled">消息已撤回</p>
                  ) : (
                    <>
                      {renderQuote(message.quote, true)}
                      {message.kind === 'sticker' && message.sticker ? (
                        <img className="message-sticker" src={message.sticker.imageDataUrl} alt={message.sticker.name || '表情包'} />
                      ) : (
                        <p>{message.text}</p>
                      )}
                    </>
                  )}
                  <div className="message-meta">
                    {!recalled && <button type="button" onClick={() => quoteMessage(message)}>引用</button>}
                    {canAddSticker && (
                      stickerSaved ? (
                        <span className="sticker-saved-state">已添加</span>
                      ) : (
                        <button type="button" onClick={() => addStickerFromMessage(message)} disabled={savingSticker}>
                          {savingSticker ? '添加中' : '添加表情'}
                        </button>
                      )
                    )}
                    {canRecall && <button type="button" onClick={() => recall(message)}>撤回</button>}
                    {mine && <span className="read-state">{message.readAt ? '已读' : '未读'}</span>}
                    <time>{new Date(message.createdAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
                  </div>
                </div>
              </div>
              {mine && <Avatar user={self} size="tiny" />}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form className="composer" onSubmit={submit}>
        <div className="composer-main">
          {quote && (
            <div className="composer-quote">
              {renderQuote(quote)}
              <button type="button" onClick={() => setQuote(null)}>取消引用</button>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={`发送给 ${contact.displayName}`}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.ctrlKey) {
                insertLineBreak(event);
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                submit(event);
              }
            }}
          />
          <div className="sticker-toolbar">
            <button type="button" className={stickerOpen ? 'active' : ''} onClick={() => setStickerOpen((open) => !open)} title="表情包">
              ☺
            </button>
          </div>
        </div>
        <button className="send-button" title="发送消息">发送</button>
        {stickerOpen && (
          <div className="sticker-panel">
            <div className="sticker-panel-header">
              <span>{stickerManage ? `已选择 ${selectedStickerIds.length}` : '我的表情'}</span>
              <div>
                {stickerManage && (
                  <button type="button" className="danger-link" onClick={deleteSelectedStickers} disabled={selectedStickerIds.length === 0}>
                    删除
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setStickerManage((manage) => !manage);
                    setSelectedStickerIds([]);
                  }}
                  disabled={stickers.length === 0}
                >
                  {stickerManage ? '完成' : '管理'}
                </button>
              </div>
            </div>
            <div className="sticker-grid">
              {!stickerManage && (
                <label className="sticker-import">
                  <span>+</span>
                  <input type="file" accept="image/*" onChange={importSticker} disabled={stickerBusy} />
                </label>
              )}
              {stickers.map((sticker) => {
                const selected = selectedStickerIds.includes(sticker.id);
                return (
                  <button
                    type="button"
                    key={sticker.id}
                    className={selected ? 'selected' : ''}
                    onClick={() => (stickerManage ? toggleStickerSelection(sticker.id) : sendSticker(sticker))}
                    title={sticker.name}
                  >
                    <img src={sticker.imageDataUrl} alt={sticker.name} />
                    {stickerManage && <span className="sticker-check">{selected ? '✓' : ''}</span>}
                  </button>
                );
              })}
              {stickers.length === 0 && <div className="sticker-empty">导入图片后可作为表情发送</div>}
            </div>
          </div>
        )}
      </form>
    </section>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [stickers, setStickers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const selectedId = selected?.id;
  const originalTitleRef = useRef(document.title);

  function clearSession() {
    localStorage.removeItem('solochat.token');
    setUser(null);
    setSelected(null);
    setMessages([]);
    setStickers([]);
    setContacts([]);
  }

  async function refreshContacts() {
    const data = await api.contacts();
    setContacts(data.contacts);
    if (selectedId) {
      const fresh = data.contacts.find((item) => item.id === selectedId);
      if (fresh) setSelected(fresh);
    }
  }

  async function refreshMessages(contactId = selectedId) {
    if (!contactId) return;
    const data = await api.messages(contactId);
    setMessages(data.messages);
  }

  async function markSelectedRead(contactId = selectedId) {
    if (!contactId) return;
    await api.markRead(contactId);
    await Promise.all([refreshMessages(contactId), refreshContacts()]);
  }

  async function refreshStickers() {
    const data = await api.stickers();
    setStickers(data.stickers);
  }

  useEffect(() => {
    const token = localStorage.getItem('solochat.token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((data) => setUser(data.user))
      .catch(() => localStorage.removeItem('solochat.token'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function updateVisibility() {
      const visible = !document.hidden;
      setPageVisible(visible);
      if (visible) {
        document.title = originalTitleRef.current;
      }
    }
    document.addEventListener('visibilitychange', updateVisibility);
    window.addEventListener('focus', updateVisibility);
    window.addEventListener('pageshow', updateVisibility);
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      window.removeEventListener('focus', updateVisibility);
      window.removeEventListener('pageshow', updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshContacts().catch(console.error);
    refreshStickers().catch(console.error);
    const timer = setInterval(() => {
      refreshContacts().catch(console.error);
    }, 4000);
    return () => clearInterval(timer);
  }, [user, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    refreshMessages(selectedId).catch(console.error);
    const timer = setInterval(() => {
      refreshMessages(selectedId).catch(console.error);
    }, 1500);
    return () => clearInterval(timer);
  }, [selectedId]);

  useEffect(() => {
    if (!user || !selectedId || !pageVisible) return;
    const hasUnreadIncoming = messages.some((message) => message.toId === user.id && !message.readAt);
    if (hasUnreadIncoming) {
      markSelectedRead(selectedId).catch(console.error);
    }
  }, [user, selectedId, pageVisible, messages]);

  useEffect(() => {
    if (!user) {
      document.title = originalTitleRef.current;
      return;
    }
    if (pageVisible) {
      document.title = originalTitleRef.current;
      return;
    }
    const unreadCount = contacts.reduce((total, contact) => total + (contact.unreadCount || 0), 0);
    document.title = unreadCount > 0 ? `(${unreadCount}) 新消息 - ${originalTitleRef.current}` : originalTitleRef.current;
  }, [contacts, pageVisible, user]);

  const sortedContacts = useMemo(() => contacts, [contacts]);

  if (loading) {
    return <div className="loading-screen">正在加载 SoloChat...</div>;
  }

  if (!user) {
    return <AuthPanel onLogin={setUser} />;
  }

  return (
    <main className="app-shell">
      <ContactList
        contacts={sortedContacts}
        selectedId={selectedId}
        onSelect={setSelected}
        self={user}
        bubbleTheme={user.bubbleTheme || 'mint'}
        bubblePresets={bubblePresets}
        onBubbleThemeChange={async (bubbleTheme) => {
          const previousUser = user;
          setUser((current) => (current ? { ...current, bubbleTheme } : current));
          try {
            const data = await api.updateBubbleTheme(bubbleTheme);
            setUser(data.user);
            await refreshContacts();
          } catch (err) {
            setUser(previousUser);
            throw err;
          }
        }}
        onLogout={clearSession}
        onUpdateProfile={async (displayName) => {
          const data = await api.updateProfile(displayName);
          setUser(data.user);
          await refreshContacts();
        }}
        onUpdateAvatar={async (avatarDataUrl) => {
          const data = await api.updateAvatar(avatarDataUrl);
          setUser(data.user);
          await refreshContacts();
        }}
        onDeleteAccount={async () => {
          await api.deleteAccount();
          clearSession();
        }}
        onAddContact={async (username) => {
          await api.addContact(username);
          await refreshContacts();
        }}
      />
      <ChatWindow
        contact={selected}
        messages={messages}
        self={user}
        stickers={stickers}
        bubblePresets={bubblePresets}
        onSend={async (text, quoteId) => {
          await api.sendQuotedMessage(selected.id, text, quoteId);
          await Promise.all([refreshMessages(selected.id), refreshContacts()]);
        }}
        onSendSticker={async (stickerId, quoteId) => {
          await api.sendSticker(selected.id, stickerId, quoteId);
          await Promise.all([refreshMessages(selected.id), refreshContacts()]);
        }}
        onAddSticker={async (payload) => {
          await api.addSticker(payload);
          await refreshStickers();
        }}
        onDeleteStickers={async (stickerIds) => {
          await Promise.all(stickerIds.map((stickerId) => api.deleteSticker(stickerId)));
          await refreshStickers();
        }}
        onRecall={async (messageId) => {
          await api.recallMessage(messageId);
          await Promise.all([refreshMessages(selected.id), refreshContacts()]);
        }}
      />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
