# 구현 스펙 — 플레이테스트 QA 5건 (2026-07-03)

배경: `out/qa-2026-07-03-user-playtest.md` (QA 분석서). 설계자(Claude)가 **기초 토대를 이미 커밋 전 워킹트리에 작성**해 두었다. 이 스펙은 그 토대 위의 나머지 구현을 정의한다. 토대 코드는 수정하지 말 것(버그 발견 시 보고만).

## 이미 완료된 토대 (건드리지 말 것)

- `src/core/scenario-blackboard.ts` — `NpcState.encountered?: boolean`, 새 delta `npc_reveal`(리듀서+validator), `npc_attitude`가 encountered를 함께 켬, `toVisibleBlackboard`가 `encountered === true`만 노출, `toGmBlackboardProjection`은 전체 캐스트 유지(+encountered 플래그).
- `src/core/config.ts` — `rollCheckTimeoutMs: 20000 → 90000`.
- `src/core/turn-state.ts` — `TurnState.rollCheckDeadline?: string | null` + `toPlain` 직렬화(legacy JSON 호환).
- `src/core/round-loop.ts` — `DeclareChecksCommand.rollDeadlineIso?: string`; `DECLARE_CHECKS`가 `rollCheckDeadline` 설정, 모든 `rollingChecks: []` 리셋 지점에서 `rollCheckDeadline: null`로 클리어.
- `src/realtime/room-orchestrator.ts` — DECLARE_CHECKS 디스패치 시 `rollDeadlineIso`를 타이머와 동일한 시계/타임아웃으로 계산해 전달.
- `public/game/index.html` — `isNearBottom(el)` / `stickToBottom(el, was)` 헬퍼(STICK_THRESHOLD_PX=40) + `renderStory()`에 적용(참조 구현).

**현재 알려진 테스트 실패 2건(토대로 인한 의도된 실패 — 네가 고칠 것):**
- `src/core/config.test.ts` > "uses the spec-mandated defaults" — 기대값 20000을 90000으로.
- `src/core/scenario-blackboard.test.ts` > "exposes discovered clues and visible NPC state without NPC known secrets" — 미조우 NPC는 이제 숨겨진다. 아래 T4 테스트 요구 참고.

---

## T1 (QA-2) — stick-to-bottom 전면 적용

`public/game/index.html`의 `renderStory()`가 참조 구현. **동일 패턴**(렌더 전 `isNearBottom` 캡처 → 렌더 후 조건부 스크롤)을 다음에 적용:

1. `public/game/index.html` 사이드 로그 — `sideEl.scrollTop = sideEl.scrollHeight` 지점(±966행). 같은 파일이므로 기존 헬퍼 재사용.
2. `public/game/ai.html` — 200, 207, 359행 부근 3곳. 헬퍼 함수를 이 파일에도 추가(파일별 자체 포함 구조 유지).
3. `public/quickplay/index.html` — 114행.
4. `public/game/scenario.html` — 194, 202행.

추가(권장): `public/game/index.html` 스토리 패널에 **"새 메시지 ↓" 점프 버튼** — 사용자가 하단에 없을 때 새 narration entry가 도착하면 스토리 패널 우하단에 플로팅 버튼 표시, 클릭 시 하단 스크롤+숨김, 사용자가 스스로 하단에 도달해도 숨김. CSS는 기존 톤(어두운 배경, 파란 액센트)과 일치시킬 것.

## T2 (QA-3) — 자동 굴림 카운트다운 UI

서버는 이미 `TurnState.rollCheckDeadline`(ISO)을 내려보낸다(토대). `public/game/index.html`에서:

1. 클라이언트 turn-state 수신 경로에서 `rollCheckDeadline`을 state에 보관.
2. rolling 단계에서 판정 바(`checkBar`) 상단 또는 캡션 영역에 카운트다운 표시: `"⏱ 자동 굴림까지 N초"` — 1초 간격 갱신(interval은 단계 이탈/전체 rolled 시 정리). 남은 시간은 `deadline - Date.now()` 기반(음수면 0).
3. 본인 미굴림 판정이 있으면 카운트다운을 강조(예: 10초 이하일 때 색상 경고).
4. 자동 굴림된 판정(`autoRolled === true`)의 캡션에 "(시간 초과 — 자동 굴림)" 표기. `renderSettledDice` 캡션 확장.
5. `src/core/config.test.ts` 기대값 90000으로 갱신.
6. round-loop 테스트에 추가: DECLARE_CHECKS가 `rollDeadlineIso`를 state로 복사하는지, RESOLUTION_READY/리셋 지점에서 null로 클리어되는지 (`src/core/round-loop.test.ts`).

주의: 서버-클라이언트 시계 오차는 무시 가능한 수준으로 간주(초 단위 표시). 클라이언트에서 audio/알림은 하지 말 것.

## T3 (QA-1) — 능력치 한국어 라벨 누수 차단

