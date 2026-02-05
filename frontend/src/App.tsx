import { ThemeProvider } from '@/components/ThemeProvider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Dashboard } from '@/components/Dashboard';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { WeatherTime } from '@/modules/WeatherTime';
import { SystemStats } from '@/modules/SystemStats';
import { JobPipeline } from '@/modules/JobPipeline';
import type { DashboardModule } from '@/types/module';

const modules: DashboardModule[] = [
  {
    id: 'weather-time',
    title: 'Weather & Time',
    component: WeatherTime,
    refreshInterval: 60000,
  },
  {
    id: 'system-stats',
    title: 'System Stats',
    component: SystemStats,
    refreshInterval: 5000,
  },
  {
    id: 'job-pipeline',
    title: 'Job Pipeline',
    component: JobPipeline,
    refreshInterval: 300000,
  },
];

function App() {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background">
        <header className="border-b">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <h1 className="text-xl font-semibold">Dashboard</h1>
            <ThemeToggle />
          </div>
        </header>
        <main className="container mx-auto">
          <ErrorBoundary>
            <Dashboard modules={modules} />
          </ErrorBoundary>
        </main>
      </div>
    </ThemeProvider>
  );
}

export default App;
