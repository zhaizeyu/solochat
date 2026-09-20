'use client';

import { useEffect, useState } from 'react';
import { Button as ShadcnButton } from '../../components/ui/button.jsx';
import { Input } from '../../components/ui/input.jsx';
import { Label } from '../../components/ui/label.jsx';
import { TabsList, TabsTrigger } from '../../components/ui/tabs.jsx';

const bubblePresets = [
  { id: 'mint', name: '清新', start: '#1597ff', end: '#0f9f86', soft: '#eaf8f5', shadow: 'rgba(15, 159, 134, 0.18)' },
  { id: 'blush', name: '蜜桃', start: '#ff8e6b', end: '#e64980', soft: '#fff0f5', shadow: 'rgba(230, 73, 128, 0.2)' },
  { id: 'ocean', name: '海蓝', start: '#22b8cf', end: '#1c7ed6', soft: '#ebf5fc', shadow: 'rgba(28, 126, 214, 0.18)' },
  { id: 'sand', name: '纸感', start: '#dd6b20', end: '#b7791f', soft: '#f7f0e4', shadow: 'rgba(183, 121, 31, 0.2)' },
  { id: 'dark', name: '暗夜', start: '#7aa2ff', end: '#4f8cff', soft: '#2a2a2a', shadow: 'rgba(79, 140, 255, 0.28)' }
];

const chatBgPresets = [
  {
    id: 'mint',
    name: '清新',
    css: 'linear-gradient(180deg, rgba(234, 248, 245, 0.96), rgba(238, 248, 245, 0.98))'
  },
  {
    id: 'blush',
    name: '蜜桃',
    css: 'linear-gradient(180deg, #fff1f5 0%, #fff6ef 100%)'
  },
  {
    id: 'ocean',
    name: '海蓝',
    css: 'linear-gradient(180deg, #eaf4fb 0%, #eef8f6 100%)'
  },
  {
    id: 'sand',
    name: '纸感',
    css: 'linear-gradient(180deg, #f5efe4 0%, #f8f4ec 100%)'
  },
  {
    id: 'dark',
    name: '暗夜',
    css: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)'
  }
];

const styleFamilyIds = new Set(['mint', 'blush', 'ocean', 'sand', 'dark']);

const legacyStyleMap = {
  rose: 'blush',
  violet: 'blush',
  pink: 'blush',
  purple: 'blush',
  peach: 'blush',
  lavender: 'blush',
  azure: 'ocean',
  sky: 'ocean',
  amber: 'sand',
  paper: 'sand',
  soft: 'mint',
  plain: 'mint',
  dusk: 'blush',
  slate: 'dark'
};

