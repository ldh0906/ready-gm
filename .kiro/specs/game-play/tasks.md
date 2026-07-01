# Implementation Plan: Game_Play_App (게임 플레이 화면)

## Overview

host-entry·room-lobby가 확립한 관례를 그대로 미러링한다(빌드 단계 없는 정적 `public/*.html`, 바닐라 JS ES 모듈, 인라인 CSS, 다크 테마, 순수 로직 분리). 순수 로직은 `public/game/logic.js`(노드에서 직접 import 가능한 ES 모듈)에 모으고, `public/game/index.html`은 그 모듈을 import 해 DOM 배선과 부수효과(주입 가능한 `connect(roomId, token)` WebSocket 어댑터·재연결, 명령 `send`, 1초 카운트다운 타이머, MAX_ENTRIES DOM 상한, 입력 잠금/종료 처리, 본인 행동 로컬 에코)만 담당한다. 기존 `public/index.html`의 2분할 UX(GM 서사 패널 + 채팅·행동 로그 사이드바, 헤더 라운드/단계/준비/busy, 말하기·확정·패스 푸터)를 재구현하되 `POST /play/new`가 아니라 room-lobby 인계로 진입한다.

테스트는 이미 devDependency인 `vitest` + `fast-check`로 작성하고, DOM·실시간 배선 테스트는 `happy-dom`(이미 devDependency) 환경에서 수행한다. `vitest.config.ts`의 `include`는 이미 `public/**/*.test.js`를 매칭한다. 설계의 Correctness Property 1~12는 각각 **정확히 하나의** 속성 기반 테스트가 되며, 최소 100회 반복(`numRuns: 100`)으로 실행하고 다음 태그를 주석으로 단다: `Feature: game-play, Property {N}: {속성 텍스트}`. 시각/접근성/정적 DOM·실시간 배선·타이머·텍스트 이스케이프·종료 문구는 예제·통합 테스트로 검증한다.

구현 언어/스택은 설계가 명시한 바닐라 JS(ES 모듈)이므로 별도 언어 선택은 필요하지 않다.

## Tasks

- [x] 1. 프로젝트 구조와 테스트 인프라 준비
  - [x] 1.1 `public/game/logic.js` 순수 로직 모듈 스캐폴드 생성
    - `public/game/` 디렉터리와 `logic.js` ES 모듈을 만든다
    - 상태 모델 상수와 타입 주석을 정의한다: `Phase`(free_chat/ready_check/resolving/ended), `ConnectionStatus`(connecting/open/disconnected), `NarrationKind`(opening/resolution/closing)
    - 상한·메시지 상수 정의: `MAX_ENTRIES = 250`, 한국어 사용자 메시지 상수(인계 무효, 미연결, 연결 끊김, 전달 실패 재시도, 세션 종료 안내)
    - 초기 상태 팩토리 `createInitialState(handoff)`를 정의한다(handoff, handoffValid, connection, deliveryFailedNotice, turnReceived, roundNumber, phase, readiness, readyCheckDeadline, chatCount, narrationEntries, chatEntries, actionLog, ended)
    - 이후 단계에서 채울 순수 함수 export 스텁을 선언한다(`parseHandoff`, `isHandoffValid`, `buildConnectParams`, `eventToAction`, `appendNarration`, `narrativeContextToEntries`, `esc`, `appendNewChats`, `computeReadyCount`, `computeCountdownMs`, `computeBusy`, `buildChatCommand`, `buildConfirmCommand`, `buildPassCommand`, `buildReviseCommand`, `isInputLocked`, `detectSessionEnded`, `appendActionLog`, `makeConfirmEcho`, `makePassEcho`, `reduce`, `computeVisibility`)
    - _Requirements: 1.1, 1.4_

  - [x] 1.2 속성/DOM 테스트가 동작하도록 vitest 설정 확인
    - `vitest.config.ts`의 `include`가 `public/**/*.test.js`를 매칭하는지 확인한다(이미 매칭하면 변경 불필요)
    - DOM·실시간 배선 테스트용 `happy-dom`이 devDependency로 존재하는지 확인하고, 파일별 `// @vitest-environment happy-dom` 지정 방식을 따른다(순수 로직 테스트는 기본 node 환경 유지)
    - 새 런타임/빌드 의존성은 추가하지 않는다
    - _Requirements: 1.1_

