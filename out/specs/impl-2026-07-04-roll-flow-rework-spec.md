# 구현 스펙 — 굴림 흐름 재설계: 오버레이 단일화·행동로그 기록·트레이/주사위패널 제거·채팅 힌트 제거·난이도 캘리브레이션 (2026-07-04)

사용자 확정 요구: ①굴림은 배경 흐림 + 화면 중앙 오버레이에서 수행 ②판정 결과는 오른쪽
행동 로그에 기록되고 주사위 UI는 사라짐 ③채팅 위 주사위 패널(d4~d20) 제거 ④판정 중
잡담 전송 시 채팅 하단 안내 문구 미표시 ⑤"계속 실패" 체감 완화(설계자 진단: GM 난이도
캘리브레이션 부재 + Partial 서술 문제. 주사위는 이미 2d[-2..2] 종형 — 건드리지 말 것).

공통 규칙은 `out/specs/impl-2026-07-04-trpg-session-feel-spec.md`와 동일(대상 파일 제한,
textContent만, 재렌더 컨테이너 내 등장 애니메이션 금지, reduced-motion 존중, 커밋 금지,
typecheck+test 통과, 이탈 시 보고). **지시와 코드가 어긋나면 멈추고 보고.**

## T-1 굴림 오버레이 단일화 — `views/checks.js`, `app.js`, `styles.css`, `index.html`

