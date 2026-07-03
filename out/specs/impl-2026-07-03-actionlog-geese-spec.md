# 구현 스펙 — 행동 로그 누적 + 거위 시나리오 반복 해소 (2026-07-03)

설계자(Claude)가 근본 원인을 확정했다. 이번에는 토대 코드 없이 **전체 구현을 Codex가 수행**한다.
워킹트리에 미커밋 변경(QA 5건 + 캐릭터 시트 4트랙 + 핫픽스 2건)이 있다 — 관련 없는 파일은 건드리지 말 것. git commit 금지.

---

## T1 — 행동 로그에 지난 라운드 행동 누적

**증상**: 사이드바 "채팅 · 행동 로그"에 이번 라운드 행동만 보이고, 라운드가 넘어가면 사라진다.

**근본 원인**: 행동 로그는 `actionLogModel(turnState)`(public/game/logic.js:1263)이 `readiness`에서 파생하는데,
`readiness`는 `RESOLUTION_READY`(src/core/round-loop.ts:473)에서 라운드가 넘어갈 때 `actionKind: null`로 초기화된다.
서버에 라운드별 행동 이력이 어디에도 남지 않는다.

### 서버

1. **`src/core/turn-state.ts`**: 타입 추가.
   ```ts
   export interface ActionHistoryEntry {
     round: number;
     playerId: string;
     kind: "confirmed_action" | "pass" | "auto_pass";
     text: string | null; // confirmed_action일 때 actionText, 아니면 null
   }
   ```
   `TurnState.actionHistory: ActionHistoryEntry[]` 추가. `createInitialTurnState`는 `[]`.
   `toPlain`(직렬화)은 기존 `rollCheckDeadline` 패턴을 따라 **비어 있지 않을 때만** 실어 레거시 JSON 왕복 테스트를 깨지 않게 한다. 역직렬화(fromPlain/파서가 있으면)는 없으면 `[]`로 기본값.

2. **`src/core/round-loop.ts` `RESOLUTION_READY`**: readiness를 초기화하기 **전에** 이번 라운드 행동을 이력으로 뽑는다.
   ```ts
   const roundActions = state.readiness
     .filter((e) => e.actionKind != null)
     .map((e) => ({
       round: state.roundNumber,
       playerId: e.playerId,
       kind: e.actionKind,
       text: e.actionKind === "confirmed_action" ? (e.actionText ?? null) : null,
     }));
   const actionHistory = [...state.actionHistory, ...roundActions].slice(-200); // 상한 200, 오래된 것부터 버림
   ```
   - **두 분기 모두** 반영: `endingReached`(ended 전이)와 일반 라운드 전진. 마지막 라운드 행동도 이력에 남아야 한다.
   - stale 배송 가드(이미 있는 early return)는 그대로 — 거기서는 이력을 쌓지 않는다.
   - 다른 명령(REVERT 등 라운드를 완료하지 않는 초기화)에서는 이력을 쌓지 않는다.

3. **`src/realtime/engine.ts` `decorateState`(:123)**: readiness에 이름을 주입하는 것과 **동일한 맵**(`charById`, `displayById`)으로
   `actionHistory` 각 항목에 `characterName`/`displayName`을 주입해 클라이언트로 보낸다(있을 때만 스프레드하는 기존 관례 그대로).
   early return 조건(`readiness.length === 0 && …`)에 `state.actionHistory` 비어 있지 않음도 추가해야 이력만 있는 상태에서도 장식이 돈다.

### 클라이언트 (`public/game/logic.js` + `public/game/index.html`)

4. **logic.js reducer `TURN_STATE`**: 서버 `state.actionHistory`를 상태로 운반(없으면 `[]`). JSDoc 갱신.
5. **logic.js 셀렉터** `actionHistoryModel(turnState)` 신설(순수 함수, 예외 금지):
   - 입력: `{ actionHistory?, readiness?, chatLog?, roundNumber? }`.
   - 출력: `[{ round, playerId, characterName, displayName, kind: "confirm"|"pass", text, auto }]` —
     이력 항목들 + 현재 라운드 항목(기존 `actionLogModel` 재사용, `round: roundNumber` 태깅)을 이어 붙인다.
   - 이름 폴백은 기존 `actionLogModel`과 동일 규칙(주입된 characterName/displayName 우선, 채팅 폴백).
6. **index.html `renderSide()`**: 행동 로그 렌더를 `actionHistoryModel` 기반으로 교체.
   - 라운드가 바뀌는 지점마다 구분선 항목(예: `— 3라운드 —`, `className: "li round-sep"`, textContent만) 삽입.
   - 기존 규칙 유지: `MAX_ENTRIES` 상한, stick-to-bottom, **textContent/textSpan만 사용(innerHTML 금지)**, 🗡 확정/패스 표기 형식 그대로.
   - 범위는 index.html만 (ai.html/scenario.html은 레거시 데모 — 건드리지 않는다).

