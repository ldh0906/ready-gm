# out/ — 작업 산출물

| 폴더 | 내용 | 규칙 |
|---|---|---|
| `specs/` | 구현 스펙(Claude 설계 → 구현 모델에게 전달). `impl-YYYY-MM-DD-<주제>-spec.md` | 완료된 스펙도 이력으로 보존 |
| `qa/` | QA 보고서·작업 지시서. `qa-YYYY-MM-DD-<주제>.md` | 최신 지시서: `qa-2026-07-03-e2e-playtest.md` |
| `playtest-logs/` | 자동 플레이테스트 원본 이벤트 로그(JSONL). `scripts/qa-e2e-*.mjs`가 기록 | 재현 증거 — 수정 금지 |
| `archive/` | 지난 수동/데모 플레이테스트 기록 | 참고용 |

서버 세션 로그(AI 원문 포함)는 여기가 아니라 `logs/session.jsonl`에 쌓인다(`SESSION_LOG=1`일 때).
