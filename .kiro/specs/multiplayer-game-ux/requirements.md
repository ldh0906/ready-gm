# Requirements Document

## Introduction

ready-gm은 친구들과 함께 즐기는 멀티플레이 TRPG 세션을 AI GM이 진행해 주는 웹 플랫폼입니다. 기존 **게임 플레이 화면(`game-play` 스펙, `public/game/`)** 은 플레이어 한 명의 시점에서 GM 서사를 읽고, 자유 대화·행동 확정·패스로 라운드 루프에 참여하고, 준비 체크 카운트다운을 지켜보는 단일 플레이어 관점의 UX를 명세·구현했습니다. 또한 **플레이어별 아이덴티티 WebSocket 연결**(각 플레이어가 자신의 `playerId`로 `/ws?roomId&playerId&token`에 연결하면 서버 `resolveSocketIdentity`가 해당 플레이어로 소켓을 귀속)도 이미 동작합니다.

그러나 **한 방에 여러 플레이어가 동시에 들어와 함께 보고 함께 행동하는 멀티플레이 진행 UX**(차례·행동 표시)는 아직 명세·검증되지 않았습니다. 이 스펙은 바로 그 간극 — **여러 동시 접속 플레이어가 같은 방에서 함께 진행하는 턴/행동 경험** — 을 정의합니다:

- **참가자 로스터**: 방의 모든 활성 플레이어와 각자의 캐릭터 이름, 연결 상태, 이번 라운드/단계에서 행동을 마쳤는지·준비됐는지.
- **차례/활성 플레이어 표시 및 단계 표시**: 시나리오가 턴 기반일 때 누구 차례인지와 차례 순서를, GM 주도 자유 단계일 때 현재 단계와 어떤 플레이어가 행동할 수 있는지.
- **단계별 행동 제출 규칙**: 각 플레이어가 어떤 행동(말하기/행동 확정/패스)을 언제 제출할 수 있는지(자유 단계에서는 모두 가능, `resolving`에서는 입력 잠금 — 기존 동작 보존).
- **실시간 갱신**: 어떤 플레이어가 행동하거나 GM이 서술하면 모든 클라이언트가 이를 반영(채팅은 `characterName`으로 귀속, 행동/준비 표시 갱신).
- **여러 플레이어 준비 체크**: 카운트다운, 플레이어별 준비 상태, 모두 준비되거나 시간 초과 시 진행.
- **재연결·아이덴티티 재동기화**: 재연결한 플레이어가 현재 Turn_State와 **본인의** 보류/행동 완료/준비 상태를 다시 맞춤(기존 플레이어별 `playerId` 연결 보존).

본 화면은 기존 프로젝트의 접근 방식(빌드 단계 없는 정적 `public/*.html`, 바닐라 JS ES 모듈, 인라인 CSS, 다크 테마)을 그대로 따르며, 순수 로직은 `public/game/logic.js` ES 모듈에 추가해 vitest + fast-check로 단위/속성 테스트하고, 부수효과(WebSocket 연결·DOM 갱신)는 `public/game/index.html`이 담당합니다(happy-dom DOM 테스트). 이 스펙은 `game-play` 스펙을 대체하지 않고 **멀티플레이 차례/행동 표시 계층을 추가**합니다.

### 백엔드 계약 근거 (실제 코드 확인)

이 스펙은 다음 실제 백엔드 계약을 근거로 합니다(`src/realtime/connection.ts`, `src/core/turn-state.ts`, `src/core/types.ts`, `src/services/types.ts`, `src/server.ts` 확인).

- **Turn_State (`src/core/turn-state.ts`) — 이미 존재(present)하는 필드**:
  - `readiness: ReadinessEntry[]` — **활성 플레이어당 정확히 한 항목**. 각 항목은 `{ playerId, status: "ready" | "not_ready", actionKind, actionText }`. 즉 **방의 활성 플레이어 집합과 각자의 준비/보류 행동**은 `readiness`에서 직접 도출된다.
  - `chatLog: ChatEntry[]` — 각 항목 `{ playerId, characterName, text, ts }`. **`characterName`은 채팅 항목에만** 실린다.
  - `roundNumber`, `phase`(`"free_chat" | "ready_check" | "resolving" | "ended"`), `readyCheckDeadline`(ISO | null), `readyCheckTimeoutMs`, `checks[]`, `narrativeContext[]`, `resolutionRequested`.
