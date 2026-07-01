# Requirements Document

## Introduction

ready-gm은 친구들과 함께 즐기는 멀티플레이 TRPG 세션을 AI GM이 진행해 주는 웹 플랫폼입니다. 이 스펙은 이미 완료된 **"랜딩 / 방 생성(호스트 진입)" 화면(host-entry)** 다음 단계인 **호스트의 로비(대기실) 화면(Room_Lobby_App)** 하나에 집중합니다.

host-entry는 방 생성 성공 후 `/host-entry/lobby?roomId=...&hostPlayerId=...&token=...` 로 이동하면서 식별자(그리고 운영자가 `?token` 공유 비밀을 쓰는 경우 접근 토큰)를 쿼리로 인계합니다(`token`은 공유 비밀이 사용될 때에만 존재). 따라서 본 화면은 그 인계 계약으로 진입하는 **호스트 전용 화면**이며, 호스트가 친구들이 모이기를 기다리고, 초대 링크를 다시 공유하고, 선택된 시나리오를 확인하고, 세션을 시작하기 직전까지의 경험을 다룹니다.

본 화면은 기존 프로젝트의 접근 방식(빌드 단계 없는 정적 `public/*.html`, 바닐라 JS ES 모듈, 인라인 CSS, 다크 테마)을 그대로 따르며, host-entry와 동일하게 순수 로직을 `public/lobby/logic.js` ES 모듈로 분리하고 `public/lobby/index.html`이 그 모듈을 import 해 DOM에 배선하는 구조로 구현합니다(vitest + fast-check 단위/속성 테스트, happy-dom DOM 테스트).

### 백엔드 계약 근거 (실제 코드 확인)

이 스펙은 다음 실제 백엔드 계약을 근거로 합니다(`src/http/app.ts`, `src/services/*`, `src/realtime/connection.ts` 확인).

- **`GET /rooms/:id/invite`** → 알려진 방 id에 대해 `{ inviteLink }`, 알 수 없는 id에는 `404 { error }`. 인계의 `roomId`로 초대 링크를 다시 얻는다.
- **`GET /scenarios`** → `{ scenarios: Scenario[] }`, `Scenario = { id, title, summary, openingSeed, endingCondition }`. MVP는 시나리오 1개(`the-sunless-crypt`)만 제공하며, 시나리오가 정확히 1개이면 기본 선택이 적용된다.
- **`GET /rooms/:token`** → `{ roomId, state, maxPlayers, scenarioId }`. 이 엔드포인트는 **roomId가 아니라 초대 토큰(invite token)** 으로 방을 해석한다. 인계는 roomId만 전달하므로 이 엔드포인트를 인계만으로는 직접 호출할 수 없다. 본 화면은 먼저 `GET /rooms/:id/invite`로 받은 `inviteLink`(`https://ready-gm/r/{token}` 형태)의 마지막 경로 세그먼트에서 invite token을 추출해 이 엔드포인트를 호출한다.
- **접근 토큰(`?token`)** 은 host-entry와 동일하게 모든 REST 요청의 `x-playtest-token` 헤더로 전달된다.
- **실시간(WebSocket) 계약(`src/realtime/connection.ts`)**: 서버 → 클라이언트 이벤트 `ServerEvent`는 `turn_state`, `player_list_updated`(`{ id, displayName, isHost }[]`), `scenario_set`(`{ scenarioId, title, summary }`), `chat_message`, `narration`, `readiness_updated`, `delivery_failed` 를 포함한다. 플레이어 로스터와 세션 시작(START_SESSION)·turn_state는 Room Orchestrator가 구동하는 실시간 관심사이다.

> 본 스펙은 host-entry가 했던 것과 동일하게, **현재 플레이테스트 서버에 아직 배선되지 않은 백엔드 항목**을 아래 "범위 밖 / 가정(Assumptions)"에 명시한다. 프론트엔드는 이 계약에 대해 모킹된 `fetch`/`WebSocket`으로 완전하게 명세·구현·단위/DOM 테스트할 수 있다.

## 범위 밖 / 가정 (Assumptions)

