'use client';

import { useEffect, useState } from 'react';
import { Input } from '../../components/ui/input.jsx';
import { Textarea } from '../../components/ui/textarea.jsx';
import { Avatar } from './Avatar.jsx';
import { Button } from '../lib/ui.jsx';
import { readImageFile } from '../lib/media.js';

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
  onChangePassword,
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

  async function changePassword() {
    if (!onChangePassword || profileBusy) return;
    setProfileBusy(true);
    setProfileError('');
    try {
      await onChangePassword();
    } catch (err) {
      if (err?.message) setProfileError(err.message);
    } finally {
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
        <button type="button" onClick={changePassword} disabled={profileBusy}>改密码</button>
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


export { ContactList };