const uiThemePresets = [
  {
    id: 'mint',
    name: '清新',
    blurb: '品牌默认 · 薄荷绿',
    mode: 'light',
    accent: '#0f9f86',
    companion: '#1597ff',
    canvas: '#eef8f5',
    canvasSoft: '#e7f4f1',
    surface: '#ffffff',
    surfaceMuted: '#d7efe9',
    soft: '#eaf8f5',
    hairline: '#c9ddd7',
    hairlineSoft: '#d7e8e3',
    ink: '#15201d',
    inkMuted: '#5d6d68',
    inkSubtle: '#7a8984',
    shell: ['#eaf7f5', '#f7f3ec'],
    sidebarTail: '245, 241, 236'
  },
  {
    id: 'blush',
    name: '蜜桃',
    blurb: '情侣感 · 粉桃',
    mode: 'light',
    accent: '#e64980',
    companion: '#ff8e6b',
    canvas: '#fff3f6',
    canvasSoft: '#ffeef3',
    surface: '#ffffff',
    surfaceMuted: '#ffd9e4',
    soft: '#fff0f5',
    hairline: '#efc9d4',
    hairlineSoft: '#f6dbe4',
    ink: '#2a1720',
    inkMuted: '#7a5563',
    inkSubtle: '#977384',
    shell: ['#fff1f5', '#fff6ef'],
    sidebarTail: '255, 244, 240'
  },
  {
    id: 'ocean',
    name: '海蓝',
    blurb: '冷静清晰 · 蓝调',
    mode: 'light',
    accent: '#1c7ed6',
    companion: '#22b8cf',
    canvas: '#eef6fc',
    canvasSoft: '#e7f2fa',
    surface: '#ffffff',
    surfaceMuted: '#d6eaf8',
    soft: '#ebf5fc',
    hairline: '#c5d8e8',
    hairlineSoft: '#d5e4f0',
    ink: '#132033',
    inkMuted: '#53657a',
    inkSubtle: '#738496',
    shell: ['#eaf4fb', '#eef8f6'],
    sidebarTail: '236, 246, 250'
  },
  {
    id: 'sand',
    name: '纸感',
    blurb: '日记感 · 暖米',
    mode: 'light',
    accent: '#b7791f',
    companion: '#dd6b20',
    canvas: '#f6f1e8',
    canvasSoft: '#f1ebe0',
    surface: '#fffcf7',
    surfaceMuted: '#eadfcb',
    soft: '#f7f0e4',
    hairline: '#ddd0b8',
    hairlineSoft: '#e8dcc8',
    ink: '#2b2418',
    inkMuted: '#6f6452',
    inkSubtle: '#8a7d68',
    shell: ['#f5efe4', '#f8f4ec'],
    sidebarTail: '245, 241, 232'
  },
  {
    id: 'dark',
    name: '暗夜',
    blurb: '夜间护眼 · 炭黑',
    mode: 'dark',
    accent: '#4f8cff',
    companion: '#7aa2ff',
    canvas: '#141414',
    canvasSoft: '#181818',
    surface: '#1e1e1e',
    surfaceMuted: '#2a2a2a',
    soft: '#232323',
    hairline: '#333333',
    hairlineSoft: '#2a2a2a',
    ink: '#e8e8e8',
    inkMuted: '#a3a3a3',
    inkSubtle: '#7c7c7c',
    shell: ['#121212', '#1a1a1a'],
    sidebarTail: '20, 20, 20'
  }
];

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex) {
  const value = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((part) => clampByte(part).toString(16).padStart(2, '0')).join('')}`;
}

function mixRgb(a, b, amount) {
  return {
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount
  };
}

function rgbChannels(rgb) {
  return `${clampByte(rgb.r)}, ${clampByte(rgb.g)}, ${clampByte(rgb.b)}`;
}

function darkenRgb(rgb, amount) {
  return mixRgb(rgb, { r: 0, g: 0, b: 0 }, amount);
}

function buildUiThemeTokens(preset) {
  const accentRgb = hexToRgb(preset.accent) || hexToRgb('#12b886');
  const companionRgb = hexToRgb(preset.companion) || accentRgb;
  const isDark = preset.mode === 'dark';
  const hover = isDark
    ? mixRgb(accentRgb, { r: 255, g: 255, b: 255 }, 0.18)
    : darkenRgb(accentRgb, 0.12);
  const secondaryHover = isDark ? '#2f2f2f' : rgbToHex(mixRgb(accentRgb, { r: 255, g: 255, b: 255 }, 0.72));
  const [shellStart, shellEnd] = preset.shell;
  return {
    id: preset.id,
    name: preset.name,
    blurb: preset.blurb,
    mode: preset.mode,
    accent: preset.accent,
    companion: preset.companion,
    accentRgb: rgbChannels(accentRgb),
    companionRgb: rgbChannels(companionRgb),
    canvas: preset.canvas,
    canvasSoft: preset.canvasSoft,
    surface: preset.surface,
    surfaceMuted: preset.surfaceMuted,
    soft: preset.soft,
    hairline: preset.hairline,
    hairlineSoft: preset.hairlineSoft,
    ink: preset.ink,
    inkMuted: preset.inkMuted,
    inkSubtle: preset.inkSubtle,
    secondaryHover,
    primaryHover: rgbToHex(hover),
    focus: `rgba(${rgbChannels(accentRgb)}, ${isDark ? 0.28 : 0.18})`,
    blockShadow: isDark
      ? '0 12px 28px rgba(0, 0, 0, 0.45)'
      : `0 10px 24px rgba(${rgbChannels(accentRgb)}, 0.1)`,
    brandGradient: `linear-gradient(135deg, ${preset.companion} 0%, ${preset.accent} 100%)`,
    shellGradient: `linear-gradient(135deg, ${shellStart} 0%, ${shellEnd} 100%)`,
    sidebarWash: `linear-gradient(180deg, rgba(${rgbChannels(accentRgb)}, ${isDark ? 0.16 : 0.12}), rgba(${rgbChannels(companionRgb)}, 0.08) 46%, rgba(${preset.sidebarTail}, ${isDark ? 0.92 : 0.72}))`,
    chatPanelWash: isDark
      ? 'linear-gradient(180deg, rgba(24, 24, 24, 0.96), rgba(18, 18, 18, 0.98))'
      : `linear-gradient(180deg, ${preset.soft}ea, ${preset.canvas}f0)`,
    composerWash: isDark
      ? 'linear-gradient(135deg, rgba(30, 30, 30, 0.96), rgba(24, 24, 24, 0.98))'
      : `linear-gradient(135deg, ${preset.surface}d6, ${preset.soft}e0)`,
    swatch: `linear-gradient(135deg, ${shellStart} 0%, ${preset.accent} 100%)`
  };
}

function mapDyeToStyleId(hexLike, fallback = 'mint') {
  const rgb = hexToRgb(hexLike);
  if (!rgb) return fallback;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luminance < 0.28) return 'dark';
  const chroma = max - min;
  if (chroma < 0.08) return fallback;
  let hue = 0;
  if (max === r) hue = ((g - b) / chroma) % 6;
  else if (max === g) hue = (b - r) / chroma + 2;
  else hue = (r - g) / chroma + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  if (hue < 25 || hue >= 330) return 'blush';
  if (hue < 80) return 'sand';
  if (hue < 170) return 'mint';
  return 'ocean';
}

function normalizeStyleId(themeId, fallback = 'mint') {
  let value = String(themeId || '').trim();
  if (legacyStyleMap[value]) value = legacyStyleMap[value];
  if (value.startsWith('dye:')) {
    value = mapDyeToStyleId(value.slice(4), fallback);
  }
  return styleFamilyIds.has(value) ? value : fallback;
}

function resolveUiTheme(themeId) {
  const value = normalizeStyleId(themeId);
  const preset = uiThemePresets.find((item) => item.id === value) || uiThemePresets[0];
  return buildUiThemeTokens(preset);
}

const uiThemeCssVars = [
  '--accent',
  '--accent-blue',
  '--accent-soft',
  '--accent-rgb',
  '--accent-companion-rgb',
  '--canvas',
  '--canvas-soft',
  '--surface',
  '--surface-muted',
  '--surface-strong',
  '--hairline',
  '--hairline-soft',
  '--ink',
  '--ink-muted',
  '--ink-subtle',
  '--focus',
  '--primary-hover',
  '--secondary-hover',
  '--block-shadow',
  '--brand-gradient',
  '--shell-gradient',
  '--sidebar-wash',
  '--chat-panel-wash',
  '--composer-wash',
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--muted',
  '--muted-foreground',
  '--border',
  '--input',
  '--ring'
];

function applyUiThemeToDocument(themeId) {
  if (typeof document === 'undefined') return;
  const theme = resolveUiTheme(themeId);
  const root = document.documentElement;
  root.dataset.uiMode = theme.mode;
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-blue', theme.companion);
  root.style.setProperty('--accent-soft', theme.soft);
  root.style.setProperty('--accent-rgb', theme.accentRgb);
  root.style.setProperty('--accent-companion-rgb', theme.companionRgb);
  root.style.setProperty('--canvas', theme.canvas);
  root.style.setProperty('--canvas-soft', theme.canvasSoft);
  root.style.setProperty('--surface', theme.surface);
  root.style.setProperty('--surface-muted', theme.surfaceMuted);
  root.style.setProperty('--surface-strong', theme.companion);
  root.style.setProperty('--hairline', theme.hairline);
  root.style.setProperty('--hairline-soft', theme.hairlineSoft);
  root.style.setProperty('--ink', theme.ink);
  root.style.setProperty('--ink-muted', theme.inkMuted);
  root.style.setProperty('--ink-subtle', theme.inkSubtle);
  root.style.setProperty('--focus', theme.focus);
  root.style.setProperty('--primary-hover', theme.primaryHover);
  root.style.setProperty('--secondary-hover', theme.secondaryHover);
  root.style.setProperty('--block-shadow', theme.blockShadow);
  root.style.setProperty('--brand-gradient', theme.brandGradient);
  root.style.setProperty('--shell-gradient', theme.shellGradient);
  root.style.setProperty('--sidebar-wash', theme.sidebarWash);
  root.style.setProperty('--chat-panel-wash', theme.chatPanelWash);
  root.style.setProperty('--composer-wash', theme.composerWash);
  root.style.setProperty('--background', theme.surface);
  root.style.setProperty('--foreground', theme.ink);
  root.style.setProperty('--card', theme.surface);
  root.style.setProperty('--card-foreground', theme.ink);
  root.style.setProperty('--popover', theme.surface);
  root.style.setProperty('--popover-foreground', theme.ink);
  root.style.setProperty('--muted', theme.surfaceMuted);
  root.style.setProperty('--muted-foreground', theme.inkMuted);
  root.style.setProperty('--border', theme.hairline);
  root.style.setProperty('--input', theme.hairline);
  root.style.setProperty('--ring', theme.accent);
}

function clearUiThemeFromDocument() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  delete root.dataset.uiMode;
  for (const key of uiThemeCssVars) {
    root.style.removeProperty(key);
  }
}

function resolveBubbleTheme(themeId) {
  const value = normalizeStyleId(themeId);
  return bubblePresets.find((preset) => preset.id === value) || bubblePresets[0];
}

function resolveChatBg(presetId, imageUrl = '') {
  if (imageUrl) {
    return {
      id: 'custom',
      name: '自定义图片',
      imageUrl,
      css: null
    };
  }
  const value = normalizeStyleId(presetId);
  return chatBgPresets.find((preset) => preset.id === value) || chatBgPresets[0];
}
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

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
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

export {
  bubblePresets,
  chatBgPresets,
  uiThemePresets,
  resolveBubbleTheme,
  resolveChatBg,
  resolveUiTheme,
  applyUiThemeToDocument,
  clearUiThemeFromDocument,
  emojiGroups,
  messagePageSize,
  cls,
  ui,
  isMobileShellViewport,
  useMobileShell,
  TextField,
  Button,
  copyTextToClipboard,
  SegmentedControl
};
