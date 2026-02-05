import { jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModuleCard } from './ModuleCard';

describe('ModuleCard', () => {
  it('renders title and children', () => {
    render(
      <ModuleCard title="Test Module">
        <div>Content</div>
      </ModuleCard>
    );

    expect(screen.getByText('Test Module')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('shows loading skeleton when loading', () => {
    render(
      <ModuleCard title="Test Module" loading>
        <div>Content</div>
      </ModuleCard>
    );

    expect(screen.getByText('Test Module')).toBeInTheDocument();
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  });

  it('shows error state with retry button', () => {
    const onRetry = () => {};
    render(
      <ModuleCard title="Test Module" error="Something went wrong" onRetry={onRetry}>
        <div>Content</div>
      </ModuleCard>
    );

    expect(screen.getByText('Test Module')).toBeInTheDocument();
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('calls onRetry when retry button is clicked', () => {
    const onRetry = jest.fn();
    render(
      <ModuleCard title="Test Module" error="Something went wrong" onRetry={onRetry}>
        <div>Content</div>
      </ModuleCard>
    );

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not show retry button when error present but no onRetry provided', () => {
    render(
      <ModuleCard title="Test Module" error="Something went wrong">
        <div>Content</div>
      </ModuleCard>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});
