# Requirements Document

## Introduction

ready-gm은 친구들과 함께 즐기는 멀티플레이 TRPG 세션을 AI GM이 진행해 주는 웹 플랫폼입니다. 백엔드는 방 생성·초대·참가·시나리오 선택·캐릭터 생성·라운드 루프·세션 요약까지 이미 지원하지만, 현재 프론트엔드는 `public/index.html` 하나뿐이며 이는 `POST /play/new`로 방·캐릭터·세션을 한 번에 생성하는 **단일 플레이어 로컬 플레이테스트** 화면입니다. 실제 멀티플레이 흐름(초대 링크 공유, 참가, 로비, 캐릭터 생성 등)은 사용하지 않습니다.

이 스펙은 우리가 만들어야 하는 여러 프론트엔드 중 **첫 진입점인 "랜딩 / 방 생성(호스트 진입)" 화면** 하나에 집중합니다. 호스트가 서비스에 처음 도착해 자신의 방을 만들고, 친구들에게 공유할 초대 링크를 받아, 방(로비)으로 진입하기 직전까지의 경험을 다룹니다.

이 화면은 백엔드의 비실시간 REST 엔드포인트 `POST /rooms`를 사용합니다. 해당 엔드포인트는 비어 있지 않은 `displayName`을 요구하며, 성공 시 `roomId`, `inviteToken`, `inviteLink`, `hostPlayerId`, `state`, `maxPlayers`를 반환합니다.

### 범위 밖 (이 스펙에서 다루지 않음)

- 초대 링크로 들어온 게스트의 참가 흐름(`GET /rooms/:token` 해석 및 참가)
- 로비 화면(플레이어 목록, 시나리오 선택, 호스트의 세션 시작 제어)
- 캐릭터 생성, 게임 플레이 클라이언트, 세션 요약 화면
- 운영/관측 대시보드
- 기존 `POST /play/new` 단일 플레이어 플레이테스트 화면의 동작 변경

이 화면들은 후속 스펙에서 다룹니다. 다만 본 화면은 그 다음 단계(로비)로의 **인계(handoff)** 지점을 제공해야 합니다.

## Glossary

- **Host_Entry_App**: 랜딩과 방 생성을 담당하는 프론트엔드 애플리케이션. 본 스펙이 정의하는 시스템.
- **Landing_View**: 호스트가 처음 도착하는 화면 영역. 서비스를 소개하고 방 생성을 시작하는 진입점을 제공한다.
- **Room_Creation_Form**: 호스트가 표시 이름(display name)을 입력하고 방 생성을 요청하는 입력 영역.
- **Invite_Panel**: 방 생성 성공 후 초대 링크와 방 정보를 표시하고 공유·진입 동작을 제공하는 영역.
- **Host**: 방을 생성하여 해당 방의 호스트 권한을 갖는 사용자.
- **Display_Name**: 호스트가 입력하는, 방 안에서 사용할 표시 이름. 공백을 제거했을 때 한 글자 이상이어야 한다.
- **Room_Creation_Endpoint**: 백엔드의 `POST /rooms`. 비어 있지 않은 `Display_Name`을 받아 방을 만들고 `roomId`, `inviteToken`, `inviteLink`, `hostPlayerId`, `state`, `maxPlayers`를 반환한다.
- **Invite_Link**: `Room_Creation_Endpoint`가 반환한 `inviteLink`. 호스트가 친구에게 공유하여 방에 참가하게 하는 URL.
- **Access_Token**: 공개 바인딩된 서버를 보호하기 위한 공유 비밀 값. 페이지 URL의 `?token=...` 쿼리 파라미터로 전달될 수 있다.
- **Submit_Action**: 호스트가 방 생성을 확정하는 사용자 동작(버튼 클릭 또는 입력 확정).

## Requirements

### Requirement 1: 랜딩 화면 제공

**User Story:** 호스트로서, 서비스에 처음 도착했을 때 무엇을 하는 서비스인지와 방을 만드는 방법을 바로 알고 싶다. 그래야 헤매지 않고 세션을 시작할 수 있다.

#### Acceptance Criteria

