# Requirements Document

## Introduction

ready-gm은 친구들과 함께 즐기는 멀티플레이 TRPG 세션을 AI GM이 진행해 주는 웹 플랫폼입니다. 이 스펙은 이미 완료된 **"호스트 로비(대기실)" 화면(room-lobby)** 다음이자 계획된 흐름의 **마지막(종착) 화면**인 **게임 플레이 화면(Game_Play_App)** 하나에 집중합니다.

room-lobby는 방이 세션 진행 상태로 전이하면(Session_Active) `/lobby/game?roomId=...&hostPlayerId=...&token=...` 로 이동하면서 식별자(그리고 운영자가 `?token` 공유 비밀을 쓰는 경우 접근 토큰)를 쿼리로 인계합니다(`token`은 공유 비밀이 사용될 때에만 존재). 따라서 본 화면은 그 인계 계약으로 진입하는 **세션 진행 중(in-session) 화면**이며, 플레이어가 GM 서사를 읽고, 자유 대화·행동 확정·패스로 라운드 루프에 참여하고, 준비 체크 카운트다운을 지켜보고, 세션이 끝날 때까지 플레이하는 경험을 다룹니다. **이후 추가 인계는 없으며**, 세션 종료는 본 화면 안에서 처리됩니다.

본 화면은 기존 프로젝트의 접근 방식(빌드 단계 없는 정적 `public/*.html`, 바닐라 JS ES 모듈, 인라인 CSS, 다크 테마)을 그대로 따르며, host-entry·room-lobby와 동일하게 순수 로직을 `public/game/logic.js` ES 모듈로 분리하고 `public/game/index.html`이 그 모듈을 import 해 DOM에 배선하는 구조로 구현합니다(vitest + fast-check 단위/속성 테스트, happy-dom DOM 테스트).

기존 `public/index.html`(솔로 플레이테스트 페이지)이 **사실상의 참조 UX**입니다: 2분할 레이아웃(좌측 = GM 서사 패널, 우측 = 채팅·행동 로그 사이드바), 라운드/단계/준비 수와 busy 스피너를 담은 헤더, 말하기(chat)·행동 확정(confirm)·패스(pass) 푸터 컨트롤, 그리고 DOM 무한 증가를 막는 `MAX_ENTRIES` 상한. 본 화면은 그 UX를 깔끔하게 재구현하되, `POST /play/new`가 아니라 **room-lobby 인계로 진입**합니다.

### 백엔드 계약 근거 (실제 코드 확인)

이 스펙은 다음 실제 백엔드 계약을 근거로 합니다(`src/realtime/connection.ts`, `src/core/turn-state.ts`, `src/core/types.ts` 확인).

- **실시간(WebSocket) 서버 → 클라이언트 이벤트 `ServerEvent`** 는 다음 분기를 가진 JSON 판별 유니온이다.
  - `turn_state` `{ roomId, state: TurnState }` — (재)연결 시와 변경 시 현재 Turn_State 전체를 전달한다.
  - `chat_message` `{ roomId, message: ChatEntry }` — 방 구성원에게 단일 채팅 메시지를 전달한다.
  - `narration` `{ roomId, narration: { kind: "opening" | "resolution" | "closing", roundNumber, text } }` — GM 서사.
  - `readiness_updated` `{ roomId, readiness: ReadinessEntry[] }` — 준비 상태 스냅샷.
  - `scenario_set` `{ roomId, scenarioId, title, summary }` — 방에 적용된 시나리오.
  - `player_list_updated` `{ roomId, players }` — 방 로스터.
  - `delivery_failed` `{ roomId, failedType, detail }` — 메시지 전달 실패 통지.