- **Server_Event (`src/realtime/connection.ts`)**: `turn_state`, `chat_message`, `narration`, `readiness_updated`, `scenario_set`, `player_list_updated { players: { id, displayName, isHost }[] }`, `delivery_failed`. 게이트웨이는 (재)연결 시와 변경 시 현재 `turn_state`를 전달하고, 끊긴 동안 버퍼링된 `narration`을 연결 시 플러시한다.
- **플레이어별 아이덴티티 연결(이미 동작)**: `/ws?roomId&playerId&token` 업그레이드에서 `resolveSocketIdentity`가 `playerId`가 해당 방의 소속 플레이어이면 그 플레이어로, 아니면 호스트로 소켓을 귀속한다. 프론트엔드 `buildConnectParams`는 `playerId`를 쿼리에 인코딩해 싣는다(`effectivePlayerId`로 도출).
- **Player (`src/services/types.ts`)**: `{ id, roomId, displayName, isHost, characterId, connectionStatus: "connected" | "disconnected" }`. `connectionStatus`는 룸 스토어에 존재하지만 현재 게이트웨이 `turn_state`에는 실리지 않는다.
- **클라이언트 → 서버 명령(소켓 위 JSON)**: `{ type: "chat", text }`, `{ type: "confirm", action }`, `{ type: "pass" }`, `{ type: "revise", action }`.

## 범위 밖 / 가정 (Assumptions)

아래는 **이미 존재하는 계약(present)** 과 **의도된 계약(intended, 아직 서버 `turn_state`에 배선되지 않음)** 을 명시적으로 구분한다. 프론트엔드는 의도된 계약을 모킹된 WebSocket으로 명세·테스트하며, 실제 동작은 해당 백엔드 배선이 추가된 뒤 검증된다.

- **[present] 활성 플레이어 집합과 준비/보류 행동**: `turn_state.readiness[]`가 활성 플레이어당 한 항목으로 `{ playerId, status, actionKind, actionText }`를 이미 제공한다. **로스터의 행 집합·준비 상태·행동 완료 여부(`actionKind != null`)는 이 필드에서 그대로 도출**한다. 추가 백엔드 작업 없이 검증 가능하다.
- **[present] 채팅 귀속**: `chatLog[].characterName`이 이미 존재한다. 채팅 표시 귀속은 이 값으로 한다.
- **[present] 플레이어별 `playerId` 연결**: `resolveSocketIdentity`가 이미 `playerId` 귀속을 지원한다. 본 스펙은 이 연결을 **변경 없이 보존**하며, 본인 식별자(`viewerPlayerId`)는 기존 `effectivePlayerId`로 도출한다.
- **[intended] 로스터의 캐릭터 이름**: `readiness` 항목에는 `characterName`이 없다(채팅에만 있음). 본 스펙은 로스터 캐릭터 이름을 **의도된 계약**(서버가 `readiness` 항목 또는 별도 로스터에 `characterName`을 함께 싣는다)으로 명세하되, 그 값이 없을 때를 위한 **결정적 폴백**(해당 `playerId`의 가장 최근 `chatLog` 항목의 `characterName` → 그것도 없으면 `playerId` 자체)을 정의한다. 폴백 도출은 현재 계약만으로 테스트 가능하다.
- **[intended] 로스터의 연결 상태**: 플레이어별 `connectionStatus`는 `Player`에 존재하나 현재 `turn_state`에 실리지 않는다. 본 스펙은 연결 상태 표시를 **의도된 계약**(서버가 로스터 항목에 `connectionStatus`를 싣거나 `player_list_updated`로 전달)으로 명세하되, 값이 없으면 **연결 상태 미상(unknown)** 으로 표시한다.
- **[intended] 턴 순서·활성 플레이어**: 현재 라운드 루프는 **GM 주도의 단계 기반**(`free_chat` → `ready_check` → `resolving`)이며, `turn_state`에 엄격한 턴 순서나 단일 활성 플레이어(`activePlayerId`) 필드가 **없다**. 따라서 본 스펙의 기본 차례 표시는 **단계 기반**으로 정의한다: 자유 단계에서는 **아직 준비를 마치지 않은 모든 활성 플레이어**가 "행동 가능"이다. 엄격한 턴 기반 시나리오(`activePlayerId`/`turnOrder`)는 **의도된 계약**으로 두며, 해당 필드가 `turn_state`에 실릴 때 활성 플레이어와 순서를 표시한다(없으면 단계 기반으로 폴백).
- **[범위 밖] 서버의 진행 결정**: GM 판정·서술 생성, 준비 체크 시간 초과 시 진행, 라운드 전환은 서버(Room Orchestrator/AI GM)가 수행한다. 본 화면은 그 결과를 `turn_state`/`readiness_updated`/`narration`/`chat_message`로 받아 표시하고, 플레이어 입력 명령만 전송한다.
- **[범위 밖] 순수 로직/부수효과 분리**: 로스터 모델·차례 도출·행동 권한·준비 집계 등 **파생은 `public/game/logic.js`의 순수 함수**로 구현해 단위/속성 테스트하고, WebSocket·DOM 등 **부수효과는 `public/game/index.html`** 이 담당한다. 이는 구현 구조 제약으로 설계 문서에서 다룬다.
- **[범위 밖] 종착 화면**: 본 화면은 계획된 흐름의 마지막 화면이며 세션 종료 이후 별도 화면(요약·재대국)은 범위 밖이다. 세션 종료는 화면 내 입력 비활성화와 종료 안내로 처리한다(기존 `game-play` 동작 보존).

