import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

const TWEMOJI_BASE_URL = '/twemoji';
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
const initialPlannerTasks = [
  { id: 1, time: '周五 19:30', place: '日料小馆', plan: '晚餐后去江边散步', confirmedByA: true, confirmedByB: false, done: false },
  { id: 2, time: '周六 下午', place: '家里', plan: '一起整理旅行清单', confirmedByA: false, confirmedByB: false, done: false }
];

function emojiToCodePoint(emoji) {
  return Array.from(emoji)
    .map((char) => char.codePointAt(0).toString(16))
    .filter((code) => code !== 'fe0f')
    .join('-');
}

function twemojiSrc(emoji) {
  return `${TWEMOJI_BASE_URL}/${emojiToCodePoint(emoji)}.svg`;
}

function Twemoji({ emoji, className = 'twemoji' }) {
  const [loaded, setLoaded] = useState(true);
  if (!loaded) {
    return (
      <span className={`${className} emoji-fallback`} role="img" aria-label={emoji}>
        {emoji}
      </span>
    );
  }
  return (
    <img
      className={className}
      src={twemojiSrc(emoji)}
      alt={emoji}
      draggable="false"
      onError={() => setLoaded(false)}
    />
  );
}

function CouplePlannerPreview() {
  const [tasks, setTasks] = useState(initialPlannerTasks);
  const [draft, setDraft] = useState({ time: '', place: '', plan: '' });
  const completedCount = tasks.filter((task) => task.done).length;

  function addTask(event) {
    event.preventDefault();
    const time = draft.time.trim();
    const place = draft.place.trim();
    const plan = draft.plan.trim();
    if (!time && !place && !plan) return;
    setTasks((current) => [
      {
        id: Date.now(),
        time,
        place,
        plan,
        confirmedByA: false,
        confirmedByB: false,
        done: false
      },
      ...current
    ]);
    setDraft({ time: '', place: '', plan: '' });
  }

  function updateTask(taskId, patch) {
    setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, ...patch } : task)));
  }

  function deleteTask(taskId) {
    setTasks((current) => current.filter((task) => task.id !== taskId));
  }

  return (
    <main className="planner-preview">
      <section className="planner-shell">
        <div className="planner-header">
          <div className="planner-avatar-pair" aria-hidden="true">
            <span>你</span>
            <span>Ta</span>
          </div>
          <div>
            <h1>两个人的 To Do List</h1>
            <p>
              共 {tasks.length} 个计划，已完成 {completedCount} 个
            </p>
          </div>
        </div>

        <form className="planner-form" onSubmit={addTask}>
          <label>
            时间
            <input
              value={draft.time}
              onChange={(event) => setDraft({ ...draft, time: event.target.value })}
              placeholder="例如：周五 19:30"
            />
          </label>
          <label>
            地点
            <input
              value={draft.place}
              onChange={(event) => setDraft({ ...draft, place: event.target.value })}
              placeholder="例如：家里 / 餐厅"
            />
          </label>
          <label className="planner-form-plan">
            计划
            <input
              value={draft.plan}
              onChange={(event) => setDraft({ ...draft, plan: event.target.value })}
              placeholder="写下要一起做的事"
            />
          </label>
          <button type="submit">添加</button>
        </form>

        <div className="planner-task-list">
          {tasks.map((task) => {
            const confirmed = task.confirmedByA && task.confirmedByB;
            return (
              <article className={`planner-task ${task.done ? 'done' : ''}`} key={task.id}>
                <label className="planner-check">
                  <input
                    type="checkbox"
                    checked={task.done}
                    onChange={(event) => updateTask(task.id, { done: event.target.checked })}
                  />
                  <span>{task.done ? '已完成' : '完成'}</span>
                </label>

                <div className="planner-task-main">
                  <h2>{task.plan || '未填写计划'}</h2>
                  <div className="planner-task-fields">
                    <span>{task.time || '未填写时间'}</span>
                    <span>{task.place || '未填写地点'}</span>
                  </div>
                </div>

                <div className="planner-confirm-actions" aria-label="双方确认">
                  <button
                    type="button"
                    className={task.confirmedByA ? 'active' : ''}
                    onClick={() => updateTask(task.id, { confirmedByA: !task.confirmedByA })}
                  >
                    你确认
                  </button>
                  <button
                    type="button"
                    className={task.confirmedByB ? 'active' : ''}
                    onClick={() => updateTask(task.id, { confirmedByB: !task.confirmedByB })}
                  >
                    Ta 确认
                  </button>
                  <button
                    type="button"
                    className="planner-delete-button"
                    onClick={() => deleteTask(task.id)}
                  >
                    删除
                  </button>
                  <strong className={confirmed ? 'ready' : ''}>{confirmed ? '双方已确认' : '待确认'}</strong>
                </div>
              </article>
            );
          })}
          {tasks.length === 0 && <div className="planner-empty">还没有计划。</div>}
        </div>
      </section>
    </main>
  );
}

