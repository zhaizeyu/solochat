import '../src/styles.css';

export const metadata = {
  title: 'doolulu',
  description: 'A private chat and planner app for two people.',
  applicationName: 'doolulu',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon', type: 'image/png' }
    ],
    apple: [{ url: '/apple-icon', type: 'image/png' }]
  }
};

export const viewport = {
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
