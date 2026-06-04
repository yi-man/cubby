export interface Terminal {
  id: string;
  sessionId: string;
  title: string | null;
  pid: number | null;
  cols: number;
  rows: number;
  createdAt: string;
}

export interface TerminalOutput {
  terminalId: string;
  data: string;
  timestamp: number;
}

export interface TerminalOutputChunk {
  data: string;
  seqStart: number;
  seq: number;
}

export type TerminalReplayResult =
  | {
      status: 'ok';
      sessionId: string;
      chunks: TerminalOutputChunk[];
      seq: number;
    }
  | {
      status: 'too_old';
      sessionId: string;
      oldestSeq: number;
      seq: number;
    }
  | {
      status: 'unknown';
      sessionId: string;
    };

export type RecoveryReconcileResult =
  | {
      action: 'noop';
      sessionId: string;
      headSeq: number;
    }
  | {
      action: 'replay';
      sessionId: string;
      fromSeq: number;
      headSeq: number;
    }
  | {
      action: 'closed';
      sessionId: string;
      headSeq: number;
      exitCode?: number | null;
    }
  | {
      action: 'unrecoverable';
      sessionId: string;
      reason: 'too_old_no_snapshot' | 'unknown_session';
    };
