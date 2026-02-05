import { renderHook, act } from '@testing-library/react';
import { useModules } from './useModules';
import type { DashboardModule } from '@/types/module';

const TestComponent = () => null;

describe('useModules', () => {
  it('starts with empty modules', () => {
    const { result } = renderHook(() => useModules());
    expect(result.current.modules).toEqual([]);
  });

  it('registers a module', () => {
    const { result } = renderHook(() => useModules());

    const module: DashboardModule = {
      id: 'test-1',
      title: 'Test Module',
      component: TestComponent,
    };

    act(() => {
      result.current.registerModule(module);
    });

    expect(result.current.modules).toHaveLength(1);
    expect(result.current.modules[0]).toEqual(module);
  });

  it('registers multiple modules', () => {
    const { result } = renderHook(() => useModules());

    const module1: DashboardModule = {
      id: 'test-1',
      title: 'Test Module 1',
      component: TestComponent,
    };

    const module2: DashboardModule = {
      id: 'test-2',
      title: 'Test Module 2',
      component: TestComponent,
      refreshInterval: 5000,
    };

    act(() => {
      result.current.registerModule(module1);
      result.current.registerModule(module2);
    });

    expect(result.current.modules).toHaveLength(2);
  });

  it('does not duplicate modules with same id', () => {
    const { result } = renderHook(() => useModules());

    const module: DashboardModule = {
      id: 'test-1',
      title: 'Test Module',
      component: TestComponent,
    };

    act(() => {
      result.current.registerModule(module);
      result.current.registerModule(module);
    });

    expect(result.current.modules).toHaveLength(1);
  });

  it('unregisters a module', () => {
    const { result } = renderHook(() => useModules());

    const module: DashboardModule = {
      id: 'test-1',
      title: 'Test Module',
      component: TestComponent,
    };

    act(() => {
      result.current.registerModule(module);
    });

    expect(result.current.modules).toHaveLength(1);

    act(() => {
      result.current.unregisterModule('test-1');
    });

    expect(result.current.modules).toHaveLength(0);
  });

  it('retrieves a module by id', () => {
    const { result } = renderHook(() => useModules());

    const module: DashboardModule = {
      id: 'test-1',
      title: 'Test Module',
      component: TestComponent,
    };

    act(() => {
      result.current.registerModule(module);
    });

    const retrieved = result.current.getModule('test-1');
    expect(retrieved).toEqual(module);
  });

  it('returns undefined for non-existent module', () => {
    const { result } = renderHook(() => useModules());

    const retrieved = result.current.getModule('non-existent');
    expect(retrieved).toBeUndefined();
  });
});