## Glossary

- **Multiplayer_Game_View**: 본 스펙이 정의하는 시스템. 기존 게임 플레이 화면(`public/game/`)에 **여러 동시 접속 플레이어를 위한 차례/행동 표시 계층**을 추가한 부분. 참가자 로스터, 차례/단계 표시, 단계별 행동 권한, 본인 상태 표시를 포함한다.
- **Viewer_Player_Id**: 본 화면을 보는 플레이어 본인의 식별자. 기존 `effectivePlayerId`로 인계 `playerId`(없으면 `hostPlayerId`)에서 도출한다.
- **Turn_State**: 방의 현재 진행 상태 스냅샷(`src/core/turn-state.ts`). `roundNumber`, `phase`, `readiness[]`, `chatLog[]`, `narrativeContext[]`, `readyCheckDeadline`, `readyCheckTimeoutMs` 등을 담는다.
- **Phase**: 라운드 루프 단계. `free_chat`(자유 대화) / `ready_check`(준비 체크) / `resolving`(판정·서술) / `ended`(세션 종료) 중 하나.
- **Active_Player**: 현재 라운드에 참여 중인 플레이어. `turn_state.readiness[]`에 항목이 존재하는 플레이어 집합으로 정의한다.
- **Readiness_Entry**: `turn_state.readiness`의 한 항목. `{ playerId, status: "ready" | "not_ready", actionKind, actionText }`.
- **Roster**: Multiplayer_Game_View에 표시되는 참가자 목록. Active_Player 집합에서 도출하며 각 행은 Roster_Entry이다.
- **Roster_Entry**: 로스터의 한 행. `{ playerId, characterName, connectionStatus, status, actionKind, hasActed, isSelf }`로 도출된다. `hasActed`는 `actionKind != null`로 정의한다.
- **Character_Name**: 플레이어를 귀속해 표시하는 캐릭터 이름. 의도된 로스터 계약의 값 → 폴백으로 해당 `playerId`의 최근 `chatLog` 항목의 `characterName` → 폴백으로 `playerId`.
- **Connection_Status_Of_Player**: 로스터 항목의 연결 상태(`connected` / `disconnected` / `unknown`). 의도된 계약 값이 없으면 `unknown`.
- **Ready_Tally**: 준비된 활성 플레이어 수와 전체 수. `readiness` 중 `status === "ready"`인 항목 수 / `readiness` 길이.
- **Actable_Players**: 현재 단계에서 행동할 수 있는 활성 플레이어 집합. 기본(단계 기반): `phase`가 `free_chat` 또는 `ready_check`인 동안 `status !== "ready"`인 Active_Player. 의도된 턴 기반 시나리오에서는 `activePlayerId`가 지정한 플레이어.
- **Self_Status**: 본인(Viewer_Player_Id)의 현재 라운드 상태. 본인 Readiness_Entry에서 도출한 `{ status, actionKind, actionText, hasActed }`. 본인 항목이 없으면 관전(spectator)으로 본다.
- **Action_Permission**: 본인이 현재 제출할 수 있는 명령 집합(말하기/행동 확정/패스/행동 수정). 단계와 본인의 Actable 여부에서 도출한다.
- **Input_Locked**: 입력·버튼이 비활성인 상태. `phase`가 `resolving` 또는 `ended`이면 참(기존 `game-play` 정의 보존).
- **Realtime_Channel**: 방의 실시간 WebSocket 연결. 서버 → 클라이언트로 Server_Event를, 클라이언트 → 서버로 플레이어 명령(JSON)을 전달한다.
- **Server_Event**: 서버 → 클라이언트 이벤트(`turn_state`, `chat_message`, `narration`, `readiness_updated`, `scenario_set`, `player_list_updated`, `delivery_failed`).
- **MAX_ENTRIES**: 표시 항목 수 상한(기존 `public/game/`와 동일, 250).

