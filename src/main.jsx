'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button as ShadcnButton } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { Label } from '../components/ui/label.jsx';
import { TabsList, TabsTrigger } from '../components/ui/tabs.jsx';
import { Textarea } from '../components/ui/textarea.jsx';

const bubblePresets = [
  { id: 'mint', name: '蓝绿色', start: '#1597ff', end: '#12b886', soft: '#eaf8f5', shadow: 'rgba(18, 184, 134, 0.18)' },
  { id: 'pink', name: '粉色', start: '#ff7ab6', end: '#ff9f8f', soft: '#fff0f6', shadow: 'rgba(255, 122, 182, 0.2)' },
  { id: 'purple', name: '紫粉', start: '#9b7bff', end: '#ff7ab6', soft: '#f6f0ff', shadow: 'rgba(155, 123, 255, 0.2)' },
  { id: 'sky', name: '天空蓝', start: '#4facfe', end: '#7bdff2', soft: '#ecf8ff', shadow: 'rgba(79, 172, 254, 0.18)' },
  { id: 'peach', name: '蜜桃', start: '#ff9a8b', end: '#ffd36e', soft: '#fff6e8', shadow: 'rgba(255, 154, 139, 0.2)' },
  { id: 'lavender', name: '薰衣草', start: '#a18cd1', end: '#fbc2eb', soft: '#f8f0ff', shadow: 'rgba(161, 140, 209, 0.2)' }
];

const emojiMatcher = /(?:[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*)/gu;
const emojiGroups = [
  {
    id: 'smileys',
    name: '表情',
    items: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋', '😜', '🤗', '🤔', '😎', '🥳', '😭', '😤', '😡', '😴', '🤒']
  },
  {
    id: 'gestures',
    name: '手势',
    items: ['👍', '👎', '👏', '🙌', '🙏', '🤝', '👌', '✌️', '🤞', '🤟', '🤘', '👊', '💪', '👋', '🤙', '🫶']
  },
  {
    id: 'hearts',
    name: '心情',
    items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '💕', '💞', '💯', '✨', '🔥', '🎉', '🎁', '🌟']
  },
  {
    id: 'life',
    name: '日常',
    items: ['☀️', '🌙', '⭐', '☁️', '🌧️', '🌈', '🍎', '🍔', '🍜', '☕', '🍺', '⚽', '🎮', '🎧', '📷', '💻', '📱', '🚗']
  }
];
const messagePageSize = 50;

function cls(...items) {
  return items.filter(Boolean).join(' ');
}

const ui = {
  shell: 'min-h-screen bg-[var(--canvas)] text-[var(--foreground)]',
  panel: 'rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-[var(--shadow-soft)]',
  mutedText: 'text-sm text-[var(--muted-foreground)]',
  input: 'h-10',
  noticeError: 'rounded-md border border-[var(--destructive-border)] bg-[var(--destructive-muted)] px-3 py-2 text-sm text-[var(--destructive)]'
};

function isMobileShellViewport() {
  if (typeof window === 'undefined') return false;
  const mobileMedia = window.matchMedia?.('(max-width: 760px)').matches;
  const narrowScreen = window.screen?.width ? window.screen.width <= 760 : false;
  const mobileUserAgent = /Android|iPhone|iPod|IEMobile|Mobile/i.test(window.navigator?.userAgent || '');
  return Boolean(mobileMedia || narrowScreen || mobileUserAgent);
}

function useMobileShell() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function update() {
      setIsMobile(isMobileShellViewport());
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return isMobile;
}

function TextField({ label, className = '', ...props }) {
  return (
    <Label>
      {label}
      <Input className={cls(ui.input, className)} {...props} />
    </Label>
  );
}

function Button({ variant = 'subtle', className = '', ...props }) {
  const variants = {
    primary: 'default',
    subtle: 'outline',
    danger: 'destructive',
    ghost: 'ghost'
  };
  return <ShadcnButton variant={variants[variant] || variant} className={className} {...props} />;
}

