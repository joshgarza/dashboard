export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ResearchChatState {
  messages: ChatMessage[];
  selectedFiles: string[];
}

export interface ResearchChatThreadSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ResearchChatThread extends ResearchChatState, ResearchChatThreadSummary {
}

export interface ResearchChatCreatedEvent {
  type: 'chat_created';
  chat: ResearchChatThreadSummary;
}

export interface ResearchFileInfo {
  key: string;
  filename: string;
  type: 'research' | 'principles';
  topic: string;
  date: string;
  tags: string[];
}
