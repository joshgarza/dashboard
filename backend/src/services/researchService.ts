import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import type { Response } from 'express';
import { getHopperDb } from './hopperDb.js';
import { initResearchSchema } from './hopperSchema.js';
import { streamCodexTurn } from './codexProvider.js';
import { sessionManager } from './sessionManager.js';

const RESEARCH_PATH = process.env.RESEARCH_PATH || '/home/josh/coding/claude/research';
const KEY_PATTERN = /^(research|principles)\/[a-zA-Z0-9._-]+\.md$/;

initResearchSchema();

interface ResearchFile {
  key: string;
  filename: string;
  type: 'research' | 'principles';
  topic: string;
  date: string;
  tags: string[];
}

interface QueueItem {
  id: string;
  topic: string;
  description: string;
  tags: string[];
  priority: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'review';
  added: string;
  started?: string;
  completed?: string;
  attempts: number;
  maxAttempts: number;
  model: 'sonnet' | 'opus' | 'haiku';
  outputFile?: string;
  error?: string;
}

interface Queue {
  items: QueueItem[];
}

interface EnqueueInput {
  topic: string;
  description?: string;
  tags?: string[];
  priority?: number;
  model?: 'sonnet' | 'opus' | 'haiku';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ResearchChatSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ResearchChatThread extends ResearchChatSummary {
  messages: ChatMessage[];
  selectedFiles: string[];
}

interface ResearchChatThreadRow {
  id: string;
  title: string;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ResearchChatMessageRow {
  role: ChatMessage['role'];
  content: string;
}

interface ResearchChatFileRow {
  file_key: string;
}

interface QueueSvcRow {
  svc_id: number;
  thought_id: number;
  raw_input: string;
  context: string | null;
  thought_created_at: string;
  status: string;
  priority: number;
  model: string;
  max_attempts: number;
  attempts: number;
  output_file: string | null;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

const CHAT_THREADS_SELECT = `
  SELECT
    t.id,
    t.title,
    t.session_id,
    t.created_at,
    t.updated_at
  FROM svc_research_chat_threads t
`;

function parseFrontmatter(content: string): Record<string, string | string[]> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string | string[]> = {};
  for (const line of match[1].split('\n')) {
    const kvMatch = line.match(/^(\w+):\s*(.+)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      if (value.startsWith('[') && value.endsWith(']')) {
        result[key] = value.slice(1, -1).split(',').map(t => t.trim());
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

function scanDir(dirPath: string, type: 'research' | 'principles'): ResearchFile[] {
  if (!fs.existsSync(dirPath)) return [];

  return fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.md'))
    .map(filename => {
      const content = fs.readFileSync(path.join(dirPath, filename), 'utf-8');
      const fm = parseFrontmatter(content);
      return {
        key: `${type}/${filename}`,
        filename,
        type,
        topic: (fm.topic as string) || filename.replace(/\.md$/, ''),
        date: (fm.date as string) || '',
        tags: Array.isArray(fm.tags) ? fm.tags : [],
      };
    });
}

function validateFileKeys(fileKeys: string[]): void {
  for (const key of fileKeys) {
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
      throw new Error('Invalid file key');
    }
  }
}

function buildChatTitle(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.length > 48 ? `${normalized.slice(0, 48).trimEnd()}...` : normalized;
}

function touchResearchChat(db: Database.Database, chatId: string): void {
  db.prepare(`
    UPDATE svc_research_chat_threads
    SET updated_at = datetime('now')
    WHERE id = ?
  `).run(chatId);
}

function writeResearchChatFiles(db: Database.Database, chatId: string, fileKeys: string[]): void {
  db.prepare('DELETE FROM svc_research_chat_thread_files WHERE thread_id = ?').run(chatId);

  const insert = db.prepare(`
    INSERT INTO svc_research_chat_thread_files (thread_id, file_key, sort_order)
    VALUES (?, ?, ?)
  `);

  fileKeys.forEach((fileKey, index) => {
    insert.run(chatId, fileKey, index);
  });
}

function getNextResearchChatSortOrder(db: Database.Database, chatId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
    FROM svc_research_chat_messages
    WHERE thread_id = ?
  `).get(chatId) as { next_sort_order: number };

  return row.next_sort_order;
}

function appendResearchChatMessage(
  db: Database.Database,
  chatId: string,
  role: ChatMessage['role'],
  content: string,
): void {
  db.prepare(`
    INSERT INTO svc_research_chat_messages (thread_id, role, content, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(chatId, role, content, getNextResearchChatSortOrder(db, chatId));
}

function getResearchChatThreadRow(
  db: Database.Database,
  chatId: string,
): ResearchChatThreadRow | null {
  const row = db.prepare(`${CHAT_THREADS_SELECT} WHERE t.id = ?`).get(chatId) as ResearchChatThreadRow | undefined;
  return row ?? null;
}

function getResearchChatMessages(db: Database.Database, chatId: string): ChatMessage[] {
  const rows = db.prepare(`
    SELECT role, content
    FROM svc_research_chat_messages
    WHERE thread_id = ?
    ORDER BY sort_order ASC
  `).all(chatId) as ResearchChatMessageRow[];

  return rows.map((row) => ({ role: row.role, content: row.content }));
}

function getResearchChatSelectedFiles(db: Database.Database, chatId: string): string[] {
  const rows = db.prepare(`
    SELECT file_key
    FROM svc_research_chat_thread_files
    WHERE thread_id = ?
    ORDER BY sort_order ASC
  `).all(chatId) as ResearchChatFileRow[];

  return rows.map((row) => row.file_key);
}

function getResearchChatMessageCount(db: Database.Database, chatId: string): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM svc_research_chat_messages
    WHERE thread_id = ?
  `).get(chatId) as { count: number };

  return row.count;
}

function mapResearchChatSummary(
  db: Database.Database,
  thread: ResearchChatThreadRow,
): ResearchChatSummary {
  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    messageCount: getResearchChatMessageCount(db, thread.id),
  };
}

function persistResearchChatSessionId(chatId: string, sessionId: string): void {
  const db = getHopperDb();
  db.prepare(`
    UPDATE svc_research_chat_threads
    SET session_id = ?
    WHERE id = ?
  `).run(sessionId, chatId);
}

export function listResearchFiles(): ResearchFile[] {
  const researchDir = path.join(RESEARCH_PATH, 'research');
  const principlesDir = path.join(RESEARCH_PATH, 'principles');

  return [
    ...scanDir(researchDir, 'research'),
    ...scanDir(principlesDir, 'principles'),
  ];
}

export function loadFileContent(key: string): string {
  if (!KEY_PATTERN.test(key)) {
    throw new Error('Invalid file key');
  }

  const filePath = path.join(RESEARCH_PATH, key);
  if (!fs.existsSync(filePath)) {
    throw new Error('File not found');
  }

  return fs.readFileSync(filePath, 'utf-8');
}

function queueSvcRowToQueueItem(row: QueueSvcRow): QueueItem {
  let ctx: { topic?: string; tags?: string[] } = {};
  try {
    ctx = JSON.parse(row.context ?? '{}');
  } catch {
    // Ignore malformed hopper context payloads.
  }

  return {
    id: `t-${row.thought_id}`,
    topic: ctx.topic ?? row.raw_input,
    description: row.raw_input,
    tags: Array.isArray(ctx.tags) ? ctx.tags : [],
    priority: row.priority,
    status: row.status as QueueItem['status'],
    added: row.thought_created_at,
    started: row.started_at ?? undefined,
    completed: row.completed_at ?? undefined,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    model: row.model as QueueItem['model'],
    outputFile: row.output_file ?? undefined,
    error: row.error ?? undefined,
  };
}

const SVC_SELECT = `
  SELECT
    svc.id AS svc_id,
    svc.thought_id,
    t.raw_input,
    t.context,
    t.created_at AS thought_created_at,
    svc.status,
    svc.priority,
    svc.model,
    svc.max_attempts,
    svc.attempts,
    svc.output_file,
    svc.started_at,
    svc.completed_at,
    svc.error
  FROM svc_research_queue_items svc
  JOIN thoughts t ON t.id = svc.thought_id
`;

export function getQueue(): Queue {
  const db = getHopperDb();
  const rows = db.prepare(
    `${SVC_SELECT} ORDER BY svc.priority ASC, svc.created_at ASC`
  ).all() as QueueSvcRow[];

  return { items: rows.map(queueSvcRowToQueueItem) };
}

export function enqueueTopic(input: EnqueueInput): QueueItem {
  const db = getHopperDb();
  const tags = input.tags ?? [];
  const context = JSON.stringify({ topic: input.topic, tags });

  const thoughtResult = db.prepare(`
    INSERT INTO thoughts (raw_input, category, status, context, created_at)
    VALUES (?, 'research-topic', 'pending', ?, datetime('now'))
  `).run(input.description ?? input.topic, context);
  const thoughtId = thoughtResult.lastInsertRowid as number;

  for (const tagName of tags) {
    let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as { id: number } | undefined;
    if (!tag) {
      const result = db.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName);
      tag = { id: result.lastInsertRowid as number };
    }
    db.prepare('INSERT OR IGNORE INTO thought_tags (thought_id, tag_id) VALUES (?, ?)').run(thoughtId, tag.id);
  }

  const priority = input.priority ?? 5;
  const model = input.model ?? 'sonnet';

  const svcResult = db.prepare(`
    INSERT INTO svc_research_queue_items (thought_id, status, priority, model, max_attempts, attempts)
    VALUES (?, 'queued', ?, ?, 2, 0)
  `).run(thoughtId, priority, model);
  const svcId = svcResult.lastInsertRowid as number;

  const row = db.prepare(`${SVC_SELECT} WHERE svc.id = ?`).get(svcId) as QueueSvcRow;
  return queueSvcRowToQueueItem(row);
}

export function listResearchChats(): ResearchChatSummary[] {
  const db = getHopperDb();
  const rows = db.prepare(`
    SELECT
      t.id,
      t.title,
      t.session_id,
      t.created_at,
      t.updated_at
    FROM svc_research_chat_threads t
    ORDER BY t.updated_at DESC, t.created_at DESC
  `).all() as ResearchChatThreadRow[];

  return rows.map((row) => mapResearchChatSummary(db, row));
}

export function getResearchChat(chatId: string): ResearchChatThread | null {
  const db = getHopperDb();
  const thread = getResearchChatThreadRow(db, chatId);

  if (!thread) {
    return null;
  }

  return {
    ...mapResearchChatSummary(db, thread),
    messages: getResearchChatMessages(db, chatId),
    selectedFiles: getResearchChatSelectedFiles(db, chatId),
  };
}

export function updateResearchChatFiles(chatId: string, fileKeys: string[]): ResearchChatThread | null {
  validateFileKeys(fileKeys);

  const db = getHopperDb();
  const transaction = db.transaction(() => {
    const thread = getResearchChatThreadRow(db, chatId);
    if (!thread) {
      return null;
    }

    writeResearchChatFiles(db, chatId, fileKeys);
    touchResearchChat(db, chatId);
    return getResearchChat(chatId);
  });

  return transaction();
}

function streamChatMessage(
  message: string,
  messages: ChatMessage[],
  fileKeys: string[],
  sessionId: string | null,
  res: Response,
  options: {
    chatId: string;
    initialEvents?: Array<Record<string, unknown>>;
  },
): Promise<void> {
  const hasActiveSession = !!(sessionId && sessionManager.get(sessionId, 'research'));
  const fileContents = fileKeys.map((key) => ({
    key,
    content: loadFileContent(key),
  }));

  const fileContext = fileContents
    .map((file) => `--- ${file.key} ---\n${file.content}`)
    .join('\n\n');

  const systemBlock = `You are a research assistant. Answer questions, synthesize information, and help the user explore their research.\n\n${fileContext}`;
  const history = [...messages, { role: 'user' as const, content: message }]
    .map((entry) => entry.role === 'user' ? `Human: ${entry.content}` : `Assistant: ${entry.content}`)
    .join('\n\n');

  const prompt = hasActiveSession
    ? `${systemBlock}\n\nContinue the ongoing conversation. The user's latest message is:\nHuman: ${message}`
    : `${systemBlock}\n\n${history}`;

  return streamCodexTurn({
    kind: 'research',
    sessionId,
    input: prompt,
    response: res,
    initialEvents: options.initialEvents,
    onSessionId: (resolvedSessionId) => {
      persistResearchChatSessionId(options.chatId, resolvedSessionId);
    },
    onComplete: (assistantResponse) => {
      const db = getHopperDb();
      const transaction = db.transaction(() => {
        appendResearchChatMessage(db, options.chatId, 'assistant', assistantResponse);
        touchResearchChat(db, options.chatId);
      });
      transaction();
    },
    onError: (errorMessage) => {
      const db = getHopperDb();
      const transaction = db.transaction(() => {
        appendResearchChatMessage(db, options.chatId, 'assistant', `Error: ${errorMessage}`);
        touchResearchChat(db, options.chatId);
      });
      transaction();
    },
  });
}

export function streamPersistedChatMessage(
  message: string,
  chatId: string | null,
  fileKeys: string[],
  res: Response,
): Promise<void> {
  validateFileKeys(fileKeys);

  const db = getHopperDb();
  const transaction = db.transaction(() => {
    if (chatId) {
      const thread = getResearchChatThreadRow(db, chatId);
      if (!thread) {
        throw new Error('Research chat not found');
      }

      const previousMessages = getResearchChatMessages(db, chatId);
      writeResearchChatFiles(db, chatId, fileKeys);
      appendResearchChatMessage(db, chatId, 'user', message);
      touchResearchChat(db, chatId);

      return {
        chatId,
        previousMessages,
        fileKeys,
        sessionId: thread.session_id,
        initialEvents: [] as Array<Record<string, unknown>>,
      };
    }

    const nextChatId = randomUUID();
    const title = buildChatTitle(message);

    db.prepare(`
      INSERT INTO svc_research_chat_threads (id, title, session_id)
      VALUES (?, ?, NULL)
    `).run(nextChatId, title);

    writeResearchChatFiles(db, nextChatId, fileKeys);
    appendResearchChatMessage(db, nextChatId, 'user', message);
    touchResearchChat(db, nextChatId);

    const thread = getResearchChatThreadRow(db, nextChatId);
    if (!thread) {
      throw new Error('Failed to create research chat');
    }

    return {
      chatId: nextChatId,
      previousMessages: [] as ChatMessage[],
      fileKeys,
      sessionId: null,
      initialEvents: [
        {
          type: 'chat_created',
          chat: mapResearchChatSummary(db, thread),
        },
      ],
    };
  });

  const state = transaction();

  return streamChatMessage(
    message,
    state.previousMessages,
    state.fileKeys,
    state.sessionId,
    res,
    {
      chatId: state.chatId,
      initialEvents: state.initialEvents,
    },
  );
}
