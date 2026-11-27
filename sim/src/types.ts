// Shared event contract giữa server (Playwright runner) và dashboard UI.

export type RunStatus =
  | 'SPAWNED'
  | 'FETCHING'
  | 'ANALYZING'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'COMPLETE'
  | 'FAILED';

export interface ChallengeEvent {
  type: 'challenge';
  instruction: string;
  cols: number;
  rows: number;
  imageBase64: string; // JPEG data của grid challenge
  index: number; // thứ tự challenge trong run
}

export interface ClickEvent {
  type: 'click';
  tile: number; // 0..cols*rows-1
  x: number; // toạ độ tuyệt đối trong viewport (px)
  y: number;
}

export interface LogEvent {
  type: 'log';
  status: RunStatus | 'INFO' | 'NET';
  message: string;
  ts: number;
  net?: { provider: string; host: string; latencyMs: number; usage?: string };
}

export interface ResultEvent {
  type: 'result';
  solved: boolean;
  challenges: number; // số challenge đã đi qua
  reason: string;
  durationMs: number;
}

export interface StatsEvent {
  type: 'stats';
  running: boolean;
  solver: string;
  solved: number;
  failed: number;
}

export type SimEvent = ChallengeEvent | ClickEvent | LogEvent | ResultEvent | StatsEvent;