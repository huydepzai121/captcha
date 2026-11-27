// language: TypeScript, file: src/domain/solver.ts, runtime: Node 22
// Contract của solver (spec click-solver). Type + hằng số, không logic nặng.

export interface GridBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridShape {
  cols: number;
  rows: number;
}

export interface SolveRequest {
  /** PNG của viewport tại thời điểm solve. */
  screenshot: Buffer;
  instruction: string;
  grid: GridShape;
  /** Vị trí lưới trong screenshot, toạ độ pixel. */
  gridBox: GridBox;
  challengeId: string;
}

export interface TokenUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  costUsd?: number | undefined;
}

/** Lý do thất bại được ghi vào attempt. Tập đóng — report phân rã theo đúng tập này. */
export type FailureReason =
  | 'timeout'
  | 'bad_schema'
  | 'click_outside_grid'
  | 'wrong_tiles'
  | 'expired'
  | 'judge_error';

export interface SolveResult {
  /** Toạ độ tuyệt đối trong screenshot. Rỗng nghĩa là model không trả gì dùng được. */
  clicks: Array<{ x: number; y: number }>;
  latencyMs: number;
  /** Nội dung thô của model, giữ để soi lại khi sai schema. */
  rawResponse?: string;
  usage?: TokenUsage;
  /** `model` = toạ độ do model trả; `derived` = adapter tự suy từ chỉ số ô. */
  coordSource: 'model' | 'derived';
}

export interface ClickSolver {
  readonly name: string;
  readonly coordSpace: 'absolute' | 'normalized';
  solve(req: SolveRequest): Promise<SolveResult>;
}

/** Timeout mặc định cho mọi lời gọi solver (spec: vượt 30s là FAILED, không retry). */
export const SOLVER_TIMEOUT_MS = 30_000;

/** Chọn ô theo `gridBox`; điểm ngoài lưới trả null và tính là click hỏng. */
export function pointToTile(
  point: { x: number; y: number },
  gridBox: GridBox,
  grid: GridShape,
): number | null {
  if (point.x < gridBox.x || point.y < gridBox.y) return null;
  if (point.x >= gridBox.x + gridBox.w || point.y >= gridBox.y + gridBox.h) return null;

  const col = Math.floor(((point.x - gridBox.x) / gridBox.w) * grid.cols);
  const row = Math.floor(((point.y - gridBox.y) / gridBox.h) * grid.rows);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null;
  return row * grid.cols + col;
}