1. WHEN the Host_Entry_App가 처음 로드되면, THE Landing_View SHALL ready-gm 서비스 소개 문구와 함께 Display_Name 입력 요소 및 방 생성을 시작하는 Submit_Action 요소를 한국어로 표시한다.
2. WHEN the Host_Entry_App가 처음 로드되면, THE Landing_View SHALL 방 생성을 아직 요청하지 않은 초기 상태를 표시하고, `roomId`·`inviteToken`·`inviteLink`·`hostPlayerId`·`state`·`maxPlayers`를 표시하는 Invite_Panel을 숨긴다.
3. IF 공백 제거 후의 Display_Name이 비어 있는 상태에서 Submit_Action이 수행되면, THEN THE Host_Entry_App SHALL `Room_Creation_Endpoint` 요청을 보내지 않고 Display_Name 입력이 필요하다는 한국어 안내를 표시하며 입력 값을 보존한다.
4. WHERE 페이지 URL에 `Access_Token`이 `?token=` 쿼리 파라미터로 존재하는 경우, THE Host_Entry_App SHALL 이후 `Room_Creation_Endpoint` 요청에 해당 `Access_Token`을 포함한다.

### Requirement 2: 표시 이름 입력 및 방 생성 시작

**User Story:** 호스트로서, 내 표시 이름을 입력하고 방을 만들고 싶다. 그래야 친구들과 함께할 세션 공간이 생긴다.

#### Acceptance Criteria

1. THE Room_Creation_Form SHALL Display_Name 입력 필드와 Submit_Action 요소를 표시한다.
2. WHEN the Host가 Submit_Action을 수행하면, THE Host_Entry_App SHALL 입력된 Display_Name의 앞뒤 공백을 제거한 값을 사용하고 입력 값을 보존한다.
3. IF 공백 제거 후의 Display_Name이 비어 있으면, THEN THE Host_Entry_App SHALL `Room_Creation_Endpoint` 요청을 보내지 않고 Display_Name 입력이 필요하다는 한국어 안내 메시지를 표시한다.
4. WHEN 공백 제거 후의 Display_Name이 한 글자 이상인 상태로 Submit_Action이 수행되면, THE Host_Entry_App SHALL `Room_Creation_Endpoint`에 해당 Display_Name을 담아 방 생성을 요청하고, 응답이 도착할 때까지 Submit_Action을 비활성화하여 중복 요청을 막는다.
5. WHEN `Room_Creation_Endpoint`가 성공 응답을 반환하면, THE Host_Entry_App SHALL 응답의 `roomId`와 `hostPlayerId`를 저장하고 Invite_Panel 표시 상태로 전환한다.
6. IF 방 생성 요청이 오류 응답으로 끝나거나 전송 후 10초(10000밀리초) 이내에 응답이 도착하지 않으면, THEN THE Host_Entry_App SHALL 방 생성 실패를 알리는 한국어 메시지를 표시하고 입력 값을 보존하며 Submit_Action을 다시 활성화한다.

### Requirement 3: 방 생성 요청 중 진행 상태 표시

**User Story:** 호스트로서, 방 생성 요청이 처리되는 동안 진행 중임을 알고 싶다. 그래야 중복 클릭하거나 멈춘 것으로 오해하지 않는다.

#### Acceptance Criteria

1. WHILE Submit_Action으로 시작된 `Room_Creation_Endpoint` 요청이 전송된 시점부터 응답(성공 또는 오류)이 도착하기 전까지, THE Host_Entry_App SHALL 요청 전송 후 200밀리초 이내에 진행 중임을 나타내는 시각적 인디케이터를 표시하고 응답 도착 시점까지 계속 표시한다.
2. WHILE `Room_Creation_Endpoint` 요청이 처리 중인 동안, THE Host_Entry_App SHALL 요청 전송과 동시에 Submit_Action을 비활성화 상태로 유지하여, 처리 중 발생한 추가 Submit_Action 입력이 새로운 `Room_Creation_Endpoint` 요청을 발생시키지 않도록 한다.
3. WHEN `Room_Creation_Endpoint` 요청이 성공 응답으로 완료되면, THE Host_Entry_App SHALL 진행 중 상태 인디케이터를 해제한다.
4. IF `Room_Creation_Endpoint` 요청이 오류 응답(성공이 아닌 응답) 또는 네트워크 오류로 완료되면, THEN THE Host_Entry_App SHALL 진행 중 상태 인디케이터를 해제하고, Submit_Action을 다시 활성화하며, 실패 원인을 알리는 오류 메시지를 표시하고, 호스트가 입력한 표시 이름 및 접속 토큰(`?token`) 입력 값을 유지한다.
5. IF `Room_Creation_Endpoint` 요청이 전송 후 10초(10000밀리초) 이내에 응답을 반환하지 않으면, THEN THE Host_Entry_App SHALL 해당 요청을 오류로 처리하고 진행 중 상태 인디케이터를 해제한 뒤 Submit_Action을 다시 활성화한다.

### Requirement 4: 방 생성 성공 시 초대 정보 표시

