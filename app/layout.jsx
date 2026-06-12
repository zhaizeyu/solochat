import '../src/styles.css';

export const metadata = {
  title: 'doolulu',
  description: 'A private chat and planner app for two people.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