1. `public/game/index.html:1282` `ATTR_LABELS`에 geese 3종 추가: `Sneaky: "은밀함", Fast: "재빠름", Tenacious: "집요함"` (정본: `src/services/sheet-schema.ts:566-581`). `public/game/ai.html`에 유사 맵이 있으면 동일 적용(확인 필요).
2. `src/services/scenario-service.ts:201` 부근 — terrible-geese 시나리오 프롬프트가 스탯을 영어 키로 소개함. 프롬프트에 지시 추가: **"서술과 판정 안내에서 능력치를 언급할 때는 반드시 한국어 라벨(은밀함/재빠름/집요함)을 사용하고, 영어 키(Sneaky/Fast/Tenacious)는 blackboardDeltas·checks 같은 구조화 필드에서만 사용"**. 다른 시나리오 프롬프트에 같은 패턴(영어 스탯 키 노출)이 있으면 동일 지시 추가.
3. `src/ai/ai-gm-coordinator.ts`의 판정 선언(DECLARE) 관련 프롬프트에도 같은 원칙이 필요한지 확인 — 나레이션 텍스트에 영어 키를 쓰지 말라는 한 줄이면 충분.

## T4 (QA-4) — NPC encountered 배선 (토대 위)

core는 완료. 나머지 배선:

1. **GM 프롬프트**: `src/ai/ai-gm-coordinator.ts:1731, 1751` — 허용 delta 목록에 `npc_reveal` 추가 + 지시 한 줄: "시드된 NPC를 처음 장면에 등장시킬 때 npc_reveal delta를 함께 내보내라. 등장하지 않은 NPC는 플레이어 화면에 표시되지 않는다."
2. **gm-decision 매핑**: `src/ai/gm-decision.ts:367` 부근 `npc_location` 케이스와 같은 방식으로 `npc_reveal` 케이스 추가 (`{ type: "npc_reveal", npcId, reason }`).
3. **memory-record**: `src/core/memory-record.ts:149` — npc delta 목록에 `npc_reveal` 포함 여부 결정: **포함**(NPC 등장은 기억할 가치가 있는 사건).
4. **시드 정책**: `src/services/scenario-blackboard.ts`의 시나리오 시드들은 **모두 encountered 미설정(=숨김)으로 둔다**. 오프닝에서 GM이 소개하는 NPC는 npc_reveal로 드러나는 것이 정상 경로. 단, 오프닝 나레이션 생성 시 delta가 누락되면 바가 계속 비므로, 오프닝 프롬프트(1번)에 "오프닝에 등장시킨 NPC는 반드시 npc_reveal을 내보내라"를 명시.
5. **테스트 갱신/추가** (`src/core/scenario-blackboard.test.ts`):
   - 기존 실패 테스트: NPC를 노출시키려면 선행 `npc_reveal` (또는 `npc_attitude`) delta를 추가하도록 수정.
   - 신규: (a) 미조우 NPC는 `toVisibleBlackboard`에서 제외, (b) `npc_reveal`로 노출, (c) `npc_attitude`가 encountered를 켬, (d) 알 수 없는 npcId의 npc_reveal은 `UNKNOWN_NPC` 거부, (e) `toGmBlackboardProjection`은 미조우 NPC 포함, (f) encountered 없는 legacy 직렬화 round-trip 정상.
6. 참고: `src/core/front-effects.ts`의 clock `add_npc` 효과는 Scene State에만 반영되고 블랙보드 npcs에는 안 들어감 — 이번 범위 아님, 손대지 말 것.

## T5 (QA-5) — 타자기 출력 + 대기 인디케이터

`public/game/index.html`만 대상(다른 페이지는 범위 외):

1. **타자기 효과**: 새로 도착한 narration entry **하나만** 글자 단위로 순차 출력(기존 entry 재렌더링 시에는 즉시 전체 표시). 마지막으로 애니메이션한 entry를 키(round+kind 조합 등)로 추적. 속도 ~25ms/글자, 긴 텍스트(500자+)는 2-3글자씩 청크. 진행 중 해당 entry 클릭 시 즉시 전체 표시. `prefers-reduced-motion: reduce`면 애니메이션 생략. 타이핑 진행 중에도 stick-to-bottom 규칙 준수(하단일 때만 따라 내려감).
2. **대기 인디케이터**: resolving 단계(나레이션 생성 대기) 동안 스토리 패널 말미에 "GM이 서술을 쓰는 중…" 점멸 표시(CSS 애니메이션, reduced-motion 대응). 나레이션 도착 시 제거.
3. `renderStory()`가 전체 재렌더링(`replaceChildren`) 구조임에 유의 — 타자기 진행 중 재렌더가 오면 진행 상태를 보존하거나 즉시 완료 처리(간단한 쪽 선택, 단 글자 유실 금지).

## 공통 수용 기준

- `npm run typecheck && npm run lint && npm test` 전부 통과 (기존 실패 2건 포함 해결).
- 클라이언트 변경은 각 HTML 파일의 기존 스타일(자체 포함 인라인 JS/CSS, XSS-safe한 textContent/textSpan 패턴)을 따를 것. `innerHTML`에 사용자/AI 텍스트 삽입 금지.
- 서버 프로토콜 변경은 additive-only (기존 클라이언트가 깨지지 않게 optional 필드만).
- 커밋은 하지 말 것 — QA(Claude)가 검수 후 처리한다.
