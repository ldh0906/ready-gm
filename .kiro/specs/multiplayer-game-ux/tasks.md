# Implementation Plan: Multiplayer_Game_View (멀티플레이 차례/행동 표시 계층)

## Overview

기존 게임 플레이 화면(`public/game/`)의 3계층 구조(순수 로직 `logic.js` / 부수효과·DOM `index.html` / 테스트)를 **변경 없이 보존**하면서, 멀티플레이 표시 계층을 **가산(additive)** 으로 구현한다. 모든 파생은 `public/game/logic.js`에 **새 순수 셀렉터**로 추가하고(기존 `computeReadyCount`/`effectivePlayerId`/`esc`/`isInputLocked`/`buildConnectParams` 재사용), 렌더·게이팅·a11y/반응형은 `public/game/index.html`에 배선한다.

작업 순서 원칙:
- `logic.js`에 셀렉터를 **하나씩 순차로** 추가하고 바로 그 속성 테스트를 작성한다(같은 파일을 동시 수정하지 않음).
- `index.html` 렌더/게이팅/CSS는 셀렉터가 모두 준비된 뒤 배선한다.
- 셸 따옴표 관례상 테스트는 `& npx vitest run public/game/`, 빌드 검증은 `& npm run build`로 실행한다.

> 테스트 명령(전체): `& npx vitest run public/game/`
> 단일 파일: `& npx vitest run public/game/<file>.test.js`

## Tasks

- [x] 1. 캐릭터 이름 폴백 셀렉터 추가 (logic.js)
  - [x] 1.1 `characterNameFor` 및 보조 `latestChatCharacterName`를 `public/game/logic.js`에 순수 함수로 추가하고 export
    - `latestChatCharacterName(playerId, chatLog)`: `chatLog`가 배열이 아니면 `""`, 배열이면 끝에서부터 훑어 `playerId`가 일치하는 첫 항목의 트림된 `characterName`(비면 `""`)
    - `characterNameFor(playerId, readinessEntry, chatLog)`: intended `readinessEntry.characterName` 트림 후 비어 있지 않으면 그 값 → 아니면 `latestChatCharacterName` → 그것도 비면 `playerId` 자체
    - 기존 `trimToString`/`isNonEmptyString` 헬퍼 재사용, 예외를 던지지 않도록 방어
    - _Requirements: 1.2_
    - _Design: Components §1 characterNameFor / latestChatCharacterName_

  - [ ]* 1.2 `characterNameFor` 속성 테스트 작성 (`public/game/character-name-for.test.js`)
    - **Property 2: 캐릭터 이름은 결정적 폴백 순서를 따른다**
    - **Validates: Requirements 1.2**
    - 생성기: `playerId`, intended `characterName`(누락/공백/값), 같은 `playerId` 여러 `chatLog` 항목 및 부재 케이스(공백·비-ASCII·이모지 포함), `numRuns: 100` 이상
    - 태그 주석: `Feature: multiplayer-game-ux, Property 2`

- [x] 2. 로스터 도출 셀렉터 추가 (logic.js)
  - [x] 2.1 `rosterModel(turnState, viewerPlayerId)`를 `public/game/logic.js`에 추가하고 export
    - `readiness`가 배열이 아니면 `[]`, 배열이면 입력 순서 보존하여 항목당 한 `RosterEntry` 도출
    - 각 행: `playerId`, `characterName = characterNameFor(...)`, `connectionStatus`(intended 값이 `connected`/`disconnected`이면 그 값, 아니면 `unknown`), `status`, `actionKind`, `hasActed = actionKind != null`, `isSelf = playerId === viewerPlayerId`
    - _Requirements: 1.1, 1.4, 1.5, 4.2, 5.2, 5.4_
    - _Design: Components §2 rosterModel / Data Models RosterEntry_

  - [ ]* 2.2 `rosterModel` 속성 테스트 작성 (`public/game/roster-model.test.js`)
    - **Property 1: 로스터는 readiness에서 1:1·순서 보존으로 도출된다**
    - **Validates: Requirements 1.1, 1.4, 1.5, 4.2, 5.2, 5.4**
    - 생성기: 임의 길이 `readiness`(`status`/`actionKind`/intended `characterName`/`connectionStatus`(무효값 포함) 혼합), 임의 `chatLog`, roster 내/외 `viewerPlayerId`, `numRuns: 100` 이상
    - 태그 주석: `Feature: multiplayer-game-ux, Property 1`

