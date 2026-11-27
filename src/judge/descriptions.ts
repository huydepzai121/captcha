// language: TypeScript, file: src/judge/descriptions.ts, runtime: Node 22
// Mô tả bằng chữ cho từng category. Đây là thứ thay cho ảnh trong `state` —
// judge chỉ đọc chữ, nên phần chữ phải đủ để phân biệt vật thể với distractor.

import type { Category } from '../domain/challenge.js';

export const SHAPE_DESCRIPTION: Readonly<Record<Category, string>> = {
  bridge: 'kết cấu vòm bắc qua mặt nước, có lan can ngang',
  fire_hydrant: 'trụ đứng màu đỏ, chỏm tròn, hai vòi bên hông',
  bicycle: 'hai bánh tròn nối bằng khung tam giác, có yên và ghi-đông',
  bus: 'thân dài hình hộp, dãy cửa sổ vuông, hai bánh dưới gầm',
  traffic_light: 'hộp đứng gắn cột, ba đèn tròn xếp dọc',
  crosswalk: 'các vạch sơn song song trên mặt đường',
};
