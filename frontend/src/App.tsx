import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Dashboard } from '@/components/Dashboard';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { WeatherTime } from '@/modules/WeatherTime';
import { SystemStats } from '@/modules/SystemStats';
import { JobPipeline } from '@/modules/JobPipeline';
import { Contacts } from '@/modules/Contacts';
import { WeeklyTodos } from '@/modules/WeeklyTodos';
import { TodaySchedule } from '@/modules/TodaySchedule';
import { ResearchChat } from '@/modules/ResearchChat';
import type { DashboardModule } from '@/types/module';

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getCurrentWeekTitle(): string {
  const now = new Date();
  const year = now.getFullYear();
  const week = getISOWeek(now);
  return `Weekly Todos - ${year} Week ${String(week).padStart(2, '0')}`;
}

const modules: DashboardModule[] = [
  {
    id: 'weather-time',
    title: 'Weather & Time',
    component: WeatherTime,
    refreshInterval: 60000,
  },
  {
    id: 'today-schedule',
    title: "The Schedule",
    component: TodaySchedule,
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
  {
    id: 'contacts',
    title: 'Contacts',
    component: Contacts,
    refreshInterval: 300000,
  },
  {
    id: 'weekly-todos',
    title: getCurrentWeekTitle(),
    component: WeeklyTodos,
    refreshInterval: 60000,
  },
];

function App() {
  const location = useLocation();

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background">
        <header className="border-b">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <nav className="flex items-center gap-4">
              <Link
                to="/"
                className={`text-xl font-semibold hover:text-foreground/80 transition-colors ${location.pathname === '/' ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                Dashboard
              </Link>
              <Link
                to="/research"
                className={`text-xl font-semibold hover:text-foreground/80 transition-colors ${location.pathname === '/research' ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                Research
              </Link>
            </nav>
            <ThemeToggle />
          </div>
        </header>
        <main className="container mx-auto">
          <Routes>
            <Route path="/" element={
              <ErrorBoundary>
                <Dashboard modules={modules} />
              </ErrorBoundary>
            } />
            <Route path="/research" element={
              <div className="px-4 pb-4">
                <ErrorBoundary>
                  <ResearchChat />
                </ErrorBoundary>
              </div>
            } />
          </Routes>
        </main>
      </div>
    </ThemeProvider>
  );
}

export default App;