function SegmentedControl({ options, value, onChange, className = '', ariaLabel }) {
  return (
    <TabsList columns={options.length} className={cls('grid w-full gap-1', className)} aria-label={ariaLabel}>
      {options.map((option) => (
        <TabsTrigger
          key={option.value}
          active={value === option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

function Twemoji({ emoji, className = 'twemoji' }) {
  return (
    <span className={`${className} emoji-fallback`} role="img" aria-label={emoji}>
      {emoji}
    </span>
  );
}

function CouplePlannerPanel({ tasks, selfLabel = '你', contactLabel = 'Ta', onAddTask, onUpdateTask, onDeleteTask, onClose }) {
  const [draft, setDraft] = useState({ time: '', place: '', plan: '' });
  const [formOpen, setFormOpen] = useState(false);
  const [filter, setFilter] = useState('active');
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const completedCount = tasks.filter((task) => task.done).length;
  const activeCount = tasks.length - completedCount;
  const pendingConfirmCount = tasks.filter((task) => !task.done && !(task.confirmedByA && task.confirmedByB)).length;

  async function submitTask(event) {
    event.preventDefault();
    const time = draft.time.trim();
    const place = draft.place.trim();
    const plan = draft.plan.trim();
    if (!time && !place && !plan) return;
    try {
      await onAddTask({ time, place, plan });
    } catch {
      return;
    }
    setDraft({ time: '', place: '', plan: '' });
    setFormOpen(false);
  }

  const visibleTasks = tasks.filter((task) => {
    if (filter === 'done') return task.done;
    if (filter === 'confirmed') return !task.done && task.confirmedByA && task.confirmedByB;
    if (filter === 'pending') return !task.done && !(task.confirmedByA && task.confirmedByB);
    return !task.done;
  });

  return (
    <aside className="planner-drawer" aria-label="两个人的待办">
      <div className="planner-drawer-header">
        <div className="planner-avatar-pair" aria-hidden="true">
          <span>{selfLabel}</span>
          <span>{contactLabel}</span>
        </div>
        <div className="planner-drawer-title">
          <h2>一起计划</h2>
          <p>
            共 {tasks.length} 个，已完成 {completedCount} 个，未完成 {activeCount} 个，其中 {pendingConfirmCount} 个待确认
          </p>
        </div>
        {onClose && (
          <button type="button" className="planner-close-button" onClick={onClose} aria-label="收回待办">
            收回
          </button>
        )}
      </div>

      <div className="planner-drawer-controls">
        <button type="button" className="planner-add-toggle" onClick={() => setFormOpen((open) => !open)}>
          {formOpen ? '收起添加' : '+ 添加计划'}
        </button>
        {formOpen && (
          <form className="planner-drawer-form" onSubmit={submitTask}>
            <input
              value={draft.time}
              onChange={(event) => setDraft({ ...draft, time: event.target.value })}
              placeholder="时间"
            />
            <input
              className={ui.input}
              value={draft.place}
              onChange={(event) => setDraft({ ...draft, place: event.target.value })}
              placeholder="地点"
            />
            <input
              className="planner-drawer-plan"
              value={draft.plan}
              onChange={(event) => setDraft({ ...draft, plan: event.target.value })}
              placeholder="写下要一起做的事"
            />
            <button type="submit">添加</button>
          </form>
        )}
      </div>

      <div className="planner-filter-tabs" aria-label="待办筛选">
        {[
          { value: 'active', label: '未完成' },
          { value: 'pending', label: '待确认' },
          { value: 'confirmed', label: '已确认' },
          { value: 'done', label: '已完成' }
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            className={filter === option.value ? 'active' : ''}
            onClick={() => setFilter(option.value)}
            aria-pressed={filter === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="planner-drawer-list">
        {visibleTasks.map((task) => {
          const confirmed = task.confirmedByA && task.confirmedByB;
          const expanded = expandedTaskId === task.id;
          return (
            <article className={cls('planner-mini-task', task.done && 'done')} key={task.id}>
              <div className="planner-mini-main">
                <input
                  type="checkbox"
                  checked={task.done}
                  onChange={(event) => onUpdateTask(task.id, { done: event.target.checked })}
                  aria-label={task.done ? '标记未完成' : '标记完成'}
                />
                <button type="button" onClick={() => setExpandedTaskId(expanded ? null : task.id)}>
                  <strong>{task.plan || '未填写计划'}</strong>
                  <em>
                    {task.time || '未填写时间'} · {task.place || '未填写地点'} · {confirmed ? '双方已确认' : '待确认'}
                  </em>
                </button>
              </div>

              {expanded && (
                <div className="planner-mini-actions" aria-label="双方确认">
                  <button
                    type="button"
                    className={task.confirmedByA ? 'active' : ''}
                    onClick={() => onUpdateTask(task.id, { confirmedByA: !task.confirmedByA })}
                  >
                    你确认
                  </button>
                  <button
                    type="button"
                    className={task.confirmedByB ? 'active' : ''}
                    disabled
                  >
                    Ta 确认
                  </button>
                  <button type="button" className="planner-delete-button" onClick={() => onDeleteTask(task.id)}>
                    删除
                  </button>
                </div>
              )}
            </article>
          );
        })}
        {visibleTasks.length === 0 && (
          <div className="planner-drawer-empty">
            {tasks.length === 0 ? '还没有计划。' : '当前筛选下没有计划。'}
          </div>
        )}
      </div>
    </aside>
  );
}

function renderTwemojiText(text) {
  if (!text) return '';
  const nodes = [];
  let lastIndex = 0;
  for (const match of text.matchAll(emojiMatcher)) {
    const emoji = match[0];
    const index = match.index || 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));
    nodes.push(<Twemoji key={`${index}-${emoji}`} emoji={emoji} />);
    lastIndex = index + emoji.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

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
      localStorage.setItem('doolulu.token', data.token);
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
          <div className="brand-mark" aria-hidden="true">d</div>
          <div>
            <h1>doolulu</h1>
            <p>多人联系人私聊</p>
          </div>
        </div>

        <div className="mode-tabs" role="tablist" aria-label="登录或注册">
          {[
            { value: 'login', label: '登录' },
            { value: 'register', label: '注册' }
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              className={mode === option.value ? 'active' : ''}
              onClick={() => setMode(option.value)}
              role="tab"
              aria-selected={mode === option.value}
            >
              {option.label}
            </button>
          ))}
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
          <button type="submit" className="primary-button" disabled={busy}>
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
  onDeleteContact,
  self,
  bubbleTheme,
  bubblePresets,
  onBubbleThemeChange,
  onUpdateProfile,
  onUpdateBio,
  onUpdateAvatar,
  onLogout,
  onDeleteAccount
}) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [displayName, setDisplayName] = useState(self.displayName);
  const [bio, setBio] = useState(self.bio || '');
  const [profileError, setProfileError] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);

  useEffect(() => {
    setDisplayName(self.displayName);
  }, [self.displayName]);

  useEffect(() => {
    setBio(self.bio || '');
  }, [self.bio]);

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

  async function deleteContact(event, contact) {
    event.stopPropagation();
    const ok = window.confirm(`确定删除 ${contact.displayName} 吗？`);
    if (!ok) return;
    setDeletingId(contact.id);
    setError('');
    try {
      await onDeleteContact(contact);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId('');
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

  async function saveBio() {
    if (profileBusy) return;
    const nextBio = bio.trim();
    if (nextBio === (self.bio || '')) {
      setEditingBio(false);
      setBio(self.bio || '');
      return;
    }
    if (nextBio.length > 120) {
      setProfileError('个人简介最多 120 个字符');
      return;
    }
    setProfileBusy(true);
    setProfileError('');
    try {
      await onUpdateBio(nextBio);
      setEditingBio(false);
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
              <Input
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
      <section className={`profile-bio ${editingBio ? 'editing' : ''}`} aria-label="个人简介">
        {editingBio ? (
          <Textarea
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            onBlur={saveBio}
            maxLength={120}
            placeholder="写一句介绍自己的话"
            disabled={profileBusy}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className={`profile-bio-display ${self.bio ? '' : 'empty'}`}
            onClick={() => setEditingBio(true)}
            disabled={profileBusy}
          >
            {self.bio || '点击这里，填写简介'}
          </button>
        )}
      </section>
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
        <Input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="输入用户名添加联系人"
        />
        <Button type="submit" title="添加联系人" disabled={busy} className="h-10 px-0">+</Button>
      </form>
      {error && <div className="inline-error">{error}</div>}

      <div className="contact-title">联系人</div>
      <div className="contact-list">
        {contacts.length === 0 && <div className="empty-list">暂无联系人</div>}
        {contacts.map((contact) => (
          <div
            key={contact.id}
            className={`contact-item ${selectedId === contact.id ? 'selected' : ''}`}
          >
            <button
              type="button"
              className="contact-select"
              onClick={() => onSelect(contact)}
            >
              <Avatar user={contact} size="small" />
              <div className="contact-copy">
                <strong>{contact.displayName}</strong>
                <span>{contact.lastMessage || `@${contact.username}`}</span>
              </div>
              {contact.unreadCount > 0 && <span className="unread-badge">{contact.unreadCount > 99 ? '99+' : contact.unreadCount}</span>}
            </button>
            <button
              type="button"
              className="contact-delete"
              onClick={(event) => deleteContact(event, contact)}
              disabled={deletingId === contact.id}
              title="删除联系人"
              aria-label={`删除 ${contact.displayName}`}
            >
              x
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

function ChatWindow({
  contact,
  messages,
  self,
  stickers,
  bubblePresets,
  hasOlderMessages,
  loadingOlderMessages,
  onLoadOlderMessages,
  onSend,
  onSendSticker,
  onAddSticker,
  onDeleteStickers,
  onRecall,
  onBack
}) {
  const [text, setText] = useState('');
  const [quote, setQuote] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [stickerBusy, setStickerBusy] = useState(false);
  const [stickerManage, setStickerManage] = useState(false);
  const [selectedStickerIds, setSelectedStickerIds] = useState([]);
  const [savingStickerMessageIds, setSavingStickerMessageIds] = useState([]);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState('chat');
  const [plannerTasks, setPlannerTasks] = useState([]);
  const bottomRef = useRef(null);
  const streamRef = useRef(null);
  const textareaRef = useRef(null);
  const messageRefs = useRef(new Map());
  const isNearBottomRef = useRef(true);
  const previousContactIdRef = useRef(null);
  const pendingScrollToBottomRef = useRef(false);
  const previousMessagesRef = useRef([]);
  const preserveScrollRef = useRef(null);

  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const previousMessages = previousMessagesRef.current;
    const contactChanged = previousContactIdRef.current !== contact?.id;
    const firstChanged = previousMessages[0]?.id !== messages[0]?.id;
    const lastChanged = previousMessages.at(-1)?.id !== messages.at(-1)?.id;
    const prependedHistory = !contactChanged && firstChanged && previousMessages.length > 0 && messages.at(-1)?.id === previousMessages.at(-1)?.id;

    if (prependedHistory && preserveScrollRef.current) {
      const { scrollHeight, scrollTop } = preserveScrollRef.current;
      stream.scrollTop = stream.scrollHeight - scrollHeight + scrollTop;
    } else if (contactChanged || previousMessages.length === 0) {
      stream.scrollTop = stream.scrollHeight;
      isNearBottomRef.current = true;
    } else if (pendingScrollToBottomRef.current || (lastChanged && isNearBottomRef.current)) {
      stream.scrollTop = stream.scrollHeight;
    }

    previousContactIdRef.current = contact?.id || null;
    previousMessagesRef.current = messages;
    pendingScrollToBottomRef.current = false;
    preserveScrollRef.current = null;
  }, [messages, contact?.id]);

  useEffect(() => {
    setQuote(null);
    setProfileOpen(false);
    setMobilePane('chat');
  }, [contact?.id]);

  useEffect(() => {
    if (!stickerOpen) {
      setStickerManage(false);
      setSelectedStickerIds([]);
    }
  }, [stickerOpen]);

  useEffect(() => {
    setEmojiOpen(false);
    setStickerOpen(false);
  }, [contact?.id]);

  useEffect(() => {
    if (!contact || !self) {
      setPlannerTasks([]);
      return;
    }
    let active = true;
    setPlannerTasks([]);
    api.plannerTasks(contact.id)
      .then((data) => {
        if (active) setPlannerTasks(data.tasks);
      })
      .catch((err) => {
        if (active) alert(err.message);
      });
    return () => {
      active = false;
    };
  }, [contact?.id, self?.id]);

  function replacePlannerTask(task) {
    setPlannerTasks((current) => current.map((item) => (item.id === task.id ? task : item)));
  }

  async function addPlannerTask(task) {
    if (!contact) return;
    try {
      const data = await api.addPlannerTask(contact.id, task);
      setPlannerTasks((current) => [data.task, ...current.filter((item) => item.id !== data.task.id)]);
      setPlannerOpen(true);
      setMobilePane('planner');
    } catch (err) {
      alert(err.message);
      throw err;
    }
  }

  async function updatePlannerTask(taskId, patch) {
    try {
      if (Object.hasOwn(patch, 'confirmedByA')) {
        const data = await api.confirmPlannerTask(taskId, patch.confirmedByA);
        replacePlannerTask(data.task);
        return;
      }
      const data = await api.updatePlannerTask(taskId, patch);
      replacePlannerTask(data.task);
    } catch (err) {
      alert(err.message);
    }
  }

  async function deletePlannerTask(taskId) {
    try {
      await api.deletePlannerTask(taskId);
      setPlannerTasks((current) => current.filter((task) => task.id !== taskId));
    } catch (err) {
      alert(err.message);
    }
  }

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

  function insertEmoji(emoji) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? text.length;
    const nextText = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    const nextPosition = start + emoji.length;
    setText(nextText);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextPosition, nextPosition);
    });
  }

  function updateScrollPosition(event) {
    const node = event.currentTarget;
    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    isNearBottomRef.current = distanceToBottom < 80;
    if (node.scrollTop < 80 && hasOlderMessages && !loadingOlderMessages) {
      preserveScrollRef.current = {
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop
      };
      onLoadOlderMessages?.();
    }
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
            <img src={quoted.sticker.imageDataUrl} alt="表情包" />
          </span>
        ) : (
          <span>{renderTwemojiText(quoted.text)}</span>
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
        <div className="empty-orbit">聊</div>
        <h2>选择一个联系人开始聊天</h2>
        <p>添加用户后即可发送私聊消息，聊天记录会保存在后台文件中。</p>
      </section>
    );
  }

  const activePlannerCount = plannerTasks.filter((task) => !task.done).length;
  function closePlanner() {
    setPlannerOpen(false);
    setMobilePane('chat');
  }

  function renderPlanner() {
    return (
      <CouplePlannerPanel
        tasks={plannerTasks}
        selfLabel="你"
        contactLabel={contact.displayName.slice(0, 1) || 'Ta'}
        onAddTask={addPlannerTask}
        onUpdateTask={updatePlannerTask}
        onDeleteTask={deletePlannerTask}
        onClose={closePlanner}
      />
    );
  }

  return (
    <section className={`chat-panel ${plannerOpen ? 'planner-open' : ''}`}>
      <div className={`chat-core ${mobilePane === 'planner' ? 'mobile-planner-active' : ''}`}>
        <header className="chat-header">
          <button type="button" className="mobile-back-button" onClick={onBack} aria-label="返回联系人">
            返回
          </button>
          <button type="button" className="chat-profile-button" onClick={() => setProfileOpen(true)} aria-label="查看联系人简介">
            <Avatar user={contact} />
          </button>
          <div className="chat-header-copy">
            <h2>{contact.displayName}</h2>
            <span>@{contact.username}</span>
          </div>
          <button
            type="button"
            className={`planner-header-button ${plannerOpen ? 'active' : ''}`}
            onClick={() => {
              setPlannerOpen((open) => !open);
              setMobilePane('planner');
            }}
          >
            待办 {activePlannerCount}
          </button>
        </header>
        {profileOpen && (
          <div className="profile-dialog-backdrop" role="presentation" onClick={() => setProfileOpen(false)}>
            <section
              className="contact-profile-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="联系人资料"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="contact-profile-head">
                <Avatar user={contact} />
                <div>
                  <h3>{contact.displayName}</h3>
                  <span>@{contact.username}</span>
                </div>
              </div>
              <div className="contact-profile-bio">
                <span>个人简介</span>
                <p>{contact.bio || '还没有填写简介'}</p>
              </div>
              <button type="button" onClick={() => setProfileOpen(false)}>关闭</button>
            </section>
          </div>
        )}

        <div className="mobile-chat-tabs" aria-label="聊天视图切换">
          <button type="button" className={mobilePane === 'chat' ? 'active' : ''} onClick={() => setMobilePane('chat')}>
            聊天
          </button>
          <button
            type="button"
            className={mobilePane === 'planner' ? 'active' : ''}
            onClick={() => {
              setPlannerOpen(true);
              setMobilePane('planner');
            }}
          >
            待办 {activePlannerCount}
          </button>
        </div>

        <div className="chat-mobile-planner">{renderPlanner()}</div>

        <div className="message-stream" ref={streamRef} onScroll={updateScrollPosition} onWheel={handleWheel}>
          {(hasOlderMessages || loadingOlderMessages) && (
            <div className="message-history-loader">
              {loadingOlderMessages ? '正在加载更早消息...' : '向上滚动加载更早消息'}
            </div>
          )}
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
                          <p>{renderTwemojiText(message.text)}</p>
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
            <div className="composer-input-box">
              <Textarea
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
                <button
                  type="button"
                  className={emojiOpen ? 'active' : ''}
                  onClick={() => {
                    setEmojiOpen((open) => !open);
                    setStickerOpen(false);
                  }}
                  title="Emoji"
                >
                  <Twemoji emoji="😀" className="toolbar-icon" />
                </button>
                <button
                  type="button"
                  className={stickerOpen ? 'active' : ''}
                  onClick={() => {
                    setStickerOpen((open) => !open);
                    setEmojiOpen(false);
                  }}
                  title="表情包"
                >
                  <Twemoji emoji="❤️" className="toolbar-icon" />
                </button>
              </div>
            </div>
          </div>
          <Button type="submit" variant="primary" className="send-button" title="发送消息">发送</Button>
          {emojiOpen && (
            <div className="emoji-panel">
              {emojiGroups.map((group) => (
                <section className="emoji-group" key={group.id}>
                  <h3>{group.name}</h3>
                  <div className="emoji-grid">
                    {group.items.map((emoji) => (
                      <button type="button" key={emoji} onClick={() => insertEmoji(emoji)} title={emoji}>
                        <Twemoji emoji={emoji} className="emoji-option" />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
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
      </div>
      <div className="chat-desktop-planner">{renderPlanner()}</div>
    </section>
  );
}

function formatAdminDate(value, emptyText = '未知') {
  if (!value) return emptyText;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function AdminPanel({ self, onLogout }) {
  const [users, setUsers] = useState([]);
  const [passwords, setPasswords] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadUsers() {
    const data = await api.adminUsers();
    setUsers(data.users);
  }

  useEffect(() => {
    loadUsers()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function resetPassword(target) {
    const password = String(passwords[target.id] || '');
    if (password.length < 6) {
      setError('密码至少 6 位');
      return;
    }
    setBusyId(target.id);
    setError('');
    setNotice('');
    try {
      await api.adminResetPassword(target.id, password);
      setPasswords((current) => ({ ...current, [target.id]: '' }));
      setNotice(`已重置 ${target.displayName} 的密码`);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  async function cleanupUser(target) {
    const ok = window.confirm(`确定清理 ${target.displayName} 的所有数据吗？该操作会永久删除账号、联系人、消息和表情包。`);
    if (!ok) return;
    setBusyId(target.id);
    setError('');
    setNotice('');
    try {
      await api.adminCleanupUserData(target.id);
      setNotice(`已清理 ${target.displayName} 的所有数据`);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">管</div>
          <div>
            <h1>管理员</h1>
            <p>@{self.username}</p>
          </div>
        </div>
        <div className="admin-actions">
          <button type="button" onClick={() => loadUsers().catch((err) => setError(err.message))} disabled={Boolean(busyId)}>
            刷新
          </button>
          <button type="button" onClick={onLogout}>退出</button>
        </div>
      </header>

      <section className="admin-panel">
        {error && <div className="inline-error">{error}</div>}
        {notice && <div className="success-line">{notice}</div>}
        {loading ? (
          <div className="empty-list">正在加载用户...</div>
        ) : (
          <div className="admin-user-list">
            {users.map((target) => {
              const disabled = Boolean(target.disabledAt);
              const busy = busyId === target.id;
              return (
                <article className={`admin-user ${disabled ? 'disabled' : ''}`} key={target.id}>
                  <div className="admin-user-main">
                    <Avatar user={target} size="small" />
                    <div>
                      <strong>{target.displayName}</strong>
                      <span>@{target.deletedUsername || target.username}</span>
                    </div>
                  </div>
                  <div className="admin-user-meta">
                    <span>{target.isAdmin ? '管理员' : disabled ? '已注销' : '正常'}</span>
                    <span>消息 {target.messageCount}</span>
                    <span>联系人 {target.contactCount}</span>
                    <span>表情 {target.stickerCount}</span>
                  </div>
                  <div className="admin-user-times">
                    <div>
                      <span>创建</span>
                      <time dateTime={target.createdAt || undefined}>{formatAdminDate(target.createdAt)}</time>
                    </div>
                    <div>
                      <span>登录</span>
                      {target.lastLoginAt ? (
                        <time dateTime={target.lastLoginAt}>{formatAdminDate(target.lastLoginAt)}</time>
                      ) : (
                        <em>{formatAdminDate(target.lastLoginAt, '从未登录')}</em>
                      )}
                    </div>
                  </div>
                  <div className="admin-user-controls">
                    <Input
                      type="password"
                      value={passwords[target.id] || ''}
                      onChange={(event) => setPasswords({ ...passwords, [target.id]: event.target.value })}
                      placeholder="新密码"
                      disabled={disabled || busy}
                    />
                    <button type="button" onClick={() => resetPassword(target)} disabled={disabled || busy}>
                      重置密码
                    </button>
                    <button
                      type="button"
                      className="danger-link"
                      onClick={() => cleanupUser(target)}
                      disabled={!disabled || target.isAdmin || busy}
                    >
                      清理数据
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [stickers, setStickers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const selectedId = selected?.id;
  const messagesRef = useRef([]);
  const loadingOlderMessagesRef = useRef(false);
  const hasOlderMessagesRef = useRef(false);
  const originalTitleRef = useRef('doolulu');
  const isMobileShell = useMobileShell();

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    loadingOlderMessagesRef.current = loadingOlderMessages;
  }, [loadingOlderMessages]);

  useEffect(() => {
    hasOlderMessagesRef.current = hasOlderMessages;
  }, [hasOlderMessages]);

  function clearSession() {
    localStorage.removeItem('doolulu.token');
    setUser(null);
    setSelected(null);
    setMessages([]);
    setHasOlderMessages(false);
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

  function mergeMessages(current, incoming) {
    const byId = new Map(current.map((message) => [message.id, message]));
    for (const message of incoming) byId.set(message.id, message);
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async function loadLatestMessages(contactId = selectedId) {
    if (!contactId) return;
    const data = await api.messages(contactId, { limit: messagePageSize });
    setMessages(data.messages);
    setHasOlderMessages(Boolean(data.hasMore));
  }

  async function refreshNewMessages(contactId = selectedId) {
    if (!contactId) return;
    const current = messagesRef.current;
    if (current.length === 0) {
      await loadLatestMessages(contactId);
      return;
    }
    const newest = current.at(-1);
    const data = await api.messages(contactId, { after: newest.createdAt, limit: messagePageSize });
    if (data.messages.length > 0) {
      setMessages((items) => mergeMessages(items, data.messages));
      return;
    }

    const latest = await api.messages(contactId, { limit: Math.min(Math.max(current.length, messagePageSize), 100) });
    if (latest.messages.length > 0) {
      setMessages((items) => mergeMessages(items, latest.messages));
    }
  }

  async function loadOlderMessages(contactId = selectedId) {
    if (!contactId || loadingOlderMessagesRef.current || !hasOlderMessagesRef.current) return;
    const oldest = messagesRef.current[0];
    if (!oldest) return;
    loadingOlderMessagesRef.current = true;
    setLoadingOlderMessages(true);
    try {
      const data = await api.messages(contactId, { before: oldest.createdAt, limit: messagePageSize });
      setMessages((items) => mergeMessages(data.messages, items));
      setHasOlderMessages(Boolean(data.hasMore));
    } finally {
      loadingOlderMessagesRef.current = false;
      setLoadingOlderMessages(false);
    }
  }

  async function refreshMessages(contactId = selectedId) {
    await loadLatestMessages(contactId);
  }

  function upsertMessages(incoming) {
    const items = Array.isArray(incoming) ? incoming : [incoming];
    setMessages((current) => mergeMessages(current, items));
  }

  function markMessagesReadLocally(contactId, readAt) {
    if (!readAt) return;
    setMessages((items) =>
      items.map((message) =>
        message.toId === user.id && !message.readAt
          ? { ...message, readAt }
          : message
      )
    );
  }

  function selectContact(contact) {
    setMessages([]);
    setHasOlderMessages(false);
    setLoadingOlderMessages(false);
    messagesRef.current = [];
    setSelected(contact);
  }

  async function markSelectedRead(contactId = selectedId) {
    if (!contactId) return;
    const data = await api.markRead(contactId);
    markMessagesReadLocally(contactId, data.readAt);
    await refreshContacts();
  }

  async function refreshStickers() {
    const data = await api.stickers();
    setStickers(data.stickers);
  }

  useEffect(() => {
    const token = localStorage.getItem('doolulu.token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((data) => setUser(data.user))
      .catch(() => localStorage.removeItem('doolulu.token'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    originalTitleRef.current = document.title;
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
      setHasOlderMessages(false);
      return;
    }
    setMessages([]);
    setHasOlderMessages(false);
    loadLatestMessages(selectedId).catch(console.error);
    const timer = setInterval(() => {
      refreshNewMessages(selectedId).catch(console.error);
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
    return <div className="loading-screen">正在加载 doolulu...</div>;
  }

  if (!user) {
    return <AuthPanel onLogin={setUser} />;
  }

  if (user.isAdmin) {
    return <AdminPanel self={user} onLogout={clearSession} />;
  }

  const hideEmptyChatOnMobile = !selected && isMobileShell;

  return (
    <main className={`app-shell ${selected ? 'mobile-chat-selected' : 'mobile-contact-selected'} ${hideEmptyChatOnMobile ? 'mobile-empty-chat' : ''}`}>
      <ContactList
        contacts={sortedContacts}
        selectedId={selectedId}
        onSelect={selectContact}
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
        onUpdateBio={async (bio) => {
          const data = await api.updateBio(bio);
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
        onDeleteContact={async (contact) => {
          await api.deleteContact(contact.id);
          if (selectedId === contact.id) {
            setSelected(null);
            setMessages([]);
            setHasOlderMessages(false);
          }
          await refreshContacts();
        }}
      />
      {!hideEmptyChatOnMobile && (
        <ChatWindow
          contact={selected}
          messages={messages}
          self={user}
          stickers={stickers}
          bubblePresets={bubblePresets}
          hasOlderMessages={hasOlderMessages}
          loadingOlderMessages={loadingOlderMessages}
          onLoadOlderMessages={() => loadOlderMessages(selected.id).catch(console.error)}
          onSend={async (text, quoteId) => {
            const data = await api.sendQuotedMessage(selected.id, text, quoteId);
            upsertMessages(data.message);
            await refreshContacts();
          }}
          onSendSticker={async (stickerId, quoteId) => {
            const data = await api.sendSticker(selected.id, stickerId, quoteId);
            upsertMessages(data.message);
            await refreshContacts();
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
            const data = await api.recallMessage(messageId);
            upsertMessages(data.message);
            await refreshContacts();
          }}
          onBack={() => setSelected(null)}
        />
      )}
    </main>
  );
}
