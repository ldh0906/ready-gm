# Implementation Plan: 인증 신뢰 모델 강화 (auth-hardening)

## Overview

이 계획은 플레이테스트 서버(`src/server.ts`)의 신뢰 모델을, **이미 존재하는** `ConnectionTicketStore`/`authorizeConnection`(`src/realtime/connection-tickets.ts`)을 **재사용·확장**해 강화한다. 목표는 "방/플레이어 UUID만 알면 남을 사칭한다"는 사소한 사칭 구멍을 닫는 것이며, 새 인증 체계(JWT/OAuth)는 도입하지 않는다. 모든 변경은 **가산적**이고, 기존 테스트(`src/realtime/connection-tickets.test.ts`, `src/server-security.test.ts`)를 깨지 않는다(계약이 정당하게 바뀌는 부분만 갱신하고 그 이유를 작업 텍스트에 적는다).

작업은 다음 두 곳을 확장한다.

- **순수 인가·티켓 로직**(`src/realtime/connection-tickets.ts`): 방→토큰 역색인과 `revokeRoom(roomId)` 추가, Targeted_Identity 일치까지 검사하는 `authorizeAction` 추가(1~2단계는 기존 `authorizeConnection`에 위임).
- **서버 배선**(`src/server.ts`): 모든 플레이어에게 티켓 발급(`/rooms`·`/rooms/:token/join` 응답에 `connectionToken` 추가), 플레이어-행위 엔드포인트(proposal/character/confirm/start)에서 Ticket_Header로 `authorizeAction` 인가 후 신원 도출, `/ws`의 클라이언트 `playerId` 폴백 제거, 세션 종료/teardown 시 `revokeRoom` 폐기 배선. 루프백 공유 비밀 게이트는 심층 방어로 보존한다.

구현 언어/스택은 기존 코드와 동일한 **TypeScript(`src/`)** 이므로 별도 언어 선택은 필요하지 않다. 설계의 Correctness Property 1~8은 각각 **정확히 하나의** 속성 기반 테스트(`fast-check`)가 되며, 최소 100회 반복(`numRuns: 100`)으로 실행하고 다음 태그를 주석으로 단다: `Feature: auth-hardening, Property {N}: {속성 텍스트}`. HTTP 상태 매핑·`/ws` 소켓 종료·게이트웨이 등록·`NOT_HOST`/`NOT_ALL_CONFIRMED`·티켓 발급 배선·해피패스는 예제·통합 테스트로 다룬다.

> **윈도우 셸 주의**: `src/` 변경 후에는 반드시 `& npm run build`로 컴파일한 뒤 `& npx vitest run`(또는 `& npx vitest run src/`)으로 테스트한다. cmd가 명령 첫 글자를 누락하므로 모든 명령은 `& ` 접두로 시작한다.

## Tasks