- **TurnState**(`src/core/turn-state.ts`): `{ roomId, roundNumber, phase, readiness: { playerId, status, actionKind, actionText }[], chatLog: { playerId, characterName, text, ts }[], checks[], narrativeContext: { round, text }[], readyCheckDeadline (ISO | null), readyCheckTimeoutMs, resolutionRequested }`. `Phase`는 `"free_chat" | "ready_check" | "resolving" | "ended"` 이며 라운드 루프는 자유 대화(free_chat) → 준비 체크(ready_check) → 판정/서술(resolving)로 돈다. 준비 수는 `readiness.filter(status === "ready").length / readiness.length`로 도출한다.
- **클라이언트 → 서버 명령(소켓 위 JSON)**: `{ type: "chat", text }`, `{ type: "confirm", action }`, `{ type: "pass" }`, `{ type: "revise", action }`.
- **(재)연결 시 게이트웨이가 현재 `turn_state`를 전달**하며, 연결이 끊긴 동안 버퍼링된 `narration`은 연결 시 플러시된다. 접근 토큰은 ws 연결에 전달된다(기존 `index.html`이 `&token=...`을 덧붙인다).
- **서버는 플레이어 본인의 확정 행동·패스를 다시 echo 하지 않는다** — 그것들은 `chatLog`가 아니라 `readiness`에 들어가므로, UI는 본인의 confirm/pass를 **행동 로그에 로컬 에코** 해야 한다.

> 본 스펙은 room-lobby가 했던 것과 동일하게, **현재 플레이테스트 서버에 아직 배선되지 않은 백엔드 항목**을 아래 "범위 밖 / 가정(Assumptions)"에 명시한다. 프론트엔드는 이 계약에 대해 모킹된 `WebSocket`으로 완전하게 명세·구현·단위/DOM 테스트할 수 있다.

## 범위 밖 / 가정 (Assumptions)

다음 항목은 **의도된(intended) 백엔드 계약**으로서 본 화면이 통합 대상으로 삼되, 현재 플레이테스트 서버(`src/server.ts`)에 아직 배선돼 있지 않으므로 명시적으로 가정으로 둔다. 프론트엔드는 모킹으로 테스트 가능하며, 실제 동작은 해당 백엔드 배선이 추가된 뒤에 검증된다.

- **게임용 실시간 연결 티켓 발급 엔드포인트 부재 (ws ticket gap)**: `/ws` 업그레이드는 서버가 발급한 연결 티켓(`ticket`)을 요구한다(`src/server.ts`). 현재 솔로 흐름(`POST /play/new`)만 티켓을 발급하며, room-lobby → game 인계 파라미터(roomId/hostPlayerId/token)에는 연결 티켓이 없고 티켓을 발급하는 REST 엔드포인트도 없다. 본 화면의 실시간 요구사항은 "유효한 연결 티켓을 획득할 수 있다"는 **의도된 계약** 위에서 정의하며, 이 간극을 명시적 가정으로 둔다. 프론트엔드는 주입 가능한 `connect(roomId, token)` 어댑터 뒤로 이 간극을 캡슐화하여 모킹된 WebSocket으로 완전히 테스트한다.
- **브라우저발 명령 매핑 범위**: 플레이테스트 서버의 명령 매핑은 `chat`/`confirm`/`pass`/`revise`를 다룬다. 본 화면의 플레이어 입력 요구사항은 이 네 가지 의도된 실시간 명령 계약을 기준으로 한다.
- **이후 단계(다음 화면)는 없음 — 종착 화면**: 본 화면은 계획된 흐름의 마지막 화면이다. 세션 종료(phase `ended` 또는 closing narration) 이후의 별도 화면(세션 요약·캐릭터 시트·재대국 등)은 본 스펙 범위 밖이며, 세션 종료는 **화면 내(in-screen)** 에서 입력 비활성화와 종료 안내로 처리한다. 추가 인계 지점은 없다.
- **GM 판정·서술 생성은 서버(범위 밖)**: GM의 행동 판정, 서사 생성, 라운드 진행 결정은 서버(Room Orchestrator/AI GM)가 수행한다. 본 화면은 그 결과를 `turn_state`/`narration`/`chat_message`/`readiness_updated` 이벤트로 받아 표시하고, 플레이어 입력 명령만 전송한다.
- **호스트/게스트 구분은 입력에 영향 없음**: 본 화면은 인계로 받은 `hostPlayerId`를 발신자 식별에 사용하지만, 입력(말하기/행동 확정/패스/수정)은 세션에 참여한 모든 플레이어에게 동일하게 적용된다. 별도의 호스트 전용 제어는 본 화면에 없다.

