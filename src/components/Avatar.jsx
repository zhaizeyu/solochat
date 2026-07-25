'use client';

function Avatar({ user, size = '' }) {
  const className = `avatar ${size}`.trim();
  if (user?.avatarDataUrl) {
    return <img className={className} src={user.avatarDataUrl} alt="" />;
  }
  return <div className={className}>{(user?.displayName || '?').slice(0, 1).toUpperCase()}</div>;
}

export { Avatar };