- [x] 3. 단계·차례 모델 셀렉터 추가 (logic.js)
  - [x] 3.1 `currentPhaseModel(turnState, viewerPlayerId)`와 `actablePlayers(turnState)`를 `public/game/logic.js`에 추가하고 export
    - 단계 기반 폴백: `phase`가 `free_chat`/`ready_check`이면 `status !== "ready"`인 `playerId`가 Actable, `resolving`/`ended`(및 알 수 없는 값)이면 빈 집합
    - 의도된 턴 기반: `activePlayerId` 존재 시 `isTurnBased = true`로 그 플레이어를 활성 차례로, `turnOrder` 존재 시 순서 보존 반영, 둘 다 없으면 단계 기반 폴백
    - 반환: `{ phase, activePlayerId, turnOrder, actablePlayerIds, isTurnBased }`, 예외를 던지지 않음
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
    - _Design: Components §3 currentPhaseModel / actablePlayers / Data Models PhaseModel_

  - [ ]* 3.2 `currentPhaseModel` 속성 테스트 작성 (`public/game/phase-model.test.js`)
    - **Property 3: 단계·차례 모델은 단계 기반/턴 기반을 정확히 도출한다**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
    - 생성기: `phase`(4종 + 알 수 없는 문자열), `readiness`, `activePlayerId`(누락/roster 내/외), `turnOrder`(누락/임의 순서), `numRuns: 100` 이상
    - 태그 주석: `Feature: multiplayer-game-ux, Property 3`

- [x] 4. 행동 권한 셀렉터 추가 (logic.js)
  - [x] 4.1 `actionPermission(turnState, viewerPlayerId)`를 `public/game/logic.js`에 추가하고 export
    - `phase`가 `resolving`/`ended`이면 `locked = true`, 네 권한 모두 false(`isInputLocked` 재사용)
    - `free_chat`/`ready_check`이고 본인 항목 존재 시 기본 허용
    - intended `activePlayerId` 존재 + `≠ viewerPlayerId`이면 `canConfirm`/`canPass` false(말하기는 허용)
    - 본인 `readiness` 항목 없으면 `spectator = true`, `canConfirm`/`canPass` false
    - 반환: `{ canChat, canConfirm, canPass, canRevise, locked, spectator }`, `locked === isInputLocked(phase)`
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 7.4_
    - _Design: Components §4 actionPermission / Data Models ActionPermission_

  - [ ]* 4.2 `actionPermission` 속성 테스트 작성 (`public/game/action-permission.test.js`)
    - **Property 4: 행동 권한은 단계·차례·관전에서 정확히 도출된다**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.5, 7.4**
    - 생성기: `phase`, intended `activePlayerId`, 본인 항목 유무, 임의 `viewerPlayerId`, `numRuns: 100` 이상
    - 태그 주석: `Feature: multiplayer-game-ux, Property 4`

- [x] 5. 준비 집계·본인 상태 셀렉터 추가 (logic.js)
  - [x] 5.1 `readyTally(readiness)`와 `selfStatus(readiness, viewerPlayerId)`를 `public/game/logic.js`에 추가하고 export
    - `readyTally`: 기존 `computeReadyCount`에 위임하여 `{ ready, total }` 반환(`0 <= ready <= total`)
    - `selfStatus`: 본인 항목 있으면 `{ status, actionKind, actionText, hasActed: actionKind != null, spectator: false }`, 없으면 `{ status: null, actionKind: null, actionText: null, hasActed: false, spectator: true }`, `readiness`가 배열 아니면 관전 처리
    - _Requirements: 5.1, 4.4, 5.4, 6.1, 6.2, 6.4, 7.3_
    - _Design: Components §5 readyTally / §6 selfStatus / Data Models SelfStatus_

  - [ ]* 5.2 `readyTally` 속성 테스트 작성 (`public/game/ready-tally.test.js`)
    - **Property 5: 준비 집계는 readiness에서 정확히 도출된다**
    - **Validates: Requirements 5.1, 4.4, 5.4**
    - 생성기: 0개 포함 임의 길이 `readiness`(`status` 혼합), `numRuns: 100` 이상
    - 태그 주석: `Feature: multiplayer-game-ux, Property 5`

  - [ ]* 5.3 `selfStatus` 속성 테스트 작성 (`public/game/self-status.test.js`)
    - **Property 6: 본인 상태는 본인 항목/관전을 정확히 도출한다**
    - **Validates: Requirements 6.1, 6.2, 6.4, 7.3**
    - 생성기: 임의 `readiness`, roster 내/외 `viewerPlayerId`(관전 케이스 포함), `numRuns: 100` 이상
    - 태그 주석: `Feature: multiplayer-game-ux, Property 6`

