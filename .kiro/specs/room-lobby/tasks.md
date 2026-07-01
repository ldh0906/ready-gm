# Implementation Plan: Room_Lobby_App (호스트 로비 / 대기실 화면)

## Overview

host-entry가 확립한 관례를 그대로 미러링한다(빌드 단계 없는 정적 `public/*.html`, 바닐라 JS ES 모듈, 인라인 CSS, 다크 테마, 순수 로직 분리). 순수 로직은 `public/lobby/logic.js`(노드에서 직접 import 가능한 ES 모듈)에 모으고, `public/lobby/index.html`은 그 모듈을 import 해 DOM 배선과 부수효과(`fetch` + `AbortController` 10초 타임아웃, 주입 가능한 `connect(roomId, token)` WebSocket 어댑터·재연결, 30초 세션 시작 타임아웃, 클립보드, 게임 화면 네비게이션 인계)만 담당한다.

테스트는 이미 devDependency인 `vitest` + `fast-check`로 작성하고, DOM·실시간 배선 테스트는 `happy-dom`(이미 devDependency) 환경에서 수행한다. `vitest.config.ts`의 `include`는 이미 `public/**/*.test.js`를 매칭한다. 설계의 Correctness Property 1~18은 각각 **정확히 하나의** 속성 기반 테스트가 되며, 최소 100회 반복(`numRuns: 100`)으로 실행하고 다음 태그를 주석으로 단다: `Feature: room-lobby, Property {N}: {속성 텍스트}`. 시각/접근성/정적 DOM·실시간 배선·타이머·클립보드 폴백은 예제·통합 테스트로 검증한다.

구현 언어/스택은 설계가 명시한 바닐라 JS(ES 모듈)이므로 별도 언어 선택은 필요하지 않다.

## Tasks

- [x] 1. 프로젝트 구조와 테스트 인프라 준비
  - [x] 1.1 `public/lobby/logic.js` 순수 로직 모듈 스캐폴드 생성
    - `public/lobby/` 디렉터리와 `logic.js` ES 모듈을 만든다
    - 상태 모델 상수와 타입 주석을 정의한다: `AreaPhase`(idle/loading/loaded/error), `ErrorKind`(notfound/server/network/timeout/invalid), `ConnectionStatus`(connecting/open/disconnected)
    - 타임아웃·복사 상수 정의: `REQUEST_TIMEOUT_MS = 10000`, `SESSION_START_TIMEOUT_MS = 30000`, `COPY_CONFIRM_MS = 3000`
    - 한국어 사용자 메시지 상수(인계 무효, 초대 오류, 방 정보 오류, 시나리오 오류·빈 목록·불일치, 연결 끊김, 세션 시작 실패/지연, 타임아웃/네트워크/서버 구분 메시지)를 선언한다
    - 초기 상태 팩토리 `createInitialState(handoff)`를 정의한다(handoff, handoffValid, invite/room/scenarios 영역 상태, selectedScenario, scenarioNotice, connection, roster, startCommandSent, sessionStarting, startError, handoffDone, copyConfirmedUntil, copyFailed)
    - 이후 단계에서 채울 순수 함수 export 스텁을 선언한다(`parseHandoff`, `isHandoffValid`, `buildAuthHeaders`, `buildInviteRequest`, `buildRoomResolveRequest`, `buildScenariosRequest`, `extractInviteToken`, `validateRoomInfo`, `classifyResponse`, `classifyOutcome`, `selectScenario`, `eventToAction`, `renderRoster`, `computeStartEnabled`, `detectSessionActive`, `buildGameHandoff`, `reduce`, `computeVisibility`, `copyInviteLink`)
    - _Requirements: 1.1, 1.4_

  - [x] 1.2 속성/DOM 테스트가 동작하도록 vitest 설정 확인
    - `vitest.config.ts`의 `include`가 `public/**/*.test.js`를 매칭하는지 확인한다(이미 매칭하면 변경 불필요)
    - DOM·실시간 배선 테스트용 `happy-dom`이 devDependency로 존재하는지 확인하고, 파일별 `// @vitest-environment happy-dom` 지정 방식을 따른다(순수 로직 테스트는 기본 node 환경 유지)
    - 새 런타임/빌드 의존성은 추가하지 않는다
    - _Requirements: 1.1_

