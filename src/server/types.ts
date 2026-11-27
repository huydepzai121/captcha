// language: TypeScript, file: src/server/types.ts, runtime: Node 22
// Shape dùng chung giữa routes và render. Tách khỏi domain để response
// serialize thủ công — cấm spread nguyên Challenge vào response.

export interface Grid {
  cols: number;
  rows: number;
}

/** Payload `POST /api/challenges` — đã lược bỏ toàn bộ ground truth. */
export interface ChallengeResponse {
  id: string;
  instruction: string;
  grid: Grid;
  imageUrl: string;
  expiresAt: number;
}

export interface VerifyResponse {
  ok: boolean;
  correct: number;
  wrong: number;
  missed: number;
  latencyMs: number;
}

export interface Instruction {
  instruction: string;
}
