import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;

export function relay(httpPort, udpPort, env = {}) {
  const child = spawn(process.execPath, ['server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(httpPort), NET_PORT: String(udpPort), ...env },
  });
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
      if ((!udpPort || output.includes(`UDP ${udpPort} :`)) && output.includes(`:${httpPort}/bo1z/`)) resolve(child);
    });
    child.on('exit', code => reject(new Error(`relais ${httpPort} arrêté (${code})`)));
  });
}