- [x] 2. 인계 파싱·검증 · 연결 토큰 전달 · 이벤트 환원 순수 함수 구현
  - [x] 2.1 `parseHandoff`·`isHandoffValid` 구현
    - `parseHandoff(search)` → 쿼리에서 `roomId`·`hostPlayerId`·`token`을 공백 제거 후 추출(토큰은 트림 후 빈 문자열이면 `""`)
    - `isHandoffValid(handoff)` → 트림된 `roomId`와 `hostPlayerId`가 모두 비어 있지 않을 때만 true
    - _Requirements: 1.1, 1.3, 1.5_

  - [x]* 2.2 Property 1 속성 테스트 작성
    - **Property 1: 인계 파싱과 검증**
    - 인계 생성기(앞뒤 임의 공백·공백만·빈 값 조합)로 `parseHandoff` 트림 추출·`isHandoffValid` 동치를 검증하고, 무효 인계 `HANDOFF_PARSED` reduce 후 `handoffValid===false`이고 `connection`이 `disconnected` 유지임을 검증
    - 태그 주석: `Feature: game-play, Property 1: 인계 파싱과 검증`, `numRuns: 100`
    - **Validates: Requirements 1.1, 1.3**

  - [x] 2.3 `buildConnectParams` 구현
    - `buildConnectParams(roomId, token)` → `roomId`를 `encodeURIComponent`로 인코딩해 쿼리에 포함하고, 토큰이 비어 있지 않으면 `token`을 `encodeURIComponent`로 인코딩해 포함, 비어 있으면 `token`을 쿼리에 미포함
    - `{ roomId, token, query }` 형태를 반환한다
    - _Requirements: 1.2, 1.5, 10.1, 10.2, 10.3_

  - [x]* 2.4 Property 2 속성 테스트 작성
    - **Property 2: 접근 토큰은 연결 파라미터로 그대로 전달된다**
    - 토큰 생성기(빈 문자열 + `&`·`=`·이모지 포함 임의 비공백 문자열) × `roomId` 생성기로 `query`의 `token` 존재/부재와 디코드 시 값 무변형, `roomId` 인코딩 포함을 검증
    - 태그 주석: `Feature: game-play, Property 2: 접근 토큰은 연결 파라미터로 그대로 전달된다`, `numRuns: 100`
    - **Validates: Requirements 1.2, 1.5, 10.1, 10.2, 10.3**

  - [x] 2.5 `eventToAction` 구현
    - `eventToAction(event)` → `turn_state`→`TURN_STATE`, `chat_message`→`CHAT_MESSAGE`, `narration`→`NARRATION`, `readiness_updated`→`READINESS_UPDATED`, `scenario_set`→`SCENARIO_SET`, `delivery_failed`→`DELIVERY_FAILED`로 환원하고 각 페이로드를 손실 없이 옮긴다
    - 관심 없는 이벤트(`player_list_updated`)와 알 수 없는 `type`은 `null` 반환(게임 화면 무시)
    - _Requirements: 2.2, 3.1, 4.2, 5.2, 8.2_

  - [x]* 2.6 Property 3 속성 테스트 작성
    - **Property 3: 실시간 이벤트는 액션으로 정확히 환원된다**
    - ServerEvent 생성기(7개 분기 + 알 수 없는 type)로 `eventToAction`의 환원 결과와 페이로드 보존, `player_list_updated`/미지 이벤트의 `null`을 검증
    - 태그 주석: `Feature: game-play, Property 3: 실시간 이벤트는 액션으로 정확히 환원된다`, `numRuns: 100`
    - **Validates: Requirements 2.2, 3.1, 4.2, 5.2, 8.2**

