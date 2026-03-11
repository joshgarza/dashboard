import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import { errorHandler } from '../src/middleware/errorHandler.js';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');

const streamCodexTurnMock = jest.fn(async ({
  response,
  initialEvents = [],
  onSessionId,
  onComplete,
}: {
  response: express.Response;
  initialEvents?: Array<Record<string, unknown>>;
  onSessionId?: (sessionId: string) => void;
  onComplete?: (fullResponseText: string) => void;
}) => {
  response.setHeader('Content-Type', 'text/event-stream');

  for (const payload of initialEvents) {
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  onSessionId?.('session-123');
  response.write(`data: ${JSON.stringify({ type: 'session_id', sessionId: 'session-123' })}\n\n`);
  response.write(`data: ${JSON.stringify({ type: 'content_block_delta', text: 'Mock assistant response' })}\n\n`);
  onComplete?.('Mock assistant response');
  response.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
  response.end();
});

jest.unstable_mockModule('../src/services/hopperDb.js', () => ({
  getHopperDb: () => db,
}));

jest.unstable_mockModule('../src/services/codexProvider.js', () => ({
  streamCodexTurn: streamCodexTurnMock,
}));

const { researchRouter } = await import('../src/routes/research.js');

const app = express();
app.use(express.json());
app.use('/api', researchRouter);
app.use(errorHandler);

function parseSsePayloads(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

describe('Research API', () => {
  beforeEach(() => {
    streamCodexTurnMock.mockClear();
    db.exec('DELETE FROM svc_research_chat_messages');
    db.exec('DELETE FROM svc_research_chat_thread_files');
    db.exec('DELETE FROM svc_research_chat_threads');
  });

  it('lists saved research chats from the database', async () => {
    const response = await request(app).get('/api/research/chats');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([]);
  });

  it('creates and persists a research chat during streaming', async () => {
    const response = await request(app)
      .post('/api/research/chat')
      .send({ message: 'How do HTTP caches work?', files: [] });

    expect(response.status).toBe(200);

    const events = parseSsePayloads(response.text);
    const createdEvent = events.find((event) => event.type === 'chat_created') as
      | { chat?: { id: string; title: string } }
      | undefined;

    expect(createdEvent?.chat?.id).toBeTruthy();
    expect(createdEvent?.chat?.title).toBe('How do HTTP caches work?');

    const chatsResponse = await request(app).get('/api/research/chats');
    expect(chatsResponse.body.data).toHaveLength(1);
    expect(chatsResponse.body.data[0]).toMatchObject({
      id: createdEvent?.chat?.id,
      title: 'How do HTTP caches work?',
      messageCount: 2,
    });

    const detailResponse = await request(app).get(`/api/research/chats/${createdEvent?.chat?.id}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.messages).toEqual([
      { role: 'user', content: 'How do HTTP caches work?' },
      { role: 'assistant', content: 'Mock assistant response' },
    ]);
    expect(detailResponse.body.data.selectedFiles).toEqual([]);
  });

  it('reuses the stored session id and appends follow-up messages to the same chat', async () => {
    const createResponse = await request(app)
      .post('/api/research/chat')
      .send({ message: 'Explain stale-while-revalidate', files: [] });

    const createdEvent = parseSsePayloads(createResponse.text).find((event) => event.type === 'chat_created') as
      | { chat?: { id: string } }
      | undefined;
    const chatId = createdEvent?.chat?.id;

    expect(chatId).toBeTruthy();

    const followUpResponse = await request(app)
      .post('/api/research/chat')
      .send({ chatId, message: 'Now compare it to ETags', files: [] });

    expect(followUpResponse.status).toBe(200);
    expect(streamCodexTurnMock).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: 'session-123',
    }));

    const detailResponse = await request(app).get(`/api/research/chats/${chatId}`);
    expect(detailResponse.body.data.messages).toEqual([
      { role: 'user', content: 'Explain stale-while-revalidate' },
      { role: 'assistant', content: 'Mock assistant response' },
      { role: 'user', content: 'Now compare it to ETags' },
      { role: 'assistant', content: 'Mock assistant response' },
    ]);
  });

  it('updates selected files for an existing chat', async () => {
    const createResponse = await request(app)
      .post('/api/research/chat')
      .send({ message: 'Summarize backend API guidance', files: [] });

    const createdEvent = parseSsePayloads(createResponse.text).find((event) => event.type === 'chat_created') as
      | { chat?: { id: string } }
      | undefined;
    const chatId = createdEvent?.chat?.id;

    const patchResponse = await request(app)
      .patch(`/api/research/chats/${chatId}`)
      .send({
        selectedFiles: [
          'research/http-caching.md',
          'principles/backend-api-engineering.md',
        ],
      });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.data.selectedFiles).toEqual([
      'research/http-caching.md',
      'principles/backend-api-engineering.md',
    ]);
  });
});