- [x] 2. 순수 보조 함수 구현 (인계 파싱·검증 · 토큰 헤더 · 요청 구성 · 결과 분류 · 토큰 추출 · 방 정보 검증)
  - [x] 2.1 `parseHandoff`·`isHandoffValid`·`buildAuthHeaders` 구현
    - `parseHandoff(search)` → 쿼리에서 `roomId`·`hostPlayerId`·`token`을 공백 제거 후 추출(토큰은 트림 후 빈 문자열이면 `""`)
    - `isHandoffValid(handoff)` → 트림된 `roomId`와 `hostPlayerId`가 모두 비어 있지 않을 때만 true
    - `buildAuthHeaders(token)` → 토큰이 비어 있지 않으면 `{ "x-playtest-token": token }`, 아니면 `{}`
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 10.1, 10.2_

  - [x] 2.2 REST 요청 빌더 구현
    - `buildInviteRequest(roomId, token)` → `{ url: "/rooms/" + encodeURIComponent(roomId) + "/invite", method: "GET", headers }`
    - `buildRoomResolveRequest(inviteToken, token)` → `{ url: "/rooms/" + encodeURIComponent(inviteToken), method: "GET", headers }`
    - `buildScenariosRequest(token)` → `{ url: "/scenarios", method: "GET", headers }`
    - 세 빌더 모두 `buildAuthHeaders(token)`로 헤더를 구성한다(토큰 비어 있으면 `x-playtest-token` 미포함)
    - _Requirements: 2.1, 4.2, 5.1, 10.1, 10.2_

  - [x]* 2.3 Property 2 속성 테스트 작성
    - **Property 2: 접근 토큰과 요청 헤더는 동치다**
    - 토큰 생성기(빈 문자열 + 특수문자 포함 임의 비공백 문자열) × 세 요청 빌더로 `x-playtest-token` 존재/부재와 값 무변형을 검증
    - 태그 주석: `Feature: room-lobby, Property 2: 접근 토큰과 요청 헤더는 동치다`, `numRuns: 100`
    - **Validates: Requirements 1.2, 1.5, 10.1, 10.2**

  - [x]* 2.4 Property 3 속성 테스트 작성
    - **Property 3: REST 요청 명세는 올바른 URL과 메서드를 만든다**
    - 임의 `roomId`·Invite_Token 생성기로 `buildInviteRequest`/`buildRoomResolveRequest`/`buildScenariosRequest`의 URL(인코딩 포함)·메서드를 검증
    - 태그 주석: `Feature: room-lobby, Property 3: REST 요청 명세는 올바른 URL과 메서드를 만든다`, `numRuns: 100`
    - **Validates: Requirements 2.1, 4.2, 5.1**

  - [x] 2.5 `classifyResponse`·`classifyOutcome` 구현
    - `classifyResponse({ ok, status })` → `"success"(2xx)` / `"notfound"(404)` / `"server"(≥500)` / `"unknown"(기타 비-2xx)`
    - `classifyOutcome({ kind, response? })` → 네트워크 실패=`network`, 타임아웃=`timeout`, 응답은 `classifyResponse` 결과를 `success`/`notfound`/`server`(unknown 포함 보수적)로 환원
    - _Requirements: 2.4, 2.5, 4.5, 9.1, 9.2, 9.3, 9.4_

  - [x]* 2.6 Property 4 속성 테스트 작성
    - **Property 4: 요청 결과는 오류 종류로 정확히 환원된다**
    - 결과 생성기(2xx, 404, 임의 4xx, 임의 5xx, 기타 비-2xx, `network`, `timeout`)로 `classifyOutcome` 환원을 검증
    - 태그 주석: `Feature: room-lobby, Property 4: 요청 결과는 오류 종류로 정확히 환원된다`, `numRuns: 100`
    - **Validates: Requirements 2.4, 2.5, 4.5, 9.1, 9.2, 9.3, 9.4**

  - [x] 2.7 `extractInviteToken`·`validateRoomInfo` 구현
    - `extractInviteToken(inviteLink)` → 질의(`?`/`#`) 제거 → 끝 `/` 제거 → 마지막 `/` 뒤 세그먼트, 추출 불가면 `""`
    - `validateRoomInfo(body)` → `maxPlayers`가 1 이상 정수이고 `scenarioId`가 비어 있지 않은 문자열일 때만 `{ ok: true, maxPlayers, scenarioId }`, 그 외 `{ ok: false }`
    - _Requirements: 4.1, 4.3, 4.4, 4.6_

  - [x]* 2.8 Property 5 속성 테스트 작성
    - **Property 5: 초대 토큰 추출 라운드트립**
    - 비어 있지 않은 토큰 생성기 + 기본 베이스 URL 결합(끝 슬래시/질의 문자열 변형 포함)으로 `extractInviteToken`이 원래 토큰을 복원함을, 세그먼트를 만들 수 없는 입력은 `""`를 반환함을 검증
    - 태그 주석: `Feature: room-lobby, Property 5: 초대 토큰 추출 라운드트립`, `numRuns: 100`
    - **Validates: Requirements 4.1, 4.4**