기존 의식 오버레이(#rollRitual)를 "결과 연출"에서 **굴림 수행 UI 그 자체**로 승격한다.

1. **자동 오픈**: `checks_pending` 수신(또는 turn_state 재수화)으로 본인 pending 판정이
   생기면 오버레이 자동 오픈: 제목(캐릭터명 · 능력치 라벨) + 큰 운명 주사위(face "?") +
   **"굴리기" 버튼**(primary) + 자동 굴림 카운트다운(기존 `rollCheckDeadline` 파생 —
   오버레이 안에도 "⏱ N초 후 자동 굴림" 표시, 1초 갱신은 오버레이 자체 interval로;
   render() 티커에 얹지 말 것).
2. **굴리기**: 버튼 클릭 → 기존 `buildRollCheckCommand`+`sendCommand`(성공 시 버튼 비활성
   "굴리는 중...") → `check_rolled` 도착 시 기존 셔플(2000ms)→스팅어(600ms)→결과 텍스트→
   900ms 후 자동 닫힘. 전송 실패 시 버튼 재활성(기존 roll-btn 패턴).
3. **연기(dismiss)**: Esc/바깥 클릭으로 언제든 닫기 — 채팅을 치고 싶을 때를 위해.
   재오픈: T-2의 상태줄 "🎲 내 판정 굴리기" 버튼. 판정 여러 건은 기존 큐로 순차 진행.
4. **autoRolled**(시간 초과 서버 굴림): 오버레이가 열려 있으면 결과만 1.2초 표시 후 닫힘,
   닫혀 있으면 열지 않는다(행동 로그 기록만).
5. **reduced-motion 변경(중요)**: 이제 오버레이가 유일한 굴림 수단이므로 **오버레이는
   뜬다**. 셔플·스팅어·트랜지션만 생략하고 결과 즉시 표시. 기존 "reduced-motion이면
   오버레이 생략" 로직과 관련 테스트를 이 규칙으로 교체하라.
6. 오버레이는 계속 body 직속·render() 불간섭·타이머 정리·`animatingCheckIds` 등록 유지.

## T-2 판정 트레이 제거 + 행동 로그 기록 — 서버+클라

### 서버

1. `src/core/turn-state.ts`: `ActionHistoryEntry`에 판정 변형 추가(additive):
   `kind: "confirmed_action" | "pass" | "auto_pass" | "check_result"` +
   옵셔널 필드 `attribute?: string; difficulty?: string; roll?: number; outcome?: string;`
   (check_result일 때만 사용, text는 null). `toPlain` 운반 추가(있을 때만 스프레드).
2. `src/core/round-loop.ts` `RESOLUTION_READY`: roundActions 뒤에, `state.rollingChecks`
   (플레이어 공개 판정)와 `command.checks`를 checkId로 조인해 check_result 항목들을
   같은 라운드 번호로 append: `{ round, playerId, kind: "check_result", text: null,
   attribute, difficulty, roll, outcome }`. gm-visibility 판정은 rollingChecks에 없으므로
   자연히 제외(추가 필터 불필요 — 확인만). 200 상한 동일 적용. endingReached 분기 포함.
3. `src/realtime/engine.ts` decorate: 기존 actionHistory 이름 주입이 check_result에도 그대로
   적용됨(변경 불필요 — 확인만).

### 클라이언트

4. `logic.js` `actionHistoryModel`: check_result 항목 통과(kind 필터에 추가), 출력 모양
   `{ round, playerId, characterName, displayName, kind: "check", attribute, difficulty,
   roll, outcome }`. **현재 라운드 라이브 병합**: `turnState.rollingChecks` 중
   `status === "rolled"` 항목을 동일 모양(kind "check", round=현재 라운드)으로 이어 붙인다
   (서버 이력은 라운드 종료 후 도착하므로 중복되지 않음 — 라운드가 넘어가면 rollingChecks가
   비워지고 서버 이력이 이어받는 기존 패턴 그대로).
5. `views/side.js` renderSide: kind "check" 렌더 — `.li.check` +
   `🎲 {characterName} — {능력치 라벨} · {난이도 라벨} → {결과 라벨} ({+N})` 형식,
   결과별 클래스(`ok`=성공, `crit`=대성공, `partial`=부분, `fail`=실패)로 색(민트/골드/
   앰버/레드). 라벨 매핑(ATTR/DIFF/OUTCOME)은 checks.js의 상수를 복제하지 말고
   `views/dom.js`로 이동해 양쪽에서 import.
6. **트레이 제거**: `views/checks.js` — 주사위 그룹 렌더(renderRollingChecks의 다이스 부분,
   renderSettledDice/renderPendingDice 트레이 경로, renderCheck/revealChecks/
   maybeAnimateChecks 내레이션 재생 경로)를 제거하고, `#checkBar`를 슬림 상태줄로 바꾼다:
   `rollCountdown`(기존) + 미굴림 대기자 이름 필("아리아 대기") + 본인 pending 있으면
   "🎲 내 판정 굴리기" 버튼(오버레이 재오픈). 사용처가 사라진 함수·상수는 삭제(죽은 코드
   정리 허용 — 단 오버레이가 쓰는 shuffleDiceFaces·스팅어·라벨 상수는 유지/이동).
   `app.js`의 `maybeAnimateChecks` 호출부도 제거.
7. `index.html`: `#checkTray` 등 불필요 마크업 정리(상태줄 구조에 맞게 최소 변경).

## T-3 주사위 패널 제거 — `index.html`, `app.js`, `styles.css`

`<details class="dice-panel">`(d4~d20/중요 판정/지우기, #diceTray, #diceResult) 마크업과
app.js의 해당 배선, styles.css의 `.dice-panel/.die-btn/.seq-btn/.dice-die` 등 관련 블록을
제거한다. **`public/game/dice.js`·`dice-tray.js` 모듈 파일은 삭제 금지**(dice-demo.html
전용). 관련 테스트(dice-tray.test.js는 모듈 대상이므로 유지, dom-structure 등 페이지
마크업 assert만 갱신).

## T-4 판정 중 채팅 힌트 제거 — `app.js`, `index.html`, 관련 테스트

resolving/rolling 중 잡담 전송은 그대로 동작하되, **어떤 안내 문구도 표시하지 않는다**:
`#chatOnlyHint` 요소·배선·문구·placeholder 전환 로직 제거(placeholder는 항상 기본).
행동 구문이 감지돼도 조용히 채팅으로 보낸다(현재 라우팅 유지, 힌트만 제거).
`#notice`(전송 실패/세션 종료)는 유지. 관련 테스트는 "힌트 요소가 존재하지 않는다/문구가
표시되지 않는다"를 검증하도록 갱신(관련 테스트 파일이 이 동작을 assert하고 있으면 그
테스트의 의도를 새 동작으로 뒤집어 유지 — 삭제 금지).

## T-5 GM 난이도·서술 캘리브레이션 — `src/ai/ai-gm-coordinator.ts`

1. decision 프롬프트 CHECK GUIDELINES에 난이도 캘리브레이션 추가:
   - "난이도 기본값은 Average다. 행동이 캐릭터의 강점 능력치와 잘 맞고 상황이 우호적이면
     Easy를 적극 사용하라. Hard는 명백한 위험·반대 압력·시간 압박이 있을 때만,
     Formidable은 클라이맥스급 순간에만 사용하라."
   - "가벼운 톤(코미디 등 저위험 룰)의 시나리오에서는 Hard 이상을 연속 사용하지 마라."
2. narration 프롬프트에 Partial 서술 규약 추가(이미 유사 문구가 있으면 강화만 하고 보고):
   - "Partial Success는 실패가 아니다 — 목표는 달성되되 대가·꼬임·소음이 따라붙는 것으로
     서술하라. Failure도 이야기를 앞으로 미는 실패(새 기회/전개)로 서술하라."
3. 프롬프트 텍스트를 검증하는 기존 테스트에 위 문구 포함 검증 추가.

## 테스트 (필수)

- round-loop: check_result 이력 append(라운드 번호·조인 정확성·gm 판정 제외·200 상한·
  ending 분기·직렬화 왕복).
- logic.js: actionHistoryModel의 check 통과 + rollingChecks 라이브 병합 + 이름 폴백.
- happy-dom: ①본인 pending → 오버레이 자동 오픈 + 굴리기 버튼 → roll_check 전송
  ②check_rolled → 결과 표시 후 닫힘 + 사이드바에 `.li.check` 항목 ③Esc 연기 → 상태줄
  재오픈 버튼 동작 ④autoRolled는 자동 오픈 안 함 ⑤주사위 패널 부재 ⑥판정 중 채팅 전송 시
  힌트 문구 부재. (기존 `window.__game*` 주입 관례와 `__gameForceMotion` 훅 재사용)
- 프롬프트: 난이도 캘리브레이션·Partial 규약 문구 포함.

## 착수 순서

T-5 → T-4 → T-3 → T-2 → T-1 (서버 이력이 먼저 있어야 클라 병합 테스트가 자연스럽다.
각 항목 후 `npm test` 통과 확인).
