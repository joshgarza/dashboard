import { jest } from '@jest/globals';

const startThreadMock = jest.fn();
const resumeThreadMock = jest.fn();
const runMock = jest.fn();
const runStreamedMock = jest.fn();
const codexConstructorMock = jest.fn();

jest.unstable_mockModule('@openai/codex-sdk', () => ({
  Codex: class MockCodex {
    constructor(...args: unknown[]) {
      codexConstructorMock(...args);
    }

    startThread = startThreadMock;
    resumeThread = resumeThreadMock;
  },
}));

const { runCodexStructuredTask, streamCodexTurn } = await import('../src/services/codexProvider.js');
const { sessionManager } = await import('../src/services/sessionManager.js');

function createThread(id = 'thread-123') {
  return {
    id,
    run: runMock,
    runStreamed: runStreamedMock,
  };
}

function createResponseMock() {
  return {
    headersSent: false,
    writableEnded: false,
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(function (this: { writableEnded: boolean }) {
      this.writableEnded = true;
    }),
    on: jest.fn(),
  };
}

describe('codexProvider', () => {
  const originalModel = process.env.CODEX_MODEL;
  const originalReasoningEffort = process.env.CODEX_REASONING_EFFORT;

  beforeEach(() => {
    delete process.env.CODEX_MODEL;
    delete process.env.CODEX_REASONING_EFFORT;
    startThreadMock.mockReset();
    resumeThreadMock.mockReset();
    runMock.mockReset();
    runStreamedMock.mockReset();
    codexConstructorMock.mockClear();
    sessionManager.destroyAll();
  });

  afterAll(() => {
    if (originalModel === undefined) {
      delete process.env.CODEX_MODEL;
    } else {
      process.env.CODEX_MODEL = originalModel;
    }

    if (originalReasoningEffort === undefined) {
      delete process.env.CODEX_REASONING_EFFORT;
    } else {
      process.env.CODEX_REASONING_EFFORT = originalReasoningEffort;
    }
  });

  it('logs and forwards the default model and reasoning for structured tasks', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    startThreadMock.mockReturnValue(createThread());
    runMock.mockResolvedValue({
      items: [],
      finalResponse: '{"ok":true}',
      usage: null,
    });

    const result = await runCodexStructuredTask('Generate a plan', {
      type: 'object',
      properties: {},
      additionalProperties: false,
    });

    expect(result).toBe('{"ok":true}');
    expect(startThreadMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.4',
      modelReasoningEffort: 'high',
    }));
    expect(infoSpy).toHaveBeenCalledWith(
      '[codex] source=task model=gpt-5.4 reasoning=high',
    );

    infoSpy.mockRestore();
  });

  it('logs and forwards env overrides for streaming weekly-review turns', async () => {
    process.env.CODEX_MODEL = 'gpt-5.3-codex';
    process.env.CODEX_REASONING_EFFORT = 'high';

    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    startThreadMock.mockReturnValue(createThread('thread-stream'));
    runStreamedMock.mockResolvedValue({
      events: (async function* () {
        yield { type: 'thread.started', thread_id: 'thread-stream' };
        yield {
          type: 'item.completed',
          item: {
            id: 'message-1',
            type: 'agent_message',
            text: 'Here is the review kickoff.',
          },
        };
        yield {
          type: 'turn.completed',
          usage: {
            input_tokens: 10,
            cached_input_tokens: 0,
            output_tokens: 6,
          },
        };
      })(),
    });

    const response = createResponseMock();

    await streamCodexTurn({
      kind: 'weekly-review',
      sessionId: null,
      input: 'Start the weekly review.',
      response: response as never,
    });

    expect(startThreadMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.3-codex',
      modelReasoningEffort: 'high',
    }));
    expect(infoSpy).toHaveBeenCalledWith(
      '[codex] source=start kind=weekly-review model=gpt-5.3-codex reasoning=high',
    );
    expect(response.write).toHaveBeenCalled();
    expect(response.end).toHaveBeenCalled();

    infoSpy.mockRestore();
  });
});