- [x] 3. 시나리오 매칭 · 실시간 이벤트 환원 · 로스터 · 세션 보조 함수 구현
  - [x] 3.1 `selectScenario` 구현
    - `selectScenario(scenarios, selectedScenarioId)` → `matched`(식별자 일치) / `default`(목록 정확히 1개 + 식별자 미확정) / `empty`(빈 목록) / `unmatched`(불일치) 분기와, matched/default 시 `{ title, summary }` 반환
    - _Requirements: 5.2, 5.3, 5.6, 5.7_

  - [x]* 3.2 Property 7 속성 테스트 작성
    - **Property 7: 시나리오 매칭과 기본 선택**
    - 시나리오 목록 생성기(0개/1개/다수, 일치/불일치 식별자, 미확정 null)로 `selectScenario` 4분기를 검증
    - 태그 주석: `Feature: room-lobby, Property 7: 시나리오 매칭과 기본 선택`, `numRuns: 100`
    - **Validates: Requirements 5.2, 5.3, 5.6, 5.7**

  - [x] 3.3 `eventToAction` 구현
    - `eventToAction(event)` → `player_list_updated`→`PLAYER_LIST_UPDATED`, `scenario_set`→`SCENARIO_SET`, `turn_state`→`TURN_STATE`, 연결 상태→`CONNECTION_OPENED`/`CONNECTION_LOST`로 환원
    - 관심 없는 이벤트(`chat_message`/`narration`/`readiness_updated`/`delivery_failed`)는 `null` 반환(로비 무시)
    - _Requirements: 5.4, 6.2, 6.3, 6.4, 7.5_

  - [x] 3.4 `renderRoster` 구현
    - `renderRoster(roster, maxPlayers)` → 각 플레이어 `displayName`(이스케이프)·호스트 표시, 현재 인원 수와 Max_Players, 0명일 때 "아직 모인 플레이어 없음" 안내를 포함한 마크업 문자열 반환
    - _Requirements: 6.2, 6.5, 6.6_

  - [x] 3.5 `computeStartEnabled`·`detectSessionActive`·`buildGameHandoff` 구현
    - `computeStartEnabled(state)` → `connection === "open"` && Selected_Scenario 확정 && 로스터 ≥ 1명의 논리곱
    - `detectSessionActive({ roundNumber, roomState })` → `roundNumber >= 1` 또는 `roomState === "in_session"`이면 true
    - `buildGameHandoff(handoff)` → `{ roomId, hostPlayerId }`, 토큰이 비어 있지 않으면 `token` 포함
    - _Requirements: 7.2, 7.3, 7.5, 7.6, 10.3, 10.4_

  - [x]* 3.6 Property 11 속성 테스트 작성
    - **Property 11: 세션 시작 활성 술어**
    - 불리언 조합 생성기(연결 상태·시나리오 확정·로스터 인원의 모든 조합)로 `computeStartEnabled`가 세 조건의 논리곱과 동치임을 검증
    - 태그 주석: `Feature: room-lobby, Property 11: 세션 시작 활성 술어`, `numRuns: 100`
    - **Validates: Requirements 7.2, 7.3**