- [x] 1. Connection_Ticket_Store 방 단위 폐기 확장 (`src/realtime/connection-tickets.ts`)
  - [x] 1.1 방→토큰 역색인과 `revokeRoom` 구현
    - `tickets: Map<token, ConnectionIdentity>`(기존)에 더해 `byRoom: Map<roomId, Set<token>>` 역색인을 추가한다
    - `issue(identity)`가 토큰을 `tickets`에 넣을 때 `byRoom.get(roomId)`에도 추가한다(기존 반환 동작 보존)
    - `revoke(token)`이 `tickets`에서 삭제할 때 해당 신원의 `byRoom` 엔트리에서도 토큰을 제거하고, 비면 키를 정리한다(기존 시그니처·멱등성 보존)
    - `revokeRoom(roomId): number`를 추가한다: 그 방의 모든 토큰을 `tickets`·`byRoom`에서 제거하고 폐기한 개수를 반환한다. 다른 방의 토큰은 건드리지 않는다
    - 불변식(역색인 정합성)을 보존한다: `byRoom`의 모든 토큰은 `tickets`에 존재하고, `tickets`의 모든 토큰은 자신의 Room_Id 역색인에 정확히 한 번 들어 있다
    - 기존 `resolve`·`size`·`generateToken` 주입·`ConnectionIdentity`·`RoomMembershipReader`는 변경하지 않는다
    - _Requirements: 1.4, 1.5, 7.1, 7.2_

  - [ ]* 1.2 Property 1 속성 테스트 작성
    - **Property 1: 발급·해석 라운드 트립과 티켓 고유성**
    - 임의 `(roomId, playerId)` 생성기로 `resolve(issue(id))`가 발급 신원과 동등하고, 다수 발급의 토큰 집합 크기가 발급 횟수와 같음을 검증(주입 `generateToken`으로 고유성 보장 시나리오 포함)
    - 태그 주석: `Feature: auth-hardening, Property 1: 발급·해석 라운드 트립과 티켓 고유성`, `numRuns: 100`
    - **Validates: Requirements 1.4, 1.5**

  - [ ]* 1.3 Property 5 속성 테스트 작성
    - **Property 5: 폐기된 티켓은 더 이상 인가하지 않는다**
    - 발급 토큰 생성기로 `revoke(token)` 이후 `resolve`가 `undefined`이고 `authorizeConnection`/`authorizeAction`이 `no_ticket`으로 거부하며, 이미 폐기된 토큰의 재폐기가 다른 토큰에 영향을 주지 않음(멱등)을 검증
    - 태그 주석: `Feature: auth-hardening, Property 5: 폐기된 티켓은 더 이상 인가하지 않는다`, `numRuns: 100`
    - **Validates: Requirements 7.1, 7.3**

  - [ ]* 1.4 Property 6 속성 테스트 작성
    - **Property 6: 방 단위 폐기는 대상 방만 무효화한다**
    - 여러 방에 걸친 발급 집합 + 대상 Room_Id 생성기로 `revokeRoom(roomId)` 이후 그 방 토큰은 모두 `resolve` 불가, 다른 방 토큰은 폐기 전과 동일하게 해석·인가됨을 검증
    - 태그 주석: `Feature: auth-hardening, Property 6: 방 단위 폐기는 대상 방만 무효화한다`, `numRuns: 100`
    - **Validates: Requirements 7.2, 7.3**

  - [ ]* 1.5 Property 8 속성 테스트 작성
    - **Property 8: 발급된 티켓의 역색인 정합성 불변식**
    - `issue`·`revoke`·`revokeRoom`의 임의 순열 생성기로 연산 후에도 역색인↔`tickets` 정합성 불변식이 유지되고, `revokeRoom`가 폐기한 수가 그 시점 해당 방 티켓 수와 같음을 검증
    - 태그 주석: `Feature: auth-hardening, Property 8: 발급된 티켓의 역색인 정합성 불변식`, `numRuns: 100`
    - **Validates: Requirements 7.2**

