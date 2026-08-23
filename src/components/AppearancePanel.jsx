'use client';

import { useEffect, useMemo, useState } from 'react';
import { bubblePresets, bubbleThemeFromDye, chatBgPresets, resolveBubbleTheme, resolveChatBg } from '../lib/ui.jsx';
import { readImageFile } from '../lib/media.js';

function AppearancePanel({
  open,
  onClose,
  bubbleTheme,
  chatBgPreset,
  chatBgDataUrl,
  onBubbleThemeChange,
  onChatBgPresetChange,
  onChatBgUpload,
  onChatBgClear
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectedBubble = useMemo(() => resolveBubbleTheme(bubbleTheme), [bubbleTheme]);
  const selectedBg = useMemo(
    () => resolveChatBg(chatBgPreset, chatBgDataUrl),
    [chatBgPreset, chatBgDataUrl]
  );
  const dyeValue = selectedBubble.dye || selectedBubble.start || '#12b886';

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
            <p>气泡会展示给对方；聊天背景仅自己可见。</p>
          </div>
          <button type="button" className="appearance-close" onClick={onClose} aria-label="关闭">
            关闭
          </button>
        </header>

        {error && <div className="inline-error">{error}</div>}

        <section className="appearance-section" aria-label="气泡颜色">
          <div className="appearance-section-head">
            <strong>气泡</strong>
            <span>预设或自定义染色</span>
          </div>
          <div className="bubble-theme-grid appearance-swatch-grid">
            {bubblePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={!selectedBubble.dye && bubbleTheme === preset.id ? 'selected' : ''}
                onClick={() => run(() => onBubbleThemeChange(preset.id))}
                disabled={busy}
                title={preset.name}
                aria-label={preset.name}
                aria-pressed={!selectedBubble.dye && bubbleTheme === preset.id}
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
          <label className="appearance-dye">
            <span>染色</span>
            <input
              type="color"
              value={dyeValue}
              disabled={busy}
              onChange={(event) => {
                const next = bubbleThemeFromDye(event.target.value);
                run(() => onBubbleThemeChange(next.id));
              }}
            />
            <em>{selectedBubble.dye ? '自定义' : '点这里自选颜色'}</em>
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
          <div className="chat-bg-grid">
            {chatBgPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={!chatBgDataUrl && chatBgPreset === preset.id ? 'selected' : ''}
                onClick={() => run(() => onChatBgPresetChange(preset.id))}
                disabled={busy}
                aria-pressed={!chatBgDataUrl && chatBgPreset === preset.id}
                style={{ background: preset.css }}
              >
                {preset.name}
              </button>
            ))}
          </div>
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