- [x] 4. 상태 리듀서 `reduce` 구현
  - [x] 4.1 단방향 상태 전이 `reduce(state, action)` 구현
    - `HANDOFF_PARSED`: `handoff` 저장, `isHandoffValid`로 `handoffValid` 설정. 무효면 모든 영역 `phase`는 `idle` 유지(요청·연결 미시작)
    - `*_STARTED`: 해당 영역 `phase="loading"`, `errorKind=null`
    - `INVITE_SUCCEEDED`: `invite.phase="loaded"`, `data=inviteLink`
    - `ROOM_SUCCEEDED`: `room.phase="loaded"`, `maxPlayers`/`scenarioId` 보존 / `ROOM_INVALID`: `room.phase="error"`, `errorKind="invalid"`
    - `*_FAILED`: 해당 영역 `phase="error"`, `errorKind` 설정, **인계 식별자·토큰 불변**, 시나리오 실패는 기존 `selectedScenario` 보존
    - `SCENARIOS_SUCCEEDED`: `selectScenario` 결과로 `selectedScenario`/`scenarioNotice` 갱신
    - `SCENARIO_SET`: `selectedScenario`를 이벤트 `title`/`summary`로 갱신
    - `PLAYER_LIST_UPDATED`: `roster`를 이벤트 목록으로 교체 / `CONNECTION_OPENED`·`CONNECTION_LOST`: `connection` 갱신
    - `START_SESSION`: `startCommandSent===false` && `computeStartEnabled(state)`일 때만 `startCommandSent=true`, `sessionStarting=true`(정확히 1회), 그 외 무변화
    - `TURN_STATE`: `detectSessionActive` && `handoffDone===false`이면 `handoffDone=true`, `sessionStarting=false`(인계 1회)
    - `START_SESSION_FAILED`·`START_SESSION_TIMEOUT`: `sessionStarting=false`, `startCommandSent=false`, `startError` 설정
    - `COPY_SUCCEEDED`: `copyConfirmedUntil = now + COPY_CONFIRM_MS` / `COPY_FAILED`: `copyFailed=true`
    - 각 오류 종류·영역에 대응하는 한국어 메시지를 매핑한다
    - _Requirements: 1.3, 1.4, 2.3, 4.3, 4.6, 5.4, 5.5, 6.2, 6.3, 6.4, 7.4, 7.5, 7.6, 7.7, 8.5, 8.6, 3.3, 3.4, 9.5, 9.6_

  - [x]* 4.2 Property 1 속성 테스트 작성
    - **Property 1: 인계 파싱과 검증**
    - 인계 생성기(앞뒤 임의 공백·공백만·빈 값 조합)로 `parseHandoff` 트림 추출·`isHandoffValid` 동치를 검증하고, 무효 인계 `HANDOFF_PARSED` reduce 후 어떤 REST 영역도 `loading`이 아님을 검증
    - 태그 주석: `Feature: room-lobby, Property 1: 인계 파싱과 검증`, `numRuns: 100`
    - **Validates: Requirements 1.1, 1.3**

  - [x]* 4.3 Property 6 속성 테스트 작성
    - **Property 6: 방 정보 검증과 보존**
    - 방 정보 본문 생성기(유효: 정수 ≥1 + 비빈 식별자 / 무효: 0·음수·비정수·누락·빈 식별자)로 `validateRoomInfo` 판정과 `ROOM_SUCCEEDED` reduce 후 값 보존, 무효 시 `ROOM_INVALID` 처리를 검증
    - 태그 주석: `Feature: room-lobby, Property 6: 방 정보 검증과 보존`, `numRuns: 100`
    - **Validates: Requirements 4.3, 4.6**

  - [x]* 4.4 Property 8 속성 테스트 작성
    - **Property 8: scenario_set 이벤트는 표시 시나리오를 갱신한다**
    - 임의 `scenario_set`(`scenarioId`·`title`·`summary`) 생성기로 `SCENARIO_SET` reduce 후 `selectedScenario`가 이벤트 값으로 갱신됨을 검증
    - 태그 주석: `Feature: room-lobby, Property 8: scenario_set 이벤트는 표시 시나리오를 갱신한다`, `numRuns: 100`
    - **Validates: Requirements 5.4**

  - [x]* 4.5 Property 9 속성 테스트 작성
    - **Property 9: 시나리오 실패는 기존 표시를 보존한다**
    - 이미 시나리오가 채워진 상태 + 임의 오류 종류로 `SCENARIOS_FAILED` reduce 후 `scenarios.phase==="error"`이지만 `selectedScenario.title`/`summary` 불변임을 검증
    - 태그 주석: `Feature: room-lobby, Property 9: 시나리오 실패는 기존 표시를 보존한다`, `numRuns: 100`
    - **Validates: Requirements 5.5**

  - [x]* 4.6 Property 10 속성 테스트 작성
    - **Property 10: 로스터 교체와 인원·정원 표시**
    - 이전 로스터 + `player_list_updated` 목록 생성기(0명 포함, `isHost` 혼합, 비-ASCII)로 `PLAYER_LIST_UPDATED` reduce 후 완전 교체와 `renderRoster` 출력에 모든 `displayName`·호스트 표시·인원 수·Max_Players(빈 목록 안내 포함) 포함을 검증
    - 태그 주석: `Feature: room-lobby, Property 10: 로스터 교체와 인원·정원 표시`, `numRuns: 100`
    - **Validates: Requirements 6.2, 6.5, 6.6**

  - [x]* 4.7 Property 12 속성 테스트 작성
    - **Property 12: 세션 시작 명령은 정확히 한 번 전송된다**
    - `computeStartEnabled`가 true인 상태 + N≥1회 `START_SESSION`으로 `startCommandSent`가 한 번만 false→true 전이, 이후 무효, 전이 직후 `sessionStarting===true`임을 검증
    - 태그 주석: `Feature: room-lobby, Property 12: 세션 시작 명령은 정확히 한 번 전송된다`, `numRuns: 100`
    - **Validates: Requirements 7.4, 8.5**

  - [x]* 4.8 Property 13 속성 테스트 작성
    - **Property 13: 세션 활성 감지와 게임 화면 인계 1회**
    - `TURN_STATE` 생성기(`roundNumber` 0/≥1, 방 상태 `lobby`/`in_session`)로 활성 감지 시 인계 1회·비활성 동안 미인계를 검증하고, `buildGameHandoff` 결과에 `roomId`·`hostPlayerId`(+ 비어있지 않은 토큰)가 포함됨을 검증
    - 태그 주석: `Feature: room-lobby, Property 13: 세션 활성 감지와 게임 화면 인계 1회`, `numRuns: 100`
    - **Validates: Requirements 7.5, 7.6, 10.3, 10.4**

  - [x]* 4.9 Property 14 속성 테스트 작성
    - **Property 14: 세션 시작 실패·타임아웃은 재시도 가능 상태로 되돌린다**
    - `sessionStarting===true` 상태에서 `START_SESSION_FAILED`/`START_SESSION_TIMEOUT` reduce 후 `sessionStarting===false`, `startCommandSent===false`, `startError` 설정을 검증
    - 태그 주석: `Feature: room-lobby, Property 14: 세션 시작 실패·타임아웃은 재시도 가능 상태로 되돌린다`, `numRuns: 100`
    - **Validates: Requirements 7.7, 8.6**

  - [x]* 4.10 Property 17 속성 테스트 작성
    - **Property 17: 복사 성공 확인 메시지는 최소 3초 표시된다**
    - 임의 `now`에 대해 `COPY_SUCCEEDED` reduce 후 `copyConfirmedUntil === now + 3000`을 검증
    - 태그 주석: `Feature: room-lobby, Property 17: 복사 성공 확인 메시지는 최소 3초 표시된다`, `numRuns: 100`
    - **Validates: Requirements 3.3**

  - [x]* 4.11 Property 18 속성 테스트 작성
    - **Property 18: 복구 가능 오류는 입력을 보존하고 재시도를 허용한다**
    - 임의 인계 상태 + 복구 가능 오류 액션 시퀀스(`INVITE_FAILED`/`ROOM_FAILED`/`SCENARIOS_FAILED` 임의 조합) 적용 후 `handoff`의 `roomId`·`hostPlayerId`·`token` 불변과 실패 영역의 `error` 단계(재요청 가능)를 검증
    - 태그 주석: `Feature: room-lobby, Property 18: 복구 가능 오류는 입력을 보존하고 재시도를 허용한다`, `numRuns: 100`
    - **Validates: Requirements 2.6, 9.5, 9.6**

