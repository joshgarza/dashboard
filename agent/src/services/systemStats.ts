import os from 'os';
import { execSync } from 'child_process';

export interface SystemStats {
  cpu: number;
  memory: {
    used: number;
    total: number;
  };
  disk: {
    used: number;
    total: number;
  };
  uptime: number;
  hostname: string;
}

function getCpuUsage(): number {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle += cpu.times.idle;
  }

  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  const usage = ((total - idle) / total) * 100;

  return Math.round(usage * 100) / 100;
}

function getMemoryStats(): { used: number; total: number } {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;

  return { used, total };
}

function getDiskStats(): { used: number; total: number } {
  try {
    if (process.platform === 'win32') {
      return { used: 0, total: 0 };
    }

    const output = execSync('df -B1 / 2>/dev/null || echo "0 0 0"', { encoding: 'utf-8' });
    const lines = output.trim().split('\n');

    if (lines.length < 2) {
      return { used: 0, total: 0 };
    }

    const parts = lines[1].split(/\s+/);
    const total = parseInt(parts[1] || '0', 10);
    const used = parseInt(parts[2] || '0', 10);

    return { used, total };
  } catch {
    return { used: 0, total: 0 };
  }
}

export function getSystemStats(): SystemStats {
  return {
    cpu: getCpuUsage(),
    memory: getMemoryStats(),
    disk: getDiskStats(),
    uptime: Math.floor(os.uptime()),
    hostname: os.hostname(),
  };
}
