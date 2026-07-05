# 구현 스펙 — 순차 굴림(차례 강제) + 공유 관전 오버레이 (2026-07-04)

사용자 확정 요구: ①주사위는 **한 번에 한 명씩, 순서를 지켜** 굴린다(동시 굴림 금지).
②차례가 아닌 사람은 **현재 굴리는 사람의 오버레이를 같이 보며 관전**하고, 굴림 결과도
모두가 함께 본다. 순서는 `rollingChecks`의 **선언 순서**(= AI가 행동별로 선언한 순서)를
따르며, "활성 판정" = 첫 번째 미굴림 항목이다.

## 공통 규칙 (엄수)

- 대상 파일만 수정. 무관 파일·기능 변경 금지. **git commit 금지.**
- DOM 텍스트는 `textContent`만 사용(innerHTML 금지, XSS 차단). 기존 `textSpan`/`appendText` 재사용.
- 재렌더 컨테이너 내부 "등장 애니메이션" 금지. `prefers-reduced-motion` 존중(§C-5).
- `npm run typecheck && npm test` 통과. (eslint는 Codex 샌드박스에서 실패하므로 실행하지 말 것 — 설계자가 QA에서 직접 돌린다.)
- **지시와 코드가 어긋나면 멈추고 보고**(예: 아래 인용한 함수/라인이 실제와 다르면 중단).
- 이 스펙은 방금 반영된 `out/specs/impl-2026-07-04-roll-flow-rework-spec.md`(굴림 오버레이 단일화)를 전제로 한다. 그 위에 "순차 강제 + 공유 관전"을 얹는 증분이다.

---

## 배경(현재 동작, 근거)

- `src/realtime/room-orchestrator.ts`
  - `applyDeclarationResult`(809~): 모든 public 판정을 **동시에** pending으로 선언하고 단일
    `rollCheckDeadline`을 건 뒤 `checks_pending` 브로드캐스트. hidden/ownerless는 즉시 굴림.
  - `applyRollCheckCommand`(918~): 소유자 검증(`pending.playerId !== playerId`)만 하고, **순서
    무관**하게 아무 본인 판정이나 굴릴 수 있다.
  - `armRollCheckTimer`(1010~) → `autoRollRemainingChecks`(1053~): 타임아웃 시 **남은 전부**를 한꺼번에 자동 굴림.
  - `rollDeclaredCheck`(928~): 판정 1건 굴림 → `CHECK_ROLLED` reduce + `check_rolled` 브로드캐스트 → `maybeLaunchDeclaredNarration`.
- `src/core/round-loop.ts`
  - `CheckRolledCommand`(190~) / `CHECK_ROLLED` case(459~): 굴린 판정만 rolled로 표시. `rollCheckDeadline`은 건드리지 않음.
- `public/game/views/checks.js`
  - `animateRolledCheck`(273~) **278행**: `if (check.playerId !== viewerPlayerId) return;` — 남의 굴림은 오버레이/애니메이션이 **안 보인다**(사이드 로그로만).
  - `maybeAutoOpenPending`(231~): **본인** pending만 오버레이 자동 오픈.
  - `openPendingRitual`(194~): 항상 "굴리기" 버튼을 만든다(관전자 개념 없음).
  - `renderRollingChecks`(237~): 상태줄에 미굴림 대기자 필 + 본인 pending 있으면 재오픈 버튼.
- `public/game/logic.js`
  - `canRollCheck`(855~): 연결/단계(rolling) 게이트. (판정별 차례 게이트는 없음.)

---

## S. 서버 — 순차 강제 (round-loop.ts, round-loop.test.ts, room-orchestrator.ts, room-orchestrator.test.ts)

### S-1. 리듀서: `CHECK_ROLLED`에 다음 차례 데드라인 운반(additive)

`src/core/round-loop.ts`

1. `CheckRolledCommand`에 옵셔널 필드 추가:
   ```ts
   export interface CheckRolledCommand {
     type: "CHECK_ROLLED";
     checkId: string;
     check: CheckRecord;
     autoRolled?: boolean;
     /** 다음 활성 판정의 자동 굴림 데드라인(ISO). 남은 플레이어 판정이 없으면 null.
      *  생략(undefined) 시 기존 `rollCheckDeadline`을 그대로 둔다(레거시/기존 테스트 호환). */
     nextRollDeadlineIso?: string | null;
   }
   ```
2. `CHECK_ROLLED` case(459~480): 반환 객체에 데드라인 갱신을 **조건부**로 추가한다. 기존
   분기/가드는 그대로:
   ```ts
   return {
     ...state,
     checks: [...state.checks, { ...command.check }],
     rollingChecks: rollingChecks.map((check) =>
       check.checkId === command.checkId ? rolled : check,
     ),
     ...(command.nextRollDeadlineIso !== undefined
       ? { rollCheckDeadline: command.nextRollDeadlineIso }
       : {}),
   };
   ```
   (`nextRollDeadlineIso`를 넘기지 않는 기존 호출은 데드라인을 바꾸지 않는다.)

