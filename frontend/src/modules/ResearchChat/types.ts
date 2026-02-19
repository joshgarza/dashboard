export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ResearchFileInfo {
  key: string;
  filename: string;
  type: 'research' | 'principles';
  topic: string;
  date: string;
  tags: string[];
}

export interface QueueItem {
  id: string;
  topic: string;
  description: string;
  tags: string[];
  priority: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'review';
  added: string;
  model: 'sonnet' | 'opus' | 'haiku';
}
