import type { DashboardModule } from '@/types/module';
import { ModuleCard } from '@/components/ModuleCard/ModuleCard';

interface DashboardProps {
  modules: DashboardModule[];
}

export function Dashboard({ modules }: DashboardProps) {
  if (modules.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>No modules configured</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
      {modules.map((module) => {
        const Component = module.component;
        return (
          <ModuleCard key={module.id} title={module.title}>
            <Component />
          </ModuleCard>
        );
      })}
    </div>
  );
}