## Glossary

- **Game_Play_App**: 세션 진행 중 화면을 담당하는 프론트엔드 애플리케이션. 본 스펙이 정의하는 시스템.
- **Game_View**: 플레이어가 보는 게임 진행 화면 영역. GM 서사 패널, 채팅·행동 로그 사이드바, 헤더 상태, 입력 푸터로 구성된다.
- **Handoff_Params**: 페이지 URL 쿼리로 전달되는 인계 값 묶음. `roomId`, `hostPlayerId`(필수)와 선택적 `token`으로 구성된다.
- **Room_Id**: 인계로 전달된 방 식별자(`roomId`). Realtime_Channel 연결에 사용된다.
- **Player_Id**: 인계로 전달된 플레이어 식별자(`hostPlayerId`). 본인 행동 로컬 에코의 발신자 식별에 사용된다.
- **Access_Token**: 공개 바인딩된 서버를 보호하기 위한 공유 비밀 값. 페이지 URL의 `?token=` 쿼리 파라미터로 전달될 수 있으며, Realtime_Channel 연결에 전달된다.
- **Realtime_Channel**: 방의 실시간 WebSocket 연결. 서버 → 클라이언트로 `ServerEvent`를 전달하고, 클라이언트 → 서버로 플레이어 명령(JSON)을 전송한다.
- **Server_Event**: 서버 → 클라이언트 이벤트(`turn_state`, `chat_message`, `narration`, `readiness_updated`, `scenario_set`, `player_list_updated`, `delivery_failed`).
- **Turn_State**: 방의 현재 진행 상태 스냅샷. `roundNumber`, `phase`, `readiness[]`, `chatLog[]`, `narrativeContext[]`, `readyCheckDeadline`, `readyCheckTimeoutMs` 등을 담는다.
- **Phase**: 라운드 루프 단계. `free_chat`(자유 대화) / `ready_check`(준비 체크) / `resolving`(판정·서술) / `ended`(세션 종료) 중 하나.
- **Narration**: GM 서사 한 조각. `kind`(`opening` | `resolution` | `closing`), `roundNumber`, `text`로 구성된다.
- **Narration_Entry**: Game_View의 GM 서사 패널에 추가되어 표시되는 서사 항목.
- **Narrative_Context**: Turn_State의 `narrativeContext`. `{ round, text }` 형태로 최근 서사 기록을 담으며(가장 최근이 마지막), 재동기화 시 서사 패널 복원에 사용된다.
- **Chat_Entry**: 채팅 로그 항목. `{ playerId, characterName, text, ts }`로 구성되며 `characterName`으로 귀속해 표시한다.
- **Chat_Log**: Turn_State의 `chatLog`. 현재 라운드의 채팅을 전송 순서대로 담으며 라운드가 바뀌면 축소(리셋)될 수 있다.
- **Readiness**: Turn_State의 `readiness`. 활성 플레이어별 준비 상태(`status`: `ready` | `not_ready`)와 보류 행동을 담는다.
- **Ready_Count**: 준비된 플레이어 수와 전체 수의 표시 값. `readiness.filter(status === "ready").length` / `readiness.length`.
- **Ready_Check_Deadline**: 준비 체크 카운트다운 마감 시각(ISO 문자열) 또는 `null`(미진행).
- **Action_Log**: Game_View 사이드바의 행동 로그. 채팅 메시지와 함께, 서버가 echo 하지 않는 **본인의 확정 행동·패스를 로컬 에코** 해 표시한다.
- **Chat_Command**: `{ type: "chat", text }` — 자유 대화 전송 명령.
- **Confirm_Command**: `{ type: "confirm", action }` — 행동 확정 전송 명령.
- **Pass_Command**: `{ type: "pass" }` — 패스 전송 명령.
- **Revise_Command**: `{ type: "revise", action }` — 확정 행동 수정 전송 명령.
- **Input_Locked**: 입력·버튼이 비활성인 상태. `phase`가 `resolving` 또는 `ended`이면 참이다.
- **Session_Ended**: 세션이 종료된 상태. `phase === "ended"` 이거나 `closing` 종류의 Narration이 도착하면 참이다.
- **Connection_Status**: 실시간 연결 상태(`connecting` / `open` / `disconnected`).
- **MAX_ENTRIES**: GM 서사 패널과 행동 로그의 DOM 항목 수 상한(기존 `public/index.html`과 동일하게 250). 상한을 넘으면 가장 오래된 항목부터 제거한다.

