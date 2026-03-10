import os from 'os';
import { Codex } from '@openai/codex-sdk';

type ProbeMode = 'new' | 'resume';

interface ProbeSummary {
  mode: ProbeMode;
  homeDir: string;
  threadId: string | null;
  eventTypes: string[];
  finalResponse: string;
}

function getMode(): ProbeMode {
  const arg = process.argv[2];
  if (arg === 'resume') return 'resume';
  return 'new';
}

function getThreadIdArg(): string {
  const threadId = process.argv[3];
  if (!threadId) {
    throw new Error('threadId is required for resume mode');
  }
  return threadId;
}

async function collectSummary(mode: ProbeMode, threadIdArg?: string): Promise<ProbeSummary> {
  const codex = new Codex({
    env: {
      HOME: process.env.HOME ?? os.homedir(),
      PATH: process.env.PATH ?? '',
      TERM: process.env.TERM ?? 'xterm-256color',
    },
  });
  const thread = mode === 'resume'
    ? codex.resumeThread(getThreadIdArg(), {
      workingDirectory: '/app',
      skipGitRepoCheck: true,
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
    })
    : codex.startThread({
      workingDirectory: '/app',
      skipGitRepoCheck: true,
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
    });

  const prompt = mode === 'resume'
    ? 'What exact token did I ask you to remember from the previous turn? Reply with only that token.'
    : 'Remember this exact token for the next turn: BLUE_RIVER_731. Reply with only BLUE_RIVER_731.';

  const { events } = await thread.runStreamed(prompt);
  const eventTypes: string[] = [];
  let finalResponse = '';

  for await (const event of events) {
    eventTypes.push(event.type);

    if (event.type === 'item.completed' && event.item.type === 'agent_message') {
      finalResponse = event.item.text;
    }

    if (event.type === 'turn.failed') {
      throw new Error(event.error.message);
    }

    if (event.type === 'error') {
      throw new Error(event.message);
    }
  }

  return {
    mode,
    homeDir: os.homedir(),
    threadId: mode === 'resume' ? threadIdArg ?? thread.id : thread.id,
    eventTypes,
    finalResponse,
  };
}

async function main() {
  const mode = getMode();
  const summary = await collectSummary(mode, process.argv[3]);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