- [x] 3. GM 서사 · 채팅 · 헤더 · 명령 빌더 · 입력 잠금 · 로컬 에코 순수 함수 구현
  - [x] 3.1 `appendNarration`·`narrativeContextToEntries`·`esc` 구현
    - `esc(value)` → `&`/`<`/`>` 이스케이프(`public/index.html` 패턴)
    - `appendNarration(entries, entry)` → 끝에 추가하고 길이가 MAX_ENTRIES를 넘으면 앞에서 잘라 상한 유지(불변, 새 배열)
    - `narrativeContextToEntries(narrativeContext)` → `{ round, text }` 목록을 표시용 항목으로 순서 보존 변환
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x]* 3.2 Property 4 속성 테스트 작성
    - **Property 4: GM 서사는 도착 순서대로 추가되고 상한을 지킨다**
    - Narration 시퀀스 생성기(MAX_ENTRIES 미만/초과, `kind` 혼합, 비-ASCII)로 `appendNarration` 누적 결과의 길이 ≤ 상한, 마지막 항목이 최근 추가분, N ≤ 상한 시 순서 보존을 검증하고 `narrativeContextToEntries` 순서 보존을 검증
    - 태그 주석: `Feature: game-play, Property 4: GM 서사는 도착 순서대로 추가되고 상한을 지킨다`, `numRuns: 100`
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 3.3 `appendNewChats` 구현
    - `appendNewChats(prevCount, chatLog)` → `chatLog.length >= prevCount`이면 인덱스 `prevCount` 이후만 새 항목으로, `chatLog.length < prevCount`이면 `prevCount`를 0으로 보고 전체를 새 항목으로 반환, `nextCount = chatLog.length`
    - _Requirements: 4.1, 4.4_

  - [x]* 3.4 Property 5 속성 테스트 작성
    - **Property 5: 채팅 로그는 새 항목만 추가하고 축소 시 리셋한다**
    - 직전 수보다 길거나 짧은(축소) Chat_Log 생성기(0 길이 포함)로 `appendNewChats`의 새 항목 슬라이스와 축소 시 0 리셋, `nextCount === chatLog.length`를 검증
    - 태그 주석: `Feature: game-play, Property 5: 채팅 로그는 새 항목만 추가하고 축소 시 리셋한다`, `numRuns: 100`
    - **Validates: Requirements 4.1, 4.4**

  - [x] 3.5 `computeReadyCount`·`computeCountdownMs`·`computeBusy` 구현
    - `computeReadyCount(readiness)` → `{ ready: status==="ready" 개수, total: 배열 길이 }`
    - `computeCountdownMs(deadlineIso, nowMs)` → `null`이면 null, 아니면 `Math.max(0, deadlineMs - nowMs)`
    - `computeBusy(phase)` → `phase === "resolving"`일 때만 true
    - _Requirements: 5.2, 5.3, 5.4, 5.5_

  - [x]* 3.6 Property 6 속성 테스트 작성
    - **Property 6: 준비 수는 readiness에서 정확히 도출된다**
    - readiness 생성기(0개 포함, `ready`/`not_ready` 혼합)로 `computeReadyCount`의 `ready`/`total`과 `0 <= ready <= total`을 검증
    - 태그 주석: `Feature: game-play, Property 6: 준비 수는 readiness에서 정확히 도출된다`, `numRuns: 100`
    - **Validates: Requirements 5.2, 5.3**

  - [x]* 3.7 Property 7 속성 테스트 작성
    - **Property 7: 준비 체크 카운트다운 잔여 시간**
    - 마감/현재 시각 생성기(`null`, 과거·현재·미래 ISO)로 `computeCountdownMs`가 null/`max(0, deadline-now)`이고 항상 0 이상, 마감 경과 시 정확히 0임을 검증
    - 태그 주석: `Feature: game-play, Property 7: 준비 체크 카운트다운 잔여 시간`, `numRuns: 100`
    - **Validates: Requirements 5.4**

  - [x] 3.8 입력 명령 빌더 구현
    - `buildChatCommand(text)` → 트림 비어 있으면 `null`, 아니면 `{ type: "chat", text }`
    - `buildConfirmCommand(action)` → 트림 비어 있으면 `null`, 아니면 `{ type: "confirm", action }`
    - `buildPassCommand()` → 항상 `{ type: "pass" }`
    - `buildReviseCommand(action)` → 트림 비어 있으면 `null`, 아니면 `{ type: "revise", action }`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x]* 3.9 Property 9 속성 테스트 작성
    - **Property 9: 명령 빌더는 올바른 JSON을 만들고 빈 입력을 거부한다**
    - 입력 문자열 생성기(빈/공백만/특수문자 포함 비공백)로 `buildChatCommand`/`buildConfirmCommand`/`buildReviseCommand`의 JSON 생성과 빈 입력 `null`, `buildPassCommand`가 항상 `{ type: "pass" }`임을 검증
    - 태그 주석: `Feature: game-play, Property 9: 명령 빌더는 올바른 JSON을 만들고 빈 입력을 거부한다`, `numRuns: 100`
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

  - [x] 3.10 `isInputLocked`·`detectSessionEnded` 구현
    - `isInputLocked(phase)` → `phase === "resolving" || phase === "ended"`일 때만 true
    - `detectSessionEnded({ phase, narrationKind })` → `phase === "ended"` 또는 `narrationKind === "closing"`이면 true
    - _Requirements: 7.1, 7.2, 7.3, 9.1_

  - [x]* 3.11 Property 8 속성 테스트 작성
    - **Property 8: 입력 잠금은 phase가 resolving 또는 ended일 때에만 참이다**
    - phase 생성기(`free_chat`/`ready_check`/`resolving`/`ended`와 기타 문자열)로 `isInputLocked`가 resolving/ended일 때만 true, 그 외 false임을 검증
    - 태그 주석: `Feature: game-play, Property 8: 입력 잠금은 phase가 resolving 또는 ended일 때에만 참이다`, `numRuns: 100`
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [x] 3.12 `appendActionLog`·`makeConfirmEcho`·`makePassEcho` 구현
    - `appendActionLog(log, entry)` → 끝에 추가하고 길이가 MAX_ENTRIES를 넘으면 앞에서 잘라 상한 유지(불변, 새 배열)
    - `makeConfirmEcho(playerId, action)` → `{ kind: "confirm", playerId, text: action }`
    - `makePassEcho(playerId)` → `{ kind: "pass", playerId, text: null }`
    - _Requirements: 6.2, 6.3_