## Requirements

### Requirement 1: 인계 파라미터 읽기 및 검증

**User Story:** 플레이어로서, 로비에서 세션이 시작되어 게임 화면으로 넘어왔을 때 올바른 방에 정확히 연결되고 싶다. 그래야 우리 일행의 세션에 참여할 수 있다.

#### Acceptance Criteria

1. WHEN the Game_Play_App가 로드되면, THE Game_Play_App SHALL 페이지 URL 쿼리에서 `roomId`의 공백 제거 후 값을 Room_Id로, `hostPlayerId`의 공백 제거 후 값을 Player_Id로 읽는다.
2. WHERE 페이지 URL 쿼리에 공백 제거 후 비어 있지 않은 `token` 값이 존재하는 경우, THE Game_Play_App SHALL 그 값을 Access_Token으로 보존하고 후속 Realtime_Channel 연결에 인증 정보로 첨부한다.
3. IF 공백 제거 후의 Room_Id 또는 Player_Id 중 하나라도 비어 있으면, THEN THE Game_Play_App SHALL 인계 정보가 유효하지 않다는 한국어 오류 메시지를 표시하고 Realtime_Channel 연결을 시작하지 않는다.
4. WHEN Room_Id와 Player_Id가 모두 비어 있지 않은 상태로 the Game_Play_App가 로드되면, THE Game_Play_App SHALL GM 서사 패널·채팅 로그·헤더 상태를 빈 값 또는 로딩 표시(placeholder) 상태로 표시하고, 첫 Turn_State 수신 전까지 입력 컨트롤을 비활성화한다.
5. IF 공백 제거 후의 `token` 값이 비어 있거나 존재하지 않으면, THEN THE Game_Play_App SHALL Access_Token 없이 Realtime_Channel 연결을 진행한다.

### Requirement 2: 실시간 채널 연결과 Turn_State 수신·렌더

**User Story:** 플레이어로서, 게임 화면에 들어오면 현재 진행 상황이 곧바로 보이고, 잠시 끊겼다 다시 들어와도 최신 상태로 맞춰지길 원한다. 그래야 흐름을 놓치지 않는다.

#### Acceptance Criteria

1. WHEN Room_Id와 Player_Id가 모두 유효한 상태로 the Game_Play_App가 로드되면, THE Game_Play_App SHALL 해당 방의 Realtime_Channel 연결을 시작하고 (존재하면) Access_Token을 연결에 전달한다.
2. WHEN Realtime_Channel이 `turn_state` 이벤트를 전달하면, THE Game_Play_App SHALL 이벤트의 Turn_State로 헤더 상태·채팅 로그·서사 패널의 파생 표시를 갱신한다.
3. WHEN Realtime_Channel이 (재)연결 직후 현재 Turn_State를 전달하면, THE Game_Play_App SHALL 그 Turn_State를 적용하여 화면을 현재 진행 상황으로 재동기화한다.
4. WHILE Realtime_Channel 연결이 수립되어 있는 동안, THE Game_Play_App SHALL 연결이 활성 상태임을 나타내는 표시를 Game_View에 제공한다.
5. WHILE Realtime_Channel 연결이 아직 수립되지 않았거나 끊긴 동안, THE Game_Play_App SHALL 연결되지 않았음을 나타내는 한국어 표시를 Game_View에 제공한다.

### Requirement 3: GM 서사 렌더

**User Story:** 플레이어로서, GM이 들려주는 오프닝·판정 결과·결말 이야기를 순서대로 읽고 싶다. 그래야 모험의 전개를 따라갈 수 있다.