### 테스트

- `src/core/round-loop.test.ts`: (a) RESOLUTION_READY가 confirmed/pass/auto_pass를 올바른 round 번호로 이력에 쌓고 readiness는 초기화, (b) endingReached 분기에서도 쌓임, (c) 200 상한(오래된 것 탈락), (d) stale 배송은 이력 불변, (e) toPlain 왕복(비었을 때 필드 생략).
- `src/realtime/engine.test.ts`(관례에 맞춰): actionHistory에 이름이 주입되어 배송됨.
- `public/game/*.test.js`: TURN_STATE 하이드레이션으로 actionHistory 운반, `actionHistoryModel` 병합·이름 폴백, (기존 렌더 테스트 관례가 있으면) 라운드 구분선 렌더 1건.

---

## T2 — 끔찍한 거위들: 같은 내용 반복 해소 (GM에게 장난 진행표 공개)

**증상**: 시나리오가 단편적이고 계속 같은 내용(오프닝 장난 주변)만 반복된다.

**근본 원인**: 방마다 장난 front 4개(오프닝 1 "진행 중" → 중반 2 "대기" → 피날레 1 "대기")가 시드되지만
(src/services/scenario-blackboard.ts:90), GM 프롬프트에 들어가는 `toGmBlackboardProjection`
(src/core/scenario-blackboard.ts:287)이 **`fronts`를 포함하지 않는다**. GM은 장난 사다리의 존재를 모르고,
`advance_front` delta가 허용 목록에 있어도 frontId를 알 수 없어 쓸 수 없다. 그래서 openingSeed의 파이 장난만 맴돈다.

### 구현

1. **`src/core/scenario-blackboard.ts`**:
   - `GmBlackboardProjection`에 `fronts: { id: string; name: string; stage: string }[]` 추가.
   - `toGmBlackboardProjection`이 `bb.fronts`를 매핑해 포함.
   - **`toVisibleBlackboard`(플레이어 프로젝션)는 절대 fronts를 포함하지 않는다** — 회귀 테스트로 고정할 것.

2. **`src/ai/ai-gm-coordinator.ts`** — 결정(decision) 프롬프트(`buildCheckSelectionPrompt`):
   - `blackboardBlock` 설명문에 fronts 안내 추가: "fronts는 GM 전용 진행 의제입니다(플레이어에게 비공개). stage가 '진행 중'인 front가 지금 장면의 중심 목표입니다."
   - CHECK GUIDELINES에 FRONT 진행 규칙 추가:
     - 진행 중인 front를 이번 라운드의 stakes/장면 목표에 엮을 것. 같은 front를 소재만 바꿔 반복하지 말 것.
     - front가 달성되었거나 소재가 소진되면 `advance_front`로 stage를 `"완료"`로 바꾸고, **동시에** 다음 "대기" front 하나를 `"진행 중"`으로 올릴 것(시드된 배열 순서 = 격화 순서).
     - 모든 front가 "완료"에 가까워지면 `climactic`을 고려할 것.
   - canonical stage 값은 자유 문자열이되 프롬프트에 `"대기" | "진행 중" | "완료"`를 명시.
   - **오프닝 프롬프트**: 오프닝 생성 시에도 fronts(적어도 "진행 중" front)가 컨텍스트에 들어가는지 확인하고, 없으면 같은 projection 블록을 포함시킨다 — 오프닝이 시드된 첫 장난과 일치해야 한다.
   - 내레이션(narration) 프롬프트가 blackboard 블록을 공유한다면 자동 반영 — 확인만.

3. **`src/services/scenario-service.ts`** terrible-geese `rulesBrief`에 한 줄 추가:
   "혼돈의 존재가 내주는 장난 목표는 블랙보드 fronts의 순서를 따른다 — 완료되면 다음 장난으로 격화시킨다."

### 테스트

- `src/core/scenario-blackboard.test.ts`: (a) `toGmBlackboardProjection`이 fronts(id/name/stage)를 포함, (b) `toVisibleBlackboard`에는 fronts 부재(플레이어 누출 가드).
- `src/ai/ai-gm-coordinator.test.ts` 기존 프롬프트 테스트 관례에 맞춰: decision 프롬프트에 fronts JSON과 FRONT 진행 지시문이 포함됨을 확인하는 테스트 1건 이상.
- `advance_front` 파싱은 gm-decision.ts:387에 이미 있음 — 재확인만.

---

## 공통 수용 기준

- `npm run typecheck && npm run lint && npm test` 전부 통과.
- 플레이어에게 fronts/비공개 정보가 새는 경로 금지(서버에서 차단, 클라 숨김 금지).
- 클라이언트는 XSS-safe 패턴(textContent/textSpan)만 사용.
- git commit 금지 — QA(Claude)가 검수 후 처리.
- 완료 보고: 파일별 변경 요약, 스펙 이탈과 이유, 남은 리스크.
