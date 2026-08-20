import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 40,
          background: 'linear-gradient(135deg, #1597ff 0%, #12b886 100%)',
          color: '#ffffff',
          fontSize: 108,
          fontWeight: 800,
          fontFamily: 'ui-sans-serif, system-ui, Segoe UI, sans-serif',
          letterSpacing: '-0.04em',
          lineHeight: 1
        }}
      >
        D
      </div>
    ),
    { ...size }
  );
}
