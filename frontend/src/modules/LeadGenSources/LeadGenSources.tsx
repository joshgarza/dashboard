import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Pencil, Trash2, ExternalLink, Check, X, GripVertical } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';

interface LeadGenSource {
  id: number;
  name: string;
  url: string | null;
  sort_order: number;
  created_at: string;
}

interface SourceFormState {
  name: string;
  url: string;
}

const emptyForm: SourceFormState = { name: '', url: '' };

export function LeadGenSources() {
  const [sources, setSources] = useState<LeadGenSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<SourceFormState>(emptyForm);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<SourceFormState>(emptyForm);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<number | null>(null);

  const dragId = useRef<number | null>(null);
  const dragOverId = useRef<number | null>(null);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/lead-gen-sources`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setSources(data.data);
    } catch {
      setError('Failed to load sources');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  async function handleAdd() {
    if (!addForm.name.trim()) {
      setAddError('Name is required');
      return;
    }
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/lead-gen-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addForm.name.trim(), url: addForm.url.trim() || null }),
      });
      if (!res.ok) throw new Error('Failed to create');
      const data = await res.json();
      setSources((prev) => [...prev, data.data]);
      setAdding(false);
      setAddForm(emptyForm);
      setAddError(null);
    } catch {
      setAddError('Failed to save');
    }
  }

  function startEdit(source: LeadGenSource) {
    setEditingId(source.id);
    setEditForm({ name: source.name, url: source.url ?? '' });
    setEditError(null);
  }

  async function handleEdit(id: number) {
    if (!editForm.name.trim()) {
      setEditError('Name is required');
      return;
    }
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/lead-gen-sources/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editForm.name.trim(), url: editForm.url.trim() || null }),
      });
      if (!res.ok) throw new Error('Failed to update');
      const data = await res.json();
      setSources((prev) => prev.map((s) => (s.id === id ? data.data : s)));
      setEditingId(null);
      setEditError(null);
    } catch {
      setEditError('Failed to save');
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/lead-gen-sources/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete');
      setSources((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // silently reset on failure
    } finally {
      setDeletingId(null);
    }
  }

  function handleDragStart(id: number) {
    dragId.current = id;
  }

  function handleDragOver(e: React.DragEvent, id: number) {
    e.preventDefault();
    dragOverId.current = id;
  }

  async function handleDrop() {
    const fromId = dragId.current;
    const toId = dragOverId.current;
    if (fromId === null || toId === null || fromId === toId) return;

    const reordered = [...sources];
    const fromIndex = reordered.findIndex((s) => s.id === fromId);
    const toIndex = reordered.findIndex((s) => s.id === toId);
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    setSources(reordered);
    dragId.current = null;
    dragOverId.current = null;

    await fetch(`${config.apiBaseUrl}/api/lead-gen-sources/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: reordered.map((s) => s.id) }),
    });
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (error) {
    return <div className="text-center text-muted-foreground py-4">{error}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {sources.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground text-center py-2">No sources yet</p>
        )}

        {sources.map((source) =>
          editingId === source.id ? (
            <div key={source.id} className="flex flex-col gap-1 p-2 border rounded-lg">
              <input
                className="text-sm bg-background border rounded px-2 py-1 w-full"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Source name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleEdit(source.id);
                  if (e.key === 'Escape') { setEditingId(null); setEditError(null); }
                }}
              />
              <input
                className="text-sm bg-background border rounded px-2 py-1 w-full"
                value={editForm.url}
                onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="URL (optional)"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleEdit(source.id);
                  if (e.key === 'Escape') { setEditingId(null); setEditError(null); }
                }}
              />
              {editError && <p className="text-xs text-destructive">{editError}</p>}
              <div className="flex gap-1 justify-end">
                <button onClick={() => handleEdit(source.id)} className="p-1 rounded hover:bg-muted text-green-600" title="Save">
                  <Check className="h-4 w-4" />
                </button>
                <button onClick={() => { setEditingId(null); setEditError(null); }} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Cancel">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <div
              key={source.id}
              draggable
              onDragStart={() => handleDragStart(source.id)}
              onDragOver={(e) => handleDragOver(e, source.id)}
              onDrop={handleDrop}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 cursor-default"
            >
              <GripVertical className="h-4 w-4 text-muted-foreground/50 flex-shrink-0 cursor-grab active:cursor-grabbing" />
              <span className="text-sm truncate flex-1">{source.name}</span>
              {source.url && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground flex-shrink-0"
                  title={source.url}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <button onClick={() => startEdit(source)} className="text-muted-foreground hover:text-foreground flex-shrink-0" title="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => handleDelete(source.id)}
                disabled={deletingId === source.id}
                className="text-muted-foreground hover:text-destructive flex-shrink-0"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        )}
      </div>

      {adding ? (
        <div className="flex flex-col gap-1 p-2 border rounded-lg">
          <input
            className="text-sm bg-background border rounded px-2 py-1 w-full"
            value={addForm.name}
            onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Source name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') { setAdding(false); setAddForm(emptyForm); setAddError(null); }
            }}
          />
          <input
            className="text-sm bg-background border rounded px-2 py-1 w-full"
            value={addForm.url}
            onChange={(e) => setAddForm((f) => ({ ...f, url: e.target.value }))}
            placeholder="URL (optional)"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') { setAdding(false); setAddForm(emptyForm); setAddError(null); }
            }}
          />
          {addError && <p className="text-xs text-destructive">{addError}</p>}
          <div className="flex gap-1 justify-end">
            <button onClick={handleAdd} className="p-1 rounded hover:bg-muted text-green-600" title="Save">
              <Check className="h-4 w-4" />
            </button>
            <button onClick={() => { setAdding(false); setAddForm(emptyForm); setAddError(null); }} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Cancel">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setAdding(true); setEditingId(null); }}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-full px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add source
        </button>
      )}
    </div>
  );
}
