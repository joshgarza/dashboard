import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Check, Circle } from 'lucide-react';
import { config } from '@/config';

interface TodoItem {
  id: number;
  text: string;
  completed: boolean;
  completed_at: string | null;
  source: string | null;
}

interface AllTodosProps {
  refreshKey: number;
}

export function AllTodos({ refreshKey }: AllTodosProps) {
  const [expanded, setExpanded] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  // Fetch on first expand or when refreshKey changes (if already expanded)
  useEffect(() => {
    if (!expanded) return;
    fetchTodos();
  }, [expanded, refreshKey]);

  async function fetchTodos() {
    setLoading(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/todos`);
      const json = await res.json();
      if (json.success) {
        setTodos(json.data);
        setLoaded(true);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(todo: TodoItem) {
    const endpoint = todo.completed ? 'uncomplete' : 'complete';

    // Optimistic update
    setTodos(prev =>
      prev.map(t => t.id === todo.id ? { ...t, completed: !t.completed } : t)
    );

    try {
      const res = await fetch(`${config.apiBaseUrl}/api/todos/${todo.id}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'manual' }),
      });
      const json = await res.json();
      if (!json.success) {
        // Revert
        setTodos(prev =>
          prev.map(t => t.id === todo.id ? { ...t, completed: todo.completed } : t)
        );
      }
    } catch {
      // Revert
      setTodos(prev =>
        prev.map(t => t.id === todo.id ? { ...t, completed: todo.completed } : t)
      );
    }
  }

  const activeTodos = todos.filter(t => !t.completed);
  const completedTodos = todos.filter(t => t.completed);
  const count = loaded ? activeTodos.length : '...';

  return (
    <div className="border rounded-md">
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors rounded-md"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        )}
        <span>All Todos ({count})</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-1">
          {loading && !loaded && (
            <p className="text-xs text-muted-foreground py-1">Loading...</p>
          )}

          {loaded && activeTodos.length === 0 && completedTodos.length === 0 && (
            <p className="text-xs text-muted-foreground py-1">No todos found.</p>
          )}

          {activeTodos.map(todo => (
            <button
              key={todo.id}
              onClick={() => handleToggle(todo)}
              className="flex items-center gap-2 w-full text-left text-sm hover:bg-muted/50 rounded px-1 py-0.5 transition-colors"
            >
              <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span>{todo.text}</span>
            </button>
          ))}

          {completedTodos.length > 0 && (
            <>
              {activeTodos.length > 0 && <div className="border-t my-1" />}
              <p className="text-xs text-muted-foreground px-1">Recently completed</p>
              {completedTodos.map(todo => (
                <button
                  key={todo.id}
                  onClick={() => handleToggle(todo)}
                  className="flex items-center gap-2 w-full text-left text-sm hover:bg-muted/50 rounded px-1 py-0.5 transition-colors"
                >
                  <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                  <span className="line-through text-muted-foreground">{todo.text}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
