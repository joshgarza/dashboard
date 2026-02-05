import { useState, useCallback } from 'react';
import type { DashboardModule } from '@/types/module';

export function useModules() {
  const [modules, setModules] = useState<DashboardModule[]>([]);

  const registerModule = useCallback((module: DashboardModule) => {
    setModules((prev) => {
      if (prev.some((m) => m.id === module.id)) {
        return prev;
      }
      return [...prev, module];
    });
  }, []);

  const unregisterModule = useCallback((id: string) => {
    setModules((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const getModule = useCallback(
    (id: string) => {
      return modules.find((m) => m.id === id);
    },
    [modules]
  );

  return {
    modules,
    registerModule,
    unregisterModule,
    getModule,
  };
}