- [x] 5. 뷰 모델 가시성 구현
  - [x] 5.1 `computeVisibility(state)` 구현
    - 각 REST 영역 로딩 인디케이터는 `phase==="loading"`일 때만 표시하고 그때 동일 영역 재트리거 컨트롤 비활성, `loaded`/`error`이면 해제·재활성
    - 실시간 연결 활성 표시는 `connection==="open"`일 때만, 세션 시작 인디케이터는 `sessionStarting`일 때만 표시, 데이터 적재 전(인계 직후)에는 사용자 조작 컨트롤 비활성
    - _Requirements: 1.4, 2.2, 6.3, 8.1, 8.2, 8.3_

  - [x]* 5.2 Property 15 속성 테스트 작성
    - **Property 15: 가시성은 상태의 함수다**
    - 임의 상태 생성기로 `computeVisibility` 출력(영역별 인디케이터/재트리거 비활성, 연결 활성 표시, 세션 시작 인디케이터, 적재 전 비활성)이 상태와 일치함을 검증
    - 태그 주석: `Feature: room-lobby, Property 15: 가시성은 상태의 함수다`, `numRuns: 100`
    - **Validates: Requirements 1.4, 2.2, 6.3, 8.1, 8.2, 8.3**

- [x] 6. 클립보드 복사 어댑터 구현
  - [x] 6.1 `copyInviteLink` 어댑터 구현 (host-entry 패턴 재사용)
    - `copyInviteLink(inviteLink, clipboard)` → 주입된 클립보드 어댑터의 `writeText`로 `inviteLink` 전체 문자열을 기록하고 성공 시 true, 어댑터 없음·거부·예외 시 false 반환
    - _Requirements: 3.2, 3.4_

  - [x]* 6.2 Property 16 속성 테스트 작성
    - **Property 16: 복사 동작은 초대 링크 전체를 그대로 기록한다**
    - 임의 `inviteLink` 생성기(특수문자·이모지·매우 긴 문자열) + 모킹된 클립보드 어댑터로 전달값이 링크 전체와 정확히 일치함을, 어댑터가 없거나 거부·예외 시 false임을 검증
    - 태그 주석: `Feature: room-lobby, Property 16: 복사 동작은 초대 링크 전체를 그대로 기록한다`, `numRuns: 100`
    - **Validates: Requirements 3.2, 3.4**