### S-2. 오케스트레이터: 활성 판정 헬퍼

`src/realtime/room-orchestrator.ts` — private 메서드 추가:
```ts
/** 순차 굴림의 현재 차례 = rollingChecks(선언 순서)의 첫 미굴림 항목. 없으면 undefined.
 *  rollingChecks에는 player-visible 판정만 들어오므로 별도 필터 불필요. */
private activePlayerCheck(state: TurnState): PendingCheck | undefined {
  return (state.rollingChecks ?? []).find((check) => check.status !== "rolled");
}
```

### S-3. 오케스트레이터: 굴림을 활성 판정으로만 게이트

`applyRollCheckCommand`(918~926)에 **활성 판정 일치** 가드 추가(소유자 검증 뒤):
```ts
private applyRollCheckCommand(roomId: string, playerId: PlayerId, checkId: string): void {
  const current = this.loadState(roomId);
  if (current.phase !== "rolling" || !current.resolutionRequested) return;
  const pending = (current.rollingChecks ?? []).find((check) => check.checkId === checkId);
  if (pending === undefined) return;
  if (pending.status === "rolled") return;
  if (pending.playerId !== playerId) return;
  // 순차 강제: 지금 차례(활성)인 판정만 굴릴 수 있다. 뒤 순번은 자기 차례가 올 때까지 no-op.
  if (this.activePlayerCheck(current)?.checkId !== checkId) return;
  this.rollDeclaredCheck(roomId, checkId, false);
}
```

### S-4. 오케스트레이터: 굴림 후 다음 차례로 커서 이동 + 데드라인/타이머 재설정

`rollDeclaredCheck`(928~968) **player 분기**(`if (declared.visibility === "player")`, 942~)를 다음과 같이 바꾼다:

1. reduce로 넘길 `CHECK_ROLLED`에 `nextRollDeadlineIso`를 계산해 싣는다. 방금 굴린 판정을
   제외한 **다음 미굴림 플레이어 판정** 존재 여부로 결정:
   ```ts
   const remaining = (current.rollingChecks ?? []).filter(
     (c) => c.checkId !== checkId && c.status !== "rolled",
   );
   const hasNext = remaining.length > 0;
   const nextRollDeadlineIso = hasNext
     ? new Date(this.now().getTime() + Math.max(0, this.config.rollCheckTimeoutMs)).toISOString()
     : null;
   const next = reduce(current, {
     type: "CHECK_ROLLED",
     checkId,
     check: rolled.value,
     nextRollDeadlineIso,
     ...(autoRolled ? { autoRolled: true } : {}),
   });
   if (next !== current) {
     this.store.save(next);
     this.gateway.broadcastTurnState(roomId);
   }
   this.gateway.broadcast(roomId, { type: "check_rolled", roomId, check: { ...toPendingCheck(...), ... } }); // 기존 그대로
   ```
2. player 분기 끝(브로드캐스트 후), **다음 차례가 있으면 그 판정을 위해 타이머를 재무장**한다:
   ```ts
   if (hasNext) this.armRollCheckTimer(roomId);
   ```
   (없으면 아래 `maybeLaunchDeclaredNarration`이 타이머를 정리하고 서술을 시작한다.)
3. 메서드 말미의 `this.maybeLaunchDeclaredNarration(roomId);` 호출은 **유지**(모든 판정이
   rolled면 그때 narration; 남았으면 no-op).

주의: hidden/ownerless 판정(`visibility !== "player"`)은 기존대로 `applyDeclarationResult`에서
즉시 굴림 → 이 분기를 타지 않으므로 커서/데드라인에 영향 없음. ownerless **public**(playerId
null) 판정은 기존대로 즉시 굴려 rolled가 되고, `activePlayerCheck`는 자연히 그 다음 소유자
판정을 가리킨다(추가 처리 불필요 — 확인만).

### S-5. 오케스트레이터: 타임아웃은 **활성 판정 1건만** 자동 굴림

`autoRollRemainingChecks`(1053~1061)를 **활성 판정만** 굴리도록 교체(이름도 의미에 맞게 변경):
```ts
private autoRollActiveCheck(roomId: string): void {
  const current = this.loadState(roomId);
  const active = this.activePlayerCheck(current);
  if (active === undefined) return;
  this.rollDeclaredCheck(roomId, active.checkId, true);
}
```
`armRollCheckTimer`(1010~)의 만료 콜백을 `this.autoRollActiveCheck(roomId)` 호출로 변경.
(자동 굴림 → S-4에 의해 다음 차례로 커서 이동 + 다음 판정용 타이머 재무장이 연쇄된다.
따라서 여러 명이 방치돼도 한 명씩 순차로 자동 진행된다.)

