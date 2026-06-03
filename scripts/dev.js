import { spawn } from 'node:child_process';

const children = [
  spawn('node', ['server/server.js'], { stdio: 'inherit' }),
  spawn('npx', ['vite', '--host', '0.0.0.0'], { stdio: 'inherit' })
];

function shutdown(signal) {
  for (const child of children) {
    child.kill(signal);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

for (const child of children) {
  child.on('exit', (code) => {
    if (code && code !== 130 && code !== 143) {
      shutdown('SIGTERM');
      process.exit(code);
    }
  });
}