- [x] 7. 정적 페이지와 부수효과 계층 배선 - 순수 로직 통합
  - 모든 순수 로직과 테스트가 통과하는지 확인하고, 의문이 생기면 사용자에게 질문한다(아래 7.x 진행 전 체크포인트).

  - [x] 7.1 `public/lobby/index.html` 레이아웃·스타일·접근성 마크업 작성
    - 다크 테마 인라인 CSS, `<html lang="ko">`, viewport 메타를 기존 `public/index.html`·host-entry 관례에 맞춰 구성한다
    - Lobby_View 영역 마크업: 인계 무효 안내 영역, 초대 링크(복사 버튼·재조회 버튼·수동 복사용 readonly 링크 요소), 정원, 플레이어 로스터, 시나리오(제목·소개·빈/불일치 안내), 연결 상태 표시, Start_Session_Action 버튼, 영역별 로딩 인디케이터·오류 메시지 라이브 영역(`aria-live`)을 만든다
    - 320~767px에서 가로 스크롤 없이 세로 단일 열, `:focus-visible` 포커스 표시, DOM 순서와 일치하는 포커스 순서, 모든 상호작용 요소의 비어있지 않은 접근성 레이블을 제공한다
    - `logic.js`를 `<script type="module">`로 import 한다
    - _Requirements: 1.4, 2.2, 3.1, 6.5, 6.6, 7.1, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 7.2 부수효과 계층 배선 및 전체 통합
    - `parseHandoff(location.search)`로 인계를 읽어 초기 상태에 주입하고, 무효이면 안내 표시 후 REST·연결을 시작하지 않는다
    - 액션 디스패치 → `reduce` → `computeVisibility`/`renderRoster` 기반 DOM 렌더의 단방향 흐름을 배선한다
    - 각 REST 영역(초대→방정보 체인, 시나리오)을 `build*Request`로 구성해 `fetch`로 전송하고, 주입 가능한 `AbortController` 기반 10초 타임아웃을 적용해 초과 시 취소하고 `classifyOutcome`로 `timeout`을 만든다. 응답 시 타이머 해제 후 `classifyResponse`/`classifyOutcome`로 결과 액션을 디스패치한다. 초대 성공 시 `extractInviteToken`→`buildRoomResolveRequest`로 방 정보를 이어 조회한다
    - 주입 가능한 `connect(roomId, token)` WebSocket 어댑터로 채널을 열고, `eventToAction`으로 `ServerEvent`를 액션으로 환원해 디스패치하며, 끊김 시 `CONNECTION_LOST` 후 일정 간격 재연결을 시도한다
    - Start_Session_Action 클릭 시 `computeStartEnabled` 충족 시에만 `START_SESSION` 명령을 채널로 1회 전송하고, 30초 세션 시작 타임아웃을 적용해 미전이 시 `START_SESSION_TIMEOUT`을 디스패치한다. 활성 전이 관측 시 `buildGameHandoff` 페이로드로 게임 화면(`/lobby/game?roomId=...&hostPlayerId=...&token=...`)에 1회 인계한다
    - `copyInviteLink` 호출, 성공 시 확인 메시지 표시·실패 시 수동 복사 폴백 노출을 배선한다
    - _Requirements: 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.5, 4.6, 5.1, 5.2, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 10.1, 10.2, 10.3, 10.4_

  - [x]* 7.3 예제 DOM 테스트 작성 (happy-dom)
    - 성공 패널의 복사 버튼·재조회 버튼·Start_Session_Action 존재, 초기 비활성 상태, 0명 로스터 안내·빈 시나리오 안내 문구 표시를 검증한다
    - 모든 상호작용 요소의 접근성 레이블 비어있지 않음, Tab 포커스 순서가 DOM 순서와 일치, Enter/Space 활성화, 오류/상태 메시지의 `aria-live` 라이브 영역 제공을 검증한다
    - _Requirements: 3.1, 6.6, 7.1, 11.2, 11.3, 11.5, 11.6_

  - [x]* 7.4 통합 테스트 작성 (happy-dom + fake timers + 가짜 채널 어댑터)
    - 가짜 타이머로 10초 경과 시 `AbortController`가 진행 중 `fetch`를 취소하는지, 30초 경과 시 `START_SESSION_TIMEOUT`이 디스패치되는지 검증한다
    - 가짜 `connect` 어댑터로 유효 인계 시 채널 연결 시작, `player_list_updated`/`scenario_set`/`turn_state` 이벤트가 `eventToAction`을 거쳐 화면에 반영, 끊김 후 재연결 시도를 검증한다
    - 클립보드 어댑터 실패 모킹 시 수동 복사용 readonly 링크 요소 노출, 타임아웃·네트워크·서버(5xx) 오류의 한국어 메시지가 서로 구분되어 표시되는지 검증한다
    - _Requirements: 3.4, 5.4, 6.1, 6.4, 8.4, 8.6, 9.1, 9.2, 9.3, 9.4_