- [x] 2. Action_Authorizer — Targeted_Identity 일치 인가 (`src/realtime/connection-tickets.ts`)
  - [x] 2.1 `authorizeAction`과 `ActionAuthResult` 구현
    - `ActionAuthResult = { ok: true; identity } | { ok: false; reason: "no_ticket" | "not_a_member" | "identity_mismatch" }`를 정의한다
    - `authorizeAction(tickets, members, token, target): ActionAuthResult`를 구현한다: 1~2단계(해석 + 멤버십 재확인)는 기존 `authorizeConnection`에 위임하여 동일한 멤버십 판정을 공유하되, `authorizeConnection` 실패를 토큰 해석 여부로 `no_ticket`/`not_a_member`로 분류한다. 3단계로 `identity.roomId !== target.roomId || identity.playerId !== target.playerId`이면 `identity_mismatch`로 거부한다
    - 성공 시 산출 신원은 항상 티켓의 Ticket_Identity이며, 함수는 어떤 클라이언트 공급 `playerId`도 신원 결정에 쓰지 않는다(인가는 순수, 스토어 미변경)
    - 기존 `authorizeConnection`의 시그니처·반환 형태(`{ ok, reason: string }`)는 변경하지 않는다
    - _Requirements: 2.1, 2.3, 3.1, 3.2, 3.3, 3.4_

  - [ ]* 2.2 Property 2 속성 테스트 작성
    - **Property 2: 인가는 신원을 티켓에서 도출하고 멤버십을 재확인한다**
    - 스토어·멤버 리더 상태 + 토큰(유효/미발급/빈) + 임의 클라이언트 공급 playerId 생성기로 `authorizeConnection`/`authorizeAction`이 미해석→`no_ticket`, 비멤버→`not_a_member`, 둘 다 충족→티켓 신원 산출(전달된 클라이언트 playerId와 무관)임을 검증
    - 태그 주석: `Feature: auth-hardening, Property 2: 인가는 신원을 티켓에서 도출하고 멤버십을 재확인한다`, `numRuns: 100`
    - **Validates: Requirements 2.1, 2.3, 4.1, 4.3**

  - [ ]* 2.3 Property 3 속성 테스트 작성
    - **Property 3: Targeted_Identity 일치 인가와 불일치 거부**
    - 유효 티켓 + Targeted_Identity 생성기(일치 / roomId만 불일치 / playerId만 불일치 / 둘 다 불일치)로 `authorizeAction`이 둘 다 일치할 때만 `ok: true`(티켓 신원 산출), 어느 하나라도 다르면 `identity_mismatch`로 거부함을 검증
    - 태그 주석: `Feature: auth-hardening, Property 3: Targeted_Identity 일치 인가와 불일치 거부`, `numRuns: 100`
    - **Validates: Requirements 2.2, 3.1, 3.2, 3.3**

  - [ ]* 2.4 Property 4 속성 테스트 작성
    - **Property 4: 같은 방 안에서도 교차 플레이어 위조는 거부된다**
    - 같은 Room_Id의 서로 다른 두 플레이어 A·B와 각자 티켓 생성기로 A의 티켓 + 대상 B는 `identity_mismatch`로 거부되고 A의 티켓은 A 대상일 때만 인가됨을 검증
    - 태그 주석: `Feature: auth-hardening, Property 4: 같은 방 안에서도 교차 플레이어 위조는 거부된다`, `numRuns: 100`
    - **Validates: Requirements 3.4**

  - [ ]* 2.5 Property 7 속성 테스트 작성
    - **Property 7: 인가 결정의 결정성·멱등성**
    - 고정 스토어·멤버 상태 + 동일 입력 생성기로 `authorizeConnection`/`authorizeAction`을 2회 이상 호출해도 동일 판정·동일 사유를 산출하고 호출이 `size`·해석 결과를 변경하지 않음을 검증
    - 태그 주석: `Feature: auth-hardening, Property 7: 인가 결정의 결정성·멱등성`, `numRuns: 100`
    - **Validates: Requirements 2.1, 3.3**

- [x] 3. 모든 플레이어에게 티켓 발급 배선 (`src/server.ts`)
  - [x] 3.1 `/rooms`·`/rooms/:token/join` 발급과 응답 확장 구현
    - `POST /rooms` 핸들러에서 Host_Player 생성 직후 `connectionTickets.issue({ roomId, playerId })`를 호출하고 201 응답 본문에 `connectionToken`을 추가한다(기존 필드 보존)
    - `POST /rooms/:token/join` 핸들러에서 `roomService.joinRoom` 성공 후 그 참가 플레이어 `(result.room.id, result.player.id)`에 대해 발급하고 201 응답 본문에 `connectionToken`을 추가한다
    - `POST /play/new`는 이미 발급하므로 변경하지 않는다(요구사항 1.1 보존)
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 3.2 티켓 발급 응답 예제 테스트 작성
    - `POST /rooms`·`POST /rooms/:token/join` 응답에 비어 있지 않은 `connectionToken`이 포함되고, 그 토큰을 `connectionTickets.resolve`로 해석하면 해당 `(roomId, playerId)`가 나옴을 예제로 검증한다
    - _Requirements: 1.2, 1.3_

