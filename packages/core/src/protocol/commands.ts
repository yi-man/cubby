export const WS_COMMANDS = {
  SESSION_CREATE: 'session.create',
  SESSION_START: 'session.start',
  SESSION_RESUME: 'session.resume',
  SESSION_KILL: 'session.kill',
  SESSION_LIST: 'session.list',
  SESSION_GET: 'session.get',
  RECOVERY_RECONCILE: 'recovery.reconcile',
  TERMINAL_SUBSCRIBE: 'terminal.subscribe',
  TERMINAL_UNSUBSCRIBE: 'terminal.unsubscribe',
  TERMINAL_REPLAY: 'terminal.replay',
  TERMINAL_SNAPSHOT: 'terminal.snapshot',
  TERMINAL_INPUT: 'terminal.input',
  TERMINAL_RESIZE: 'terminal.resize',
} as const;

export type WSCommand = (typeof WS_COMMANDS)[keyof typeof WS_COMMANDS];

export const WS_EVENTS = {
  SESSION_STATUS: 'session.status',
  SESSION_CREATED: 'session.created',
  SESSION_UPDATED: 'session.updated',
  TERMINAL_OUTPUT: 'terminal.output',
  TERMINAL_EXIT: 'terminal.exit',
} as const;

export type WSEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];
