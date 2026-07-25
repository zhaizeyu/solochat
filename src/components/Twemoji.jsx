'use client';

const emojiMatcher = /(?:[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*)/gu;

function Twemoji({ emoji, className = 'twemoji' }) {
  return (
    <span className={`${className} emoji-fallback`} role="img" aria-label={emoji}>
      {emoji}
    </span>
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

export { emojiMatcher, Twemoji, renderTwemojiText };
