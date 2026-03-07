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