**User Story:** 호스트로서, 방이 만들어지면 친구에게 보낼 초대 링크를 받고 싶다. 그래야 사람들을 방으로 부를 수 있다.

#### Acceptance Criteria

1. WHEN `Room_Creation_Endpoint`가 방 생성 성공 응답을 반환하면, THE Host_Entry_App SHALL 응답 수신 후 1초(1000밀리초) 이내에 응답의 `inviteLink` 전체 문자열을 Invite_Panel에 표시한다.
2. WHEN `Room_Creation_Endpoint`가 방 생성 성공 응답을 반환하면, THE Invite_Panel SHALL 응답의 `maxPlayers` 정수 값을 방의 최대 인원 정보로 표시한다.
3. WHEN `Room_Creation_Endpoint`가 방 생성 성공 응답을 반환하면, THE Host_Entry_App SHALL Room_Creation_Form의 Submit_Action을 비활성 상태로 유지하고 Invite_Panel을 표시 상태로 전환한다.
4. IF `Room_Creation_Endpoint`가 오류 응답을 반환하거나 방 생성 요청 후 10초(10000밀리초) 이내에 응답이 수신되지 않으면, THEN THE Host_Entry_App SHALL Invite_Panel을 표시하지 않고, 실패 원인을 나타내는 오류 메시지를 표시하며, Room_Creation_Form의 Submit_Action을 다시 활성화한다.

### Requirement 5: 초대 링크 복사

**User Story:** 호스트로서, 초대 링크를 한 번에 복사하고 싶다. 그래야 채팅으로 빠르게 친구에게 전달할 수 있다.

#### Acceptance Criteria

1. THE Invite_Panel SHALL Invite_Link를 클립보드로 복사하는 동작 요소를 제공한다.
2. WHEN the Host가 초대 링크 복사 동작을 수행하면, THE Host_Entry_App SHALL `Room_Creation_Endpoint` 응답의 `inviteLink` 전체 문자열을 클립보드에 복사한다.
3. WHEN Invite_Link 복사가 성공하면, THE Host_Entry_App SHALL 복사 완료를 알리는 확인 메시지를 최소 3초(3000밀리초) 동안 표시한다.
4. IF Invite_Link 복사가 실패하면, THEN THE Host_Entry_App SHALL 복사 실패를 알리는 표시를 제공하고, Invite_Link 전체 문자열을 사용자가 직접 선택·복사할 수 있는 형태로 표시한다.

### Requirement 6: 로비로의 인계

**User Story:** 호스트로서, 방을 만든 뒤 내 방(로비)으로 들어가고 싶다. 그래야 친구들이 모이는 동안 세션 준비를 이어갈 수 있다.

#### Acceptance Criteria

1. WHEN `Room_Creation_Endpoint`가 `roomId`와 `hostPlayerId`를 모두 포함한 성공 응답을 반환하면, THE Invite_Panel SHALL 응답 수신 후 1초 이내에 생성된 방으로 진입하는 단일 동작 요소를 활성 상태로 표시한다.
2. WHEN the Host가 방 진입 동작을 수행하면, THE Host_Entry_App SHALL 응답의 `roomId`와 `hostPlayerId`를 후속 로비 화면이 사용할 수 있는 형태로 전달한 뒤 인계를 1회만 수행한다.
3. IF `Room_Creation_Endpoint`가 오류 응답을 반환하거나 응답에 `roomId` 또는 `hostPlayerId`가 누락되면, THEN THE Invite_Panel SHALL 방 진입 동작 요소를 비활성 상태로 유지하고 방 생성이 완료되지 않았음을 알리는 오류 표시를 제공한다.
4. WHILE the Host가 방 진입 동작을 수행하지 않은 상태이면, THE Host_Entry_App SHALL 수신한 `roomId`와 `hostPlayerId`를 변경 없이 보존한다.

### Requirement 7: 입력 검증 오류 처리

**User Story:** 호스트로서, 입력이 잘못되었을 때 무엇을 고쳐야 하는지 알고 싶다. 그래야 막힘 없이 다시 시도할 수 있다.

#### Acceptance Criteria

1. IF `Room_Creation_Endpoint`가 HTTP 400 상태로 응답하면, THEN THE Host_Entry_App SHALL 응답 수신 후 1초 이내에 Display_Name 입력란에 인접한 위치에 한국어 오류 메시지를 표시하며, 그 메시지는 Display_Name이 앞뒤 공백을 제외하고 최소 1자 이상이어야 한다는 수정 방법을 포함한다.
2. IF `Room_Creation_Endpoint`가 HTTP 400 상태로 응답하면, THEN THE Host_Entry_App SHALL 호스트가 직전에 입력한 Display_Name 값을 그대로 보존한 채 Room_Creation_Form을 편집 및 재제출이 가능한 상태로 유지하고, 다른 화면으로 이동하지 않는다.
3. WHILE 400 오류 메시지가 표시된 상태에서, WHEN 호스트가 Display_Name 입력란의 값을 변경하면, THE Host_Entry_App SHALL 해당 오류 메시지를 제거한다.