## Requirements

### Requirement 1: 참가자 로스터 도출

**User Story:** 플레이어로서, 지금 누가 이 방에서 함께 플레이하고 있는지와 각자의 캐릭터 이름을 보고 싶다. 그래야 일행 전체가 모였는지 알 수 있다.

#### Acceptance Criteria

1. WHEN the Multiplayer_Game_View가 Turn_State를 적용하면, THE Multiplayer_Game_View SHALL Turn_State의 `readiness` 항목 하나당 Roster_Entry 하나를 그 `playerId`에 대해 도출한다.
2. WHEN the Multiplayer_Game_View가 Roster_Entry의 Character_Name을 도출할 때, THE Multiplayer_Game_View SHALL 의도된 로스터 계약의 `characterName`이 비어 있지 않으면 그 값을, 비어 있으면 해당 `playerId`의 가장 최근 Chat_Log 항목의 `characterName`을, 그것도 비어 있으면 그 `playerId` 자체를 Character_Name으로 사용한다.
3. WHEN the Multiplayer_Game_View가 Roster를 표시할 때, THE Multiplayer_Game_View SHALL 각 Roster_Entry의 Character_Name을 HTML로 해석하지 않고 일반 텍스트로 이스케이프하여 표시한다.
4. WHERE Roster_Entry의 `playerId`가 Viewer_Player_Id와 동일한 경우, THE Multiplayer_Game_View SHALL 그 Roster_Entry를 본인 항목으로 식별하는 표시를 함께 렌더링한다.
5. WHEN the Multiplayer_Game_View가 Roster_Entry의 Connection_Status_Of_Player를 도출할 때, THE Multiplayer_Game_View SHALL 의도된 계약의 연결 상태 값이 존재하면 그 값(`connected` 또는 `disconnected`)을, 존재하지 않으면 `unknown`을 사용한다.

### Requirement 2: 현재 단계 및 행동 가능 플레이어 표시

**User Story:** 플레이어로서, 지금이 누구 차례인지 또는 누가 행동할 수 있는 단계인지 보고 싶다. 그래야 언제 내가 움직여야 할지 안다.

#### Acceptance Criteria

1. WHEN the Multiplayer_Game_View가 Turn_State를 적용하면, THE Multiplayer_Game_View SHALL 현재 `phase`를 식별하는 표시를 Multiplayer_Game_View에 제공한다.
2. WHILE Turn_State의 `phase`가 `free_chat` 또는 `ready_check`인 동안, THE Multiplayer_Game_View SHALL `status`가 `ready`가 아닌 Active_Player를 Actable_Players로 도출하여 "행동 가능"으로 표시한다.
3. WHERE Turn_State에 의도된 활성 플레이어 식별자(`activePlayerId`)가 존재하는 경우, THE Multiplayer_Game_View SHALL 그 플레이어를 현재 차례의 활성 플레이어로 표시한다.
4. WHERE Turn_State에 의도된 턴 순서(`turnOrder`)가 존재하는 경우, THE Multiplayer_Game_View SHALL 그 순서대로 Active_Player의 차례 순서를 표시한다.
5. IF Turn_State에 의도된 활성 플레이어 식별자와 턴 순서가 모두 존재하지 않으면, THEN THE Multiplayer_Game_View SHALL 단계 기반 Actable_Players 도출로 행동 가능 플레이어를 표시한다.

### Requirement 3: 단계별 행동 제출 권한

**User Story:** 플레이어로서, 내가 지금 말하거나 행동을 확정하거나 패스할 수 있는지 분명히 알고 싶다. 그래야 보낼 수 없는 입력으로 헷갈리지 않는다.

#### Acceptance Criteria

