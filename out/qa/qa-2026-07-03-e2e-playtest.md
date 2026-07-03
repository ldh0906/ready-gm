# QA 보고서 — 자동화 E2E 멀티플레이 세션 검증 (2026-07-03)

Claude가 실제 서버(HTTP+WS)를 상대로 2인 세션을 자동 구동하는 하네스
(`scripts/qa-e2e-harness.mjs`, `scripts/qa-e2e-edges.mjs`)로 세션 4회를 돌려 검증했다.
이벤트 원본: `out/playtest-logs/qa-e2e-*.jsonl`(플레이어별 전체 WS/HTTP 로그), `logs/session.jsonl`(SESSION_LOG=1 서버 로그).

| 세션 | 시나리오 | 커버리지 | 결과 |
|---|---|---|---|
| run1-mvp | 잠들지 않는 지하실(MVP) | 확정+패스 / 확정+확정 / 패스+패스, 3라운드 | 전 라운드 정상 해석 |
| run2-geese | 끔찍한 거위들 | 4라운드 계획(자동굴림 포함) | **1라운드에서 서사 생성 실패 → 무음 되돌림 재현** |
| run3-geese-logged | 끔찍한 거위들 | 2라운드, 서버 AI 로깅 켬 | 전 라운드 정상(실패 재현 안 됨 — 간헐성) |
| edges1 | MVP | 수정(revise)/중복 굴림/타인 판정 굴림/롤링 중 재접속/롤링 중 채팅/시트 프라이버시 | **이상 0건 — 전부 정상** |

**핵심 결론**: 사용자가 보고한 "패스+행동 조합에서 판정은 진행되는데 결과가 안 나온다"는
조합 자체의 버그가 아니다(run1에서 확정+패스 정상 동작 확인). 실체는 **간헐적 AI 서사 생성
실패를 서버가 '무음 되돌림 + 90초 대기 + 재판정'으로 처리하는 설계**이며, 플레이어 화면에는
그동안 아무 신호도 가지 않는다(QA-F1~F3). 어떤 행동 조합에서든 발생할 수 있다.

---

## 고객 관점 총평 (QA 세션을 플레이어로서 겪은 소감)

