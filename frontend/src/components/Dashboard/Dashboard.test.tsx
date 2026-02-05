import { render, screen } from '@testing-library/react';
import { Dashboard } from './Dashboard';
import type { DashboardModule } from '@/types/module';

const TestModule1 = () => <div>Module 1 Content</div>;
const TestModule2 = () => <div>Module 2 Content</div>;

describe('Dashboard', () => {
  it('renders empty state when no modules', () => {
    render(<Dashboard modules={[]} />);

    expect(screen.getByText(/no modules/i)).toBeInTheDocument();
  });

  it('renders grid of modules', () => {
    const modules: DashboardModule[] = [
      { id: 'mod-1', title: 'Module 1', component: TestModule1 },
      { id: 'mod-2', title: 'Module 2', component: TestModule2 },
    ];

    render(<Dashboard modules={modules} />);

    expect(screen.getByText('Module 1')).toBeInTheDocument();
    expect(screen.getByText('Module 1 Content')).toBeInTheDocument();
    expect(screen.getByText('Module 2')).toBeInTheDocument();
    expect(screen.getByText('Module 2 Content')).toBeInTheDocument();
  });

  it('renders modules in a grid layout', () => {
    const modules: DashboardModule[] = [
      { id: 'mod-1', title: 'Module 1', component: TestModule1 },
      { id: 'mod-2', title: 'Module 2', component: TestModule2 },
    ];

    const { container } = render(<Dashboard modules={modules} />);

    const grid = container.querySelector('.grid');
    expect(grid).toBeInTheDocument();
  });
});
