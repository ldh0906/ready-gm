# ready-gm 통합 아키텍처 (2026-07-03)

> **독자**: 이 저장소에서 작업하는 모든 모델/개발자. 기능별 상세는 `.kiro/specs/*`에 있지만
> **전체 지도는 이 문서가 유일한 출처**다. 코드와 어긋나면 이 문서를 고쳐라(문서가 코드를
> 이기지 않는다). 제품 방향 판단은 `docs/product-north-star.md`를 따른다.
>
> 기원 문서: 아이디어 노트 `C:\Obsidian\idea_note\AI-TRPG-webservice\`(AI-TRPG-GM-webservice.md,
> ai-architecture.md) — "blackboard 기반 AI GM 운영체제" 설계가 이 코드베이스의 뼈대다.

## 1. 한 줄 요약

AI가 GM을 맡는 원격 친구용 TRPG 웹 서비스. **서버 엔진이 게임 상태의 단일 권위**이고,
AI(LLM)는 "신뢰하지 않는 서술·판단 제안 서비스"다. AI는 판정 종류·난이도·상태 변화를
**typed delta로 제안**만 하고, 적용은 항상 서버의 검증(fail-closed)을 통과해야 한다.

## 2. 계층 지도

```
브라우저 (public/*)                      ← 정적 파일. 빌드 없음. ES 모듈 + happy-dom 테스트
  │  REST (x-connection-ticket) + WS (/ws?ticket=, /lobby/ws)
  ▼
src/server.ts                            ← Express 배선: REST 엔드포인트, 티켓 발급, WS 업그레이드, 정적 서빙
  ▼
src/realtime/  ── engine.ts              ← 전체 조립(퍼시스턴스·게이트웨이·orchestrator·AI 배선) + decorateState
  │            ── room-orchestrator.ts   ← ★방당 단일 작성자. 커맨드 직렬 처리, 타이머, AI 호출 조율
  │            ── gateway.ts             ← 방별 fan-out, 재접속 resync, 하트비트, 서사 버퍼
  │            ── ws-connection.ts       ← ws 어댑터 (pong=생존 신호)
  ▼
src/core/      ← ★순수 계층. 부수효과 금지, 시계·난수는 인자로 주입
  ├ round-loop.ts        라운드 상태기계 reducer: reduce(state, command) → state
  ├ turn-state.ts        TurnState 타입 + 무손실 직렬화 (actionHistory 포함)
  ├ scenario-blackboard.ts  블랙보드 + typed delta 검증/적용 + 프로젝션(3.4절)
  ├ dice.ts / config.ts / memory-record.ts / game-profile.ts / front-effects.ts
  └ sinks-day-state.ts   until-it-sinks(GM리스) 전용 일차 상태기계
src/services/  ← 도메인 서비스·콘텐츠 카탈로그 (scenario-service, sheet-schema, scenario-clocks/
                 scenes/blackboard 시드, character-service, card-dealing, narrative-draft, sinks-event-deck)
src/ai/        ← ai-gm-coordinator(프롬프트 조립+검증), gm-decision(파싱), 라우터, CLI 클라이언트(codex/claude 단발 호출), record-replay
src/persistence/ ← in-memory 기본 + Postgres 리포지토리(mappers) — 로컬 플레이테스트는 in-memory
src/http/      ← solo-play, session-start 경계
src/observability/ ← session-log(SESSION_LOG=1), event-sink(ai_call/ai_output/state_mutation/dice_roll/round_timing)
```

**클라이언트 페이지**: `public/game/index.html`(★메인 멀티플레이 인게임 — 순수 로직은
`logic.js`, 배선·뷰는 인라인 스크립트[분리 작업 진행 중]), `public/character/`(시트 위저드),
`public/lobby/`·`public/join/`(방·초대), `public/quickplay/`. `public/game/ai.html·scenario.html·
dice-demo.html`은 레거시 데모 — 신규 기능 대상 아님.

## 3. 지켜야 할 불변식 (깨면 사고)

1. **단일 작성자**: TurnState 변경은 오직 orchestrator가 reducer를 통해서만. 다른 코드가
   store에 직접 쓰지 않는다.
2. **reducer 순수성**: `src/core/`는 Date.now/랜덤/IO 금지. 시각·난수는 커맨드/인자로 주입.
3. **at-most-once 해석**: 라운드당 resolution 1회(`resolutionRequested` CAS + stale 가드).
   되돌림(revert) 후 재시도는 새 해석이며 stale 배송은 폐기된다.
4. **AI 불신**: AI 출력은 전부 스키마 검증 + typed delta allow-list를 통과한다. 미지의
   delta/필드는 **조용히 버린다(fail-closed)** — 예외를 던져 라운드를 죽이지 않는다.
5. **주사위는 서버만** 굴린다. AI 프롬프트에는 결정된 결과만 주입된다.
6. **비공개 정보는 서버에서 생략**한다(클라이언트에서 숨기기 금지). 프로젝션 경계는 3.4절.
7. **클라이언트 DOM은 textContent/textSpan만** (innerHTML 금지 — XSS 표면 차단).
8. **서버 API는 additive-only** (기존 필드 의미 변경 금지, 새 필드는 옵셔널).
9. **레거시 JSON 왕복 보존**: TurnState 직렬화에 새 필드를 넣을 땐 "비었을 때 생략" 패턴
   (`rollCheckDeadline`, `actionHistory` 선례)을 따른다.
10. **테스트 약화 금지**: 동작이 바뀌면 테스트를 새 동작 검증으로 바꾸되, expect를 지워서
    통과시키지 않는다.

## 4. 핵심 흐름

### 4.1 라운드 수명주기 (상태기계)

```
free_chat ─(첫 readiness)→ ready_check ─(전원 ready | 타임아웃 auto-pass | 호스트 강제)→ resolving
resolving ─(GM 결정: checks 있음)→ rolling ─(전원 굴림 | 90초 auto-roll)→ [서사 생성]
        └─(checks 없음)────────────────────────────────────────────────┘
[서사 생성 성공] → RESOLUTION_READY 커밋 → free_chat(N+1) (actionHistory 누적, chatLog 초기화)
[서사/결정 실패] → revertFailedResolution → ready_check 복귀 (§4.2)
```

- **two-phase 굴림**: 결정(decision) AI가 판정을 선언(`DECLARE_CHECKS` + `rollDeadlineIso`)
  → 플레이어가 `roll_check` (본인 것만, 멱등) → 전원 완료 시 서사(narration) AI 호출.
  gm-visibility 판정과 소유자 없는 판정은 서버가 즉시 굴린다.
- **채팅**: free_chat/ready_check에서만 수용. resolving/rolling 중엔 서버가 조용히 폐기
  (제품 방향은 잡담 허용으로 변경 예정 — north-star P-1).
- **이벤트 순서 주의**: 커밋 후 `broadcastTurnState`(다음 라운드) → `deliverNarration`(결과
  텍스트) 순. 클라이언트는 라운드 헤더가 서사보다 먼저 바뀐다(알려진 UX 이슈 F7).

### 4.2 실패·되돌림 경로 (2026-07-03 QA에서 결함 확정 — 수정 예정)

`revertFailedResolution`(room-orchestrator.ts:1149): AI 실패 시 ready_check로 되돌리고
readiness는 보존. **현재 결함**: 첫 실패는 클라이언트에 무음(`narration_failed`는 재시도
소진 후에만, MAX=1) + 재시도가 90초 타이머에 묶임. 수정 지시서:
`out/qa/qa-2026-07-03-e2e-playtest.md` T-1. **이 경로를 건드릴 때는 반드시 그 문서를 먼저 읽어라.**

### 4.3 AI 호출 파이프라인 (coordinator)

라운드 해석 = ① decision 프롬프트(구조화 JSON: intent/gmMove/checks/clockDeltas/
characterDeltas/blackboardDeltas/memoryWrites/off-front/climactic) → ② 서버 주사위+EZFudge
매핑 → ③ narration 프롬프트(결정된 결과 주입) → ④ 검증·적용·배송. 프롬프트에는 시나리오
룰 요약, GM 블랙보드 프로젝션(fronts 포함), 시계, 장면, 캐릭터 시트/상태, 메모리 요약,
최근 서사가 들어간다. 플레이어 입력은 **untrusted JSON 블록** 관례로 감싼다(인젝션 방어).
모든 호출은 event-sink(`ai_call`/`ai_output`+실패사유/`state_mutation` 제안vs적용 diff)로
감사 가능하다.

### 4.4 프로젝션·프라이버시 경계 (보안 핵심)

| 원본 | 플레이어에게 | GM(AI)에게 | 함수 |
|---|---|---|---|
| ScenarioBlackboard | 발견된 clue 결론 + 만난(encountered) NPC + 위협/월드플래그만 | 전체 NPC(+encountered 플래그) + **fronts**(GM 전용 의제) + 발견 clue. 숨은 secret truth·미발견 clue 결론은 GM에게도 안 감 | `toVisibleBlackboard` / `toGmBlackboardProjection` (core/scenario-blackboard.ts) |
| 캐릭터 시트 | 본인=전부, 타인=private 서사 필드 **생략** | 전체(판정 근거용) | `projectSheetForViewer` (services/sheet-schema.ts) |
| 캐릭터 상태 | player-visible만 (GM 메모/관계 제외) | 전체 | `toVisibleCharacterState` |
| TurnState fan-out | readiness/actionHistory에 표시용 이름 주입 | — | `decorateState` (realtime/engine.ts:123) |

### 4.5 인증

REST: 루프백은 무토큰, 외부 노출 시 `PLAYTEST_TOKEN`(공유 비밀) + 플레이어 행위는
`x-connection-ticket`(서버 발급, 방·플레이어 바인딩). WS: `/ws?ticket=` 필수 — 클라이언트
제공 id는 절대 신뢰하지 않는다. 티켓 검증은 `authorizePlayerAction`/`authorizeRoomMemberRead`.

## 5. 변경 가이드 ("~하려면 어디를")

| 하려는 것 | 만지는 곳 | 주의 |
|---|---|---|
| 새 시나리오 추가 | services/scenario-service.ts(카탈로그) + scenario-blackboard.ts(시드) + scenario-clocks/scenes.ts + (커스텀 룰이면) sheet-schema.ts + game-profile.ts | `.kiro/steering/adding-scenarios.md` 참조. openingSeed에 특정 사건을 고정 언급하면 시드와 어긋날 수 있음(F5) |
| 새 blackboard delta 타입 | core/scenario-blackboard.ts(타입+검증+적용) → ai/gm-decision.ts(파싱) → ai-gm-coordinator.ts(프롬프트 allow-list 문자열 2곳) → memory-record.ts(파생 기억) | 넷 중 하나라도 빼먹으면 delta가 조용히 버려진다 |
| TurnState 필드 추가 | core/turn-state.ts + round-loop.ts(모든 리셋 지점!) + realtime/engine.ts decorate + 클라 logic.js TURN_STATE | 리셋 지점 누락이 단골 버그. 직렬화는 불변식 9 |
| 라운드 규칙 변경 | core/round-loop.ts(reducer) + room-orchestrator.ts(타이머/커맨드 발행) | reducer에 IO 금지. 타이머는 orchestrator |
| 인게임 UI | public/game/logic.js(순수 파생 함수 + 단위 테스트) + index.html 배선 | 파생 로직은 반드시 logic.js에 두고 테스트. DOM은 불변식 7 |
| GM 프롬프트/품질 | ai/ai-gm-coordinator.ts | 프롬프트 텍스트를 검증하는 테스트가 있다(ai-gm-coordinator.test.ts). 스냅샷 갱신 필수 |
| REST 엔드포인트 | server.ts — 기존 인증 패턴(restAuthorized + authorizePlayerAction) 복붙 수준으로 준수 | 비공개 필드는 서버에서 생략(불변식 6) |

## 6. 테스트·QA 체계

- `npm run typecheck && npm test` (vitest ~1,100개)가 게이트. lint는 Codex 샌드박스에서 못
  돌므로 QA(Claude)가 돌린다.
- core = property 테스트(fast-check) 위주. 클라이언트 = logic.js 단위 + happy-dom 통합
  (integration.test.js가 index.html의 인라인 모듈을 추출 실행 — **클라이언트 분리 작업 시
  이 하네스도 함께 이행**).
- E2E: `scripts/qa-e2e-harness.mjs`(시나리오·행동 플랜 지정 2인 세션 자동 구동),
  `scripts/qa-e2e-edges.mjs`(엣지케이스). 로그는 `out/playtest-logs/*.jsonl`.
- 서버 관측: `SESSION_LOG=1 node dist/server.js` → `logs/session.jsonl`(AI 원문·검증 실패
  사유 포함).
- 실행: `npm run build:server && node dist/server.js` → http://127.0.0.1:8787.

## 7. 알려진 부채·리스크 (2026-07-03)

- **P1**: 해석 실패 무음 되돌림 + 90초 재시도 지연 (수정 지시서 T-1, `out/qa/` 참조)
- `public/game/index.html` 2,087줄 단일 파일 — 분리 스펙 `out/specs/impl-2026-07-03-game-client-split-spec.md`
- 오프닝 생성과 1라운드 해석 경합(T-2), 거위 openingSeed-시드 불일치(T-3)
- 라운드 전환 시 chatLog 초기화 → 재접속하면 지난 채팅 소실(actionHistory만 영속) — 설계 미결
- 문서 파편화: `.kiro/specs` 11벌은 기능별 이력. **신규 작업은 이 문서 + north-star +
  `out/qa,specs`의 지시서를 기준으로** 하고, .kiro는 요구사항 번호(R#) 추적에만 쓴다.
- 아이디어 노트의 intent routing(table_talk/ask_world/inspect 분류)·Front Planner·Memory
  Clerk 분리는 **미구현 방향**이다 — 현재는 단일 모델이 decision+narration을 겸한다(노트의
  Phase 1 형태). 이 진화는 north-star 로드맵을 따른다.
