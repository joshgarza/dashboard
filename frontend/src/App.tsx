import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Dashboard } from '@/components/Dashboard';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { WeatherTime } from '@/modules/WeatherTime';
import { LeadGenSources } from '@/modules/LeadGenSources';
import { JobPipeline } from '@/modules/JobPipeline';
import { Contacts } from '@/modules/Contacts';
import { TodayTodos } from '@/modules/TodayTodos';
import { TodaySchedule } from '@/modules/TodaySchedule';
import { ResearchChat } from '@/modules/ResearchChat';
import { WeeklyReview } from '@/modules/WeeklyReview';
import type { DashboardModule } from '@/types/module';

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
    id: 'today-todos',
    title: "Today's Plan",
    component: TodayTodos,
    refreshInterval: 60000,
  },
  {
    id: 'lead-gen-sources',
    title: 'Lead Gen Sources',
    component: LeadGenSources,
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
];

function App() {
  const location = useLocation();

  return (
    <ThemeProvider>
      <div className="h-screen overflow-hidden bg-background flex flex-col">
        <header className="sticky top-0 z-30 shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex w-full items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
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
              <Link
                to="/weekly-review"
                className={`text-xl font-semibold hover:text-foreground/80 transition-colors ${location.pathname === '/weekly-review' ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                Weekly Review
              </Link>
            </nav>
            <ThemeToggle />
          </div>
        </header>
        <main className="w-full flex-1 min-h-0 overflow-hidden flex flex-col">
          <Routes>
            <Route path="/" element={
              <div className="app-scrollbar flex-1 min-h-0 overflow-y-auto">
                <div className="mx-auto w-full max-w-[1600px]">
                  <ErrorBoundary>
                    <Dashboard modules={modules} />
                  </ErrorBoundary>
                </div>
              </div>
            } />
            <Route path="/research" element={
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <ErrorBoundary>
                  <ResearchChat />
                </ErrorBoundary>
              </div>
            } />
            <Route path="/weekly-review" element={
              <div className="app-scrollbar flex-1 min-h-0 overflow-y-auto">
                <div className="flex min-h-full flex-col px-4 py-4 sm:px-6 lg:px-8">
                  <ErrorBoundary>
                    <WeeklyReview />
                  </ErrorBoundary>
                </div>
              </div>
            } />
          </Routes>
        </main>
      </div>
    </ThemeProvider>
  );
}

export default App;