#### Acceptance Criteria

1. WHEN Realtime_Channel이 `narration` 이벤트를 전달하면, THE Game_Play_App SHALL 이벤트의 `text`를 그 `kind`(opening/resolution/closing) 표시와 함께 GM 서사 패널의 끝에 새 Narration_Entry로 추가하여 도착 순서대로 표시한다.
2. WHEN the Game_Play_App가 Turn_State를 적용하여 재동기화할 때, THE Game_Play_App SHALL 그 Turn_State의 Narrative_Context 항목들을 기록된 순서(가장 최근이 마지막)대로 GM 서사 패널에 반영한다.
3. WHILE GM 서사 패널에 표시된 Narration_Entry 수가 MAX_ENTRIES를 초과하는 동안, THE Game_Play_App SHALL 가장 오래된 Narration_Entry부터 제거하여 표시 항목 수가 MAX_ENTRIES를 넘지 않도록 유지한다.
4. WHEN Narration_Entry의 텍스트를 렌더링할 때, THE Game_Play_App SHALL 그 텍스트를 HTML로 해석하지 않고 일반 텍스트로 이스케이프하여 표시한다.

### Requirement 4: 채팅 로그 렌더

**User Story:** 플레이어로서, 일행이 주고받는 대화를 캐릭터 이름과 함께 시간 순으로 보고 싶다. 그래야 누가 무슨 말을 했는지 알 수 있다.

#### Acceptance Criteria

1. WHEN the Game_Play_App가 `turn_state` 이벤트의 Chat_Log를 적용할 때, THE Game_Play_App SHALL 직전에 표시한 채팅 수를 초과하는 새 Chat_Entry만 채팅 로그 사이드바에 전송 순서대로 추가한다.
2. WHEN Realtime_Channel이 라이브 `chat_message` 이벤트를 전달하면, THE Game_Play_App SHALL 그 Chat_Entry를 채팅 로그 사이드바의 끝에 새 항목으로 추가한다.
3. WHEN Chat_Entry를 표시할 때, THE Game_Play_App SHALL 그 항목의 `characterName`으로 발화를 귀속하여 표시하고 `text`를 일반 텍스트로 이스케이프하여 표시한다.
4. IF 적용하려는 Turn_State의 Chat_Log 길이가 직전에 표시한 채팅 수보다 작으면(라운드 전환 등으로 축소), THEN THE Game_Play_App SHALL 직전 채팅 수를 0으로 재설정한 뒤 Chat_Log의 항목들을 새로 추가한다.

### Requirement 5: 헤더 상태 표시

**User Story:** 플레이어로서, 지금 몇 라운드인지, 어떤 단계인지, 몇 명이 준비됐는지, 준비 체크가 얼마나 남았는지 한눈에 보고 싶다. 그래야 언제 행동을 확정해야 할지 판단할 수 있다.

#### Acceptance Criteria

1. WHEN the Game_Play_App가 Turn_State를 적용할 때, THE Game_Play_App SHALL 그 Turn_State의 `roundNumber`를 라운드 표시로, `phase`를 단계 표시로 헤더에 표시한다.
2. WHEN the Game_Play_App가 Turn_State를 적용할 때, THE Game_Play_App SHALL 준비된 플레이어 수(`readiness` 중 `status === "ready"`인 항목 수)와 전체 `readiness` 수를 "준비 X/전체" 형태로 헤더에 표시한다.
3. WHILE Turn_State의 Ready_Check_Deadline이 비어 있지 않은(ISO 시각) 동안, THE Game_Play_App SHALL 현재 시각 기준으로 마감까지 남은 시간을 0 이상의 값으로 카운트다운하여 표시하고, 현재 시각이 마감을 지난 경우 0으로 표시한다.
4. WHILE Turn_State의 `phase`가 `resolving`인 동안, THE Game_Play_App SHALL GM이 판정·서술 중임을 나타내는 busy 표시를 헤더에 제공한다.
5. WHILE Turn_State의 `phase`가 `resolving`이 아닌 동안, THE Game_Play_App SHALL busy 표시를 노출하지 않는다.

