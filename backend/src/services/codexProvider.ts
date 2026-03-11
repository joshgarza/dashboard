import os from 'os';
import { Codex } from '@openai/codex-sdk';
import type { Thread, ThreadEvent } from '@openai/codex-sdk';
import type { Response } from 'express';
import { sessionManager, type SessionKind } from './sessionManager.js';

interface StreamCodexTurnOptions {
  kind: SessionKind;
  sessionId?: string | null;
  input: string;
  response: Response;
  initialEvents?: Array<Record<string, unknown>>;
  transformText?: (text: string) => string;
  onSessionId?: (sessionId: string) => void;
  onComplete?: (fullResponseText: string) => void;
  onError?: (errorMessage: string) => void;
}

interface CodexThreadState {
  thread: Thread;
  sessionId: string | null;
  resumed: boolean;
}

function createCodexClient(): Codex {
  return new Codex({
    env: {
      HOME: process.env.HOME ?? os.homedir(),
      PATH: process.env.PATH ?? '',
      TERM: process.env.TERM ?? 'xterm-256color',
    },
  });
}

let codexClient: Codex | null = null;

function getCodexClient(): Codex {
  if (!codexClient) {
    codexClient = createCodexClient();
  }
  return codexClient;
}

function getThreadOptions() {
  return {
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
    sandboxMode: 'read-only' as const,
    approvalPolicy: 'never' as const,
    networkAccessEnabled: false,
    model: process.env.CODEX_MODEL || undefined,
  };
}

function getThreadState(kind: SessionKind, sessionId?: string | null): CodexThreadState {
  const client = getCodexClient();

  if (sessionId) {
    const record = sessionManager.get(sessionId, kind);
    if (record) {
      return {
        thread: client.resumeThread(record.threadId, getThreadOptions()),
        sessionId: record.id,
        resumed: true,
      };
    }
  }

  return {
    thread: client.startThread(getThreadOptions()),
    sessionId: null,
    resumed: false,
  };
}

function writeSse(response: Response, payload: Record<string, unknown>): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function ensureSseHeaders(response: Response): void {
  if (response.headersSent) {
    return;
  }

  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();
}

function getVisibleDelta(
  previousRawText: string,
  nextRawText: string,
  transformText: (text: string) => string,
): string {
  const previousVisible = transformText(previousRawText);
  const nextVisible = transformText(nextRawText);

  if (nextVisible.startsWith(previousVisible)) {
    return nextVisible.slice(previousVisible.length);
  }

  return nextVisible;
}

function isAgentMessageEvent(event: ThreadEvent): event is Extract<ThreadEvent, { type: 'item.updated' | 'item.completed' }> {
  return (event.type === 'item.updated' || event.type === 'item.completed') && event.item.type === 'agent_message';
}

export async function streamCodexTurn({
  kind,
  sessionId,
  input,
  response,
  initialEvents = [],
  transformText = (text) => text,
  onSessionId,
  onComplete,
  onError,
}: StreamCodexTurnOptions): Promise<void> {
  const state = getThreadState(kind, sessionId);
  const itemText = new Map<string, string>();
  let resolvedSessionId = state.sessionId;
  let fullResponseText = '';
  let completed = false;
  const controller = new AbortController();

  ensureSseHeaders(response);

  for (const payload of initialEvents) {
    writeSse(response, payload);
  }

  response.on('close', () => {
    if (!response.writableEnded) {
      controller.abort();
    }
  });

  try {
    const { events } = await state.thread.runStreamed(input, { signal: controller.signal });

    for await (const event of events) {
      if (event.type === 'thread.started') {
        const record = sessionManager.createOrBind(resolvedSessionId, kind, event.thread_id);
        resolvedSessionId = record.id;
        onSessionId?.(record.id);
        writeSse(response, { type: 'session_id', sessionId: record.id });
        continue;
      }

      if (isAgentMessageEvent(event)) {
        const messageItem = event.item as { id: string; text: string };
        const previous = itemText.get(event.item.id) ?? '';
        const next = messageItem.text;
        itemText.set(event.item.id, next);

        const delta = getVisibleDelta(previous, next, transformText);
        if (delta) {
          writeSse(response, { type: 'content_block_delta', text: delta });
        }

        if (event.type === 'item.completed') {
          fullResponseText = next;
        }
        continue;
      }

      if (event.type === 'turn.failed') {
        throw new Error(event.error.message);
      }

      if (event.type === 'error') {
        throw new Error(event.message);
      }
    }

    if (!resolvedSessionId && state.thread.id) {
      const record = sessionManager.create(kind, state.thread.id);
      resolvedSessionId = record.id;
      onSessionId?.(record.id);
      writeSse(response, { type: 'session_id', sessionId: record.id });
    }

    if (fullResponseText && onComplete) {
      onComplete(fullResponseText);
    }

    completed = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onError?.(message);
    writeSse(response, { type: 'content_block_delta', text: `Error: ${message}` });
    throw error;
  } finally {
    writeSse(response, { type: 'message_stop' });
    response.end();
    if (!completed && resolvedSessionId) {
      sessionManager.destroy(resolvedSessionId);
    }
  }
}

export async function runCodexTextTask(prompt: string): Promise<string> {
  const thread = getCodexClient().startThread(getThreadOptions());
  const turn = await thread.run(prompt);
  return turn.finalResponse.trim();
}

export async function runCodexStructuredTask<TSchema extends Record<string, unknown>>(
  prompt: string,
  outputSchema: TSchema,
): Promise<string> {
  const thread = getCodexClient().startThread(getThreadOptions());
  const turn = await thread.run(prompt, { outputSchema });
  return turn.finalResponse.trim();
}
