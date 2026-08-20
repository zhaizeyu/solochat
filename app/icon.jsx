import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          background: 'linear-gradient(135deg, #1597ff 0%, #12b886 100%)',
          color: '#ffffff',
          fontSize: 20,
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