### Requirement 8: 서버·네트워크 오류 처리

**User Story:** 호스트로서, 서버나 네트워크 문제가 생기면 그 사실을 알고 다시 시도하고 싶다. 그래야 무엇이 잘못됐는지 모른 채 기다리지 않는다.

#### Acceptance Criteria

1. IF `Room_Creation_Endpoint` 요청이 네트워크 오류로 완료되지 못하거나 전송 후 30초(30000밀리초) 이내에 응답이 도착하지 않으면, THEN THE Host_Entry_App SHALL 연결 문제를 알리는 한국어 오류 메시지를 표시하고 호스트가 입력한 Display_Name 값을 보존한다.
2. IF `Room_Creation_Endpoint`가 HTTP 500 이상의 상태로 응답하면, THEN THE Host_Entry_App SHALL 서버 오류를 알리는 한국어 메시지를 표시하고 호스트가 입력한 Display_Name 값을 보존한다.
3. WHEN 방 생성 요청이 네트워크 오류 또는 HTTP 500 이상의 오류로 끝난 뒤, THE Host_Entry_App SHALL Submit_Action을 다시 활성화하여 호스트가 재시도할 수 있게 한다.
4. WHILE `Room_Creation_Endpoint` 요청이 처리 중인 동안, THE Host_Entry_App SHALL Submit_Action을 비활성 상태로 유지하여 중복 제출을 막는다.

### Requirement 9: 공유 접근 토큰 전달

**User Story:** 운영자로서, 서버를 공개로 띄울 때 공유 비밀 토큰으로 보호하고 싶다. 그래야 링크를 받은 사람만 방을 만들 수 있다.

#### Acceptance Criteria

1. WHERE 페이지 URL의 `?token=` 쿼리 파라미터에 비어 있지 않은 `Access_Token`이 존재하는 경우, THE Host_Entry_App SHALL `Room_Creation_Endpoint` 요청의 토큰 인증 헤더(`x-playtest-token`)에 해당 `Access_Token` 값을 그대로 포함하여 전송한다.
2. WHERE 페이지 URL에 `?token=` 쿼리 파라미터가 없거나 그 값이 빈 문자열인 경우, THE Host_Entry_App SHALL `Room_Creation_Endpoint` 요청을 토큰 인증 헤더 없이 전송한다.
3. WHERE 페이지 URL의 `?token=` 쿼리 파라미터에 비어 있지 않은 `Access_Token`이 존재하는 경우, THE Host_Entry_App SHALL 후속 로비 화면으로 인계할 때 해당 `Access_Token`을 함께 전달한다.

### Requirement 10: 반응형 레이아웃과 접근성

**User Story:** 호스트로서, 휴대폰이든 데스크톱이든 키보드든 편하게 방을 만들고 싶다. 그래야 어떤 환경에서도 친구들을 모을 수 있다.

#### Acceptance Criteria

1. WHERE 뷰포트 너비가 320px 이상 767px 이하인 모바일 환경인 경우, THE Host_Entry_App SHALL Landing_View, Room_Creation_Form, Invite_Panel을 가로 스크롤(수평 스크롤바)이 발생하지 않도록 세로 단일 열로 배치한다.
2. THE Room_Creation_Form SHALL Display_Name 입력 필드와 Submit_Action을 Tab 키로 순차 이동하고 Enter 또는 Space 키로 활성화할 수 있도록, DOM 표시 순서와 동일한 포커스 순서로 제공한다.
3. WHILE 키보드 포커스가 상호작용 가능한 요소에 위치한 동안, THE Host_Entry_App SHALL 해당 요소에 주변 배경과 구분되는 보이는 포커스 표시를 렌더링한다.
4. THE Host_Entry_App SHALL 상호작용 가능한 각 요소에 화면 낭독기가 읽을 수 있는, 비어 있지 않으며 요소의 역할과 목적을 식별하는 접근성 레이블을 제공한다.
5. IF Display_Name 입력이 유효하지 않은 상태에서 Submit_Action이 실행되면, THEN THE Host_Entry_App SHALL 제출을 중단하고 입력 값을 보존하며 화면 낭독기가 읽을 수 있는 유효성 오류 안내를 해당 입력 필드와 연관지어 제공한다.
