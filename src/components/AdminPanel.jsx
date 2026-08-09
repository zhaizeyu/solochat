'use client';

import { useEffect, useMemo, useState } from 'react';
import { Input } from '../../components/ui/input.jsx';
import { api } from '../api/client.js';
import { Avatar } from './Avatar.jsx';

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

function adminDayStart(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function adminDayEnd(value) {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseAdminCount(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

const emptyAdminFilters = {
  status: 'all',
  createdFrom: '',
  createdTo: '',
  loginFrom: '',
  loginTo: '',
  loginNever: false,
  messageMin: '',
  messageMax: '',
  query: ''
};

function filterAdminUsers(users, filters) {
  const createdFrom = adminDayStart(filters.createdFrom);
  const createdTo = adminDayEnd(filters.createdTo);
  const loginFrom = adminDayStart(filters.loginFrom);
  const loginTo = adminDayEnd(filters.loginTo);
  const messageMin = parseAdminCount(filters.messageMin);
  const messageMax = parseAdminCount(filters.messageMax);
  const query = String(filters.query || '').trim().toLowerCase();

  return users.filter((target) => {
    const disabled = Boolean(target.disabledAt);
    if (filters.status === 'active' && disabled) return false;
    if (filters.status === 'disabled' && !disabled) return false;
    if (filters.status === 'admin' && !target.isAdmin) return false;

    if (query) {
      const haystack = [
        target.displayName,
        target.username,
        target.deletedUsername
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    if (createdFrom || createdTo) {
      const createdAt = target.createdAt ? new Date(target.createdAt) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
      if (createdFrom && createdAt < createdFrom) return false;
      if (createdTo && createdAt > createdTo) return false;
    }

    const lastLoginAt = target.lastLoginAt ? new Date(target.lastLoginAt) : null;
    const hasLogin = Boolean(lastLoginAt && !Number.isNaN(lastLoginAt.getTime()));
    if (filters.loginNever) {
      if (hasLogin) return false;
    } else if (loginFrom || loginTo) {
      if (!hasLogin) return false;
      if (loginFrom && lastLoginAt < loginFrom) return false;
      if (loginTo && lastLoginAt > loginTo) return false;
    }

    const messageCount = Number(target.messageCount) || 0;
    if (messageMin != null && messageCount < messageMin) return false;
    if (messageMax != null && messageCount > messageMax) return false;
    return true;
  });
}

function toLocalDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function computeAdminUserStats(users) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOf7d = new Date(startOfToday);
  startOf7d.setDate(startOf7d.getDate() - 6);
  const startOf30d = new Date(startOfToday);
  startOf30d.setDate(startOf30d.getDate() - 29);

  let active = 0;
  let disabled = 0;
  let admins = 0;
  let neverLogin = 0;
  let createdToday = 0;
  let created7d = 0;
  let created30d = 0;

  for (const target of users) {
    if (target.disabledAt) disabled += 1;
    else active += 1;
    if (target.isAdmin) admins += 1;
    if (!target.lastLoginAt) neverLogin += 1;

    const createdAt = target.createdAt ? new Date(target.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) continue;
    if (createdAt >= startOfToday) createdToday += 1;
    if (createdAt >= startOf7d) created7d += 1;
    if (createdAt >= startOf30d) created30d += 1;
  }

  return {
    total: users.length,
    active,
    disabled,
    admins,
    neverLogin,
    createdToday,
    created7d,
    created30d,
    today: toLocalDateInput(startOfToday),
    weekFrom: toLocalDateInput(startOf7d),
    monthFrom: toLocalDateInput(startOf30d)
  };
}

function AdminPanel({ self, onLogout }) {
  const [users, setUsers] = useState([]);
  const [passwords, setPasswords] = useState({});
  const [filters, setFilters] = useState(emptyAdminFilters);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const filteredUsers = useMemo(() => filterAdminUsers(users, filters), [users, filters]);
  const stats = useMemo(() => computeAdminUserStats(users), [users]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyStatFilter(preset) {
    if (preset === 'all') {
      setFilters(emptyAdminFilters);
      return;
    }
    if (preset === 'active') {
      setFilters({ ...emptyAdminFilters, status: 'active' });
      return;
    }
    if (preset === 'disabled') {
      setFilters({ ...emptyAdminFilters, status: 'disabled' });
      return;
    }
    if (preset === 'admin') {
      setFilters({ ...emptyAdminFilters, status: 'admin' });
      return;
    }
    if (preset === 'neverLogin') {
      setFilters({ ...emptyAdminFilters, loginNever: true });
      return;
    }
    if (preset === 'today') {
      setFilters({ ...emptyAdminFilters, createdFrom: stats.today, createdTo: stats.today });
      return;
    }
    if (preset === 'week') {
      setFilters({ ...emptyAdminFilters, createdFrom: stats.weekFrom, createdTo: stats.today });
      return;
    }
    if (preset === 'month') {
      setFilters({ ...emptyAdminFilters, createdFrom: stats.monthFrom, createdTo: stats.today });
    }
  }

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
    const ok = window.confirm(
      `确定重置 ${target.displayName} 的登录密码吗？\n\n注意：若对方开通过安全聊天，旧的加密消息仍需用「原来的登录密码」才能打开。重置后对方所有已登录设备会退出。`
    );
    if (!ok) return;
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
        <div className="admin-stats" aria-label="用户数统计">
          {[
            { key: 'all', label: '全部用户', value: stats.total },
            { key: 'active', label: '正常', value: stats.active },
            { key: 'disabled', label: '已注销', value: stats.disabled },
            { key: 'admin', label: '管理员', value: stats.admins },
            { key: 'neverLogin', label: '从未登录', value: stats.neverLogin },
            { key: 'today', label: '今日新增', value: stats.createdToday },
            { key: 'week', label: '近 7 日新增', value: stats.created7d },
            { key: 'month', label: '近 30 日新增', value: stats.created30d }
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              className="admin-stat"
              onClick={() => applyStatFilter(item.key)}
              disabled={loading}
              title="点击按此项筛选列表"
            >
              <strong>{loading ? '—' : item.value}</strong>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <form
          className="admin-filters"
          onSubmit={(event) => event.preventDefault()}
        >
          <label>
            <span>搜索</span>
            <Input
              value={filters.query}
              onChange={(event) => updateFilter('query', event.target.value)}
              placeholder="用户名 / 昵称"
            />
          </label>
          <label>
            <span>状态</span>
            <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
              <option value="all">全部</option>
              <option value="active">正常</option>
              <option value="disabled">已注销</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <label>
            <span>创建起</span>
            <Input
              type="date"
              value={filters.createdFrom}
              onChange={(event) => updateFilter('createdFrom', event.target.value)}
            />
          </label>
          <label>
            <span>创建止</span>
            <Input
              type="date"
              value={filters.createdTo}
              onChange={(event) => updateFilter('createdTo', event.target.value)}
            />
          </label>
          <label>
            <span>登录起</span>
            <Input
              type="date"
              value={filters.loginFrom}
              onChange={(event) => updateFilter('loginFrom', event.target.value)}
              disabled={filters.loginNever}
            />
          </label>
          <label>
            <span>登录止</span>
            <Input
              type="date"
              value={filters.loginTo}
              onChange={(event) => updateFilter('loginTo', event.target.value)}
              disabled={filters.loginNever}
            />
          </label>
          <label className="admin-filter-check">
            <input
              type="checkbox"
              checked={filters.loginNever}
              onChange={(event) => updateFilter('loginNever', event.target.checked)}
            />
            <span>仅从未登录</span>
          </label>
          <label>
            <span>消息 ≥</span>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={filters.messageMin}
              onChange={(event) => updateFilter('messageMin', event.target.value)}
              placeholder="最小"
            />
          </label>
          <label>
            <span>消息 ≤</span>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={filters.messageMax}
              onChange={(event) => updateFilter('messageMax', event.target.value)}
              placeholder="最大"
            />
          </label>
          <div className="admin-filter-actions">
            <span className="admin-filter-count">
              {loading ? '加载中' : `显示 ${filteredUsers.length} / ${users.length}`}
            </span>
            <button type="button" onClick={() => setFilters(emptyAdminFilters)}>
              清空筛选
            </button>
          </div>
        </form>
        {loading ? (
          <div className="empty-list">正在加载用户...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="empty-list">没有符合条件的用户</div>
        ) : (
          <div className="admin-user-list">
            {filteredUsers.map((target) => {
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

export { AdminPanel };
