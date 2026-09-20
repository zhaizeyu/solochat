'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  bubblePresets,
  chatBgPresets,
  resolveBubbleTheme,
  resolveChatBg,
  resolveUiTheme,
  uiThemePresets
} from '../lib/ui.jsx';
import { readImageFile } from '../lib/media.js';

function AppearancePanel({
  open,
  onClose,
  uiTheme,
  bubbleTheme,
  chatBgPreset,
  chatBgDataUrl,
  onUiThemeChange,
  onBubbleThemeChange,
  onChatBgPresetChange,
  onChatBgUpload,
  onChatBgClear
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectedUi = useMemo(() => resolveUiTheme(uiTheme), [uiTheme]);
  const selectedBubble = useMemo(() => resolveBubbleTheme(bubbleTheme), [bubbleTheme]);
  const selectedBg = useMemo(
    () => resolveChatBg(chatBgPreset, chatBgDataUrl),
    [chatBgPreset, chatBgDataUrl]
  );

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose?.();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err?.message || '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="appearance-overlay" role="presentation" onClick={onClose}>
      <section
        className="appearance-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appearance-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="appearance-header">
          <div>
            <h2 id="appearance-title">外观</h2>
            <p>界面 / 气泡 / 背景共用同一套风格；聊天背景仅自己可见，气泡会展示给对方。</p>
          </div>
          <button type="button" className="appearance-close" onClick={onClose} aria-label="关闭">
            关闭
          </button>
        </header>

        {error && <div className="inline-error">{error}</div>}

        <section className="appearance-section" aria-label="界面主题">
          <div className="appearance-section-head">
            <strong>界面主题</strong>
            <span>{selectedUi.blurb}</span>
          </div>
          <label className="appearance-select">
            <span className="appearance-select-swatch" style={{ background: selectedUi.swatch }} />
            <select
              value={selectedUi.id}
              disabled={busy}
              onChange={(event) => run(() => onUiThemeChange(event.target.value))}
            >
              {uiThemePresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} · {preset.blurb}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="appearance-section" aria-label="气泡颜色">
          <div className="appearance-section-head">
            <strong>气泡</strong>
            <span>与主题同款风格</span>
          </div>
          <label className="appearance-select">
            <span
              className="appearance-select-swatch"
              style={{
                background: `linear-gradient(135deg, ${selectedBubble.start}, ${selectedBubble.end})`
              }}
            />
            <select
              value={selectedBubble.id}
              disabled={busy}
              onChange={(event) => run(() => onBubbleThemeChange(event.target.value))}
            >
              {bubblePresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <div
            className="bubble-theme-preview"
            style={{
              background: `linear-gradient(135deg, ${selectedBubble.start}, ${selectedBubble.end})`,
              boxShadow: `0 10px 26px ${selectedBubble.shadow}`
            }}
          >
            {selectedBubble.name}气泡预览
          </div>
        </section>

        <section className="appearance-section" aria-label="聊天背景">
          <div className="appearance-section-head">
            <strong>聊天背景</strong>
            <span>预设或上传图片</span>
          </div>
          <label className="appearance-select">
            <span
              className="appearance-select-swatch"
              style={{ background: selectedBg.css || selectedUi.swatch }}
            />
            <select
              value={chatBgDataUrl ? '' : selectedBg.id}
              disabled={busy || Boolean(chatBgDataUrl)}
              onChange={(event) => {
                if (!event.target.value) return;
                run(() => onChatBgPresetChange(event.target.value));
              }}
            >
              {chatBgDataUrl && <option value="">自定义图片</option>}
              {chatBgPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <div className="appearance-bg-actions">
            <label className="appearance-upload">
              <input
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  run(async () => {
                    const dataUrl = await readImageFile(file);
                    await onChatBgUpload(dataUrl);
                  });
                }}
              />
              上传背景图
            </label>
            {chatBgDataUrl && (
              <button type="button" onClick={() => run(() => onChatBgClear())} disabled={busy}>
                清除图片
              </button>
            )}
          </div>
          <div
            className="chat-bg-preview"
            style={
              selectedBg.imageUrl
                ? {
                    backgroundImage: `linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.28)), url(${selectedBg.imageUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                  }
                : { background: selectedBg.css }
            }
          >
            {selectedBg.name}
          </div>
        </section>
      </section>
    </div>
  );
}

export { AppearancePanel };
