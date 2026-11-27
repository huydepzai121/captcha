# Phase 4 — Real Solver Adapters

Phụ thuộc: Phase 3. Chạy song song được với Phase 5.
Blocker cũ "contract API của JEV AI (câu hỏi mở #2)" đã **giải xong** — doc chính
thức đã có, xem `openspec/project.md` mục "Sự thật đã xác minh về JEV".

## Điều chỉnh so với bản đầu

Bản đầu giả định JEV là một `ClickSolver`. Doc bác bỏ: JEV **không nhận ảnh**, chỉ
nhận `state` dạng string/object/array, và không trả toạ độ. JEV **không thuộc
`src/solvers/`** — nó là judge, thuộc `src/judge/` của change
`add-click-grounding-harness`. Phase này chỉ ship solver *vision*.

## Mục tiêu

Cắm model vision thật vào `ClickSolver` mà không sửa gì ngoài thư mục `src/solvers/`.

## Files

```
src/solvers/claude.ts
src/solvers/http-vision.ts    # base dùng chung: retry, timeout, parse toạ độ
test/solvers/*.spec.ts
test/solvers/fixtures/*.json  # response đã ghi lại, replay offline
```

Nếu response trả toạ độ chuẩn hoá `[0,1]` thì đặt `coordSpace: "normalized"` và
`http-vision.ts` nhân lại theo kích thước screenshot. Ghi rõ điều này vì đây là
nguồn sai số im lặng hay gặp nhất — toạ độ lệch vẫn parse thành công, chỉ là
click trượt, và metric sẽ đổ lỗi cho model.

API key đọc từ env (`AI_GATEWAY_API_KEY`), không commit, `.env` vào `.gitignore`.

## Endpoint vision qua AI Gateway

Host là `ai-gateway.vercel.sh` (**không** phải `.ai`):

```ts
const res = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
  },
  body: JSON.stringify({ model, max_tokens: 1024, messages: [...] }),
  signal: AbortSignal.timeout(30_000),
});
```

Model id dạng `provider/slug`. Đối chiếu model list hiện hành trước khi hard-code —
slug đổi theo thời gian, và model vision phải là model nhận `image_url` part.

## JEV không nằm ở đây

Judge JEV (ba câu hỏi `boolean` / `choice` / `score`) thuộc Phase 6 của change
`add-click-grounding-harness`, không thuộc `src/solvers/`. Nó tiêu thụ output của
solver, không thay thế solver. Xem `specs/evaluation-judge/spec.md` và
`openspec/project.md` để lấy contract đã xác minh.

## Claude adapter

Dùng Anthropic SDK, model vision hiện hành. Trước khi viết, đọc skill `claude-api`
để lấy model id và tham số đúng — không viết từ trí nhớ.

Prompt: đưa screenshot + `instruction` + mô tả lưới, yêu cầu trả JSON
`{"clicks":[{"x":..,"y":..}]}`. Parse strict; response sai schema thì trả
`SolveResult` rỗng, tính FAILED, giữ `rawResponse` để soi lại.

## Bất biến

- Solver **chỉ** nhận `SolveRequest`. Không truy cập store, không đọc ground
  truth, không dùng `challengeId` để tra cứu. Test: chạy solver với store đã
  đóng, vẫn phải hoạt động bình thường.
- Timeout mặc định 30s. Vượt là FAILED, không retry.
- Mọi lời gọi mạng ra ngoài ghi log `{solver, endpoint host, latencyMs, usage}`.

## Steps

1. `http-vision.ts`: timeout, 1 lần retry trên lỗi mạng (không retry 4xx), parse
   toạ độ theo `coordSpace`, clamp về trong ảnh.
2. `claude.ts` trước (contract đã biết) để chứng minh interface đủ dùng.
3. Fixture replay: mỗi adapter một test chạy offline từ response đã ghi.

## Validation

- `pnpm test test/solvers/` pass offline (không gọi mạng).
- Smoke thật: `pnpm bench --workers 2 --trials 20 --solver claude` cho số liệu,
  solve rate nằm giữa `random` và `oracle`.
- Isolation test: solver chạy được khi store đóng.

## Risk / rollback

Risk: model vision trả toạ độ sai không gian hoặc sai schema. Mitigation:
`coordSpace` khai báo tường minh trong adapter, parse strict, fixture replay chạy
offline trong CI. Rollback: xoá một file adapter, registry bỏ một entry.