다음 항목은 **의도된(intended) 백엔드 계약**으로서 본 화면이 통합 대상으로 삼되, 현재 플레이테스트 서버(`src/server.ts`)에 아직 배선돼 있지 않으므로 명시적으로 가정으로 둔다. 프론트엔드는 모킹으로 테스트 가능하며, 실제 동작은 해당 백엔드 배선이 추가된 뒤에 검증된다.

- **로비용 실시간 연결 티켓 발급 엔드포인트 부재**: `/ws` 업그레이드는 서버가 발급한 연결 티켓(`ticket`)을 요구한다(`src/server.ts`). 현재 솔로 흐름(`POST /play/new`)만 티켓을 발급하며, 인계 파라미터(roomId/hostPlayerId/token)에는 연결 티켓이 없고 로비용 티켓 발급 REST 엔드포인트도 없다. 본 화면의 실시간 요구사항은 "유효한 연결 티켓을 획득할 수 있다"는 가정 위에서 정의한다.
- **브라우저발 `START_SESSION` 미배선**: 플레이테스트 서버의 `toCommand`는 `chat`/`confirm`/`pass`/`revise`만 매핑하며 `START_SESSION`은 매핑하지 않는다. 본 화면의 세션 시작 요구사항은 의도된 `START_SESSION` 실시간 명령 계약을 기준으로 한다.
- **방 플레이어 목록 REST 엔드포인트 부재**: 방의 플레이어를 나열하는 REST 엔드포인트는 없다. 로스터는 실시간 `player_list_updated` 이벤트로만 제공된다.
- **세션 시작 REST 엔드포인트 부재**: 세션을 시작하는 REST 엔드포인트는 없다. 세션 시작은 실시간 `START_SESSION` 명령으로만 이루어진다.
- **초대 링크 형식 의존**: maxPlayers·scenarioId 획득을 위한 invite token 추출은 `inviteLink`가 `…/{token}` 형태로 끝난다는 형식 가정에 의존한다. 형식이 어긋나 토큰을 추출할 수 없으면 본 화면은 정원/시나리오 식별자 조회를 우아하게 생략한다.
- **다음 단계(게임 화면)는 범위 밖**: 세션 전이 후 이동하는 게임 플레이 화면, 캐릭터 생성, 세션 요약, 운영 대시보드는 본 스펙 범위 밖이다. 본 화면은 게임 화면으로의 인계 지점만 제공한다.
- **게스트(비호스트) 참가 흐름은 범위 밖**: 초대 링크로 들어온 게스트의 참가·캐릭터 생성 화면은 후속 스펙에서 다룬다. 본 화면은 호스트 전용이다.

## Glossary

