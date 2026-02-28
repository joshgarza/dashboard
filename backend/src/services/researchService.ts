import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type { Response } from 'express';
import { getHopperDb } from './hopperDb.js';

const RESEARCH_PATH = process.env.RESEARCH_PATH || '/home/josh/coding/claude/research';
const KEY_PATTERN = /^(research|principles)\/[a-zA-Z0-9._-]+\.md$/;

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

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function parseFrontmatter(content: string): Record<string, string | string[]> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string | string[]> = {};
  for (const line of match[1].split('\n')) {
    const kvMatch = line.match(/^(\w+):\s*(.+)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      // Handle YAML arrays like [tag1, tag2]
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

type SvcRow = {
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
};

function svcRowToQueueItem(row: SvcRow): QueueItem {
  let ctx: { topic?: string; tags?: string[] } = {};
  try { ctx = JSON.parse(row.context ?? '{}'); } catch { /* ignore */ }
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
  ).all() as SvcRow[];
  return { items: rows.map(svcRowToQueueItem) };
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
      const r = db.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName);
      tag = { id: r.lastInsertRowid as number };
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

  const row = db.prepare(`${SVC_SELECT} WHERE svc.id = ?`).get(svcId) as SvcRow;
  return svcRowToQueueItem(row);
}

export function streamChat(
  fileContents: { key: string; content: string }[],
  messages: ChatMessage[],
  res: Response,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fileContext = fileContents
      .map(f => `--- ${f.key} ---\n${f.content}`)
      .join('\n\n');

    // Build conversation into a single prompt for claude -p
    const systemBlock = `You are a research assistant. Answer questions, synthesize information, and help the user explore their research.\n\n${fileContext}`;

    const conversationLines = messages.map(m =>
      m.role === 'user' ? `Human: ${m.content}` : `Assistant: ${m.content}`
    );

    const prompt = `${systemBlock}\n\n${conversationLines.join('\n\n')}`;

    const claudeBin = path.resolve(import.meta.dirname, '../../node_modules/.bin/claude');

    const child = spawn(claudeBin, ['-p', prompt, '--output-format', 'stream-json', '--verbose'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'assistant' && event.message?.content) {
            const text = event.message.content
              .map((b: { text?: string }) => b.text || '')
              .join('');
            if (text) {
              res.write(`data: ${JSON.stringify({ type: 'content_block_delta', text })}\n\n`);
            }
          }
        } catch {
          // skip malformed lines
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      console.error('[claude stderr]', chunk.toString());
    });

    child.on('close', (code) => {
      // flush remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          if (event.type === 'assistant' && event.subtype === 'text') {
            res.write(`data: ${JSON.stringify({ type: 'content_block_delta', text: event.text })}\n\n`);
          }
        } catch {
          // ignore
        }
      }
      res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      res.end();
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}`));
      } else {
        resolve();
      }
    });

    child.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'content_block_delta', text: `Error: ${err.message}` })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      res.end();
      reject(err);
    });

    // If the client disconnects, kill the child process
    res.on('close', () => {
      if (!child.killed) child.kill();
    });
  });
}