- [x] 4. 상태 리듀서 `reduce` 구현
  - [x] 4.1 단방향 상태 전이 `reduce(state, action)` 구현
    - `HANDOFF_PARSED`: `handoff` 저장, `isHandoffValid`로 `handoffValid` 설정. 무효면 연결 미시작 상태 유지
    - `CONNECTION_OPENED`/`CONNECTION_LOST`: `connection` 갱신
    - `TURN_STATE`: `turnReceived=true`, `roundNumber`/`phase`/`readiness`/`readyCheckDeadline` 갱신, `appendNewChats`로 새 채팅만 추가 후 `chatCount` 갱신, `narrativeContextToEntries`로 서사 패널 반영, `detectSessionEnded({phase})` 참이면 `ended=true`
    - `CHAT_MESSAGE`: 라이브 채팅을 `chatEntries` 끝에 추가하고 `chatCount` 증가
    - `NARRATION`: `appendNarration`으로 서사 추가(상한), `kind==="closing"`이면 `ended=true`
    - `READINESS_UPDATED`: `readiness` 교체 / `SCENARIO_SET`: 시나리오 표시 보존 / `DELIVERY_FAILED`: `deliveryFailedNotice` 설정
    - `CONFIRM_ACTION`: `appendActionLog`로 본인 확정 로컬 에코 / `PASS`: 본인 패스 로컬 에코 / `REVISE`·`SEND_CHAT`: 상태 무변화
    - 입력 상태를 변형하지 않고 새 객체 반환, no-op은 동일 참조
    - _Requirements: 1.3, 2.2, 2.4, 2.5, 3.1, 3.2, 3.3, 4.1, 4.2, 4.4, 5.2, 5.3, 6.2, 6.3, 8.2, 9.1_

  - [x]* 4.2 Property 10 속성 테스트 작성
    - **Property 10: 로컬 에코는 본인의 확정·패스를 행동 로그에 추가한다**
    - `playerId`·액션 시퀀스 생성기(임의 길이의 `CONFIRM_ACTION`/`PASS` 혼합)로 reduce 후 각 액션마다 본인 발신 항목이 하나씩 추가되고(확정=`kind:"confirm"`+텍스트, 패스=`kind:"pass"`), `actionLog` 길이 ≤ MAX_ENTRIES임을 검증
    - 태그 주석: `Feature: game-play, Property 10: 로컬 에코는 본인의 확정·패스를 행동 로그에 추가한다`, `numRuns: 100`
    - **Validates: Requirements 6.2, 6.3**