- **Room_Lobby_App**: 호스트의 로비(대기실)를 담당하는 프론트엔드 애플리케이션. 본 스펙이 정의하는 시스템.
- **Lobby_View**: 호스트가 진입하는 로비 화면 영역. 초대 링크, 정원, 플레이어 로스터, 시나리오, 세션 시작 제어를 표시한다.
- **Host**: 방을 생성하여 호스트 권한을 가진 사용자. 본 화면의 유일한 사용자.
- **Handoff_Params**: 페이지 URL 쿼리로 전달되는 인계 값 묶음. `roomId`, `hostPlayerId`(필수)와 선택적 `token`으로 구성된다.
- **Room_Id**: 인계로 전달된 방 식별자(`roomId`). `GET /rooms/:id/invite` 호출에 사용된다.
- **Host_Player_Id**: 인계로 전달된 호스트 플레이어 식별자(`hostPlayerId`).
- **Access_Token**: 공개 바인딩된 서버를 보호하기 위한 공유 비밀 값. 페이지 URL의 `?token=` 쿼리 파라미터로 전달될 수 있으며, REST 요청의 `x-playtest-token` 헤더로 전송된다.
- **Invite_Endpoint**: 백엔드의 `GET /rooms/:id/invite`. 알려진 방에는 `{ inviteLink }`를, 알 수 없는 방에는 `404 { error }`를 반환한다.
- **Invite_Link**: `Invite_Endpoint`가 반환한 `inviteLink` 문자열. 호스트가 친구에게 공유하는 URL이며 `…/{Invite_Token}` 형태로 끝난다.
- **Invite_Token**: `Invite_Link`의 마지막 경로 세그먼트. `Room_Resolve_Endpoint` 호출에 사용된다.
- **Room_Resolve_Endpoint**: 백엔드의 `GET /rooms/:token`. `Invite_Token`을 받아 `{ roomId, state, maxPlayers, scenarioId }`를 반환한다.
- **Max_Players**: `Room_Resolve_Endpoint`가 반환한 방의 최대 인원 정수 값(`maxPlayers`).
- **Scenarios_Endpoint**: 백엔드의 `GET /scenarios`. `{ scenarios: Scenario[] }`를 반환한다.
- **Scenario**: 사전 제작된 원샷 시나리오. `{ id, title, summary, openingSeed, endingCondition }`로 구성된다. MVP는 `the-sunless-crypt` 1개만 제공한다.
- **Selected_Scenario**: 방에 적용된 시나리오. 방의 `scenarioId`로 식별되며, 시나리오가 정확히 1개일 때는 그 단일 시나리오가 기본 선택으로 적용된다.
- **Realtime_Channel**: 방의 실시간 WebSocket 연결. 서버 → 클라이언트로 `turn_state`, `player_list_updated`, `scenario_set` 등 `ServerEvent`를 전달한다.
- **Player_Roster**: 방에 현재 모인 플레이어 목록. 실시간 `player_list_updated` 이벤트(`{ id, displayName, isHost }[]`)로 갱신된다.
- **Start_Session_Action**: 호스트가 세션 시작을 확정하는 사용자 동작 요소(버튼). 호스트 전용이다.
- **Start_Session_Command**: 세션 시작을 위해 `Realtime_Channel`로 전송하는 의도된 `START_SESSION` 실시간 명령.
- **Session_Active_State**: 방이 세션 진행 단계로 전이한 상태. `turn_state` 이벤트의 진행 단계(예: `roundNumber`가 1 이상) 또는 방 상태 `in_session`으로 식별된다.
- **Game_Screen**: 세션 시작 후 이동하는 게임 플레이 화면(범위 밖). 본 화면은 이 화면으로의 인계 지점만 제공한다.
- **Copy_Action**: 호스트가 `Invite_Link`를 클립보드로 복사하는 사용자 동작 요소.
- **Request_Timeout**: REST 요청에 적용되는 클라이언트 타임아웃. 10초(10000밀리초)로 한다(host-entry와 동일).

## Requirements

### Requirement 1: 인계 파라미터 읽기 및 검증

**User Story:** 호스트로서, 방 생성 직후 인계된 식별자로 내 로비에 정확히 도착하고 싶다. 그래야 올바른 방의 대기실에서 친구들을 기다릴 수 있다.

#### Acceptance Criteria

1. WHEN the Room_Lobby_App가 로드되면, THE Room_Lobby_App SHALL 페이지 URL 쿼리에서 `roomId`의 공백 제거 후 값을 Room_Id로, `hostPlayerId`의 공백 제거 후 값을 Host_Player_Id로 읽는다.
2. WHERE 페이지 URL 쿼리에 공백 제거 후 비어 있지 않은 `token` 값이 존재하는 경우, THE Room_Lobby_App SHALL 그 값을 Access_Token으로 보존하고 후속 Invite_Endpoint·Scenarios_Endpoint·Room_Resolve_Endpoint 요청에 인증 정보로 첨부한다.
3. IF 공백 제거 후의 Room_Id 또는 Host_Player_Id 중 하나라도 비어 있으면, THEN THE Room_Lobby_App SHALL 인계 정보가 유효하지 않다는 한국어 오류 메시지를 표시하고, Invite_Endpoint·Scenarios_Endpoint·Room_Resolve_Endpoint 요청과 Realtime_Channel 연결을 시작하지 않는다.
4. WHEN Room_Id와 Host_Player_Id가 모두 비어 있지 않은 상태로 the Room_Lobby_App가 로드되면, THE Room_Lobby_App SHALL 로비 초기 상태로서 Invite_Link·Max_Players·Player_Roster·Selected_Scenario 영역을 빈 값 또는 로딩 표시(placeholder) 상태로 표시하고 데이터 적재 완료 전까지 사용자 조작이 불가능하도록 비활성화한다.
5. IF 공백 제거 후의 `token` 값이 비어 있거나 존재하지 않으면, THEN THE Room_Lobby_App SHALL Access_Token 없이 Invite_Endpoint·Scenarios_Endpoint·Room_Resolve_Endpoint 요청을 진행한다.

