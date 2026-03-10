import { randomUUID } from 'crypto';

export type SessionKind = 'research' | 'weekly-review';

interface SessionRecord {
  id: string;
  kind: SessionKind;
  threadId: string;
  createdAt: number;
  updatedAt: number;
}

const sessions = new Map<string, SessionRecord>();

function touch(record: SessionRecord): SessionRecord {
  record.updatedAt = Date.now();
  sessions.set(record.id, record);
  return record;
}

function create(kind: SessionKind, threadId: string): SessionRecord {
  const now = Date.now();
  const record: SessionRecord = {
    id: randomUUID(),
    kind,
    threadId,
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(record.id, record);
  return record;
}

function get(sessionId: string, kind: SessionKind): SessionRecord | null {
  const record = sessions.get(sessionId);
  if (!record || record.kind !== kind) {
    return null;
  }
  return touch(record);
}

function bind(sessionId: string, kind: SessionKind, threadId: string): SessionRecord | null {
  const record = sessions.get(sessionId);
  if (!record || record.kind !== kind) {
    return null;
  }
  record.threadId = threadId;
  return touch(record);
}

function createOrBind(sessionId: string | null | undefined, kind: SessionKind, threadId: string): SessionRecord {
  if (sessionId) {
    const record = bind(sessionId, kind, threadId);
    if (record) {
      return record;
    }
  }
  return create(kind, threadId);
}

function destroy(sessionId: string): void {
  sessions.delete(sessionId);
}

function destroyAll(): void {
  sessions.clear();
}

export const sessionManager = {
  create,
  get,
  bind,
  createOrBind,
  destroy,
  destroyAll,
};
