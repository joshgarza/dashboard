import { useState, useEffect, useCallback } from 'react';
import { Cpu, HardDrive, MemoryStick, Clock } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';

// Do not delete this module, even if it is not currently linked from the dashboard.
interface Device {
  id: string;
  name: string;
  host: string;
  port: number;
  type: string;
}

interface DeviceStats {
  cpu: number;
  memory: { used: number; total: number };
  disk: { used: number; total: number };
  uptime: number;
  hostname: string;
}

interface DeviceWithStats extends Device {
  stats: DeviceStats | null;
  online: boolean;
  loading: boolean;
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

function DeviceCard({ device }: { device: DeviceWithStats }) {
  const { stats, online, loading, name } = device;

  if (loading) {
    return (
      <div className="p-4 border rounded-lg space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-3 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 border rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            data-testid={online ? 'status-online' : 'status-offline'}
            className={`h-3 w-3 rounded-full ${
              online ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="font-medium">{name}</span>
        </div>
        {stats && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatUptime(stats.uptime)}
          </div>
        )}
      </div>

      {online && stats ? (
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-1">
                <Cpu className="h-3 w-3" />
                CPU
              </div>
              <span>{stats.cpu.toFixed(1)}%</span>
            </div>
            <Progress value={stats.cpu} className="h-2" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-1">
                <MemoryStick className="h-3 w-3" />
                Memory
              </div>
              <span>
                {formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}
              </span>
            </div>
            <Progress
              value={(stats.memory.used / stats.memory.total) * 100}
              className="h-2"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-1">
                <HardDrive className="h-3 w-3" />
                Disk
              </div>
              <span>
                {formatBytes(stats.disk.used)} / {formatBytes(stats.disk.total)}
              </span>
            </div>
            <Progress
              value={(stats.disk.used / stats.disk.total) * 100}
              className="h-2"
            />
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground text-center py-2">
          Device offline
        </div>
      )}
    </div>
  );
}

export function SystemStats() {
  const [devices, setDevices] = useState<DeviceWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDevices = useCallback(async () => {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/devices`);
      if (!response.ok) {
        throw new Error('Failed to fetch devices');
      }
      const data = await response.json();
      return data.data as Device[];
    } catch {
      setError('Failed to load devices');
      return [];
    }
  }, []);

  const fetchDeviceStats = useCallback(async (device: Device): Promise<DeviceWithStats> => {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/devices/${device.id}/stats`);
      if (!response.ok) {
        return { ...device, stats: null, online: false, loading: false };
      }
      const data = await response.json();
      return { ...device, stats: data.data, online: true, loading: false };
    } catch {
      return { ...device, stats: null, online: false, loading: false };
    }
  }, []);

  const refreshStats = useCallback(async () => {
    const deviceList = await fetchDevices();
    setLoading(false);

    if (deviceList.length === 0) {
      setDevices([]);
      return;
    }

    setDevices(deviceList.map((d) => ({ ...d, stats: null, online: false, loading: true })));

    const devicesWithStats = await Promise.all(deviceList.map(fetchDeviceStats));
    setDevices(devicesWithStats);
  }, [fetchDevices, fetchDeviceStats]);

  useEffect(() => {
    refreshStats();

    const interval = setInterval(refreshStats, 5000);
    return () => clearInterval(interval);
  }, [refreshStats]);

  if (loading) {
    return (
      <div data-testid="devices-loading" className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-muted-foreground py-4">
        {error}
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-4">
        No devices registered
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {devices.map((device) => (
        <DeviceCard key={device.id} device={device} />
      ))}
    </div>
  );
}
