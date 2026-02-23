import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { config } from '@/config';
import { InterviewChat } from './InterviewChat';
import { PlanPreview } from './PlanPreview';
import type { ChatMessage, WeeklyPlan } from './types';

export function WeeklyReview() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<'interview' | 'preview'>('interview');
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFinalize(messages: ChatMessage[]) {
    setFinalizing(true);
    setError(null);

    try {
      const res = await fetch(`${config.apiBaseUrl}/api/weekly-review/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

      const json = await res.json();
      if (json.success) {
        setPlan(json.data);
        setPhase('preview');
      } else {
        const msg = typeof json.error === 'object' ? json.error?.message : json.error;
        setError(msg || 'Failed to generate plan');
      }
    } catch {
      setError('Failed to generate plan');
    } finally {
      setFinalizing(false);
    }
  }

  function handleAccept() {
    navigate('/');
  }

  function handleBack() {
    setPhase('interview');
  }

  return (
    <div className="flex-1 flex flex-col gap-4">
      <h1 className="text-2xl font-bold">
        {phase === 'interview' ? 'Weekly Review' : 'Weekly Review — Your Plan'}
      </h1>

      {error && (
        <div className="text-destructive text-sm border border-destructive/50 rounded-md p-2">
          {error}
        </div>
      )}

      {phase === 'interview' ? (
        <InterviewChat onFinalize={handleFinalize} finalizing={finalizing} />
      ) : plan ? (
        <PlanPreview plan={plan} onAccept={handleAccept} onBack={handleBack} />
      ) : null}
    </div>
  );
}