### Requirement 2: 초대 링크 재조회

**User Story:** 호스트로서, 로비에서 초대 링크를 다시 보고 싶다. 그래야 늦게 합류하는 친구에게 링크를 한 번 더 보낼 수 있다.

#### Acceptance Criteria

1. WHEN 비어 있지 않은 Room_Id가 존재하는 상태로 the Room_Lobby_App가 로드되면, THE Room_Lobby_App SHALL 해당 Room_Id와 (존재하면) Access_Token을 포함하여 Invite_Endpoint에 초대 링크 조회를 요청한다.
2. WHILE 초대 링크 조회 요청이 진행 중인 동안, THE Room_Lobby_App SHALL Lobby_View에 조회 진행 중임을 나타내는 표시를 노출한다.
3. WHEN Invite_Endpoint가 HTTP 200 상태로 `inviteLink`를 포함한 성공 응답을 반환하면, THE Room_Lobby_App SHALL 응답의 `inviteLink` 전체 문자열을 Lobby_View에 표시한다.
4. IF Invite_Endpoint가 HTTP 404 상태로 응답하면, THEN THE Room_Lobby_App SHALL 해당 방을 찾을 수 없다는 한국어 오류 메시지를 표시한다.
5. IF Invite_Endpoint 요청이 네트워크 오류로 실패하거나 전송 후 Request_Timeout(10초) 이내에 응답하지 않거나 HTTP 500 이상으로 응답하면, THEN THE Room_Lobby_App SHALL 초대 링크를 불러오지 못했다는 한국어 오류 메시지를 표시하고 초대 링크 재조회를 다시 시도할 수 있는 동작 요소를 제공한다.
6. WHEN 호스트가 초대 링크 재조회 동작 요소를 선택하면, THE Room_Lobby_App SHALL 해당 Room_Id와 (존재하면) Access_Token을 포함하여 Invite_Endpoint에 초대 링크 조회를 다시 요청한다.

### Requirement 3: 초대 링크 복사

**User Story:** 호스트로서, 초대 링크를 한 번에 복사하고 싶다. 그래야 채팅으로 빠르게 친구에게 전달할 수 있다.

#### Acceptance Criteria

1. WHEN Invite_Endpoint가 `inviteLink`를 포함한 성공 응답을 반환하면, THE Lobby_View SHALL Invite_Link를 클립보드로 복사하는 Copy_Action 요소를 제공한다.
2. WHEN the Host가 Copy_Action을 수행하면, THE Room_Lobby_App SHALL Invite_Link 전체 문자열을 잘림·변형·공백 추가 없이 그대로 클립보드에 복사한다.
3. WHEN Invite_Link 복사가 성공하면, THE Room_Lobby_App SHALL 복사 완료를 알리는 확인 메시지를 최소 3000밀리초 동안 연속해서 표시한다.
4. IF Invite_Link 복사가 실패하면(클립보드 미지원, 권한 거부, 쓰기 예외 포함), THEN THE Room_Lobby_App SHALL 복사 실패를 알리는 표시를 제공하고 Invite_Link 전체 문자열을 사용자가 직접 선택·복사할 수 있는 형태로 유지하여 표시한다.

### Requirement 4: 방 정보 조회 (정원·시나리오 식별자)

**User Story:** 호스트로서, 방의 최대 인원과 어떤 시나리오가 적용됐는지 알고 싶다. 그래야 몇 명까지 모을 수 있고 무엇을 플레이할지 파악할 수 있다.

#### Acceptance Criteria

