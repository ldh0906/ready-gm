---
inclusion: manual
---

# 설계 + 단계별 작업: 멀티플레이어 세션 흐름 (옵션 B)

목표 흐름(사용자 의도):

```
호스트가 방 생성(로비) → 초대 링크 공유
  → 다른 플레이어들이 초대 링크로 입장(로비 명단에 추가)
  → 호스트가 "시작"
    → 전원(호스트 포함)이 캐릭터 시트 작성 화면으로 이동
      → 각자 작성 + 확정
        → 방의 모든 플레이어가 확정되면 → 세션(게임) 시작 → 전원 게임 화면
```

이 문서는 `#multiplayer-session-flow`로 불러 단계별로 구현한다. 각 단계는 독립 커밋 가능하고
앞 단계가 끝나야 다음이 의미가 있다. 토큰 절약을 위해 한 번에 한 단계씩, 이 계획대로 진행한다.

## 현재 상태(기준선) — 무엇이 있고 없는가

있음:
- 로비 화면 `public/lobby/` + 로비 WS `/lobby/ws`(호스트 신원만 인식, 명단=호스트만).
- 게임 화면 `public/game/` + 게임 WS `/ws`.
- 캐릭터 시트 화면 `public/character/` + REST(스키마/제안/저장/확정). 확정 후 "다음 화면으로" → `/game/...` 인계.
- `CharacterService.canStart(roomId)` = 방의 모든 플레이어가 확정했는지 판정(이미 존재).
- `POST /rooms/:token/join`(REST) = 미확정 플레이어를 방에 추가(테스트용으로 추가됨).
- `RoomService.joinRoom` = 로비 게이팅·정원·이름 유니크.

없음(B에 필요):
- **초대 입장 화면**: 초대 링크는 `/join/{inviteToken}`을 가리키지만 이를 서빙하는 화면이 없다(`public/join` 부재).
- **로비의 다중 신원**: 로비 WS는 ticket 없이 roomId만 받으면 무조건 호스트로 본다. 입장한 일반 플레이어가 자기 신원으로 로비에 붙고 명단 갱신을 받는 경로가 없다.
- **세션 단계 전이 신호**: 로비 "시작"이 곧장 `START_SESSION`을 디스패치해 게임을 시작한다(캐릭터 작성 단계가 없음).
- **전원 확정 → 시작 게이트의 자동 발화**: 확정 엔드포인트가 `canStart`를 검사해 세션을 시작하지 않는다.
- `POST /rooms`(로비 생성)가 호스트를 **확정된** 캐릭터로 만든다(작성 단계를 건너뛰는 원인).

## 단계별 작업

### 단계 1 — 초대 입장 화면 `public/join/`
- `public/join/index.html` + `logic.js`(host-entry/lobby 관례 미러: 다크 테마, 순수 로직 분리, 테스트).
- URL: `/join/{inviteToken}` (express.static로 `/join/`은 index.html을 서빙하나, 경로 세그먼트 토큰을 읽으려면 라우팅 필요 — 아래 서버 작업 참조).
- 동작: 이름 입력 → `POST /rooms/:token/join` → `{roomId, playerId}` 수신 → 로비로 인계(`/lobby/?roomId&playerId&token`)하되, **일반 플레이어 신원(playerId)**으로 들어가게 한다.
- 순수 로직: 토큰 추출, 요청 빌더, 응답 분류, 빈 이름 차단, 인계 페이로드 — 속성/예제 테스트.

### 단계 2 — 서버: 초대 경로 + 로비 다중 신원
- `app.get("/join/:token", ...)`가 `public/join/index.html`을 반환(express.static은 정적 파일만 매칭하므로 명시 라우트 필요). 토큰은 클라이언트가 `location.pathname`에서 읽는다.
- 로비 WS(`/lobby/ws`) 신원 해석을 ticket 우선 + `playerId` 쿼리 허용으로 확장:
  - 입장 플레이어는 자신의 `playerId`로 로비 소켓에 접속.
  - 접속/이탈 시 `persistence.roomStore.listPlayers(room.id)` 전체를 `player_list_updated`로 **모든 로비 소켓에 브로드캐스트**(현재는 접속자에게 1회만 보냄).
- 로비 WS에 소켓↔room 매핑(룸별 소켓 집합)을 두어 브로드캐스트 가능하게 한다.

### 단계 3 — 호스트를 미확정으로 + 시작의 의미 변경
- `POST /rooms`: 호스트 캐릭터를 `confirmed:false`로 생성(또는 캐릭터를 아예 만들지 않음). 그래야 호스트도 작성 단계를 거친다.
  - 주의: `/play/new`, 게임 데모의 "즉시 시작" 가정과 분리할 것(그 경로는 건드리지 않는다).
- 로비 WS `START_SESSION` 처리: `orchestrator.dispatch(START_SESSION)` 대신
  **`character_setup` 이벤트를 룸의 모든 로비 소켓에 브로드캐스트**(게임을 아직 시작하지 않음).
- 로비 클라이언트(`public/lobby`): `character_setup` 수신 → 각자 `/character/?roomId&playerId&token`로 이동.
  - 로비 reduce/eventToAction에 `character_setup` 액션 추가 + 부수효과 네비게이션.

### 단계 4 — 전원 확정 → 세션 시작 게이트
- `POST /rooms/:roomId/players/:playerId/character/confirm` 성공 후:
  - `characterService.canStart(roomId)` 검사.
  - 참이면 `orchestrator.dispatch(roomId, { type:"START_SESSION", by: host })` 1회 디스패치(세션 시작).
- 캐릭터 화면: 확정 후 "다음 화면으로" → `/game/...`(이미 존재). 먼저 확정한 사람은 게임 화면에서 세션 활성 대기.
  - (선택) 게임 화면이 "다른 플레이어 대기 중" 상태를 표시.
- 결과: 마지막 사람이 확정하는 순간 세션이 시작되고, 게임 WS turn_state가 흐른다.

### 단계 5 — 통합 검증
- 2~3개 플레이어로 멀티 합류 시뮬레이션(REST join ×N) → 로비 명단 브로드캐스트 확인.
- 호스트 시작 → 전원 character 이동 → 각자 확정 → 마지막 확정에서 세션 시작 → 게임 turn_state.
- 단위/예제 테스트 + curl/WS 스크립트로 흐름 검증. 전체 `& npx vitest run`.

## 핵심 설계 결정(고정)
- "모든 이들"의 정의 = **방(roomStore)에 등록된 플레이어 전원**. 입장은 단계 1·2로 실제 추가된다.
- 세션 시작 발화 지점 = **확정 엔드포인트의 canStart 게이트**(단일 진실 원천). 로비 "시작"은 *작성 단계 진입* 신호일 뿐 세션을 시작하지 않는다.
- 기존 `/play/new`·`/solo/*`·게임 데모 경로는 건드리지 않는다(회귀 방지).
- 인메모리 저장이라 서버 재시작 시 방·플레이어·확정 상태가 사라진다(플레이테스트 한정).

## 변경 파일 지도
- 신규: `public/join/index.html`, `public/join/logic.js`(+테스트)
- `src/server.ts`: `/join/:token` 라우트, 로비 WS 다중 신원·브로드캐스트, `character_setup` 발화, 확정 게이트, `POST /rooms` 호스트 미확정화
- `public/lobby/logic.js` + `index.html`: `character_setup` 처리·네비게이션
- (선택) `public/game/`: 세션 시작 대기 표시
