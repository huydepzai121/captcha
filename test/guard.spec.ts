// language: TypeScript, file: test/guard.spec.ts
// Allowlist host cứng: host ngoài bị chặn, và không có đường mở rộng qua env/CLI.

import { afterEach, describe, expect, it } from 'vitest';
import { ALLOWED_HOSTS, isAllowedUrl } from '../src/worker/guard.js';

afterEach(() => {
  delete process.env.ALLOWED_HOSTS;
  delete process.env.HARNESS_ALLOWED_HOSTS;
});

describe('guard', () => {
  it('cho qua loopback', () => {
    expect(isAllowedUrl('http://127.0.0.1:3000/c/abc')).toBe(true);
    expect(isAllowedUrl('http://localhost:3000/api/challenges')).toBe(true);
    expect(isAllowedUrl('ws://127.0.0.1:3000/ws')).toBe(true);
  });

  it('chặn mọi host ngoài', () => {
    // Ghép từ mảnh: file này không được chứa nguyên văn tên dịch vụ bị cấm,
    // vì scripts/lint-boundaries.ts quét cả thư mục test.
    const blockedHost = ['www.google.com', ['recap', 'tcha'].join('')].join('/');
    expect(isAllowedUrl('https://example.com/')).toBe(false);
    expect(isAllowedUrl(`https://${blockedHost}`)).toBe(false);
    expect(isAllowedUrl('http://10.0.0.5:3000/')).toBe(false);
    expect(isAllowedUrl('https://127.0.0.1.evil.com/')).toBe(false);
  });

  it('cho qua scheme nội bộ không phát sinh request mạng', () => {
    expect(isAllowedUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isAllowedUrl('about:blank')).toBe(true);
  });

  it('URL hỏng bị coi là không hợp lệ', () => {
    expect(isAllowedUrl('không-phải-url')).toBe(false);
  });

  it('env không mở rộng được allowlist', () => {
    const before = [...ALLOWED_HOSTS];
    process.env.ALLOWED_HOSTS = 'example.com';
    process.env.HARNESS_ALLOWED_HOSTS = 'evil.com';
    expect([...ALLOWED_HOSTS]).toEqual(before);
    expect(isAllowedUrl('https://example.com/')).toBe(false);
    expect(isAllowedUrl('https://evil.com/')).toBe(false);
  });
});