1. WHILE Turn_State의 `phase`가 `free_chat` 또는 `ready_check`인 동안, THE Multiplayer_Game_View SHALL 본인(Viewer_Player_Id)의 말하기·행동 확정·패스·행동 수정 명령을 허용하는 Action_Permission을 도출한다.
2. WHILE Turn_State의 `phase`가 `resolving` 또는 `ended`인 동안, THE Multiplayer_Game_View SHALL 본인의 모든 입력 명령을 불허하는 Action_Permission을 도출하고 입력 컨트롤을 비활성 상태로 표시한다.
3. WHERE Turn_State에 의도된 활성 플레이어 식별자(`activePlayerId`)가 존재하고 그 값이 Viewer_Player_Id와 다른 경우, THE Multiplayer_Game_View SHALL 본인의 행동 확정·패스 명령을 불허하는 Action_Permission을 도출한다.
4. IF Action_Permission이 허용하지 않는 입력 명령 동작이 트리거되면, THEN THE Multiplayer_Game_View SHALL 그 명령을 Realtime_Channel로 전송하지 않고 본인 행동 로컬 에코도 추가하지 않는다.
5. WHILE 본인의 Self_Status가 관전(본인 Readiness_Entry 없음)인 동안, THE Multiplayer_Game_View SHALL 본인의 행동 확정·패스 명령을 불허하는 Action_Permission을 도출한다.

### Requirement 4: 여러 플레이어 행동·서사의 실시간 반영

**User Story:** 플레이어로서, 다른 사람이 말하거나 행동을 확정하거나 GM이 이야기를 들려주면 내 화면에도 곧바로 보이길 원한다. 그래야 함께 같은 장면을 본다.

#### Acceptance Criteria

1. WHEN Realtime_Channel이 다른 플레이어의 발화에 대한 `chat_message` 이벤트를 전달하면, THE Multiplayer_Game_View SHALL 그 Chat_Entry를 `characterName`으로 귀속하여 채팅 로그의 끝에 추가한다.
2. WHEN Realtime_Channel이 `readiness_updated` 또는 `turn_state` 이벤트로 갱신된 `readiness`를 전달하면, THE Multiplayer_Game_View SHALL Roster의 각 Roster_Entry의 준비 상태와 행동 완료 여부(`hasActed`) 표시를 갱신한다.
3. WHEN Realtime_Channel이 `narration` 이벤트를 전달하면, THE Multiplayer_Game_View SHALL 그 서사를 모든 접속 플레이어 화면의 GM 서사 패널에 도착 순서대로 추가한다.
4. WHEN the Multiplayer_Game_View가 갱신된 Turn_State를 적용하면, THE Multiplayer_Game_View SHALL Ready_Tally 표시를 갱신된 `readiness`로부터 다시 도출하여 갱신한다.

### Requirement 5: 여러 플레이어 준비 체크

**User Story:** 플레이어로서, 준비 체크가 진행될 때 우리 중 몇 명이 준비됐고 누가 아직인지, 시간이 얼마나 남았는지 보고 싶다. 그래야 함께 다음으로 넘어갈 시점을 맞출 수 있다.

#### Acceptance Criteria

1. WHEN the Multiplayer_Game_View가 Turn_State를 적용할 때, THE Multiplayer_Game_View SHALL `readiness` 중 `status === "ready"`인 항목 수와 전체 `readiness` 수를 Ready_Tally로 도출하여 "준비 X/전체" 형태로 표시한다.
2. WHEN the Multiplayer_Game_View가 Roster를 표시할 때, THE Multiplayer_Game_View SHALL 각 Roster_Entry에 그 플레이어의 준비 상태(`ready` 또는 `not_ready`)를 표시한다.
3. WHILE Turn_State의 Ready_Check_Deadline이 비어 있지 않은(ISO 시각) 동안, THE Multiplayer_Game_View SHALL 현재 시각 기준으로 마감까지 남은 시간을 0 이상의 값으로 카운트다운하여 표시하고, 현재 시각이 마감을 지난 경우 0으로 표시한다.
4. WHEN Realtime_Channel이 갱신된 `readiness`를 전달하면, THE Multiplayer_Game_View SHALL Ready_Tally와 각 Roster_Entry의 준비 상태 표시를 그 `readiness`로부터 다시 도출하여 갱신한다.

### Requirement 6: 본인 상태 표시 및 귀속