**강점 — 서사 품질.** 오프닝·결과 서사의 한국어 산문은 상용 수준이다(거위 오프닝의 "마을의
평화는 파이 껍질처럼 얇고 바삭합니다" 등). 확정한 행동을 빠짐없이 결과에 엮고, 실패도 장르
톤(코미디→웃긴 실패)으로 소화한다. 판정 소유권·재접속 복원·행동 로그 등 기반 체계도 탄탄하다.

**약점 — "친구들과 게임하는 기분"이 아직 아니다.**
1. **죽은 시간**: 행동 확정→결과까지 정상 경로 25~50초, 실패 경로 수 분. 길이 자체보다
   그동안 화면이 침묵하는 것이 치명적이다. "GM이 서술을 쓰는 중" 한 줄로 30초를 못 버틴다.
2. **대기 중 채팅 잠금의 역설**: resolving/rolling 중 입력이 잠기는데, 결과를 기다리는
   순간이야말로 친구들끼리 잡담이 터지는 순간이다. 원격 친구용 서비스라는 정체성과 충돌한다.
3. **편지 왕복형 라운드**: 전원 확정→일괄 해석 구조라 GM에게 짧은 되물음이 불가능하다.
   TRPG의 대화감보다 "턴제 릴레이 소설"에 가깝다.
4. **균질한 호흡**: 좋은 라운드도 나쁜 라운드도 한 문단. 몇 라운드면 리듬이 예측된다(거위
   반복 문제의 절반은 fronts 부재였고 — 수정됨 — 나머지 절반은 이 호흡 문제다).

**한 줄 평**: 지금은 "AI가 글을 잘 쓰는 서비스"다. "친구들과 게임하는 서비스"가 되려면
버그 수정(F1~F3)과 별개로 ①대기 시간을 채우는 것, ②대기 중에 떠들 수 있게 하는 것이
체감을 가장 크게 바꾼다. → 작업 지시서의 P-1, P-2.

---

## F1 (P1) — 서사 생성 실패가 플레이어에게 완전히 무음이다

**증상**: 주사위를 굴렸는데 결과 서사가 영영 안 나온다. 화면은 조용히 준비 확인 단계로 돌아가
있고, 아무 오류 표시도 없다. (사용자 보고 증상과 일치)

**근거 (run2-geese 타임라인, `out/playtest-logs/qa-e2e-run2-geese.jsonl`)**:
- 0.5s: 두 플레이어 확정 → `resolving`
- 15.0s: `checks_pending`(판정 선언) → 15.8s: 두 판정 모두 굴림 완료 → 서사 생성 시작
- **62.2s: `phase=ready_check, resolutionRequested=false`로 되돌림 — 이 사이 클라이언트로 간
  이벤트는 turn_state뿐, 실패를 알리는 이벤트 없음**
- 152.2s: 자동 재해석 시작(90초 대기 후) → 166.9s: **같은 라운드의 새 판정 세트 재선언**
- 하네스(=플레이어)는 이미 굴렸으므로 다시 굴리지 않음 → 자동 굴림 타임아웃(추가 90초) 대기 중 종료

**원인**: `src/realtime/room-orchestrator.ts:1149` `revertFailedResolution` — 서사/판정 선언
실패 시 `ready_check`로 되돌리고 `broadcastTurnState`만 한다. `narration_failed` 이벤트는
자동 재시도 소진 후에만 발송되는데(`:1176`), `MAX_AUTOMATIC_FAILED_RESOLUTION_RETRIES = 1`
(`:105`)이므로 첫 실패는 항상 무음이다. 클라이언트에는 `narration_failed` 처리(및 표시)가
이미 있으나 첫 실패에는 도착하지 않는다.

**권장 수정**: 모든 되돌림 시점에 room-visible 알림 발송(예: `narration_failed`에
`retrying: true` 필드 추가 or 별도 `resolution_retrying` 이벤트). 클라이언트는 서사 패널에
시스템 항목("GM이 결과를 쓰다 실패해서 다시 시도하는 중...")을 띄운다.

## F2 (P1) — 실패 후 재시도까지 이유 없는 90초 대기

**증상**: F1 상황에서 모두가 이미 준비 완료 상태인데도 90초를 그냥 기다린 뒤에야 재해석이 시작된다.

**근거**: run2에서 되돌림(62.2s) → 재해석(152.2s) = 정확히 90,000ms
= `readyCheckTimeoutMs`(`src/core/config.ts:37`).

**원인**: `revertFailedResolution`이 재시도를 `armReadyCheckTimer(readyCheckTimeoutMs)`
(`room-orchestrator.ts:1184`)에 맡긴다 — 준비 확인 카운트다운이 만료돼야 재해석이 돈다.
전원이 여전히 ready인 상태라면 이 대기는 순수 낭비다.

**권장 수정**: 되돌림 직후 readiness가 여전히 전원 ready면 짧은 백오프(예: 3~5초) 후 즉시
재해석. 타이머 재무장은 ready가 깨진 경우의 폴백으로만.

**체감 비용**: 실패 1회당 최악 시나리오 = 무음 90초 대기 + 재결정(수십 초~100초) + 재선언된
판정을 아무도 안 굴리면 자동굴림 90초 + 서사 생성. **최대 ~5분간 '결과 없음' 화면.**

## F3 (P2) — 재판정 시 이미 굴린 주사위가 무언설명 없이 초기화된다

**증상**: F1 진행 중 판정 트레이의 굴린 주사위가 사라지고 새 "굴리기" 대기 주사위가 나타난다.
플레이어는 왜 다시 굴려야 하는지 알 수 없고, 모르고 방치하면 자동굴림까지 추가 90초.

**원인**: 되돌림이 `rollingChecks: []`로 초기화 후 재해석이 완전히 새 판정을 선언한다
(checkId 재발급). 자연스러운 귀결이지만 클라이언트에 맥락 설명이 없다.

**권장 수정**: F1의 알림에 "판정을 다시 진행합니다" 문구 포함. (선택) 재선언 판정이 직전과
동일 구성이면 기존 굴림 값을 재사용하는 서버 최적화 — 우선순위 낮음.

## F4 (P2) — 오프닝 생성과 1라운드 해석이 경합한다

**증상**: 세션 시작 직후 플레이어가 빠르게 행동을 확정하면, 오프닝 서사가 도착하기 전에
판정이 먼저 선언된다. 1라운드 GM 결정은 오프닝 내용을 모른 채 내려진다.

**근거**: run2 — `checks_pending` 15.0s < 오프닝 서사 19.5s. run3도 동일(판정 15.0s,
오프닝 15.8s). 오프닝과 결정이 동시 병행 AI 호출로 돈다.

**원인**: 세션 시작(`maybeStartSession`)이 오프닝 생성을 백그라운드로 띄우고, 라운드 루프는
오프닝 완료를 기다리지 않는다. 실사용자는 보통 오프닝을 읽고 행동하므로 드물지만, 급한
플레이어·짧은 오프닝 지연에서 실제로 발생 가능.

**권장 수정**: 오프닝이 배송되기 전에는 READY/CONFIRM을 받되 해석 착수를 오프닝 완료 이후로
지연(orchestrator에서 오프닝 프로미스를 게이트로). 클라이언트 변경 불필요.

## F5 (P3, 설계) — 거위 openingSeed가 시드된 오프닝 장난과 2/3 확률로 어긋난다

**증상/리스크**: 시나리오 `openingSeed`(`src/services/scenario-service.ts:187`)는 "창턱의
파이"를 고정 언급하지만, 방마다 시드되는 오프닝 front는 파이/분수대 리본/빵집 종 중 랜덤
(`src/services/scenario-blackboard.ts:9`, 1/3 확률로만 파이). 불일치 방에서는 GM이 오프닝
프롬프트에서 상충하는 두 지시(openingSeed의 파이 vs fronts의 '진행 중' 장난)를 받는다.

**근거**: run2 방의 시드 재현 결과 오프닝 front가 우연히 `geese_prank_window_pie`여서 이번
런에서는 표면화되지 않았음 — 코드 경로상 확정적 불일치 가능.

**권장 수정**: openingSeed에서 특정 장난 명시를 제거(중립 문구화)하거나, 오프닝 프롬프트에서
"openingSeed의 예시 장난보다 fronts의 '진행 중' front가 우선"임을 명시.

## F6 (P3, 성능 관찰) — 라운드 레이턴시 편차가 크다

관찰치(행동 확정 → 결과 서사): run1 24~48s, run3 27~29s, **run2 실패 라운드는 5분+**.
GM 결정 단독으로 run2에서 ~100s(152→167s 구간 재결정 15s, 1차 결정 15s — 편차는 CLI/모델
상태 의존). 별도 수정 없음; F1~F2 수정 시 최악 경로가 크게 줄어든다. 스트리밍 중계는 기존
백로그(중기) 유지.

## F7 (P3) — 결과 서사보다 다음 라운드 전환이 먼저 화면에 반영된다

`RESOLUTION_READY` 커밋 → `broadcastTurnState`(다음 라운드 free_chat) → `deliverNarration`
순서(`room-orchestrator.ts:1079` → `:1115`)라서 클라이언트가 결과 텍스트보다 "N+1라운드 ·
자유 대화" 헤더를 먼저 그린다. 타자기 효과가 곧바로 서사를 채우므로 체감은 작지만, 회고
관점에서 서사→전환 순서가 자연스럽다. 우선순위 낮음(이벤트 순서 스왑은 회귀 위험 있으므로
클라이언트에서 서사 도착까지 헤더 전환을 잠깐 유예하는 쪽이 안전).

## F8 (P3) — 라운드가 넘어가면 채팅 이력은 여전히 사라진다 (재접속 시)

행동 로그는 이번 작업으로 `actionHistory`에 영속화됐지만 채팅(`chatLog`)은 라운드 전환 시
서버에서 비워진다(`round-loop.ts:518`). 접속 유지 중엔 클라이언트가 로컬로 누적하지만
**재접속하면 지난 라운드 채팅이 모두 사라진다.** actionHistory와 같은 패턴(chatHistory 또는
actionHistory에 채팅 포함)으로 통일할지 설계 판단 필요.

---

## 정상 동작 확인 (회귀 없음)

- **행동 조합**: 확정+패스, 확정+확정, 패스+패스 모두 판정 선언→굴림→결과 서사 정상 (run1 3라운드).
  패스+확정 조합 자체는 결함이 아님을 확인.
- **행동 로그 누적(신규)**: `actionHistory`가 라운드·행동종류·본문·이름(characterName/
  displayName 주입 포함)을 정확히 누적, 라운드 전환·세션 진행 후에도 유지 (run1 최종 상태 검증).
- **2단계 굴림**: `checks_pending`→`check_rolled` 수명주기, 본인 판정만 굴리기 버튼,
  `rollCheckDeadline` 동봉 확인.
- **GM 전용 정보 비누출**: 전체 플레이어 수신 payload에서 `fronts`/`truth`/`secrets`/
  `goals`/`discoveryCondition`/`pressureClockId` 문자열 스캔 — 0건 (run1·run2·run3).
- **거위 fronts 배선(신규)**: GM projection에 fronts 포함 + 오프닝이 '진행 중' front(파이)와
  일치하는 서사 생성 (run2/run3 오프닝 텍스트 확인).
- **서버 채팅 잠금**: rolling/resolving 중 채팅은 서버가 조용히 폐기 (`round-loop.ts:328`) —
  클라이언트 입력 잠금과 일관.
- **엣지케이스 (edges1, 이상 0건)**:
  - 확정→수정(revise)→재확정: 최종 행동만 이력에 정확히 1건 기록.
  - 타인 판정 `roll_check` 전송: 서버가 무시(check_rolled 미발생) — 소유권 검증 정상.
  - 같은 판정 중복 `roll_check`: 1회만 굴림 처리(멱등).
  - **롤링 중 재접속**: `rollingChecks`(pending 상태)와 `rollCheckDeadline`이 turn_state로
    재수화되고, 재접속한 플레이어가 이어서 정상적으로 굴림 완료.
  - 시트 뷰 endpoint 티켓 인증 정상(200), 라운드 해석·서사 전달 정상.

## 커버리지 한계 (이번에 못 본 것)

- 자동굴림(90초 방치) 실측은 run2 실패와 겹쳐 미완 — F1 수정 후 재검 권장.
- 세션 엔딩(ending 도달)·클로징 서사·요약 저장 경로 미검증.
- until-it-sinks(GM리스) 루프, 관전/3인+ 세션, 모바일 뷰포트 미검증.
- run2 서사 실패의 AI측 원인(원문)은 로깅이 꺼져 있어 미확보 — SESSION_LOG=1 서버가 현재
  떠 있으므로 재발 시 `logs/session.jsonl`의 `ai_output.failureReason`으로 확인 가능.

---

# 작업 지시서 (구현 담당 모델용)

이 섹션만 보고 구현이 가능해야 한다. 설계 판단은 이미 끝났다 — **아래 지시와 실제 코드가
어긋나는 경우 임의로 재해석하지 말고 구현을 멈추고 완료 보고에 어긋난 지점을 명시하라.**

## 공통 규칙 (전 작업 적용)

- 워킹트리에 미커밋 변경이 많다. **명시된 파일 외 수정 금지. `git add`/`git commit` 금지.**
- 완료 조건: `npm run typecheck && npm test` 전부 통과. (eslint는 샌드박스에서 실행이 안 될
  수 있음 — 그 경우 건너뛰고 보고에 명시. QA가 대신 돌린다.)
- 클라이언트 DOM 조립은 textContent/textSpan 패턴만 사용. **innerHTML 금지.**
- 서버가 숨긴 정보(fronts, secret truth, 미발견 clue 등)를 클라이언트로 보내는 경로 신설 금지.
- 기존 테스트를 지우거나 expect를 약화시켜 통과시키는 것 금지. 동작이 바뀌면 테스트도 새
  동작을 검증하도록 고쳐라(왜 바뀌는지 주석).
- 완료 보고 양식: ①파일별 변경 요약 ②지시 이탈과 이유 ③새로 추가한 테스트 목록 ④남은 리스크.

## T-1 — 해석 실패를 보이게 하고, 즉시 재시도한다 (F1+F2+F3, P1)

**의도**: 서사 생성이 실패해도 플레이어는 "실패했고, 자동으로 재시도 중이며, 판정을 다시
굴려야 할 수 있다"를 안다. 전원 준비 상태면 재시도는 90초가 아니라 몇 초 안에 시작된다.

### 서버 — `src/realtime/room-orchestrator.ts`

1. `revertFailedResolution(roomId, current)`(:1149)의 시그니처를
   `revertFailedResolution(roomId, current, reason: string)`으로 확장하고 4개 호출부에서
   실패 사유를 전달하라: `applyDeclarationResult`(:783)와 `applyResolutionResult`(:1033)는
   `result.error.message`, `rollDeclaredCheck`(:903)는 `"dice roll failed"`,
   `applyResolutionFailure`(:1188)는 `"no scenario selected"`.
2. revert 커밋(`broadcastTurnState`) 직후, **재시도 예산이 남아 있으면** 다음을 브로드캐스트:
   `{ type: "narration_failed", roomId, phase: "resolution", reason, retryable: true, retrying: true }`
   — 기존 `emitNarrationFailure`(:1254)에 `retrying?: boolean` 파라미터를 추가해 재사용하라.
   재시도 소진 분기(:1176)는 지금처럼 `retrying` 없이(또는 false) 발송한다. `ServerEvent`의
   narration_failed 타입(`src/realtime/connection.ts` 부근)에 `retrying?: boolean`을 추가.
3. **즉시 재시도**: 재시도 예산이 남아 있고 revert된 state의 readiness가 전원
   `status === "ready"`이면, `armReadyCheckTimer(readyCheckTimeoutMs)` 대신 짧은 지연으로
   재해석을 예약하라: 상수 `FAILED_RESOLUTION_RETRY_DELAY_MS = 5_000` 신설,
   `this.scheduleTimer`로 5초 뒤 **기존의 all-ready → 해석 착수 경로와 동일한 함수**를
   호출한다(READY_CHECK 만료 시 해석을 시작하는 기존 코드를 찾아 그 진입점을 재사용하라 —
   해석 착수 로직을 복붙하지 말 것). 타이머 핸들은 `rollCheckTimers`(:977 부근)와 같은
   패턴으로 방별 Map에 보관·정리하고, 발화 시점에 phase가 `ready_check`가 아니거나 전원
   ready가 아니면 no-op. 전원 ready가 아니면 기존 `armReadyCheckTimer` 폴백 유지.
4. 로그: 기존 `resolution_reverted` 로그에 `reason`과 `retryInMs`를 추가.

### 클라이언트 — `public/game/logic.js`, `public/game/index.html`

5. `eventToAction`의 `narration_failed` 분기(logic.js:439)에서 `retrying: event.retrying === true`
   를 액션에 실어라. `NARRATION_FAILED` reducer(:1009)는 `retrying`이면 전용 메시지를 쓴다:
   `"GM이 결과를 쓰다 실패해 자동으로 다시 시도합니다. 판정이 다시 나타나면 한 번 더 굴려 주세요."`
   — `NARRATION_FAILED_MESSAGES`(:92)에 키를 추가하고 `narrationFailureMessage`를
   `(phase, retrying)` 시그니처로 확장하라(기존 호출 호환 유지).
6. 알림 해제: 현재 `NARRATION` 수신 시에만 `narrationFailedNotice: null`(:977)이다.
   **`CHECKS_PENDING` reducer에도 `narrationFailedNotice: null`을 추가**하라 — 재시도가 새
   판정을 선언하는 순간 배너가 내려가야 한다.
7. index.html은 기존 narrationFailedNotice 표시 요소를 그대로 쓴다(신규 DOM 불필요 — 표시
   요소가 없다면 그때만 서사 패널 위 고정 배너 `div.notice.narration-failed`를 textContent로 추가).

### 테스트 (필수)

- `src/realtime/room-orchestrator.test.ts`(기존 관례에 맞춰):
  (a) 선언 실패 → `narration_failed(retrying:true)` 브로드캐스트 + 5초 후(가짜 타이머) 재해석
  착수, 90초 타이머 미사용. (b) 서사 실패(narrateDeclaredRound 실패)도 동일. (c) 재시도 소진
  시 기존 `retrying` 없는 이벤트 + 재예약 없음. (d) 전원 ready가 아니면 기존 타이머 폴백.
- `public/game/*.test.js`: retrying 메시지 매핑, CHECKS_PENDING이 알림을 지움.

## T-2 — 오프닝이 끝나기 전에는 라운드 해석을 시작하지 않는다 (F4, P2)

**의도**: 플레이어가 아무리 빨리 확정해도 1라운드 GM 결정은 오프닝 서사가 배송된(또는 실패로
확정된) 뒤에 시작된다. READY/CONFIRM 수신 자체는 막지 않는다.

- `room-orchestrator.ts`: 세션 시작 시 오프닝을 생성하는 `this.track((async () => { ... })())`
  블록(:600 부근)의 프로미스를 방별 Map(`openingInFlight: Map<roomId, Promise<void>>`)에
  보관하고, settle 시(성공/실패 모두) Map에서 제거하라.
- all-ready → 해석 착수 진입점에서: `openingInFlight`에 해당 방이 있으면 해석 착수를 그
  프로미스의 settle 뒤로 체이닝하라(`.finally()` — 오프닝 실패도 게이트를 푼다). 체이닝된
  착수도 발화 시점 상태 재검증(phase/resolutionRequested)을 거쳐야 한다 — 기존 stale 가드
  패턴(:787)을 재사용.
- 테스트: 오프닝 AI를 지연시키는 fake로 (a) 오프닝 배송 전 `checks_pending`이 나가지 않음,
  (b) 오프닝 settle 후 해석이 자동 착수, (c) 오프닝 실패 시에도 해석이 착수됨(무한 대기 금지).

## T-3 — 거위 openingSeed를 시드된 오프닝 장난과 어긋나지 않게 (F5, P3)

- `src/services/scenario-service.ts` `TERRIBLE_GEESE.openingSeed`(:187)에서 특정 장난("저
  창턱의 파이를 망쳐 놓아라") 언급을 제거하고 중립 문구로 바꿔라(예: "혼돈의 존재가 첫 번째
  장난 임무를 속삭인다" — 구체 장난은 명시하지 않음).
- `src/ai/ai-gm-coordinator.ts` 오프닝 프롬프트의 blackboard 블록(:1443)에 한 문장 추가:
  "시나리오 openingSeed에 예시 장난이 있어도, fronts에서 stage가 '진행 중'인 front를 첫
  임무로 사용하라."
- 파이 문구를 assert하는 기존 테스트가 있으면 새 문구 기준으로 갱신. 신규 테스트: 오프닝
  프롬프트에 위 우선순위 문장이 포함된다.

## P-1 — 해석·굴림 중 테이블 잡담 허용 (제품, 설계 확정됨)

**의도**: resolving/rolling 동안 채팅만 허용한다(행동 확정은 계속 잠금). 결과를 기다리는
동안 친구들이 떠들 수 있어야 한다.

- 서버 `src/core/round-loop.ts` `SEND_CHAT`(:324): 허용 phase를
  `free_chat | ready_check | resolving | rolling`으로 확장(`ended`만 차단). 주석에 이유
  명시("결과 대기 중 테이블 잡담 — CONFIRM/PASS/REVISE 잠금은 그대로").
- **주의**: resolving 중 도착한 채팅은 이미 스냅샷된 해석에는 영향 없고 다음 라운드 AI
  컨텍스트에 포함된다 — 의도된 동작이며 추가 처리 금지.
- 클라이언트 `public/game/logic.js`: `isInputLocked`(:746 부근)는 그대로 두고, 전송 게이트를
  분리하라 — `canSendChat(state)` 신설(연결 open + ended 아님 + turnReceived). index.html의
  입력 처리에서 resolving/rolling 중에는 **따옴표 여부와 무관하게 전량 채팅으로 전송**하고,
  행동 구문이 감지되면 입력창 아래 힌트로 "지금은 대사만 보낼 수 있어요 — 행동은 다음
  라운드에"를 textContent로 표시(기존 힌트 요소 관례 재사용).
- placeholder도 phase에 맞춰 변경: resolving/rolling일 때 "대사(잡담)만 가능…".
- 테스트: round-loop에서 rolling 중 SEND_CHAT이 chatLog에 append됨 + ended는 여전히 차단;
  클라이언트 게이트/라우팅 단위 테스트.

## P-2 — 대기 시간을 채우는 단계별 진행 표시 (제품, 클라이언트 전용)

**의도**: "GM이 서술을 쓰는 중" 한 줄 대신, 지금 GM이 뭘 하는 중인지 + 경과 시간을 보여준다.

- `public/game/index.html` `renderStory()`의 waiting 블록(:1122 부근)을 확장:
  - phase가 `resolving`이고 `rollingChecks`가 비어 있으면 → "GM이 상황을 읽고 판정을 고르는 중"
  - phase가 `rolling`이고 pending 판정이 있으면 → 기존 판정 UI가 주인공이므로 waiting 블록 숨김
  - phase가 `resolving`·`rolling`이고 모든 판정이 rolled면 → "GM이 결과 서술을 쓰는 중"
  - 각 문구 뒤에 경과 시간 "(N초)"를 붙인다. 시작 시각은 해당 상태로 **진입한** 렌더에서
    모듈 변수에 기록하고 상태가 바뀌면 리셋(기존 1초 렌더 티커가 갱신을 보장한다).
- 신규 서버 이벤트 금지 — 전부 기존 state에서 파생할 것.
- 테스트: happy-dom 렌더 테스트 1건(문구 분기), 티커 의존 로직은 파생 함수로 분리해 단위 테스트.

## 착수 순서와 검수 게이트

| 순서 | 작업 | 검수(QA가 수행) |
|---|---|---|
| 1 | T-1 | 하네스 재실행 + AI 실패 주입 시나리오, retrying 이벤트·5초 재시도 확인 |
| 2 | T-2 | 하네스 즉시확정 시나리오에서 `checks_pending`이 오프닝 뒤에만 발생 |
| 3 | T-3 + P-2 (독립적, 병행 가능) | 오프닝 프롬프트 스냅샷 + 수동 화면 확인 |
| 4 | P-1 | 롤링 중 채팅 왕복 + 행동 잠금 유지 확인 |

F7(서사 전 라운드 전환 표시)·F8(채팅 이력 영속화)은 **이번 착수 범위에서 제외** — 설계
논의 후 별도 지시서로 낸다. 지시 없이 손대지 말 것.
