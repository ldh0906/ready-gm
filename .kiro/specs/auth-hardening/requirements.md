# Requirements Document

## Introduction

ready-gm은 친구들과 함께 즐기는 멀티플레이 TRPG 원샷 세션을 AI GM이 진행해 주는 웹 플랫폼이다. 본 스펙(item #4: **인증 신뢰 모델 강화, auth-hardening**)은 플레이테스트 서버의 **신뢰 모델(trust model)** 하나를 강화하는 횡단 관심사에 집중한다.

현재 플레이테스트 서버(`src/server.ts`)의 신뢰 모델은 MVP 수준이며 **위조(forge)가 쉽다**. 플레이어를 식별하는 거의 모든 동작은 클라이언트가 보낸 `playerId`(그리고 경로의 `roomId`)를 **방 멤버십(room membership)으로만** 검증한다. 즉 어떤 방의 `(roomId, playerId)` UUID 쌍을 알아낸 사람은 누구든 그 플레이어인 척하고 캐릭터를 저장하거나, 확정하거나, 세션을 시작하거나, 그 플레이어의 실시간 팬아웃을 가로챌 수 있다. 유일한 추가 방어선은 루프백 바인딩과 `PLAYTEST_TOKEN` 공유 비밀(shared secret) 게이트뿐인데, 이 게이트는 **플레이어 신원(identity)** 을 전혀 구분하지 못한다(토큰만 알면 아무 플레이어로나 행세 가능).

다행히 이 구멍을 닫는 **올바른 1차 도구가 이미 코드에 존재한다**. `src/realtime/connection-tickets.ts`의 `ConnectionTicketStore`는 서버가 발급하는 24바이트 무작위(base64url) **연결 티켓(connection ticket)** 을 관리하고, `authorizeConnection(tickets, members, token)`은 신원을 **티켓에서 도출(derive)** 한 뒤(클라이언트 쿼리 파라미터가 아니라) 방 멤버십을 재확인한다. 이 메커니즘은 플레이테스트 진입 흐름(`POST /play/new`)의 시드 플레이어에 대해서만 발급·사용되고 있고, **모든 플레이어를 대상으로, 모든 플레이어-행위(player-acting) 엔드포인트에 균일하게 강제되지는 않는다**.

본 스펙의 목표는 **새로운 인증 체계를 발명하지 않고**, 이미 검증된 `ConnectionTicketStore`/`authorizeConnection` 1차 도구를 **재사용·확장**하여, "UUID만 알면 남을 사칭한다"는 사소한 사칭 구멍을 닫는 것이다. 이것은 인메모리 플레이테스트 서버이므로(재시작 시 방/플레이어/확정 상태가 사라짐), 목표는 **완전한 프로덕션 인증(JWT/OAuth 등)** 이 아니라 그 기본 프리미티브로 사칭을 막는 **실용적이고 가산적인(additive)** 강화다.

### 백엔드 계약 근거 (실제 코드 확인)

본 스펙은 다음 실제 코드를 근거로 한다.

- **연결 티켓 스토어**(`src/realtime/connection-tickets.ts`): `ConnectionTicketStore`는 `issue(identity): token`, `resolve(token): identity | undefined`, `revoke(token): void`, `size`를 제공한다. `authorizeConnection(tickets, members, token)`은 `tickets.resolve(token)`으로 신원을 얻고(없으면 거부), 그 신원의 `playerId`가 여전히 그 `roomId`의 멤버인지 `members.getPlayer(...)`로 재확인한다(아니면 거부). `RoomMembershipReader`는 `getPlayer(playerId): { roomId } | undefined` 하나만 요구하며 `RoomStore`가 이를 만족한다. **현재 스토어는 토큰→신원 단방향 맵만 가지며, 방 단위로 티켓을 일괄 폐기하는 역방향 색인은 없다.**
- **플레이테스트 서버**(`src/server.ts`):
  - `connectionTickets = new ConnectionTicketStore()` 인스턴스가 하나 있다.
  - `POST /play/new`(솔로 시드)는 `connectionTickets.issue({ roomId, playerId })`로 시드 호스트 플레이어에게 티켓을 발급하고 응답에 `connectionToken`을 담는다.
  - `POST /rooms`(로비 방 생성)와 `POST /rooms/:token/join`(로비 참가)은 **티켓을 발급하지 않으며** 응답에 `connectionToken`이 없다.
  - 플레이어-행위 REST 엔드포인트 — `POST /rooms/:roomId/players/:playerId/proposal`, `POST /rooms/:roomId/players/:playerId/character`, `POST /rooms/:roomId/players/:playerId/character/confirm`, `POST /rooms/:roomId/players/:playerId/start` — 는 모두 `restAuthorized(req)`(= `tokenMatches(TOKEN, ...)`, 즉 루프백 공유 비밀 게이트)만 통과하면, 경로의 `req.params.playerId`를 **그대로 신뢰**해 동작한다. 신원 검증은 (start의 호스트 검사를 제외하면) 사실상 없다.
  - `start` 엔드포인트는 `req.params.playerId !== room.hostPlayerId`이면 `{ ok: false, reason: "NOT_HOST" }`, 전원 확정이 아니면 `{ ok: false, reason: "NOT_ALL_CONFIRMED" }`를 반환한다(이 두 게이트는 보존되어야 한다).
  - `resolveSocketIdentity(params)`는 `ticket` 쿼리 파라미터가 있으면 `authorizeConnection`으로 신원을 도출하지만, **티켓이 없으면** `roomId`(+선택적 `playerId`)만으로 신원을 도출하는 폴백 경로가 있어, 방 멤버인 임의 `playerId`로 행세하거나 호스트 신원으로 폴백한다. 이것이 "ws ticket gap"이다.
  - `/ws` 업그레이드와 REST는 `x-playtest-token` 헤더(또는 쿼리 `token`)로 루프백 공유 비밀을 검사한다.
- **기존 보안 테스트**(`src/server-security.test.ts`): `resolveBinding`·`playtestToken`·`checkStartupSafety`·`tokenMatches`·`FixedWindowRateLimiter`·`SessionSlotLimiter` 등 `server-security.ts` 헬퍼만 단위 검증한다. 엔드포인트 신원 검증은 다루지 않는다.
- **티켓 테스트**(`src/realtime/connection-tickets.test.ts`): `ConnectionTicketStore`/`authorizeConnection`의 발급·해석·폐기·교차 플레이어 사칭 거부를 이미 검증한다(확장의 기준선).

> 본 스펙은 **가산적**이다. `ConnectionTicketStore`/`authorizeConnection`을 재사용·확장하고, 기존 테스트(`src/server-security.test.ts`, `src/realtime/connection-tickets.test.ts` 등)를 깨지 않는다. 계약이 정당하게 바뀌는 부분(예: 플레이어-행위 엔드포인트가 이제 티켓을 요구함)에서는 테스트를 갱신하되 그 이유를 작업 텍스트에 설명한다.

## 범위 밖 / 가정 (Assumptions)

- **인메모리 플레이테스트 범위**: 티켓 스토어·방 스토어는 단일 프로세스 인메모리이며 재시작 시 사라진다. 본 스펙은 영속화·분산 세션을 다루지 않는다.
- **프로덕션 인증 아님**: JWT·OAuth·세션 쿠키·암호 서명 토큰 등은 도입하지 않는다. 신원은 기존 24바이트 무작위 티켓의 **추측 불가능성(unguessability)** 과 서버 측 발급에만 의존한다.
- **루프백 공유 비밀 게이트 보존**: `PLAYTEST_TOKEN` 게이트와 바인딩 안전성 검사(`checkStartupSafety` 등)는 변경하지 않고 심층 방어로 유지한다.
- **티켓 전달 수단은 의도된 계약**: 클라이언트는 발급받은 티켓을 후속 플레이어-행위 요청에 제시한다. 본 스펙은 티켓을 전용 요청 헤더(Ticket_Header, `x-connection-ticket`)로 보내고 `/ws`는 `ticket` 쿼리 파라미터(기존 방식)로 보내는 의도된 계약 위에서 동작을 정의한다. 실제 프론트엔드 배선은 character-sheet·room-lobby 스펙과 같은 방식으로 가산 작업이다.
- **방 단위 폐기 색인은 의도된 확장**: 방 종료/teardown 시 그 방의 모든 티켓을 일괄 폐기하기 위해, `ConnectionTicketStore`에 방→토큰 역방향 색인과 방 단위 폐기 연산을 추가하는 의도된 확장 위에서 동작을 정의한다. 기존 `issue`·`resolve`·`revoke(token)`·`size` 동작은 보존된다.
- **레이트 리미트·세션 슬롯 보존**: `FixedWindowRateLimiter`·`SessionSlotLimiter` 정책은 변경하지 않는다.

## Glossary

- **Playtest_Server**: 플레이테스트 HTTP + WebSocket 서버(`src/server.ts`). 방을 시드하고 플레이어-행위 요청을 처리한다.
- **Connection_Ticket_Store**: 서버가 발급하는 연결/행위 티켓을 관리하는 인메모리 스토어(`ConnectionTicketStore`, `src/realtime/connection-tickets.ts`). 본 스펙에서 방 단위 폐기 연산이 추가된다.
- **Connection_Ticket**: Connection_Ticket_Store가 발급하는, 24바이트 무작위에서 만든 추측 불가능한 불투명(opaque) 토큰. 정확히 하나의 Ticket_Identity에 묶인다. 본 스펙에서 `/ws` 연결과 플레이어-행위 REST 요청 양쪽의 신원 증명에 쓰인다.
- **Ticket_Identity**: 한 Connection_Ticket이 증명하는 신원, 즉 `(Room_Id, Player_Id)` 쌍(`ConnectionIdentity`).
- **Room_Id**: 한 방의 식별자.
- **Player_Id**: 한 플레이어의 식별자.
- **Targeted_Identity**: 한 요청이 행위 대상으로 지정한 `(Room_Id, Player_Id)`. REST에서는 경로 파라미터 `:roomId`·`:playerId`, `/ws`에서는 쿼리 파라미터로 표현된다.
- **Action_Authorizer**: 제시된 Connection_Ticket과 Targeted_Identity로부터 한 요청을 인가/거부하는 검증 계약. 기존 `authorizeConnection`(연결용)과, 본 스펙이 추가하는 `authorizeAction`(Targeted_Identity 일치까지 검사하는 확장)으로 실현된다.
- **Authenticated_Identity**: Action_Authorizer가 Connection_Ticket에서 도출하고 멤버십을 재확인해 인가에 성공한 Ticket_Identity. 플레이어-행위는 항상 이 신원으로 수행된다.
- **Player_Acting_Endpoint**: 한 플레이어의 신원으로 상태를 바꾸는 REST 엔드포인트 — 능력치 제안(`proposal`), 캐릭터 저장(`character`), 캐릭터 확정(`character/confirm`), 호스트 세션 시작(`start`).
- **Realtime_Channel**: 게임/솔로 플레이 WebSocket 진입점(`/ws`)과 그 신원 해석(`resolveSocketIdentity`).
- **Loopback_Token_Gate**: `PLAYTEST_TOKEN` 공유 비밀 검사(`tokenMatches`)와 루프백 바인딩 정책. 신원을 구분하지 않는 심층 방어 게이트.
- **Ticket_Header**: 플레이어-행위 REST 요청이 Connection_Ticket을 싣는 전용 요청 헤더 `x-connection-ticket`(의도된 계약).
- **Host_Player**: 한 방의 호스트 플레이어(`room.hostPlayerId`).
- **NOT_HOST**: 세션 시작 요청자가 Host_Player가 아닐 때의 거부 사유.
- **NOT_ALL_CONFIRMED**: 방의 모든 플레이어가 캐릭터를 확정하지 않았을 때 세션 시작이 거부되는 사유.
- **Ticket_Revocation**: 세션 종료 또는 방 teardown 시 해당 방의 Connection_Ticket을 더 이상 인가하지 못하도록 무효화하는 동작.
- **Forge_Attempt**: 유효한 Connection_Ticket 없이, 또는 다른 플레이어/다른 방의 티켓으로 한 플레이어인 척 수행하려는 요청.
- **Member_Reader**: Action_Authorizer가 멤버십을 재확인할 때 쓰는 최소 조회 계약(`RoomMembershipReader`, `getPlayer(playerId): { roomId } | undefined`). `RoomStore`가 이를 만족한다.

## Requirements

### Requirement 1: 모든 플레이어에게 연결 티켓 발급

**User Story:** 플레이어로서, 방에 들어가거나 세션이 준비되는 시점에 서버가 나만의 연결 티켓을 발급해 주길 바란다. 그래야 이후 내 신원을 클라이언트가 보낸 식별자가 아니라 서버가 발급한 티켓으로 증명할 수 있다.

#### Acceptance Criteria

1. WHEN the Playtest_Server가 `POST /play/new`로 솔로 시드 플레이어를 생성하면, THE Playtest_Server SHALL 그 `(Room_Id, Player_Id)`에 대한 하나의 Connection_Ticket을 the Connection_Ticket_Store로 발급하고 그 Connection_Ticket을 응답 본문에 포함한다.
2. WHEN the Playtest_Server가 `POST /rooms`로 로비 방과 Host_Player를 생성하면, THE Playtest_Server SHALL 그 Host_Player의 `(Room_Id, Player_Id)`에 대한 하나의 Connection_Ticket을 the Connection_Ticket_Store로 발급하고 그 Connection_Ticket을 응답 본문에 포함한다.
3. WHEN the Playtest_Server가 `POST /rooms/:token/join`으로 한 플레이어를 방에 참가시키면, THE Playtest_Server SHALL 그 참가한 플레이어의 `(Room_Id, Player_Id)`에 대한 하나의 Connection_Ticket을 the Connection_Ticket_Store로 발급하고 그 Connection_Ticket을 응답 본문에 포함한다.
4. WHEN the Connection_Ticket_Store가 한 `(Room_Id, Player_Id)`에 대해 Connection_Ticket을 발급하면, THE Connection_Ticket_Store SHALL 그 Connection_Ticket을 정확히 그 하나의 Ticket_Identity에 묶고, 그 Connection_Ticket을 the Connection_Ticket_Store로 해석하면 발급에 쓰인 그 Ticket_Identity를 돌려준다.
5. WHEN the Connection_Ticket_Store가 서로 다른 두 발급 요청에 대해 Connection_Ticket을 발급하면, THE Connection_Ticket_Store SHALL 서로 구별되는 두 Connection_Ticket을 산출한다.

### Requirement 2: 플레이어-행위 REST 요청은 티켓에서 신원을 도출한다

**User Story:** 플레이어로서, 내 캐릭터를 저장·확정하거나 세션을 시작하는 요청이 클라이언트가 보낸 `playerId`가 아니라 서버가 발급한 티켓으로만 내 신원을 정하길 바란다. 그래야 다른 사람이 내 식별자를 알아내더라도 나로 행세할 수 없다.

#### Acceptance Criteria

1. WHEN the Action_Authorizer가 제시된 Connection_Ticket과 a Member_Reader로 한 요청을 인가하면, THE Action_Authorizer SHALL 그 요청의 Authenticated_Identity를 the Connection_Ticket이 묶인 Ticket_Identity에서 도출하고, 요청에 함께 온 클라이언트 공급 `Player_Id`를 신원 결정에 사용하지 않는다.
2. WHEN a Player_Acting_Endpoint가 유효한 Connection_Ticket과 함께 호출되고 그 Connection_Ticket의 Ticket_Identity가 요청의 Targeted_Identity(경로의 `:roomId`와 `:playerId`)와 정확히 일치하면, THE Playtest_Server SHALL 그 요청을 the Authenticated_Identity로 수행한다.
3. WHILE the Action_Authorizer가 한 Connection_Ticket을 인가하는 동안, THE Action_Authorizer SHALL the Connection_Ticket의 Ticket_Identity의 Player_Id가 a Member_Reader에서 여전히 그 Ticket_Identity의 Room_Id의 멤버일 때에만 그 인가를 성공으로 판정한다.
4. IF a Player_Acting_Endpoint가 Connection_Ticket 없이 또는 the Connection_Ticket_Store가 해석하지 못하는 Connection_Ticket과 함께 호출되면, THEN THE Playtest_Server SHALL 그 요청을 401 상태로 거부하고 어떤 캐릭터 데이터 기록·확정·세션 시작도 수행하지 않는다.
5. WHEN a Player_Acting_Endpoint가 the Authenticated_Identity로 수행되면, THE Playtest_Server SHALL the Authenticated_Identity의 Player_Id를 행위 주체로 사용하여 the Character_Service 또는 세션 시작을 호출한다.

### Requirement 3: 교차 플레이어·교차 방 위조 거부

**User Story:** 운영자로서, 한 플레이어에게 발급된 티켓으로 다른 플레이어나 다른 방의 행위를 인가할 수 없길 바란다. 그래야 같은 방 안에서도 플레이어 간 사칭이 불가능하다.

#### Acceptance Criteria

1. IF a Player_Acting_Endpoint가 어떤 Connection_Ticket과 함께 호출되었으나 그 Connection_Ticket의 Ticket_Identity의 Player_Id가 요청의 Targeted_Identity의 `:playerId`와 다르면, THEN THE Playtest_Server SHALL 그 요청을 403 상태로 거부하고 어떤 상태 변경도 수행하지 않는다.
2. IF a Player_Acting_Endpoint가 어떤 Connection_Ticket과 함께 호출되었으나 그 Connection_Ticket의 Ticket_Identity의 Room_Id가 요청의 Targeted_Identity의 `:roomId`와 다르면, THEN THE Playtest_Server SHALL 그 요청을 403 상태로 거부하고 어떤 상태 변경도 수행하지 않는다.
3. IF the Action_Authorizer가 한 Connection_Ticket과 a Targeted_Identity를 받고 the Connection_Ticket의 Ticket_Identity가 the Targeted_Identity와 Room_Id 또는 Player_Id에서 일치하지 않으면, THEN THE Action_Authorizer SHALL 그 인가를 실패로 판정하고 Authenticated_Identity를 산출하지 않는다.
4. WHEN the Action_Authorizer가 같은 Room_Id에 속한 두 플레이어의 Connection_Ticket을 각각 받으면, THE Action_Authorizer SHALL 한 플레이어의 Connection_Ticket으로 다른 플레이어를 Targeted_Identity로 한 요청을 인가하지 않는다.

### Requirement 4: 실시간 채널은 티켓에서 신원을 도출한다

**User Story:** 플레이어로서, 내 게임 WebSocket이 서버가 발급한 티켓으로만 내 플레이어 신원을 정하길 바란다. 그래야 방/플레이어 UUID를 아는 사람이 내 실시간 스트림을 가로채거나 나로 행세하지 못한다.

#### Acceptance Criteria

1. WHEN a Realtime_Channel 업그레이드가 유효한 Connection_Ticket과 함께 수립되면, THE Realtime_Channel SHALL 그 소켓의 플레이어 신원을 the Connection_Ticket의 Ticket_Identity에서 도출하고 클라이언트 공급 `playerId` 쿼리 파라미터를 신원 결정에 사용하지 않는다.
2. IF a Realtime_Channel 업그레이드가 Connection_Ticket 없이 또는 the Connection_Ticket_Store가 해석하지 못하는 Connection_Ticket과 함께 수립되면, THEN THE Realtime_Channel SHALL 그 연결을 인가하지 않고 닫는다.
3. WHILE a Realtime_Channel이 한 Connection_Ticket을 인가하는 동안, THE Realtime_Channel SHALL the Connection_Ticket의 Ticket_Identity의 Player_Id가 여전히 그 Room_Id의 멤버일 때에만 그 연결을 인가한다.
4. WHEN a Realtime_Channel이 the Connection_Ticket에서 도출한 신원으로 the Realtime_Gateway에 연결을 등록하면, THE Realtime_Channel SHALL 인바운드 클라이언트 메시지를 the Authenticated_Identity의 Player_Id를 행위 주체로 하여 오케스트레이터 명령으로 변환한다.

### Requirement 5: 루프백 공유 비밀 게이트는 심층 방어로 보존한다

**User Story:** 운영자로서, 기존 루프백 공유 비밀 게이트를 그대로 유지하되 그것이 플레이어 신원 검증의 유일한 수단이 되지 않길 바란다. 그래야 비용 표면 보호와 신원 위조 방지가 둘 다 성립한다.

#### Acceptance Criteria

1. WHILE a Loopback_Token_Gate가 설정되어 있는 동안, WHEN a Player_Acting_Endpoint 또는 a Realtime_Channel 업그레이드가 요청되면, THE Playtest_Server SHALL the Loopback_Token_Gate 검사를 먼저 적용하고, 그 검사가 통과한 뒤에도 별도로 Connection_Ticket 기반 신원 검증을 적용한다.
2. IF a Loopback_Token_Gate가 설정되어 있고 한 요청이 일치하는 공유 비밀을 제시하지 못하면, THEN THE Playtest_Server SHALL 그 요청을 401 상태로 거부하고 Connection_Ticket 검증을 수행하지 않는다.
3. WHERE Loopback_Token_Gate가 설정되어 있지 않은 경우(공유 비밀 미구성), THE Playtest_Server SHALL a Player_Acting_Endpoint와 a Realtime_Channel 업그레이드에 대해 Connection_Ticket 기반 신원 검증을 여전히 적용한다.
4. THE Playtest_Server SHALL the Loopback_Token_Gate(`tokenMatches`)와 바인딩 안전성 정책(`checkStartupSafety`·`resolveBinding`)의 기존 동작을 변경 없이 유지한다.

### Requirement 6: 호스트 전용·전원 확정 게이트 보존

**User Story:** 호스트로서, 신원 강화 이후에도 오직 호스트만 세션을 시작할 수 있고 전원이 캐릭터를 확정해야 시작되길 바란다. 그래야 기존 시작 규칙이 그대로 지켜진다.

#### Acceptance Criteria

1. IF the start Player_Acting_Endpoint가 the Authenticated_Identity로 수행되었으나 그 Authenticated_Identity의 Player_Id가 그 방의 Host_Player가 아니면, THEN THE Playtest_Server SHALL `NOT_HOST` 사유를 산출하고 세션을 시작하지 않는다.
2. IF the start Player_Acting_Endpoint가 the Host_Player의 Authenticated_Identity로 수행되었으나 그 방의 모든 플레이어가 캐릭터를 확정하지 않았으면, THEN THE Playtest_Server SHALL `NOT_ALL_CONFIRMED` 사유를 산출하고 세션을 시작하지 않는다.
3. WHEN the start Player_Acting_Endpoint가 the Host_Player의 Authenticated_Identity로 수행되고 그 방의 모든 플레이어가 캐릭터를 확정했으면, THE Playtest_Server SHALL 그 방의 세션을 정확히 한 번 시작한다.

### Requirement 7: 세션 종료·방 teardown 시 티켓 폐기

**User Story:** 운영자로서, 세션이 끝나거나 방이 정리되면 그 방의 티켓이 더 이상 어떤 행위도 인가하지 못하길 바란다. 그래야 폐기된 티켓이 재사용되어 사칭에 쓰이지 않는다.

#### Acceptance Criteria

1. WHEN the Connection_Ticket_Store가 한 Connection_Ticket을 폐기(Ticket_Revocation)하면, THE Connection_Ticket_Store SHALL 이후 그 Connection_Ticket을 해석할 수 없게 하여 그 Connection_Ticket이 어떤 Authenticated_Identity도 산출하지 못하게 한다.
2. WHEN the Connection_Ticket_Store가 한 Room_Id에 대한 방 단위 폐기를 수행하면, THE Connection_Ticket_Store SHALL 그 Room_Id를 Room_Id로 가진 모든 Connection_Ticket을 해석 불가능하게 만들고, 다른 Room_Id에 묶인 Connection_Ticket은 변경 없이 유지한다.
3. IF a Player_Acting_Endpoint 또는 a Realtime_Channel 업그레이드가 폐기된 Connection_Ticket과 함께 요청되면, THEN THE Playtest_Server SHALL 그 요청을 인가하지 않고(REST는 401, Realtime_Channel은 연결 닫음) 어떤 상태 변경도 수행하지 않는다.

### Requirement 8: 정상 멀티플레이 흐름 후방 호환

**User Story:** 플레이어로서, 신원 강화 이후에도 올바른 티켓을 제시하면 기존 멀티플레이 흐름(호스트 생성 → 참가 → 로비 → 캐릭터 → 확정 → 시작 → 게임)이 그대로 성공하길 바란다. 그래야 강화가 기존 플레이를 깨뜨리지 않는다.

#### Acceptance Criteria

1. WHEN 한 플레이어가 자신에게 발급된 Connection_Ticket을, 자신의 `(Room_Id, Player_Id)`를 Targeted_Identity로 한 a Player_Acting_Endpoint 요청에 제시하면, THE Playtest_Server SHALL 그 요청을 the Authenticated_Identity로 정상 수행한다.
2. WHEN the Host_Player가 자신에게 발급된 Connection_Ticket을 제시하고 그 방의 모든 플레이어가 캐릭터를 확정했으면, THE Playtest_Server SHALL the start Player_Acting_Endpoint를 통해 세션을 정상 시작한다.
3. WHEN 한 플레이어가 자신에게 발급된 Connection_Ticket으로 a Realtime_Channel에 연결하면, THE Realtime_Channel SHALL 그 소켓을 the Authenticated_Identity로 the Realtime_Gateway에 등록하여 Turn_State와 내레이션 팬아웃을 받게 한다.
4. THE Playtest_Server SHALL 본 스펙이 다루지 않는 비(非)플레이어-행위 엔드포인트(예: `GET /rooms/:id/readiness`, `GET /rooms/:id/sheet-schema`, `GET /scenarios`, `POST /solo/*`, 로비 소켓 `/lobby/ws`)의 기존 인가 동작을 변경 없이 유지한다.