- [x] 4. 플레이어-행위 엔드포인트 인가 배선 (`src/server.ts`)
  - [x] 4.1 `ticketFromRequest`·`authorizePlayerAction` 헬퍼와 핸들러 적용 구현
    - `ticketFromRequest(req): string | undefined` → `x-connection-ticket` 헤더에서 토큰을 읽는다(없으면 undefined)
    - `authorizePlayerAction(req, res, roomId, playerId): ConnectionIdentity | null` → `authorizeAction(connectionTickets, persistence.roomStore, ticketFromRequest(req), { roomId, playerId })`를 호출해, `no_ticket`→401, `not_a_member`/`identity_mismatch`→403을 `res`에 쓰고 `null`을 반환하며, 성공 시 `auth.identity`를 반환한다. **거부는 어떤 서비스 호출 전에** 일어난다
    - `POST /rooms/:roomId/players/:playerId/proposal`·`.../character`·`.../character/confirm`·`.../start` 각 핸들러에서, 기존 `restAuthorized(req)`(루프백 게이트) 검사를 먼저 유지한 뒤 `authorizePlayerAction(...)`을 호출하고, `null`이면 즉시 반환한다
    - 인가 성공 시 `characterService`/세션 시작 호출에 `req.params.playerId`가 아니라 **`identity.playerId`** 를 행위 주체로 넘긴다(proposal은 신원 도출만 강제하면 됨)
    - `start` 핸들러는 인가 통과 후 기존 `NOT_HOST`(`identity.playerId !== room.hostPlayerId`)·`NOT_ALL_CONFIRMED`·`maybeStartSession` 로직을 그대로 적용한다
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 3.1, 3.2, 5.1, 5.2, 6.1, 6.2, 6.3_

  - [ ]* 4.2 인가 거부·상태 무변경 통합 테스트 작성
    - Express 핸들러를 통해 (a) 티켓 부재→401, (b) 교차 플레이어 티켓→403, (c) 교차 방 티켓→403을 검증하고, 각 거부에서 캐릭터가 기록·확정되지 않고 세션이 시작되지 않음(스토어 무변경)을 확인한다
    - _Requirements: 2.4, 3.1, 3.2_

  - [ ]* 4.3 호스트·전원 확정 게이트 보존 예제 테스트 작성
    - 인가를 통과한 비호스트 신원의 `start`가 `NOT_HOST`, 전원 미확정 시 호스트 신원의 `start`가 `NOT_ALL_CONFIRMED`, 호스트 신원 + 전원 확정 시 세션이 정확히 한 번 시작됨을 예제로 검증한다
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 5. Realtime_Channel 신원 도출 강화 (`src/server.ts`)
  - [x] 5.1 `resolveSocketIdentity` 폴백 제거 구현
    - `resolveSocketIdentity(params)`에서 클라이언트 공급 `roomId`/`playerId` 기반 폴백 경로를 제거하고, `ticket` 쿼리 파라미터를 `authorizeConnection(connectionTickets, persistence.roomStore, ticket)`로 도출한 신원만 채택한다(성공 시 `auth.identity`, 실패 시 `null`)
    - `wss.on("connection")`은 기존대로 루프백 게이트(`tokenMatches`)를 먼저 적용한 뒤 `resolveSocketIdentity`가 `null`이면 `socket.close(1008, "unauthorized")`로 닫고, 성공 시 `identity.playerId`로 `WsConnection`을 만들고 인바운드 메시지를 그 playerId로 오케스트레이터 명령에 매핑한다
    - 로비 소켓(`/lobby/ws`)·비플레이어-행위 엔드포인트는 변경하지 않는다
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 8.4_

  - [ ]* 5.2 `/ws` 인가 통합 테스트 작성
    - 티켓 없이 `/ws` 업그레이드가 닫히고, 유효 티켓으로는 도출된 신원으로 게이트웨이에 등록되어 Turn_State 팬아웃을 받음을 통합 테스트로 검증한다(클라이언트 `playerId` 쿼리는 신원에 영향 없음)
    - _Requirements: 4.1, 4.2, 4.4, 8.3_

- [x] 6. 세션 종료·방 teardown 시 티켓 폐기 배선 (`src/server.ts`)
  - [x] 6.1 `revokeRoom` 폐기 훅 배선 구현
    - 세션 종료 또는 방 teardown 지점(방 상태가 종료로 전이되거나 방이 정리되는 경로)에서 `connectionTickets.revokeRoom(roomId)`를 호출해 그 방의 모든 티켓을 폐기한다
    - 폐기 이후 동일 티켓으로 온 플레이어-행위·`/ws` 요청이 `resolve` 실패로 자동 거부됨을 보장한다(추가 분기 불필요; 4·5의 인가 경로가 처리)
    - _Requirements: 7.2, 7.3_

  - [ ]* 6.2 폐기 후 인가 거부 통합 테스트 작성
    - 방의 티켓을 `revokeRoom`로 폐기한 뒤 같은 티켓으로 온 플레이어-행위 요청이 401, `/ws` 업그레이드가 닫힘을 통합 테스트로 검증하고, 다른 방 티켓은 영향받지 않음을 확인한다
    - _Requirements: 7.2, 7.3_