`applyDeclarationResult`(862~866)의 초기 `if (this.hasUnrolledChecks(roomId)) this.armRollCheckTimer(roomId);`는
**그대로 둔다**(첫 활성 판정용 타이머). `DECLARE_CHECKS`의 `rollDeadlineIso`(844)도 그대로(첫 활성 판정 데드라인).

### S-6. 서버 테스트

`src/core/round-loop.test.ts`
- 신규: `CHECK_ROLLED`에 `nextRollDeadlineIso: "..."`를 주면 `rollCheckDeadline`이 그 값으로,
  `null`을 주면 `null`로 바뀐다. **생략하면 기존 `rollCheckDeadline` 불변**(기존 테스트가
  깨지지 않도록 이 점을 명시적으로 검증).
- 기존 `CHECK_ROLLED`/DECLARE 관련 테스트 모두 통과 유지.

`src/realtime/room-orchestrator.test.ts` (기존 `checksPending()/checksRolled()` 헬퍼 재사용)
- 두 플레이어 판정 A,B가 선언 순서 [A,B]로 pending일 때:
  - B에 대한 `ROLL_CHECK`는 **no-op**(A가 활성인 동안). A `ROLL_CHECK` → A rolled,
    `rollCheckDeadline`이 새 값으로 갱신, 이제 B가 활성. 그 다음 B `ROLL_CHECK` → B rolled →
    narration 런치.
  - 타임아웃 1회 → **A만** 자동 굴림(autoRolled=true), B는 여전히 pending, 타이머 재무장.
    타임아웃 2회 → B 자동 굴림 → narration.
  - hidden/ownerless 판정은 선언 즉시 rolled로, 커서는 첫 소유자 판정에서 시작(확인).
- 직렬화 왕복은 기존 turn-state.test로 커버(별도 불필요 — rollCheckDeadline은 이미 왕복).

---

## C. 클라이언트 — 공유 관전 오버레이 (logic.js, views/checks.js, rolling.test.js)

### C-1. logic.js: 활성 판정 선택자(순수)

```js
/**
 * 순차 굴림의 현재 차례 판정 = rollingChecks의 첫 미굴림 항목. 없으면 null.
 * @param {{ rollingChecks?: Array<{status?: string}> }} state
 * @returns {object | null}
 */
export function activeRollingCheck(state) {
  const checks = state && Array.isArray(state.rollingChecks) ? state.rollingChecks : [];
  for (const c of checks) if (c && c.status !== "rolled") return c;
  return null;
}
```
`canRollCheck`는 변경하지 않는다(단계 게이트 유지). 판정별 차례 판단은 뷰에서 `activeRollingCheck`로.

### C-2. checks.js: 활성 판정 오버레이를 **모든 뷰어**에게

`maybeAutoOpenPending(checks)`(231~235)를 "본인 pending"이 아니라 **활성 판정**을 열도록 변경:
```js
function maybeAutoOpenPending(checks) {
  if (activeRitual) return;
  const active = checks.find((check) => check && check.status !== "rolled");
  if (!active) return;
  if (dismissedPendingIds.has(String(active.checkId || ""))) return; // 이 뷰어가 연기한 경우
  openPendingRitual(active);
}
```

### C-3. checks.js: 소유자=버튼 / 관전자=관전 캡션

`openPendingRitual(check)`(194~223)에서 소유 여부로 분기:
```js
const isOwner = check.playerId === viewerPlayerId;
...
if (isOwner) {
  made.caption.textContent = "당신 차례 — 굴리기";
  // 기존 "굴리기" 버튼 생성/배선 그대로(canRollCheck 게이트 유지)
} else {
  const whoName = (typeof check.characterName === "string" && check.characterName.trim())
    ? check.characterName.trim() : "플레이어";
  made.caption.textContent = `${whoName}이(가) 굴리는 중…`;
  // 버튼 생성하지 않음(관전). 카운트다운은 동일하게 표시(updateRitualCountdown + interval).
}
```
카운트다운(`updateRitualCountdown`)은 `getState().rollCheckDeadline`을 읽으므로, 서버가
차례마다 데드라인을 리셋하면(S-1/S-4) 관전 오버레이의 "N초 후 자동 굴림"도 활성 판정 기준으로 갱신된다(추가 작업 불필요).

### C-4. checks.js: 결과는 **모두가** 함께 본다