- [x] 8. 최종 체크포인트 - 모든 테스트 통과 확인
  - 모든 테스트가 통과하는지 확인하고, 의문이 생기면 사용자에게 질문한다.

## Notes

- `*`로 표시된 하위 작업은 선택 사항(테스트)이며 빠른 MVP를 위해 건너뛸 수 있다. 핵심 구현 작업은 표시되지 않는다.
- Correctness Property 1~18은 각각 하나의 속성 기반 테스트로 구현되며, 구현 직후 가까운 위치에 배치해 오류를 조기에 잡는다. 리듀서에 의존하는 속성(1·6·8·9·10·12·13·14·17·18)은 `reduce` 구현 직후 에픽 4에 모은다.
- 모든 속성 테스트는 `numRuns: 100` 이상으로 실행하고 `Feature: room-lobby, Property {N}: {텍스트}` 태그를 주석으로 단다.
- 시각/접근성/정적 DOM, 실시간 `connect` 어댑터 배선·재연결, 10초/30초 타이머, 클립보드 폴백, 오류 문구 구분 등 속성으로 다루지 않는 요구사항은 예제·통합 테스트(7.3, 7.4)로 검증한다.
- 모든 외부 의존성(`fetch`, `connect`, 클립보드, 타이머)은 주입 가능하게 만들어 아직 배선되지 않은 백엔드 항목도 모킹으로 완전히 테스트한다.
- 각 작업은 추적성을 위해 구체적인 요구사항 절을 참조한다.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.5", "2.3", "2.4"] },
    { "id": 4, "tasks": ["2.7", "2.6"] },
    { "id": 5, "tasks": ["3.1", "2.8"] },
    { "id": 6, "tasks": ["3.3", "3.2"] },
    { "id": 7, "tasks": ["3.4"] },
    { "id": 8, "tasks": ["3.5"] },
    { "id": 9, "tasks": ["4.1", "3.6"] },
    { "id": 10, "tasks": ["5.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "4.11"] },
    { "id": 11, "tasks": ["6.1", "5.2"] },
    { "id": 12, "tasks": ["7.1", "6.2"] },
    { "id": 13, "tasks": ["7.2"] },
    { "id": 14, "tasks": ["7.3", "7.4"] }
  ]
}
```