**User Story:** 플레이어로서, 내가 이번 라운드에 무엇을 확정했는지, 준비됐는지, 아직 행동이 필요한지 분명히 보고 싶다. 그래야 내 차례를 놓치지 않는다.

#### Acceptance Criteria

1. WHEN the Multiplayer_Game_View가 Turn_State를 적용할 때, THE Multiplayer_Game_View SHALL `readiness`에서 `playerId === Viewer_Player_Id`인 항목으로부터 Self_Status(`status`, `actionKind`, `actionText`, `hasActed`)를 도출한다.
2. IF `readiness`에 `playerId === Viewer_Player_Id`인 항목이 없으면, THEN THE Multiplayer_Game_View SHALL Self_Status를 관전(spectator) 상태로 도출한다.
3. WHEN the Multiplayer_Game_View가 본인의 확정 행동 또는 패스를 로컬 에코로 추가할 때, THE Multiplayer_Game_View SHALL 그 항목을 Viewer_Player_Id로 귀속하여 행동 로그에 추가한다.
4. WHEN the Multiplayer_Game_View가 Self_Status를 표시할 때, THE Multiplayer_Game_View SHALL 본인이 이번 라운드에 행동을 마쳤는지(`hasActed`)와 준비 상태를 식별하는 표시를 제공한다.

### Requirement 7: 재연결 시 본인 및 방 상태 재동기화

**User Story:** 플레이어로서, 잠깐 끊겼다 다시 들어와도 현재 진행 상황과 내가 이미 확정해 둔 행동이 그대로 보이길 원한다. 그래야 흐름과 내 입력을 잃지 않는다.

#### Acceptance Criteria

1. WHILE Realtime_Channel 연결을 (재)수립하는 동안, THE Multiplayer_Game_View SHALL 인계로 받은 Viewer_Player_Id를 연결 파라미터에 인코딩하여 전달하고 플레이어별 아이덴티티 연결을 보존한다.
2. WHEN 끊겼던 Realtime_Channel이 다시 연결되어 현재 Turn_State를 전달하면, THE Multiplayer_Game_View SHALL 그 Turn_State로 Roster·단계·Ready_Tally 표시를 현재 진행 상황으로 재동기화한다.
3. WHEN the Multiplayer_Game_View가 재연결 시 Turn_State를 적용하면, THE Multiplayer_Game_View SHALL 그 Turn_State의 `readiness`에서 본인(Viewer_Player_Id) 항목으로부터 Self_Status를 다시 도출하여 본인의 보류·행동 완료·준비 상태를 복원한다.
4. WHEN the Multiplayer_Game_View가 재연결 시 Turn_State를 적용하면, THE Multiplayer_Game_View SHALL `phase`로부터 Input_Locked와 Action_Permission을 다시 도출하여 입력 컨트롤의 활성/비활성 상태를 현재 단계에 맞게 복원한다.

### Requirement 8: 멀티플레이 표시의 반응형 레이아웃과 접근성

**User Story:** 플레이어로서, 휴대폰이든 데스크톱이든 키보드든 참가자 목록과 차례 표시를 편하게 확인하고 싶다. 그래야 어떤 환경에서도 누가 함께하는지 알 수 있다.

#### Acceptance Criteria

1. WHERE 뷰포트 너비가 320px 이상 767px 이하인 모바일 환경인 경우, THE Multiplayer_Game_View SHALL Roster 표시를 콘텐츠가 뷰포트 너비를 초과하여 가로 스크롤바가 나타나지 않도록 배치한다.
2. THE Multiplayer_Game_View SHALL Roster와 차례/단계 표시의 각 상호작용 가능한 요소에 화면 낭독기가 읽을 수 있는, 비어 있지 않으며 요소의 역할과 목적을 식별하는 접근성 레이블을 제공한다.
3. WHEN Roster·준비 상태·차례 표시가 갱신되면, THE Multiplayer_Game_View SHALL 키보드 포커스를 이동시키지 않고 해당 변경 내용을 화면 낭독기가 낭독할 수 있도록 라이브 영역을 통해 제공한다.
4. WHILE 키보드 포커스가 Roster의 상호작용 가능한 요소에 위치한 동안, THE Multiplayer_Game_View SHALL 해당 요소의 외곽 경계 전체에 주변 배경과 시각적으로 구별되는 보이는 포커스 표시를 렌더링한다.