- [x] 6. 턴 메타 선택적 흡수 (logic.js reducer)
  - [x] 6.1 `createInitialState`에 `activePlayerId: null`/`turnOrder: []` 기본값을 추가하고, `reduce`의 `TURN_STATE` 분기에서 `turnState.activePlayerId`/`turnState.turnOrder`를 선택적으로 흡수
    - 값이 `undefined`이면 기존 상태 보존(`turnState.activePlayerId !== undefined ? ... : state.activePlayerId`, `turnOrder`도 동일), 기존 `readiness`/`phase`/`roundNumber`/`chatEntries` 처리에 영향 없음
    - 기존 reducer/visibility/command 경로를 변경 없이 보존(가산만)
    - _Requirements: 2.3, 2.4, 7.2, 7.4_
    - _Design: Architecture §turn_state 파생 스냅샷의 확장 / Data Models GameState 선택적 확장_

  - [ ]* 6.2 턴 메타 흡수 단위 테스트 작성 (`public/game/turn-meta-absorb.test.js`)
    - intended 필드가 있을 때 흡수되고, 없을 때 기존 기본값(`null`/`[]`)이 보존되며 기존 필드 처리가 회귀하지 않음을 검증
    - _Requirements: 2.3, 2.4, 7.2, 7.4_

- [x] 7. 체크포인트 — 순수 셀렉터 검증
  - `& npx vitest run public/game/`로 모든 테스트가 통과하는지 확인, 의문이 생기면 사용자에게 질문한다.

- [x] 8. 파생 결정성 검증
  - [ ]* 8.1 파생 셀렉터 결정성 속성 테스트 작성 (`public/game/selector-determinism.test.js`)
    - **Property 7: 파생 셀렉터는 결정적이라 재연결 재동기화가 안정적이다**
    - **Validates: Requirements 7.2, 7.3, 7.4**
    - 동일한 모킹 `turn_state`(present + intended) 스냅샷과 `viewerPlayerId`로 `rosterModel`/`currentPhaseModel`/`readyTally`/`selfStatus`/`actionPermission`을 두 번 이상 호출 시 구조적으로 동일한 결과를 반환함을 검증, `numRuns: 100` 이상
    - 태그 주석: `Feature: multiplayer-game-ux, Property 7`

- [x] 9. 멀티플레이 표시 렌더 배선 (index.html)
  - [x] 9.1 `public/game/index.html`에 로스터 패널·단계/차례 표시·Ready_Tally·본인 상태 렌더를 배선
    - 로스터 패널: `rosterModel` 결과를 행으로 렌더(캐릭터명 `esc` 이스케이프, 연결 배지, 준비 상태, `hasActed` 표시, `isSelf` 표시)
    - 단계/차례 표시: `currentPhaseModel`로 현재 단계와 (턴 기반) 활성 플레이어/순서 또는 (단계 기반) "행동 가능" 표시
    - Ready_Tally: 헤더에 "준비 X/전체"(기존 `#ready` 재사용 가능), 본인 상태: `selfStatus`로 준비/행동완료/관전 표시
    - `turn_state`/`readiness_updated` 수신 시 재렌더로 자동 갱신(기존 단방향 흐름 보존)
    - _Requirements: 1.3, 1.4, 2.1, 4.2, 5.1, 5.2, 6.4_
    - _Design: Components §9 렌더 영역_

  - [ ]* 9.2 로스터 DOM 렌더·이스케이프 예제 테스트 작성 (`public/game/roster-render.test.js`, happy-dom)
    - 각 행의 캐릭터명이 `esc`를 거쳐 HTML로 해석되지 않고 텍스트로 표시되는지, 연결 배지·준비/`hasActed`·`isSelf` 표시가 렌더되는지 검증
    - _Requirements: 1.3, 1.4, 5.2, 6.4_

  - [ ]* 9.3 접근성 레이블·라이브 영역 예제 테스트 작성 (`public/game/roster-a11y.test.js`, happy-dom)
    - 로스터·차례 표시의 상호작용 요소가 비어 있지 않은 접근성 레이블을 가지는지, 갱신이 포커스를 이동시키지 않고 `aria-live` 라이브 영역으로 노출되는지 검증
    - _Requirements: 8.2, 8.3_