- [x] 5. 뷰 모델 가시성 구현
  - [x] 5.1 `computeVisibility(state)` 구현
    - `connection === "open"`일 때만 연결 활성 표시, `phase === "resolving"`일 때만 busy 표시
    - `isInputLocked(phase)` 또는 `ended` 또는 `turnReceived === false` 또는 인계 무효일 때 입력 컨트롤 비활성(`inputDisabled`)
    - `ended`일 때 종료 안내 노출, 미연결 표시는 `connection !== "open"`
    - _Requirements: 1.4, 2.4, 2.5, 5.5, 7.1, 9.2, 9.3_

  - [x]* 5.2 Property 12 속성 테스트 작성
    - **Property 12: 가시성은 상태의 함수다**
    - 상태 생성기(연결 상태·phase·`ended`·`turnReceived`·인계 유효 조합)로 `computeVisibility`의 연결 활성/busy/입력 비활성/종료 안내 보고가 상태와 일치하고 결정적임을 검증
    - 태그 주석: `Feature: game-play, Property 12: 가시성은 상태의 함수다`, `numRuns: 100`
    - **Validates: Requirements 1.4, 2.4, 2.5, 5.5, 7.1, 9.2, 9.3**

  - [x]* 5.3 Property 11 속성 테스트 작성
    - **Property 11: 세션 종료 감지는 입력을 비활성화한다**
    - phase·Narration kind 생성기로 `detectSessionEnded`가 `ended`/`closing`일 때만 true이고, true가 reduce 되어 `ended`가 되면 `computeVisibility`가 `inputDisabled===true`로 보고함을 검증
    - 태그 주석: `Feature: game-play, Property 11: 세션 종료 감지는 입력을 비활성화한다`, `numRuns: 100`
    - **Validates: Requirements 9.1, 9.2**

- [x] 6. 정적 페이지와 부수효과 계층 배선 - 순수 로직 통합
  - 모든 순수 로직과 테스트가 통과하는지 확인하고, 의문이 생기면 사용자에게 질문한다(아래 6.x 진행 전 체크포인트).

  - [x] 6.1 `public/game/index.html` 레이아웃·스타일·접근성 마크업 작성
    - 다크 테마 인라인 CSS, `<html lang="ko">`, viewport 메타를 기존 `public/index.html` 관례에 맞춰 구성한다
    - Game_View 마크업: 헤더(연결 상태·라운드·단계·준비 X/total·카운트다운·busy 스피너), 2분할 본문(좌측 GM 서사 패널 + 우측 채팅·행동 로그 사이드바), 입력 푸터(메시지 입력 필드 + 말하기·행동 확정·패스·수정 버튼), 인계 무효 안내 영역, 연결/전달실패/종료 안내 라이브 영역(`aria-live`)을 만든다
    - 320~767px에서 가로 스크롤 없이 두 패널을 세로 단일 열로 적층, `:focus-visible` 포커스 표시, DOM 순서와 일치하는 포커스 순서, 모든 상호작용 요소의 비어있지 않은 접근성 레이블을 제공한다
    - `logic.js`를 `<script type="module">`로 import 한다
    - _Requirements: 1.4, 2.4, 2.5, 3.4, 4.3, 5.1, 5.4, 9.3, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 6.2 부수효과 계층 배선 및 전체 통합
    - `parseHandoff(location.search)`로 인계를 읽어 초기 상태에 주입하고, 무효이면 안내 표시 후 연결을 시작하지 않는다
    - 액션 디스패치 → `reduce` → `computeVisibility`/뷰 렌더(서사 패널·채팅 사이드바·행동 로그·헤더)의 단방향 흐름을 배선한다. 서사·행동 로그 DOM은 `MAX_ENTRIES` 상한을 적용한다
    - 주입 가능한 `connect(roomId, token)` WebSocket 어댑터(`window.__gameConnect`로 교체 가능)로 `buildConnectParams`의 쿼리를 사용해 채널을 열고, `eventToAction`으로 `ServerEvent`를 액션으로 환원해 디스패치하며, 끊김 시 `CONNECTION_LOST` 후 일정 간격 재연결을 시도하고 (재)연결 시 turn_state·플러시된 narration으로 재동기화한다
    - 입력 동작 배선: 말하기→`buildChatCommand`, 행동 확정→`buildConfirmCommand`(+`CONFIRM_ACTION` 로컬 에코), 패스→`buildPassCommand`(+`PASS` 로컬 에코), 수정→`buildReviseCommand`. 빌더가 `null`이면 미전송, 전송 성공 시 입력 필드를 비운다
    - `isInputLocked(phase)` 또는 `ended` 또는 연결 비활성(`connection !== "open"`)이면 명령을 채널로 전송하지 않고 로컬 에코도 디스패치하지 않으며, 입력 컨트롤을 비활성으로 렌더한다
    - 1초 간격 카운트다운 타이머로 `computeCountdownMs`를 갱신해 헤더에 표시하고, `phase === "resolving"`일 때 busy 표시를 노출한다. 세션 종료(`ended`) 시 입력을 비활성으로 유지하고 종료 안내를 표시하며 추가 네비게이션을 수행하지 않는다
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.2, 5.1, 5.2, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.3, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.4, 10.1, 10.2, 10.3_

  - [x]* 6.3 예제 DOM 테스트 작성 (happy-dom)
    - 헤더(라운드/단계/준비/busy), 2분할 패널, 말하기·행동 확정·패스 버튼·입력 필드 존재, 첫 turn_state 전 입력 비활성, 세션 종료 안내 문구 표시를 검증한다
    - GM 서사·채팅 텍스트의 HTML 이스케이프(`<`,`>`,`&` 미해석), `characterName` 귀속 표시, 모든 상호작용 요소의 접근성 레이블 비어있지 않음, Tab 포커스 순서가 DOM 순서와 일치, Enter/Space 활성화, 상태/오류 메시지의 `aria-live` 라이브 영역 제공을 검증한다
    - _Requirements: 3.4, 4.3, 5.1, 9.3, 11.2, 11.3, 11.5, 11.6_

  - [x]* 6.4 통합 테스트 작성 (happy-dom + fake timers + 가짜 채널 어댑터)
    - 가짜 `connect` 어댑터로 유효 인계 시 채널 연결 시작, `turn_state`/`chat_message`/`narration`/`readiness_updated`/`delivery_failed` 이벤트가 `eventToAction`을 거쳐 화면에 반영, 끊김 후 재연결 시도와 (재)연결 시 재동기화를 검증한다
    - 가짜 타이머로 1초 카운트다운 갱신 발화, 입력 잠금(`resolving`/`ended`) 또는 연결 끊김 동안 명령 미전송, 전송 성공 후 입력 필드 비우기, 본인 confirm/pass 로컬 에코 표시, 세션 종료 후 추가 네비게이션 미수행을 검증한다
    - _Requirements: 2.1, 2.3, 5.4, 6.6, 7.3, 8.1, 8.3, 8.4, 9.4_

