export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ResearchChatState {
  messages: ChatMessage[];
  sessionId: string | null;
  selectedFiles: string[];
}

export interface ResearchChatThread extends ResearchChatState {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchFileInfo {
  key: string;
  filename: string;
  type: 'research' | 'principles';
  topic: string;
  date: string;
  tags: string[];
}