- [x] 10. 명령 게이팅 확장 (index.html)
  - [x] 10.1 `public/game/index.html`의 전송 경로에 `actionPermission`을 기존 `canSend()`와 AND로 결합
    - 말하기 전 `canChat`, 확정 전 `canConfirm`, 패스 전 `canPass`, 수정 전 `canRevise` 확인. 불허면 채널 `send`도 로컬 에코 `dispatch`도 하지 않음
    - 기존 잠금/연결 가드(`computeVisibility(state).inputDisabled`, `connection === OPEN`)는 그대로 유지
    - _Requirements: 3.4, 3.2_
    - _Design: Components §7 명령 게이팅 통합 / Error Handling §권한 없는 명령 가드_

  - [ ]* 10.2 권한 없는 명령 미전송·미에코 통합 테스트 작성 (`public/game/command-gating.test.js`, 가짜 채널)
    - `resolving`/`ended`·관전·`activePlayerId ≠ self` 상황에서 확정/패스 트리거 시 채널 `send` 미호출·로컬 에코 미추가 검증
    - _Requirements: 3.4_

- [x] 11. 반응형·포커스 스타일 (index.html)
  - [x] 11.1 `public/game/index.html`에 멀티플레이 표시용 반응형 레이아웃과 `:focus-visible` 스타일을 인라인 CSS로 추가
    - 320~767px에서 로스터가 가로 스크롤 없이 단일 열로 배치, 상호작용 요소에 외곽 전체를 두르는 보이는 포커스 표시(주변 배경과 구별)
    - 다크 테마/인라인 CSS 관례 유지
    - _Requirements: 8.1, 8.4_
    - _Design: Components §9 a11y/반응형_

- [x] 12. 재연결 아이덴티티 검증
  - [ ]* 12.1 재연결 `viewerPlayerId` 인코딩 통합 테스트 작성 (`public/game/reconnect-identity.test.js`, 가짜 connect·가짜 타이머)
    - (재)연결 시 `effectivePlayerId` → `buildConnectParams`로 `playerId`가 연결 파라미터에 인코딩되어 전달되고 플레이어별 아이덴티티 연결이 보존됨을 검증
    - _Requirements: 7.1_
    - _Design: Components §8 재연결 재동기화_

- [x] 13. 최종 체크포인트 — 전체 테스트·빌드 검증
  - `& npx vitest run`로 전체 테스트가 통과하는지 확인(기존 reducer/visibility/command/테스트 회귀 없음)
  - `& npm run build`로 `src` 미영향 빌드가 정상인지 검증
  - 의문이 생기면 사용자에게 질문한다.

## Notes

- `*`로 표시된 하위 작업은 선택(테스트)이며 빠른 MVP에서 건너뛸 수 있다. 핵심 구현 작업(`*` 없음)은 반드시 구현한다.
- 7개 Correctness Property는 각각 하나의 속성 기반 테스트로 매핑된다: P1→2.2, P2→1.2, P3→3.2, P4→4.2, P5→5.2, P6→5.3, P7→8.1.
- 모든 `logic.js` 수정 작업(1.1, 2.1, 3.1, 4.1, 5.1, 6.1)은 동일 파일을 수정하므로 순차로 진행한다. `index.html` 수정(9.1, 10.1, 11.1)도 동일 파일이므로 순차로 진행한다. 테스트 파일은 각기 별도 파일이다.
- intended 계약(`characterName`/`connectionStatus`/`activePlayerId`/`turnOrder`)은 모킹된 `turn_state`로 검증하며, 결정적 폴백(캐릭터명 chatLog→playerId, 연결 unknown, 차례 단계 기반)으로 백엔드 부재 시에도 동작한다.
- 본 스펙은 `game-play` 위 가산 계층이다. 기존 동작(채팅 reduce·서사 추가·카운트다운·로컬 에코·연결 토큰 전달·`esc`)은 재사용하고 변경하지 않는다.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1"] },
    { "id": 4, "tasks": ["4.2", "5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "6.1", "8.1"] },
    { "id": 6, "tasks": ["6.2", "9.1"] },
    { "id": 7, "tasks": ["9.2", "9.3", "10.1"] },
    { "id": 8, "tasks": ["10.2", "11.1"] },
    { "id": 9, "tasks": ["12.1"] }
  ]
}
```
