import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChatView } from './ChatView.tsx';
import { EnqueueForm } from './EnqueueForm.tsx';

type Tab = 'chat' | 'enqueue';

export function ResearchChat() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Research Assistant</CardTitle>
          <div className="flex gap-1">
            <Button
              variant={activeTab === 'chat' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('chat')}
            >
              Chat
            </Button>
            <Button
              variant={activeTab === 'enqueue' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('enqueue')}
            >
              Enqueue
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {activeTab === 'chat' ? <ChatView /> : <EnqueueForm />}
      </CardContent>
    </Card>
  );
}