1. WHEN Invite_Endpoint가 `inviteLink`를 포함한 성공 응답을 반환하면, THE Room_Lobby_App SHALL `inviteLink`에서 끝의 슬래시와 질의 문자열을 제외한 마지막 경로 세그먼트를 Invite_Token으로 추출한다.
2. WHEN Invite_Token이 추출되면, THE Room_Lobby_App SHALL 그 Invite_Token으로 Room_Resolve_Endpoint에 방 정보 조회를 요청한다.
3. WHEN Room_Resolve_Endpoint가 1 이상의 정수인 `maxPlayers`와 비어 있지 않은 `scenarioId`를 포함한 성공 응답을 반환하면, THE Room_Lobby_App SHALL `maxPlayers` 정수 값을 방의 최대 인원으로 표시하고 `scenarioId`를 Selected_Scenario 식별자로 보존한다.
4. IF Invite_Link에서 비어 있지 않은 Invite_Token을 추출할 수 없으면, THEN THE Room_Lobby_App SHALL Room_Resolve_Endpoint 요청을 보내지 않고 정원·시나리오 식별자 표시를 생략한다.
5. IF Room_Resolve_Endpoint 요청이 네트워크 오류로 실패하거나 전송 후 Request_Timeout(10초) 이내에 응답하지 않거나 HTTP 404 또는 500 이상으로 응답하면, THEN THE Room_Lobby_App SHALL 방 정보를 불러오지 못했다는 한국어 오류 메시지를 표시한다.
6. IF Room_Resolve_Endpoint 성공 응답에 `maxPlayers` 또는 `scenarioId`가 없거나 `maxPlayers`가 1 이상의 정수가 아니면, THEN THE Room_Lobby_App SHALL 정원·시나리오 식별자를 표시하지 않고 방 정보를 불러오지 못했다는 한국어 오류 메시지를 표시한다.

### Requirement 5: 선택된 시나리오 표시

**User Story:** 호스트로서, 로비에서 우리가 플레이할 시나리오의 제목과 소개를 보고 싶다. 그래야 친구들에게 어떤 모험인지 설명할 수 있다.

#### Acceptance Criteria

1. WHEN Room_Id가 유효한 상태로 the Room_Lobby_App가 로드되면, THE Room_Lobby_App SHALL 전송 후 Request_Timeout(10초) 이내의 응답을 기대 조건으로 하여 Scenarios_Endpoint에 시나리오 목록 조회를 요청한다.
2. WHEN Scenarios_Endpoint가 HTTP 200으로 시나리오 목록을 반환하고 Selected_Scenario 식별자가 그 목록의 한 Scenario `id`와 일치하면, THE Room_Lobby_App SHALL 일치하는 Scenario의 `title`과 `summary`를 Lobby_View에 표시한다.
3. WHERE Scenarios_Endpoint가 반환한 시나리오가 정확히 1개이고 Selected_Scenario 식별자가 아직 확정되지 않은 경우, THE Room_Lobby_App SHALL 그 단일 Scenario를 Selected_Scenario로 적용하여 `title`과 `summary`를 표시한다.
4. WHEN Realtime_Channel이 `scenario_set` 이벤트를 전달하면, THE Room_Lobby_App SHALL 이벤트의 `title`과 `summary`로 표시된 시나리오 정보를 갱신한다.
5. IF Scenarios_Endpoint 요청이 네트워크 오류로 실패하거나 전송 후 Request_Timeout(10초) 이내에 응답하지 않거나 HTTP 500 이상으로 응답하면, THEN THE Room_Lobby_App SHALL 시나리오 정보를 불러오지 못했다는 한국어 오류 메시지를 표시하고 기존에 표시된 시나리오 정보를 유지한다.
6. IF Scenarios_Endpoint가 HTTP 200으로 응답했으나 반환된 시나리오 목록이 비어 있으면(0개), THEN THE Room_Lobby_App SHALL 표시할 시나리오가 없다는 한국어 메시지를 표시한다.
7. IF Scenarios_Endpoint가 시나리오 목록을 반환했으나 Selected_Scenario 식별자가 그 목록의 어떤 Scenario `id`와도 일치하지 않으면, THEN THE Room_Lobby_App SHALL 선택된 시나리오를 찾을 수 없다는 한국어 오류 메시지를 표시한다.

