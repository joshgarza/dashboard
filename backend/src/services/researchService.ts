import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type { Response } from 'express';

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

export function getQueue(): Queue {
  const queuePath = path.join(RESEARCH_PATH, 'automation', 'queue.json');
  return JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
}

export function enqueueTopic(input: EnqueueInput): QueueItem {
  const queuePath = path.join(RESEARCH_PATH, 'automation', 'queue.json');
  const queue: Queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));

  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');

  const item: QueueItem = {
    id: `q-${date}-${seq}`,
    topic: input.topic,
    description: input.description || input.topic,
    tags: input.tags || [],
    priority: input.priority ?? 5,
    status: 'queued',
    added: new Date().toISOString(),
    attempts: 0,
    maxAttempts: 2,
    model: input.model || 'sonnet',
  };

  queue.items.push(item);
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2) + '\n');

  return item;
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
