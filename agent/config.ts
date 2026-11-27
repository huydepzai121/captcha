// language: TypeScript, file: agent/config.ts, runtime: Node 22
// Cấu hình chung cho agent. Key không commit — chỉ đọc từ env hoặc .env.
//
// HAI surface, đừng lẫn:
//   - Decision: TypeSafe API (api.typesafe.ai). Nhận ẢNH qua `assets`, trả
//     noul/box/choice có xác suất. Đây là bên quyết định của agent.
//   - Vision: AI Gateway chat/completions. Chỉ còn dùng làm đường lùi và cho
//     các script soi chất lượng.
// Key `apikey_…` là key TypeSafe: dùng được ở api.typesafe.ai, KHÔNG dùng được
// ở ai-gateway.vercel.sh (trả 401).

export const GATEWAY_BASE = 'https://ai-gateway.vercel.sh';
export const TYPESAFE_BASE = 'https://api.typesafe.ai';

/** Header bắt buộc cho request có ảnh hoặc câu hỏi box (đang là danger zone). */
export const DANGER_ZONE_HEADER = 'TypeSafe-Danger-Zone-Images';

/** Model decision — nhận ảnh, trả xác suất, không trả văn bản. */
export const DECISION_MODEL = 'jev-latest';

/** Model vision mặc định cho đường lùi — rẻ, hỗ trợ image input. */
export const DEFAULT_VISION_MODEL = 'deepseek/deepseek-v4.1-flash';

/** Đích demo chính thức của Google để kiểm thử tích hợp reCAPTCHA. */
export const DEMO_URL = 'https://www.google.com/recaptcha/api2/demo';

export const ANCHOR_FRAME = 'iframe[src*="api2/anchor"]';
export const CHALLENGE_FRAME = 'iframe[src*="api2/bframe"]';

export function requireApiKey(): string {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) {
    throw new Error('AI_GATEWAY_API_KEY chưa set — agent cần key để gọi model');
  }
  return key;
}