### Requirement 6: 실시간 채널 연결 및 플레이어 로스터

**User Story:** 호스트로서, 친구들이 방에 들어올 때마다 누가 모였는지 실시간으로 보고 싶다. 그래야 모두 모였는지 판단하고 세션을 시작할 수 있다.

#### Acceptance Criteria

1. WHEN Room_Id와 Host_Player_Id가 모두 유효한 상태로 the Room_Lobby_App가 로드되면, THE Room_Lobby_App SHALL 해당 방의 Realtime_Channel 연결을 시작한다.
2. WHEN Realtime_Channel이 `player_list_updated` 이벤트를 전달하면, THE Room_Lobby_App SHALL 이벤트의 플레이어 목록으로 Player_Roster를 교체하고, 각 플레이어의 `displayName`과 호스트 여부(`isHost`)를 표시한다.
3. WHILE Realtime_Channel 연결이 수립되어 있는 동안, THE Room_Lobby_App SHALL 연결이 활성 상태임을 나타내는 표시를 Lobby_View에 제공한다.
4. IF Realtime_Channel 연결이 끊어지면, THEN THE Room_Lobby_App SHALL 연결이 끊겼음을 알리는 한국어 표시를 제공하고 일정 간격으로 재연결을 시도한다.
5. WHEN the Room_Lobby_App가 Player_Roster를 표시할 때, THE Room_Lobby_App SHALL 현재 플레이어 수와 Max_Players를 함께 표시한다.
6. WHILE Player_Roster에 플레이어가 0명인 동안, THE Room_Lobby_App SHALL 아직 모인 플레이어가 없음을 나타내는 한국어 표시를 제공한다.

### Requirement 7: 호스트 전용 세션 시작 제어

**User Story:** 호스트로서, 친구들이 모이면 세션을 시작하고 싶다. 그래야 다 함께 게임을 시작할 수 있다.

#### Acceptance Criteria

1. THE Lobby_View SHALL 세션을 시작하는 Start_Session_Action 요소를 표시한다.
2. WHILE Realtime_Channel 연결이 활성 상태이고 Selected_Scenario가 확정되었으며 Player_Roster에 1명 이상의 플레이어가 존재하는 동안, THE Room_Lobby_App SHALL Start_Session_Action 요소를 활성 상태로 표시한다.
3. WHILE Realtime_Channel 연결이 활성 상태가 아니거나 Selected_Scenario가 확정되지 않았거나 Player_Roster의 플레이어가 0명인 동안, THE Room_Lobby_App SHALL Start_Session_Action 요소를 비활성 상태로 표시한다.
4. WHEN the Host가 활성 상태의 Start_Session_Action을 수행하면, THE Room_Lobby_App SHALL Host_Player_Id를 발신자로 하는 Start_Session_Command를 Realtime_Channel로 정확히 1회만 전송하고 Start_Session_Action 요소를 즉시 비활성화하여 중복 전송을 막는다.
5. WHEN Realtime_Channel이 방이 Session_Active_State(`turn_state`의 `roundNumber`가 1 이상이거나 방 상태가 `in_session`)로 전이했음을 나타내는 이벤트를 전달하면, THE Room_Lobby_App SHALL Room_Id와 Host_Player_Id를, 그리고 Access_Token이 존재하면 그 Access_Token을 함께 Game_Screen이 사용할 수 있는 형태로 전달하는 인계를 1회만 수행한다.
6. WHILE 방이 Session_Active_State로 전이하지 않은 상태이면, THE Room_Lobby_App SHALL Game_Screen으로의 인계를 수행하지 않는다.
7. IF Start_Session_Command 전송이 실패하면, THEN THE Room_Lobby_App SHALL 세션 시작에 실패했다는 한국어 메시지를 표시하고 Start_Session_Action 요소를 다시 활성화하여 재시도할 수 있게 한다.