### Requirement 6: 플레이어 입력

**User Story:** 플레이어로서, 자유롭게 말하고, 하려는 행동을 확정하고, 차례를 넘기고, 필요하면 행동을 고치고 싶다. 그래야 게임에 능동적으로 참여할 수 있다.

#### Acceptance Criteria

1. WHEN the Player가 비어 있지 않은 메시지로 말하기 동작을 수행하면, THE Game_Play_App SHALL `{ type: "chat", text }` 형태의 Chat_Command를 Realtime_Channel로 전송한다.
2. WHEN the Player가 비어 있지 않은 메시지로 행동 확정 동작을 수행하면, THE Game_Play_App SHALL `{ type: "confirm", action }` 형태의 Confirm_Command를 Realtime_Channel로 전송하고, 본인의 확정 행동을 Action_Log에 로컬 에코로 추가한다.
3. WHEN the Player가 패스 동작을 수행하면, THE Game_Play_App SHALL `{ type: "pass" }` 형태의 Pass_Command를 Realtime_Channel로 전송하고, 본인의 패스를 Action_Log에 로컬 에코로 추가한다.
4. WHEN the Player가 비어 있지 않은 메시지로 행동 수정 동작을 수행하면, THE Game_Play_App SHALL `{ type: "revise", action }` 형태의 Revise_Command를 Realtime_Channel로 전송한다.
5. IF 말하기·행동 확정·행동 수정의 입력 메시지가 공백 제거 후 비어 있으면, THEN THE Game_Play_App SHALL 해당 명령을 전송하지 않고 Action_Log에 로컬 에코도 추가하지 않는다.
6. WHEN the Game_Play_App가 명령을 전송한 뒤, THE Game_Play_App SHALL 해당 명령에 사용된 입력 필드를 비운다.

### Requirement 7: 입력 잠금

**User Story:** 플레이어로서, GM이 판정·서술 중이거나 세션이 끝났을 때는 입력이 막혀 있길 원한다. 그래야 의미 없는 입력을 보내 혼란을 일으키지 않는다.

#### Acceptance Criteria

1. WHILE Turn_State의 `phase`가 `resolving` 또는 `ended`인 동안, THE Game_Play_App SHALL 말하기·행동 확정·패스·행동 수정 컨트롤과 입력 필드를 비활성 상태로 표시한다.
2. WHILE Turn_State의 `phase`가 `resolving` 또는 `ended`가 아닌 동안, THE Game_Play_App SHALL 말하기·행동 확정·패스·행동 수정 컨트롤과 입력 필드를 활성 상태로 표시한다.
3. IF 입력이 잠긴(Input_Locked) 동안 어떤 입력 명령 동작이 트리거되면, THEN THE Game_Play_App SHALL 그 명령을 Realtime_Channel로 전송하지 않는다.

### Requirement 8: 연결 끊김·재연결·전달 실패 처리

**User Story:** 플레이어로서, 연결이 끊기거나 메시지 전달에 문제가 생기면 그 사실을 알고 다시 연결되길 원한다. 그래야 멈춘 줄 오해하지 않는다.

#### Acceptance Criteria

1. IF Realtime_Channel 연결이 끊어지면, THEN THE Game_Play_App SHALL 연결이 끊겼음을 알리는 한국어 표시를 제공하고 일정 간격으로 재연결을 시도한다.
2. WHEN Realtime_Channel이 `delivery_failed` 이벤트를 전달하면, THE Game_Play_App SHALL 메시지 전달에 실패해 재시도 중임을 알리는 한국어 표시를 제공한다.
3. WHEN 끊겼던 Realtime_Channel이 다시 연결되면, THE Game_Play_App SHALL 연결 활성 표시를 복원하고, (재)연결 시 전달되는 Turn_State와 플러시된 Narration으로 화면을 재동기화한다.
4. WHILE Realtime_Channel 연결이 끊긴 동안, THE Game_Play_App SHALL 입력 컨트롤을 통해 전송된 명령이 Realtime_Channel로 나가지 않도록 한다.

### Requirement 9: 세션 종료

