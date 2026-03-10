import type { ResearchChatThread } from './types.ts';

interface ChatSidebarProps {
  chats: ResearchChatThread[];
  activeChatId: string | null;
  disabled: boolean;
  onNewChat: () => void;
  onSelectChat: (chatId: string) => void;
}

function formatChatTimestamp(updatedAt: string): string {
  const updated = new Date(updatedAt);
  const now = new Date();
  const sameDay = updated.toDateString() === now.toDateString();

  if (sameDay) {
    return updated.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  if (updated.getFullYear() === now.getFullYear()) {
    return updated.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
  }

  return updated.toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function ChatSidebar({ chats, activeChatId, disabled, onNewChat, onSelectChat }: ChatSidebarProps) {
  return (
    <aside className="border-b border-border bg-muted/20 md:sticky md:top-0 md:h-full md:w-80 md:min-w-80 md:self-start md:border-b-0 md:border-r">
      <div className="flex h-full max-h-full min-h-0 flex-col">
        <div className="p-3">
          <button
            type="button"
            onClick={onNewChat}
            disabled={disabled}
            aria-pressed={activeChatId === null}
            className={
              activeChatId === null
                ? 'flex w-full cursor-pointer items-center justify-between rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/12 disabled:opacity-50'
                : 'flex w-full cursor-pointer items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:border-border/80 hover:bg-background/80 disabled:opacity-50'
            }
          >
            <span>New chat</span>
            <span className="text-xs text-muted-foreground">Draft</span>
          </button>
        </div>

        <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Recent chats
        </div>

        <div className="app-scrollbar flex-1 min-h-0 space-y-1 overflow-y-auto px-2 pb-3">
          {chats.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-background/60 px-3 py-4 text-sm text-muted-foreground">
              Saved research chats will show up here after your first message.
            </div>
          ) : (
            chats.map(chat => {
              const active = chat.id === activeChatId;

              return (
                <button
                  key={chat.id}
                  type="button"
                  onClick={() => onSelectChat(chat.id)}
                  disabled={disabled}
                  aria-pressed={active}
                  className={
                    active
                      ? 'block w-full cursor-pointer rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-left disabled:opacity-50'
                      : 'block w-full cursor-pointer rounded-xl border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-background/80 disabled:opacity-50'
                  }
                >
                  <div className="truncate text-sm font-medium text-foreground">{chat.title}</div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>{chat.messages.length} messages</span>
                    <span>{formatChatTimestamp(chat.updatedAt)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