### Requirement 8: 로딩 및 진행 상태 표시

**User Story:** 호스트로서, 로비가 데이터를 불러오거나 세션을 시작하는 동안 진행 중임을 알고 싶다. 그래야 멈춘 것으로 오해하거나 중복 조작하지 않는다.

#### Acceptance Criteria

1. WHILE Invite_Endpoint, Scenarios_Endpoint, 또는 Room_Resolve_Endpoint 요청이 전송된 시점부터 응답이 도착하기 전까지, THE Room_Lobby_App SHALL 요청 전송 후 200밀리초 이내에 해당 영역에 데이터를 불러오는 중임을 나타내는 시각적 인디케이터를 표시한다.
2. WHILE 해당 요청의 로딩 인디케이터가 표시되는 동안, THE Room_Lobby_App SHALL 해당 영역의 동일 요청을 다시 트리거하는 컨트롤을 비활성화하여 중복 요청 전송을 차단한다.
3. WHEN 해당 요청이 성공 또는 오류로 완료되면, THE Room_Lobby_App SHALL 200밀리초 이내에 그 영역의 로딩 인디케이터를 해제하고 비활성화했던 컨트롤을 다시 활성화한다.
4. IF Invite_Endpoint, Scenarios_Endpoint, 또는 Room_Resolve_Endpoint 요청이 전송 후 10초 이내에 응답을 받지 못하면, THEN THE Room_Lobby_App SHALL 해당 영역의 로딩 인디케이터를 해제하고, 요청이 시간 초과되었음을 나타내는 오류 표시를 제시하며, 비활성화했던 컨트롤을 다시 활성화한다.
5. WHILE Start_Session_Command 전송 후 방이 Session_Active_State로 전이하기 전까지, THE Room_Lobby_App SHALL Start_Session_Command 전송 후 200밀리초 이내에 세션을 시작하는 중임을 나타내는 시각적 인디케이터를 표시하고 세션 시작 컨트롤을 비활성화한다.
6. IF Start_Session_Command 전송 후 30초 이내에 방이 Session_Active_State로 전이하지 않으면, THEN THE Room_Lobby_App SHALL 세션 시작 인디케이터를 해제하고, 세션 시작이 시간 초과되었음을 나타내는 오류 표시를 제시하며, 세션 시작 컨트롤을 다시 활성화한다.

### Requirement 9: 서버·네트워크·타임아웃 오류 처리

**User Story:** 호스트로서, 서버나 네트워크 문제가 생기면 그 사실을 알고 다시 시도하고 싶다. 그래야 무엇이 잘못됐는지 모른 채 기다리지 않는다.

#### Acceptance Criteria

1. IF 어떤 REST 요청(Invite_Endpoint, Scenarios_Endpoint, Room_Resolve_Endpoint)이든 전송 후 Request_Timeout(10000밀리초) 이내에 응답을 반환하지 않으면, THEN THE Room_Lobby_App SHALL 해당 요청을 타임아웃 오류로 처리하고 진행 중인 요청을 취소한다.
2. IF 어떤 REST 요청이 Request_Timeout(10000밀리초)을 초과하여 타임아웃 오류로 처리되면, THEN THE Room_Lobby_App SHALL 연결이 지연되어 요청이 완료되지 못했음을 알리는 한국어 메시지를 표시한다.
3. IF 어떤 REST 요청이든 응답을 수신하지 못하는 네트워크 오류로 완료되지 못하면, THEN THE Room_Lobby_App SHALL 네트워크 연결 문제로 요청이 실패했음을 알리는 한국어 오류 메시지를 표시한다.
4. IF 어떤 REST 요청이든 HTTP 상태 코드 500 이상으로 응답하면, THEN THE Room_Lobby_App SHALL 서버 오류가 발생했음을 알리는, 타임아웃·네트워크 오류 메시지와 구분되는 한국어 메시지를 표시한다.
5. IF 어떤 REST 요청이 복구 가능한 오류(타임아웃, 네트워크 오류, 또는 HTTP 500 이상의 서버 오류 중 하나)로 종료되면, THEN THE Room_Lobby_App SHALL 동일한 요청을 동일한 입력값으로 다시 전송할 수 있는 동작 요소를 표시한다.
6. IF 어떤 REST 요청이 타임아웃·네트워크·서버(HTTP 500 이상) 오류 중 하나로 종료되면, THEN THE Room_Lobby_App SHALL 호스트가 입력하거나 보유한 데이터(인계 식별자·Access_Token)를 변경하지 않고 그대로 유지한다.