**User Story:** 플레이어로서, 모험이 끝나면 그 사실을 분명히 알고 입력이 마무리되길 원한다. 그래야 세션이 끝났음을 이해하고 정리할 수 있다.

#### Acceptance Criteria

1. WHEN Turn_State의 `phase`가 `ended`가 되거나 `closing` 종류의 Narration이 도착하면, THE Game_Play_App SHALL 세션이 종료되었음을 Session_Ended 상태로 기록한다.
2. WHILE Session_Ended 상태인 동안, THE Game_Play_App SHALL 말하기·행동 확정·패스·행동 수정 컨트롤과 입력 필드를 비활성 상태로 유지한다.
3. WHEN the Game_Play_App가 Session_Ended 상태로 전이하면, THE Game_Play_App SHALL 세션이 종료되었음을 알리는 한국어 안내를 Game_View에 표시한다.
4. WHILE Session_Ended 상태인 동안, THE Game_Play_App SHALL 다른 화면으로의 추가 인계나 네비게이션을 수행하지 않는다.

### Requirement 10: 공유 접근 토큰 전달

**User Story:** 운영자로서, 서버를 공개로 띄울 때 공유 비밀 토큰으로 보호하고 싶다. 그래야 토큰을 가진 플레이어만 세션에 연결할 수 있다.

#### Acceptance Criteria

1. WHILE 길이가 1자 이상인 Access_Token이 존재하는 동안, WHEN Game_Play_App이 Realtime_Channel 연결을 시작할 때, THE Game_Play_App SHALL 그 Access_Token 값을 한 글자도 변경하지 않고 연결의 인증 파라미터로 전달한다.
2. IF Access_Token이 존재하지 않거나 그 값의 길이가 0인 경우, THEN THE Game_Play_App SHALL Realtime_Channel 연결을 Access_Token 없이 시작한다.
3. WHEN the Game_Play_App가 Access_Token을 연결에 전달할 때, THE Game_Play_App SHALL 그 값을 연결 URL/파라미터에 안전하게 인코딩하여 포함한다.

### Requirement 11: 반응형 레이아웃과 접근성

**User Story:** 플레이어로서, 휴대폰이든 데스크톱이든 키보드든 편하게 세션에 참여하고 싶다. 그래야 어떤 환경에서도 서사를 읽고 행동을 입력할 수 있다.

#### Acceptance Criteria

1. WHERE 뷰포트 너비가 320px 이상 767px 이하인 모바일 환경인 경우, THE Game_Play_App SHALL GM 서사 패널과 채팅·행동 로그 사이드바를 세로 단일 열로 적층하고, 콘텐츠가 뷰포트 너비를 초과하여 가로 스크롤바가 나타나지 않도록 한다.
2. WHEN 사용자가 Tab 키 또는 Shift+Tab 키를 누르면, THE Game_Play_App SHALL 키보드 포커스를 상호작용 가능한 요소 사이에서 DOM 표시 순서와 동일한 순서로 다음 또는 이전 요소로 이동시킨다.
3. WHILE 상호작용 가능한 요소에 키보드 포커스가 위치한 동안 사용자가 Enter 또는 Space 키를 누르면, THE Game_Play_App SHALL 해당 요소의 기본 동작을 활성화한다.
4. WHILE 키보드 포커스가 상호작용 가능한 요소에 위치한 동안, THE Game_Play_App SHALL 해당 요소의 외곽 경계 전체에 주변 배경과 시각적으로 구별되는 보이는 포커스 표시를 렌더링하여, 포커스를 가진 단일 요소를 식별할 수 있게 한다.
5. THE Game_Play_App SHALL 상호작용 가능한 각 요소에 화면 낭독기가 읽을 수 있는, 비어 있지 않으며 요소의 역할과 목적을 식별하는 접근성 레이블을 제공한다.
6. WHEN GM 서사·채팅·상태 변경 또는 오류 메시지가 갱신되면, THE Game_Play_App SHALL 키보드 포커스를 이동시키지 않고 해당 변경 내용을 화면 낭독기가 낭독할 수 있도록 라이브 영역을 통해 제공한다.