`animateRolledCheck`(273~288)의 **278행 `if (check.playerId !== viewerPlayerId) return;`을 삭제**한다.
그 아래 autoRolled 억제 로직(279행 `if (check.autoRolled === true && (!activeRitual || …)) return;`)도
**삭제**한다 — 관전자도 자동 굴림 결과를 봐야 하므로. 결과 표시 경로는 그대로:
- 오버레이가 이미 이 checkId로 열려 있으면(활성 판정 관전/본인) → 그 자리에서 셔플→스팅어→결과.
- 아니면 `ritualQueue`에 넣어 `playNextRollRitual`로 잠깐(자동 1200ms / 수동 900ms) 표시.

`closeRollRitual`(79~92) 끝에서 **다음 차례 오버레이를 이어서 연다**: 기존 `playNextRollRitual()`
호출 뒤에 다음 한 줄을 추가한다.
```js
// 결과가 닫히면 다음 차례(활성) 판정 오버레이를 이어서 연다(관전 릴레이).
if (!activeRitual) maybeAutoOpenPending(Array.isArray(getState().rollingChecks) ? getState().rollingChecks : []);
```
(`playNextRollRitual`이 큐를 소비해 새 결과를 띄웠다면 `activeRitual`이 채워지므로 자동 오픈은
건너뛴다. 큐가 비었고 다음 pending이 있으면 그 차례를 연다.)

### C-5. reduced-motion

reduced-motion에서도 **오버레이는 뜬다**(굴림 오버레이가 유일 수단, 직전 스펙 T-1 규칙과 동일).
관전자/소유자 모두 셔플·스팅어·트랜지션만 생략하고 결과 즉시 표시. `shuffleDiceFaces`의 기존
reduced-motion 즉시 완료 분기를 재사용. 자동 오픈 자체는 막지 않는다.

### C-6. checks.js: 상태줄(#checkBar)을 "차례" 표시로

`renderRollingChecks`(237~271)의 상태줄 구성 갱신:
- `const active = getState() 기준 activeRollingCheck` — 활성 판정.
- 활성 판정이 있으면 필 대신(또는 맨 앞에) **차례 표시**: `🎲 {characterName} 차례`(활성 소유자 이름).
  나머지 미굴림은 기존처럼 `{name} 대기`.
- 재오픈 버튼("🎲 내 판정 굴리기")은 **활성 판정이 본인일 때만** 표시(현재는 본인 pending 아무거나).
  `const mineActive = active && active.playerId === viewerPlayerId ? active : null;` 로 게이트.
- `rollCountdown`은 그대로.

### C-7. 클라이언트 테스트

`public/game/rolling.test.js` (happy-dom, 기존 `window.__game*` / `__gameForceMotion` 관례 재사용)
- **관전**: rollingChecks=[본인 아닌 활성 A, 본인 B] 상태를 turn_state로 주입 → 활성 A의 오버레이가
  뜨고, 버튼이 없으며 캡션에 A의 이름과 "굴리는 중"이 있고 카운트다운이 보인다.
- **결과 공유**: `check_rolled`(A, 남의 판정) 수신 → 오버레이에 A 결과가 애니메이션/표시된다(관전자도 봄).
  결과가 닫히면 다음 활성(B, 본인)의 오버레이가 이어 열리고 이번엔 "굴리기" 버튼이 있다.
- **차례 상태줄**: 상태줄에 활성 소유자 "차례" 문구가 뜨고, 재오픈 버튼은 본인 차례일 때만 존재.
- **reduced-motion**(`__gameForceMotion=false` 상당): 관전 오버레이가 뜨고 결과가 즉시 표시된다.
- 순수 `activeRollingCheck` 단위 테스트(첫 미굴림 반환, 전부 rolled면 null).

---

## 착수 순서

S-1 → S-2 → S-3 → S-4 → S-5 → (서버 테스트 S-6 통과) → C-1 → C-2 → C-6 → C-3 → C-4 →
C-5 → (클라 테스트 C-7 통과). 각 묶음 후 `npm run typecheck && npm test`.

## 수용 기준

- `npm run typecheck && npm test` 전부 통과.
- 서버: 한 방에 한 판정만 활성이며, 비활성 판정 `ROLL_CHECK`는 no-op. 활성 굴림/자동 굴림 후
  커서가 다음으로 이동하고 데드라인이 리셋된다. 마지막 판정이 굴려지면 narration 런치.
- 클라: 차례가 아닌 사람도 현재 굴리는 사람의 오버레이·결과를 함께 보고, 결과가 닫히면 다음
  차례 오버레이가 릴레이로 열린다. 차례인 사람만 "굴리기" 버튼을 본다.
- 무관 파일 변경·커밋 없음. 지시와 코드가 어긋난 지점은 보고.