### Requirement 10: 공유 접근 토큰 전달

**User Story:** 운영자로서, 서버를 공개로 띄울 때 공유 비밀 토큰으로 보호하고 싶다. 그래야 토큰을 가진 호스트만 로비를 사용할 수 있다.

#### Acceptance Criteria

1. WHILE 길이가 1자 이상인 Access_Token이 존재하는 동안, WHEN Room_Lobby_App이 Invite_Endpoint, Scenarios_Endpoint, Room_Resolve_Endpoint 중 하나로 REST 요청을 전송할 때, THE Room_Lobby_App SHALL 해당 요청의 `x-playtest-token` 헤더에 Access_Token 값을 한 글자도 변경하지 않고 그대로 포함한다.
2. IF Access_Token이 존재하지 않거나 그 값의 길이가 0인 경우, THEN THE Room_Lobby_App SHALL Invite_Endpoint, Scenarios_Endpoint, Room_Resolve_Endpoint로의 모든 REST 요청을 `x-playtest-token` 헤더 없이 전송한다.
3. WHILE 길이가 1자 이상인 Access_Token이 존재하는 동안, WHEN Room_Lobby_App이 Game_Screen으로 인계할 때, THE Room_Lobby_App SHALL 해당 Access_Token 값을 한 글자도 변경하지 않고 그대로 함께 전달한다.
4. IF Access_Token이 존재하지 않거나 그 값의 길이가 0인 경우, THEN THE Room_Lobby_App SHALL Game_Screen 인계 시 Access_Token을 포함하지 않는다.

### Requirement 11: 반응형 레이아웃과 접근성

**User Story:** 호스트로서, 휴대폰이든 데스크톱이든 키보드든 편하게 로비를 사용하고 싶다. 그래야 어떤 환경에서도 친구들을 모으고 세션을 시작할 수 있다.

#### Acceptance Criteria

1. WHERE 뷰포트 너비가 320px 이상 767px 이하인 모바일 환경인 경우, THE Room_Lobby_App SHALL Lobby_View의 초대 링크·정원·Player_Roster·시나리오·Start_Session_Action 영역을 세로 단일 열로 배치하고, 콘텐츠가 뷰포트 너비를 초과하여 가로 스크롤바가 나타나지 않도록 한다.
2. WHEN 사용자가 Tab 키 또는 Shift+Tab 키를 누르면, THE Room_Lobby_App SHALL 키보드 포커스를 상호작용 가능한 요소 사이에서 DOM 표시 순서와 동일한 순서로 다음 또는 이전 요소로 이동시킨다.
3. WHILE 상호작용 가능한 요소에 키보드 포커스가 위치한 동안 사용자가 Enter 또는 Space 키를 누르면, THE Room_Lobby_App SHALL 해당 요소의 기본 동작을 활성화한다.
4. WHILE 키보드 포커스가 상호작용 가능한 요소에 위치한 동안, THE Room_Lobby_App SHALL 해당 요소의 외곽 경계 전체에 주변 배경과 시각적으로 구별되는 보이는 포커스 표시를 렌더링하여, 포커스를 가진 단일 요소를 식별할 수 있게 한다.
5. THE Room_Lobby_App SHALL 상호작용 가능한 각 요소에 화면 낭독기가 읽을 수 있는, 비어 있지 않으며 요소의 역할과 목적을 식별하는 접근성 레이블을 제공한다.
6. WHEN 오류 또는 상태 변경 메시지가 표시되면, THE Room_Lobby_App SHALL 키보드 포커스를 이동시키지 않고 해당 메시지 텍스트를 화면 낭독기가 자동으로 낭독하도록 라이브 영역을 통해 제공한다.
