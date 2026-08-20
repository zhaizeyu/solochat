'use client';

import { useState } from 'react';
import { api } from '../api/client.js';

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
          <div className="brand-mark" aria-hidden="true">D</div>
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


export { AuthPanel };
