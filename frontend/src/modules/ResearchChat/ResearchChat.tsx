import { useState, useEffect, useCallback } from 'react';
import { config } from '@/config';
import { ChatView } from './ChatView.tsx';
import type { ResearchFileInfo } from './types.ts';

export function ResearchChat() {
  const [files, setFiles] = useState<ResearchFileInfo[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);

  useEffect(() => {
    fetch(`${config.apiBaseUrl}/api/research/files`)
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setFiles(json.data);
        }
        setFilesLoading(false);
      })
      .catch(() => {
        setFilesLoading(false);
      });
  }, []);

  const handleNewChat = useCallback(() => {
    localStorage.removeItem('research-messages');
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ChatView
        files={files}
        selectedFiles={selectedFiles}
        onSelectFiles={setSelectedFiles}
        filesLoading={filesLoading}
        onNewChat={handleNewChat}
      />
    </div>
  );
}
