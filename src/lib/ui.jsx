'use client';

import { useEffect, useState } from 'react';
import { Button as ShadcnButton } from '../../components/ui/button.jsx';
import { Input } from '../../components/ui/input.jsx';
import { Label } from '../../components/ui/label.jsx';
import { TabsList, TabsTrigger } from '../../components/ui/tabs.jsx';

const bubblePresets = [
  { id: 'mint', name: '蓝绿色', start: '#1597ff', end: '#12b886', soft: '#eaf8f5', shadow: 'rgba(18, 184, 134, 0.18)' },
  { id: 'pink', name: '粉色', start: '#ff7ab6', end: '#ff9f8f', soft: '#fff0f6', shadow: 'rgba(255, 122, 182, 0.2)' },
  { id: 'purple', name: '紫粉', start: '#9b7bff', end: '#ff7ab6', soft: '#f6f0ff', shadow: 'rgba(155, 123, 255, 0.2)' },
  { id: 'sky', name: '天空蓝', start: '#4facfe', end: '#7bdff2', soft: '#ecf8ff', shadow: 'rgba(79, 172, 254, 0.18)' },
  { id: 'peach', name: '蜜桃', start: '#ff9a8b', end: '#ffd36e', soft: '#fff6e8', shadow: 'rgba(255, 154, 139, 0.2)' },
  { id: 'lavender', name: '薰衣草', start: '#a18cd1', end: '#fbc2eb', soft: '#f8f0ff', shadow: 'rgba(161, 140, 209, 0.2)' }
];

const chatBgPresets = [
  {
    id: 'soft',
    name: '清新',
    css: 'linear-gradient(180deg, rgba(234, 248, 245, 0.92), rgba(251, 248, 244, 0.94))'
  },
  {
    id: 'paper',
    name: '纸感',
    css: 'linear-gradient(180deg, #f7f3ea 0%, #efe7d8 100%)'
  },
  {
    id: 'dusk',
    name: '暮色',
    css: 'linear-gradient(180deg, #ece7f4 0%, #f4ebe4 100%)'
  },
  {
    id: 'ocean',
    name: '海蓝',
    css: 'linear-gradient(180deg, #e4f2fb 0%, #eaf6f2 100%)'
  },
  {
    id: 'plain',
    name: '素白',
    css: '#f5f5f4'
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

function bubbleThemeFromDye(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return bubblePresets[0];
  const end = mixRgb(rgb, { r: 255, g: 255, b: 255 }, 0.28);
  const soft = mixRgb(rgb, { r: 255, g: 255, b: 255 }, 0.88);
  const startHex = rgbToHex(rgb).toLowerCase();
  return {
    id: `dye:${startHex}`,
    name: '自定义染色',
    start: startHex,
    end: rgbToHex(end),
    soft: rgbToHex(soft),
    shadow: `rgba(${clampByte(rgb.r)}, ${clampByte(rgb.g)}, ${clampByte(rgb.b)}, 0.2)`,
    dye: startHex
  };
}

function resolveBubbleTheme(themeId) {
  const value = String(themeId || '').trim();
  if (value.startsWith('dye:')) {
    return bubbleThemeFromDye(value.slice(4));
  }
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
  return chatBgPresets.find((preset) => preset.id === presetId) || chatBgPresets[0];
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
  resolveBubbleTheme,
  resolveChatBg,
  bubbleThemeFromDye,
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
