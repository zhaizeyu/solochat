'use client';

import { useState } from 'react';
import { cls } from '../lib/ui.jsx';
import { readMomentImageFile } from '../lib/media.js';
import { renderTwemojiText } from './Twemoji.jsx';

function CoupleMomentsPanel({ moments, self, contact, onAddMoment, onUpdateMoment, onDeleteMoment, onClose }) {
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState({ text: '', happenedAt: new Date().toISOString().slice(0, 10), imageDataUrl: '' });
  const [editingId, setEditingId] = useState('');
  const [expandedMomentId, setExpandedMomentId] = useState('');
  const [editDraft, setEditDraft] = useState({ text: '', happenedAt: '', imageDataUrl: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function chooseDraftImage(event, setter) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imageDataUrl = await readMomentImageFile(file);
      setter((current) => ({ ...current, imageDataUrl }));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitMoment(event) {
    event.preventDefault();
    const text = draft.text.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    try {
      await onAddMoment({
        text,
        happenedAt: draft.happenedAt,
        imageDataUrl: draft.imageDataUrl
      });
      setDraft({ text: '', happenedAt: new Date().toISOString().slice(0, 10), imageDataUrl: '' });
      setFormOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(moment) {
    setEditingId(moment.id);
    setExpandedMomentId(moment.id);
    setEditDraft({
      text: moment.text,
      happenedAt: moment.happenedAt || new Date().toISOString().slice(0, 10),
      imageDataUrl: moment.imageDataUrl || ''
    });
    setError('');
  }

  async function saveEdit(event) {
    event.preventDefault();
    const text = editDraft.text.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    try {
      await onUpdateMoment(editingId, {
        text,
        happenedAt: editDraft.happenedAt,
        imageDataUrl: editDraft.imageDataUrl
      });
      setEditingId('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeMoment(moment) {
    const ok = window.confirm('确定删除这条回忆吗？');
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await onDeleteMoment(moment.id);
      if (editingId === moment.id) setEditingId('');
      if (expandedMomentId === moment.id) setExpandedMomentId('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="planner-drawer moments-drawer" aria-label="两个人的回忆">
      <div className="planner-drawer-header">
        <div className="planner-avatar-pair" aria-hidden="true">
          <span>你</span>
          <span>{contact.displayName.slice(0, 1) || 'Ta'}</span>
        </div>
        <div className="planner-drawer-title">
          <h2>回忆</h2>
          <p>共 {moments.length} 条，由 {self.displayName} 和 {contact.displayName} 共同记录</p>
        </div>
        {onClose && (
          <button type="button" className="planner-close-button" onClick={onClose} aria-label="收回回忆">
            收回
          </button>
        )}
      </div>

      <div className="planner-drawer-controls">
        <button type="button" className="planner-add-toggle" onClick={() => setFormOpen((open) => !open)}>
          {formOpen ? '收起记录' : '+ 记录回忆'}
        </button>
        {formOpen && (
          <form className="moment-form" onSubmit={submitMoment}>
            <input
              type="date"
              value={draft.happenedAt}
              onChange={(event) => setDraft({ ...draft, happenedAt: event.target.value })}
            />
            <textarea
              value={draft.text}
              onChange={(event) => setDraft({ ...draft, text: event.target.value })}
              maxLength={1000}
              placeholder="写下这一天发生了什么"
            />
            {draft.imageDataUrl && (
              <div className="moment-preview">
                <img src={draft.imageDataUrl} alt="回忆预览" />
                <button type="button" onClick={() => setDraft({ ...draft, imageDataUrl: '' })}>移除图片</button>
              </div>
            )}
            <div className="moment-form-actions">
              <label>
                图片
                <input type="file" accept="image/*" onChange={(event) => chooseDraftImage(event, setDraft)} disabled={busy} />
              </label>
              <button type="submit" disabled={busy || !draft.text.trim()}>发布</button>
            </div>
          </form>
        )}
        {error && <div className="inline-error">{error}</div>}
      </div>

      <div className="planner-drawer-list moment-list">
        {moments.map((moment) => {
          const editing = editingId === moment.id;
          const expanded = expandedMomentId === moment.id;
          return (
            <article className={cls('moment-card', expanded && 'expanded')} key={moment.id}>
              {editing ? (
                <form className="moment-edit-form" onSubmit={saveEdit}>
                  <input
                    type="date"
                    value={editDraft.happenedAt}
                    onChange={(event) => setEditDraft({ ...editDraft, happenedAt: event.target.value })}
                  />
                  <textarea
                    value={editDraft.text}
                    onChange={(event) => setEditDraft({ ...editDraft, text: event.target.value })}
                    maxLength={1000}
                  />
                  {editDraft.imageDataUrl && (
                    <div className="moment-preview">
                      <img src={editDraft.imageDataUrl} alt="回忆预览" />
                      <button type="button" onClick={() => setEditDraft({ ...editDraft, imageDataUrl: '' })}>移除图片</button>
                    </div>
                  )}
                  <div className="moment-form-actions">
                    <label>
                      换图
                      <input type="file" accept="image/*" onChange={(event) => chooseDraftImage(event, setEditDraft)} disabled={busy} />
                    </label>
                    <button type="submit" disabled={busy || !editDraft.text.trim()}>保存</button>
                    <button type="button" onClick={() => setEditingId('')} disabled={busy}>取消</button>
                  </div>
                </form>
              ) : (
                <>
                  <div className={cls('moment-card-main', !moment.imageDataUrl && 'no-image')}>
                    {moment.imageDataUrl && (
                      <button
                        type="button"
                        className="moment-image-button"
                        onClick={() => setExpandedMomentId(expanded ? '' : moment.id)}
                        aria-label={expanded ? '收起回忆操作' : '展开回忆操作'}
                        aria-expanded={expanded}
                      >
                        <img className="moment-image" src={moment.imageDataUrl} alt="回忆图片" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="moment-card-copy"
                      onClick={() => setExpandedMomentId(expanded ? '' : moment.id)}
                      aria-expanded={expanded}
                    >
                      <time dateTime={moment.happenedAt}>{moment.happenedAt}</time>
                      <span className="moment-card-text">{renderTwemojiText(moment.text)}</span>
                      <em>{moment.authorName || (moment.authorId === self.id ? self.displayName : contact.displayName)}</em>
                    </button>
                  </div>
                  {expanded && (
                    <div className="moment-card-actions">
                      <button type="button" onClick={() => startEdit(moment)}>编辑</button>
                      <button type="button" className="planner-delete-button" onClick={() => removeMoment(moment)}>删除</button>
                    </div>
                  )}
                </>
              )}
            </article>
          );
        })}
        {moments.length === 0 && <div className="planner-drawer-empty">还没有回忆。</div>}
      </div>
    </aside>
  );
}

export { CoupleMomentsPanel };