function CouplePlannerPanel({ tasks, selfLabel = '你', contactLabel = 'Ta', onAddTask, onUpdateTask, onDeleteTask }) {
  const [draft, setDraft] = useState({ time: '', place: '', plan: '' });
  const [formOpen, setFormOpen] = useState(false);
  const [filter, setFilter] = useState('active');
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const completedCount = tasks.filter((task) => task.done).length;
  const activeCount = tasks.length - completedCount;
  const pendingConfirmCount = tasks.filter((task) => !task.done && !(task.confirmedByA && task.confirmedByB)).length;

  function submitTask(event) {
    event.preventDefault();
    const time = draft.time.trim();
    const place = draft.place.trim();
    const plan = draft.plan.trim();
    if (!time && !place && !plan) return;
    onAddTask({ time, place, plan });
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
        <div>
          <h2>一起计划</h2>
          <p>
            共 {tasks.length} 个，未完成 {activeCount} 个，待确认 {pendingConfirmCount} 个
          </p>
        </div>
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
        <button type="button" className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>
          未完成
        </button>
        <button type="button" className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>
          待确认
        </button>
        <button type="button" className={filter === 'confirmed' ? 'active' : ''} onClick={() => setFilter('confirmed')}>
          已确认
        </button>
        <button type="button" className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>
          已完成
        </button>
      </div>

      <div className="planner-drawer-list">
        {visibleTasks.map((task) => {
          const confirmed = task.confirmedByA && task.confirmedByB;
          const expanded = expandedTaskId === task.id;
          return (
            <article className={`planner-mini-task ${task.done ? 'done' : ''}`} key={task.id}>
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
                    onClick={() => onUpdateTask(task.id, { confirmedByB: !task.confirmedByB })}
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
          <img className="brand-mark" src="/logo.jpg" alt="" />
          <div>
            <h1>doolulu</h1>
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
  onRecall
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
    const saved = localStorage.getItem(`doolulu.planner.${self.id}.${contact.id}`);
    if (!saved) {
      setPlannerTasks([]);
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      setPlannerTasks(Array.isArray(parsed) ? parsed : []);
    } catch {
      setPlannerTasks([]);
    }
  }, [contact?.id, self?.id]);

  function savePlannerTasks(nextTasks) {
    if (!contact || !self) return;
    localStorage.setItem(`doolulu.planner.${self.id}.${contact.id}`, JSON.stringify(nextTasks));
  }

  function updatePlannerTasks(updater) {
    setPlannerTasks((current) => {
      const nextTasks = typeof updater === 'function' ? updater(current) : updater;
      savePlannerTasks(nextTasks);
      return nextTasks;
    });
  }

  function addPlannerTask(task) {
    updatePlannerTasks((current) => [
      {
        id: Date.now(),
        time: task.time,
        place: task.place,
        plan: task.plan,
        confirmedByA: false,
        confirmedByB: false,
        done: false
      },
      ...current
    ]);
    setPlannerOpen(true);
    setMobilePane('planner');
  }

  function updatePlannerTask(taskId, patch) {
    updatePlannerTasks((current) => current.map((task) => (task.id === taskId ? { ...task, ...patch } : task)));
  }

  function deletePlannerTask(taskId) {
    updatePlannerTasks((current) => current.filter((task) => task.id !== taskId));
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
            <img src={quoted.sticker.imageDataUrl} alt={quoted.sticker.name || '表情包'} />
            <span>{quoted.sticker.name || '表情包'}</span>
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
  function renderPlanner() {
    return (
      <CouplePlannerPanel
        tasks={plannerTasks}
        selfLabel="你"
        contactLabel={contact.displayName.slice(0, 1) || 'Ta'}
        onAddTask={addPlannerTask}
        onUpdateTask={updatePlannerTask}
        onDeleteTask={deletePlannerTask}
      />
    );
  }

  return (
    <section className={`chat-panel ${plannerOpen ? 'planner-open' : ''}`}>
      <div className={`chat-core ${mobilePane === 'planner' ? 'mobile-planner-active' : ''}`}>
        <header className="chat-header">
          <Avatar user={contact} />
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
          <button className="send-button" title="发送消息">发送</button>
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
          <img className="brand-mark" src="/logo.jpg" alt="" />
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
                  <div className="admin-user-controls">
                    <input
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

function App() {
  if (window.location.pathname === '/couple-planner') {
    return <CouplePlannerPreview />;
  }

  const [user, setUser] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [stickers, setStickers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const selectedId = selected?.id;
  const messagesRef = useRef([]);
  const loadingOlderMessagesRef = useRef(false);
  const hasOlderMessagesRef = useRef(false);
  const originalTitleRef = useRef(document.title);

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

  return (
    <main className="app-shell">
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
      />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
