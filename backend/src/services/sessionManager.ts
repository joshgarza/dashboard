// Placeholder - session management not currently used.
// The stream-json input format and --resume flags don't work reliably
// with `claude -p`, so we spawn a fresh process per message and replay
// conversation history. This file exists so imports don't break.

export const sessionManager = {
  destroyAll() {},
  destroy(_sessionId: string) {},
};