- [x] 7. 최종 체크포인트 - 모든 테스트 통과 확인
  - 모든 테스트가 통과하는지 확인하고, 의문이 생기면 사용자에게 질문한다.

## Notes

- `*`로 표시된 하위 작업은 선택 사항(테스트)이며 빠른 MVP를 위해 건너뛸 수 있다. 핵심 구현 작업은 표시되지 않는다.
- Correctness Property 1~12는 각각 하나의 속성 기반 테스트로 구현되며, 구현 직후 가까운 위치에 배치해 오류를 조기에 잡는다. 리듀서에 의존하는 속성(10·11)은 `reduce`/`computeVisibility` 구현 직후 에픽 4·5에 모은다.
- 모든 속성 테스트는 `numRuns: 100` 이상으로 실행하고 `Feature: game-play, Property {N}: {텍스트}` 태그를 주석으로 단다.
- 시각/접근성/정적 DOM, 실시간 `connect` 어댑터 배선·재연결, 카운트다운 타이머, 텍스트 이스케이프, 종료 문구 등 속성으로 다루지 않는 요구사항은 예제·통합 테스트(6.3, 6.4)로 검증한다.
- 모든 외부 의존성(`connect`, 타이머)은 주입 가능하게 만들어(`window.__gameConnect`) 아직 배선되지 않은 백엔드 항목(ws 연결 티켓 간극)도 모킹으로 완전히 테스트한다.
- `logic.js`를 편집하는 작업은 서로 다른 wave로 분리해 순차 실행하고, 서로 다른 파일을 만드는 속성 테스트는 병렬화한다. 각 작업은 추적성을 위해 구체적인 요구사항 절을 참조한다.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.3", "2.2"] },
    { "id": 3, "tasks": ["2.5", "2.4"] },
    { "id": 4, "tasks": ["3.1", "2.6"] },
    { "id": 5, "tasks": ["3.3", "3.2"] },
    { "id": 6, "tasks": ["3.5", "3.4"] },
    { "id": 7, "tasks": ["3.8", "3.6", "3.7"] },
    { "id": 8, "tasks": ["3.10", "3.9"] },
    { "id": 9, "tasks": ["3.12", "3.11"] },
    { "id": 10, "tasks": ["4.1"] },
    { "id": 11, "tasks": ["5.1", "4.2"] },
    { "id": 12, "tasks": ["6.1", "5.2", "5.3"] },
    { "id": 13, "tasks": ["6.2"] },
    { "id": 14, "tasks": ["6.3", "6.4"] }
  ]
}
```