- [x] 7. 체크포인트 - 빌드·테스트 통과 확인
  - `& npm run build`로 컴파일하고 `& npx vitest run`으로 전체 테스트를 실행해, 기존 `src/realtime/connection-tickets.test.ts`·`src/server-security.test.ts`가 그대로 통과하고 신규 속성·예제·통합 테스트가 모두 통과하는지 확인한다. 의문이 생기면 사용자에게 질문한다.

- [x] 8. 후방 호환 해피패스·심층 방어 회귀 (`src/server.ts` 통합)
  - [x] 8.1 정상 멀티플레이 흐름 통합 검증 배선/정리
    - 생성(`/rooms`)→참가(`/rooms/:token/join`)→캐릭터 저장/확정→호스트 시작→`/ws` 연결의 해피패스가 각 단계에서 발급받은 올바른 `connectionToken`을 제시할 때 그대로 성공하도록 배선이 정합한지 정리한다(엔드포인트 간 토큰 전달 계약 확인)
    - 루프백 게이트 미구성(`PLAYTEST_TOKEN` 미설정)에서도 티켓 인가가 여전히 적용됨을 보장한다
    - _Requirements: 5.3, 8.1, 8.2, 8.3, 8.4_

  - [ ]* 8.2 해피패스·게이트 미구성 통합 테스트 작성
    - 올바른 티켓을 단계별로 제시하는 전체 멀티플레이 해피패스가 성공함을, 그리고 `PLAYTEST_TOKEN` 미설정 시에도 티켓 없는 플레이어-행위가 401로 거부됨을 통합 테스트로 검증한다
    - _Requirements: 5.3, 8.1, 8.2, 8.3_

- [x] 9. 최종 체크포인트 - 모든 테스트 통과 확인
  - `& npm run build` 후 `& npx vitest run`을 실행해 모든 속성·예제·통합 테스트와 기존 테스트가 통과하는지 확인한다. 의문이 생기면 사용자에게 질문한다.

## Notes

- `*`로 표시된 하위 작업은 선택 사항(테스트)이며 빠른 MVP를 위해 건너뛸 수 있다. 핵심 구현 작업(번호만 있는 항목)은 건너뛰지 않는다.
- Correctness Property 1~8은 각각 정확히 하나의 속성 기반 테스트로 구현되며, 구현 직후 가까운 위치에 배치해 오류를 조기에 잡는다.
- 모든 속성 테스트는 `numRuns: 100` 이상으로 실행하고 `Feature: auth-hardening, Property {N}: {텍스트}` 태그를 주석으로 단다.
- HTTP 상태 매핑(401/403)·`/ws` 소켓 종료·게이트웨이 등록·`NOT_HOST`/`NOT_ALL_CONFIRMED`·티켓 발급 배선·해피패스·루프백 게이트 보존 등 속성으로 다루지 않는 요구사항은 예제·통합 테스트(3.2, 4.2, 4.3, 5.2, 6.2, 8.2)와 기존 회귀로 검증한다.
- 모든 변경은 가산적이다. 기존 `authorizeConnection`·`ConnectionTicketStore.issue/resolve/revoke/size`·`tokenMatches`·`checkStartupSafety`·`resolveBinding`의 동작과 비플레이어-행위 엔드포인트·로비 소켓은 변경하지 않는다.
- `src/` 변경 후에는 항상 `& npm run build` → `& npx vitest run`. cmd 첫 글자 누락 방지를 위해 모든 명령은 `& ` 접두로 시작한다.
- 각 작업은 추적성을 위해 구체적인 요구사항 절을 참조한다.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "5.1"] },
    { "id": 5, "tasks": ["5.2", "6.1"] },
    { "id": 6, "tasks": ["6.2", "7"] },
    { "id": 7, "tasks": ["8.1"] },
    { "id": 8, "tasks": ["8.2", "9"] }
  ]
}
```
