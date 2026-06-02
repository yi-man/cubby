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
