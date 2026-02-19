import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';
import type { QueueItem } from './types.ts';

export function EnqueueForm() {
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [priority, setPriority] = useState('5');
  const [model, setModel] = useState<'sonnet' | 'opus' | 'haiku'>('sonnet');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${config.apiBaseUrl}/api/research/queue`)
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setQueue(json.data.items ?? json.data);
        } else {
          const msg = typeof json.error === 'object' ? json.error?.message : json.error;
          setQueueError(msg || 'Failed to load queue');
        }
        setQueueLoading(false);
      })
      .catch(() => {
        setQueueError('Failed to load queue');
        setQueueLoading(false);
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSuccessId(null);
    setSubmitting(true);

    try {
      const res = await fetch(`${config.apiBaseUrl}/api/research/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          description,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
          priority: Number(priority),
          model,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setSuccessId(json.data.id);
        setTopic('');
        setDescription('');
        setTags('');
        setPriority('5');
        setModel('sonnet');
        setQueue(prev => [json.data, ...prev]);
      } else {
        const msg = typeof json.error === 'object' ? json.error?.message : json.error;
        setSubmitError(msg || 'Failed to enqueue');
      }
    } catch {
      setSubmitError('Failed to enqueue research topic');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
  const labelClass = 'text-sm font-medium leading-none';

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className={labelClass}>Topic *</label>
          <input
            type="text"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            required
            placeholder="e.g. React Server Components deep dive"
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What should be researched and why?"
            rows={2}
            className={inputClass + ' resize-none'}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className={labelClass}>Tags</label>
            <input
              type="text"
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="react, ssr"
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Priority</label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value)}
              className={inputClass}
            >
              <option value="1">1 (Highest)</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5 (Default)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Model</label>
            <select
              value={model}
              onChange={e => setModel(e.target.value as 'sonnet' | 'opus' | 'haiku')}
              className={inputClass}
            >
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
              <option value="haiku">Haiku</option>
            </select>
          </div>
        </div>

        {submitError && (
          <div className="text-destructive text-sm">{submitError}</div>
        )}
        {successId && (
          <div className="text-sm text-green-600 dark:text-green-400">
            Queued successfully (ID: {successId})
          </div>
        )}

        <Button type="submit" size="sm" disabled={submitting || !topic.trim()}>
          {submitting ? 'Enqueuing...' : 'Enqueue Research'}
        </Button>
      </form>

      <div className="border-t pt-3">
        <h4 className="text-sm font-medium mb-2">Queue</h4>
        {queueLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : queueError ? (
          <div className="text-destructive text-sm">{queueError}</div>
        ) : queue.length === 0 ? (
          <div className="text-sm text-muted-foreground">No items in queue</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-1 pr-3 font-medium">Topic</th>
                  <th className="pb-1 pr-3 font-medium">Status</th>
                  <th className="pb-1 pr-3 font-medium">Priority</th>
                  <th className="pb-1 font-medium">Model</th>
                </tr>
              </thead>
              <tbody>
                {queue.map(item => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">{item.topic}</td>
                    <td className="py-1.5 pr-3">
                      <span className={
                        item.status === 'running' ? 'text-blue-600 dark:text-blue-400' :
                        item.status === 'completed' ? 'text-green-600 dark:text-green-400' :
                        item.status === 'failed' ? 'text-destructive' :
                        'text-muted-foreground'
                      }>
                        {item.status}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3">{item.priority}</td>
                    <td className="py-1.5">{item.model}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
