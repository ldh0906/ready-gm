# Implementation Plan: Host_Entry_App (랜딩 / 방 생성 화면)

## Overview

기존 프로젝트 관례(빌드 단계 없는 정적 `public/*.html`, 바닐라 JS, ES 모듈, 인라인 CSS, 다크 테마)를 그대로 따른다. 순수 로직은 `public/host-entry/logic.js`(노드에서 직접 import 가능한 ES 모듈)에 모으고, `public/host-entry/index.html`은 그 모듈을 import 해 DOM 배선과 부수효과(`fetch`, `AbortController` 타임아웃, 클립보드, 네비게이션)만 담당한다.

테스트는 이미 devDependency인 `vitest` + `fast-check`로 작성한다. 설계의 Correctness Property 1~15는 각각 **정확히 하나의** 속성 기반 테스트가 되며, 최소 100회 반복(`numRuns: 100`)으로 실행하고 다음 태그를 주석으로 단다: `Feature: frontend-applications, Property {N}: {속성 텍스트}`. 시각/접근성/정적 DOM 기준은 예제·통합 테스트로 검증한다.

구현 언어/스택은 설계가 명시한 바닐라 JS(ES 모듈)이므로 별도 언어 선택은 필요하지 않다.

## Tasks

- [x] 1. 프로젝트 구조와 테스트 인프라 준비
  - [x] 1.1 `public/host-entry/logic.js` 순수 로직 모듈 스캐폴드 생성
    - `public/host-entry/` 디렉터리와 `logic.js` ES 모듈을 만든다
    - 상태 모델 상수와 타입 주석을 정의한다: `Phase`(idle/submitting/success/error), `ErrorKind`(validation/server/network/timeout)
    - 타임아웃·복사 상수 정의: `REQUEST_TIMEOUT_MS = 10000`, `COPY_CONFIRM_MS = 3000`
    - 초기 상태 팩토리 `createInitialState(token)`를 정의한다(phase=idle, displayNameInput="", token, validationMessage=null, errorKind/Message=null, success=null, copyConfirmedUntil=null, handoffDone=false)
    - 이후 단계에서 채울 순수 함수 export 스텁을 선언한다(`validateDisplayName`, `buildCreateRoomRequest`, `classifyResponse`, `classifyOutcome`, `canEnterRoom`, `buildHandoff`, `reduce`, `computeVisibility`, `renderInvitePanel`, `copyInviteLink`)
    - _Requirements: 1.2_

  - [x] 1.2 속성/DOM 테스트가 동작하도록 vitest 설정 확장
    - `vitest.config.ts`의 `include`에 `public/**/*.test.js`를 추가해 `public/host-entry`의 테스트를 인식시킨다
    - DOM 예제·통합 테스트용 경량 테스트 환경(`happy-dom`)을 devDependency로 추가한다(런타임/빌드 의존성 아님, 파일별 `// @vitest-environment happy-dom`로 지정)
    - 순수 로직 테스트는 기본 node 환경을 유지한다
    - _Requirements: 1.2_

- [x] 2. 순수 보조 함수 구현 (검증 · 요청 구성 · 분류 · 인계)
  - [x] 2.1 `validateDisplayName` 구현
    - `validateDisplayName(raw)` → `{ valid, trimmed }` 반환: 앞뒤 공백 제거 후 길이 ≥ 1이면 valid=true
    - 다양한 공백 문자(스페이스/탭/개행/전각 공백)와 빈 문자열을 무효로 처리한다
    - _Requirements: 1.3, 2.2, 2.3, 10.5_

  - [x] 2.2 `buildCreateRoomRequest` 구현
    - `buildCreateRoomRequest(trimmedName, token)` → `{ url: "/rooms", method: "POST", headers, body }`
    - 바디 `displayName`은 트림된 이름과 정확히 일치시킨다
    - `token`이 비어 있지 않으면 `x-playtest-token` 헤더에 그 값을 그대로 포함하고, 비어 있으면 해당 헤더를 포함하지 않는다(`content-type: application/json`은 항상 포함)
    - _Requirements: 1.4, 2.2, 9.1, 9.2_

  - [x]* 2.3 Property 3 속성 테스트 작성
    - **Property 3: 접근 토큰과 요청 헤더는 동치다**
    - 토큰 생성기(빈 문자열 + 임의 비공백 문자열)로 `buildCreateRoomRequest` 헤더 존재/부재를 검증
    - 태그 주석: `Feature: frontend-applications, Property 3: 접근 토큰과 요청 헤더는 동치다`, `numRuns: 100`
    - **Validates: Requirements 1.4, 9.1, 9.2**

  - [x] 2.4 `classifyResponse` 및 `classifyOutcome` 구현
    - `classifyResponse({ ok, status })` → `"success" | "validation"(400) | "server"(≥500) | "unknown"(기타 비-2xx)`
    - `classifyOutcome(...)`로 응답/네트워크오류/타임아웃을 단일 `ErrorKind` 결과로 환원한다(network, timeout 매핑 포함)
    - _Requirements: 7.1, 8.1, 8.2, 3.5_

  - [x]* 2.5 Property 7 속성 테스트 작성
    - **Property 7: HTTP 응답 상태는 오류 종류로 정확히 분류된다**
    - 상태 코드 생성기(400, 임의 4xx, 임의 5xx, 기타 비-2xx)로 분류 결과를 검증
    - 태그 주석: `Feature: frontend-applications, Property 7: HTTP 응답 상태는 오류 종류로 정확히 분류된다`, `numRuns: 100`
    - **Validates: Requirements 7.1, 8.2**

  - [x] 2.6 `canEnterRoom` 및 `buildHandoff` 구현
    - `canEnterRoom(success)` → `roomId`와 `hostPlayerId`가 모두 비어 있지 않을 때만 true
    - `buildHandoff(success, token)` → `{ roomId, hostPlayerId }`, 토큰이 비어 있지 않으면 `token` 포함
    - _Requirements: 6.1, 6.3, 6.2, 9.3_

  - [x]* 2.7 Property 10 속성 테스트 작성
    - **Property 10: 방 진입 가능 여부는 식별자 존재와 동치다**
    - 일부 필드가 누락될 수 있는 성공 페이로드 생성기로 `canEnterRoom` 동치성을 검증
    - 태그 주석: `Feature: frontend-applications, Property 10: 방 진입 가능 여부는 식별자 존재와 동치다`, `numRuns: 100`
    - **Validates: Requirements 6.1, 6.3**

- [x] 3. 상태 리듀서 `reduce` 구현
  - [x] 3.1 단방향 상태 전이 `reduce(state, action)` 구현
    - `SUBMIT`: `validateDisplayName(displayNameInput)`이 무효면 phase 불변 + `validationMessage`만 설정(요청 미발송), 유효하면 `phase="submitting"` + 오류·검증 메시지 클리어. 이미 `submitting`이면 무변화(멱등)
    - `INPUT_CHANGED`: `displayNameInput` 갱신, `validationMessage` 및 `validation` 오류 종류 제거
    - `REQUEST_SUCCEEDED`: `phase="success"`, `success` 페이로드 전체 저장
    - `REQUEST_FAILED`: `phase="error"`, `errorKind`/`errorMessage` 설정, `displayNameInput`·`token` 보존
    - `COPY_SUCCEEDED`: `copyConfirmedUntil = now + COPY_CONFIRM_MS`
    - `COPY_FAILED`: 복사 실패 표시 상태 설정
    - `ENTER_ROOM`: `handoffDone===false` 이고 `canEnterRoom(success)`일 때만 인계 1회 수행(`handoffDone=true`), 그 외 무변화
    - 각 오류 종류에 대응하는 한국어 메시지를 매핑한다(validation/server/network/timeout)
    - _Requirements: 1.3, 2.2, 2.3, 2.4, 2.5, 2.6, 3.2, 3.4, 4.4, 5.3, 6.2, 6.4, 7.2, 7.3, 8.1, 8.2, 8.3, 8.4, 10.5_

  - [x]* 3.2 Property 1 속성 테스트 작성
    - **Property 1: 공백 표시 이름은 거부되고 요청을 보내지 않는다**
    - 공백 문자열 생성기(빈 문자열 포함)로 `SUBMIT` reduce 후 phase 불변·입력 보존·검증 메시지 설정을 검증
    - 태그 주석: `Feature: frontend-applications, Property 1: 공백 표시 이름은 거부되고 요청을 보내지 않는다`, `numRuns: 100`
    - **Validates: Requirements 1.3, 2.3, 10.5**

  - [x]* 3.3 Property 2 속성 테스트 작성
    - **Property 2: 유효 제출은 트림된 이름을 전송하고 원본 입력을 보존한다**
    - 유효 이름 생성기(앞뒤 임의 공백 + 트림 후 ≥1자, 한글/비-ASCII 포함)로 `buildCreateRoomRequest` 바디=트림값, 상태 `displayNameInput`=원본 보존을 검증
    - 태그 주석: `Feature: frontend-applications, Property 2: 유효 제출은 트림된 이름을 전송하고 원본 입력을 보존한다`, `numRuns: 100`
    - **Validates: Requirements 2.2**

  - [x]* 3.4 Property 4 속성 테스트 작성
    - **Property 4: 처리 중 추가 제출은 멱등이다**
    - `submitting` 상태에서 추가 `SUBMIT` reduce 후에도 phase가 `submitting`으로 유지됨을 검증
    - 태그 주석: `Feature: frontend-applications, Property 4: 처리 중 추가 제출은 멱등이다`, `numRuns: 100`
    - **Validates: Requirements 3.2, 8.4**

  - [x]* 3.5 Property 5 속성 테스트 작성
    - **Property 5: 성공 응답은 success 단계로 전이하며 응답 데이터를 보존한다**
    - 유효 성공 페이로드 생성기로 `REQUEST_SUCCEEDED` reduce 후 phase=success 및 모든 필드 보존을 검증
    - 태그 주석: `Feature: frontend-applications, Property 5: 성공 응답은 success 단계로 전이하며 응답 데이터를 보존한다`, `numRuns: 100`
    - **Validates: Requirements 2.5**

  - [x]* 3.6 Property 6 속성 테스트 작성
    - **Property 6: 모든 실패는 동일한 회복 가능 상태로 전이한다**
    - 오류 종류(validation/server/network/timeout) × 임의 입력·토큰 상태로 `REQUEST_FAILED` reduce 후 phase=error, 패널 미표시, 입력·토큰 보존, Submit 재활성을 검증
    - 태그 주석: `Feature: frontend-applications, Property 6: 모든 실패는 동일한 회복 가능 상태로 전이한다`, `numRuns: 100`
    - **Validates: Requirements 2.6, 3.4, 4.4, 7.2, 8.1, 8.3**

  - [x]* 3.7 Property 11 속성 테스트 작성
    - **Property 11: 로비 인계는 정확히 한 번 수행되며 식별자와 토큰을 전달한다**
    - `success` 상태 + N≥1회 `ENTER_ROOM`에 대해 인계 1회만 수행, 페이로드에 `roomId`/`hostPlayerId` 포함, 토큰 비어있지 않으면 토큰 포함을 검증
    - 태그 주석: `Feature: frontend-applications, Property 11: 로비 인계는 정확히 한 번 수행되며 식별자와 토큰을 전달한다`, `numRuns: 100`
    - **Validates: Requirements 6.2, 9.3**

  - [x]* 3.8 Property 12 속성 테스트 작성
    - **Property 12: 인계 전 식별자는 불변이다**
    - `success` 상태 + `ENTER_ROOM` 제외 임의 액션 시퀀스 적용 후 `roomId`/`hostPlayerId` 불변을 검증
    - 태그 주석: `Feature: frontend-applications, Property 12: 인계 전 식별자는 불변이다`, `numRuns: 100`
    - **Validates: Requirements 6.4**

  - [x]* 3.9 Property 14 속성 테스트 작성
    - **Property 14: 복사 성공 확인 메시지는 최소 3초 표시된다**
    - 임의 `now`에 대해 `COPY_SUCCEEDED` reduce 후 `copyConfirmedUntil === now + 3000`을 검증
    - 태그 주석: `Feature: frontend-applications, Property 14: 복사 성공 확인 메시지는 최소 3초 표시된다`, `numRuns: 100`
    - **Validates: Requirements 5.3**

  - [x]* 3.10 Property 15 속성 테스트 작성
    - **Property 15: 입력 변경은 검증·오류 메시지를 제거한다**
    - `validation` 오류 표시 상태 + 임의 새 입력값으로 `INPUT_CHANGED` reduce 후 검증 메시지 제거 및 `validation` 비활성을 검증
    - 태그 주석: `Feature: frontend-applications, Property 15: 입력 변경은 검증·오류 메시지를 제거한다`, `numRuns: 100`
    - **Validates: Requirements 7.3**

- [x] 4. 뷰 모델과 Invite_Panel 렌더 구현
  - [x] 4.1 `computeVisibility(state)` 구현
    - phase로부터 가시성 도출: 진행 인디케이터는 `submitting`일 때만, Invite_Panel은 `success`일 때만 표시, Submit_Action은 `submitting`/`success`에서 비활성·그 외 활성
    - _Requirements: 1.2, 3.1, 3.3, 4.3_

  - [x]* 4.2 Property 9 속성 테스트 작성
    - **Property 9: 가시성은 단계의 함수다**
    - 임의 상태 생성기로 `computeVisibility` 출력(인디케이터/패널/Submit 비활성)이 phase와 일치함을 검증
    - 태그 주석: `Feature: frontend-applications, Property 9: 가시성은 단계의 함수다`, `numRuns: 100`
    - **Validates: Requirements 1.2, 3.1, 3.3, 4.3**

  - [x] 4.3 `renderInvitePanel(success)` 구현
    - 초대 링크 전체 문자열과 `maxPlayers` 값을 포함하는 패널 마크업 문자열을 반환한다
    - _Requirements: 4.1, 4.2_

  - [x]* 4.4 Property 8 속성 테스트 작성
    - **Property 8: Invite_Panel 렌더는 필수 방 정보를 모두 포함한다**
    - 성공 페이로드 생성기(특수문자 포함 `inviteLink`, 임의 정수 `maxPlayers`)로 렌더 출력에 링크 전체와 maxPlayers 포함을 검증
    - 태그 주석: `Feature: frontend-applications, Property 8: Invite_Panel 렌더는 필수 방 정보를 모두 포함한다`, `numRuns: 100`
    - **Validates: Requirements 4.1, 4.2**

- [x] 5. 클립보드 복사 어댑터 구현
  - [x] 5.1 `copyInviteLink` 어댑터 구현
    - `copyInviteLink(inviteLink, clipboard)` 형태로 클립보드 어댑터를 주입받아 `inviteLink` 전체 문자열을 기록하고 성공/실패를 반환한다(테스트 시 어댑터 모킹 가능)
    - _Requirements: 5.2, 5.4_

  - [x]* 5.2 Property 13 속성 테스트 작성
    - **Property 13: 복사 동작은 초대 링크 전체를 클립보드에 기록한다**
    - 임의 `inviteLink` 생성기 + 모킹된 클립보드 어댑터로 전달값이 링크 전체와 정확히 일치함을 검증
    - 태그 주석: `Feature: frontend-applications, Property 13: 복사 동작은 초대 링크 전체를 클립보드에 기록한다`, `numRuns: 100`
    - **Validates: Requirements 5.2**

- [x] 6. 정적 페이지와 부수효과 계층 배선 - 순수 로직 통합
  - 모든 순수 로직과 테스트가 통과하는지 확인하고, 의문이 생기면 사용자에게 질문한다(아래 6.x 진행 전 체크포인트).

  - [x] 6.1 `public/host-entry/index.html` 레이아웃·스타일·접근성 마크업 작성
    - 다크 테마 인라인 CSS, `<html lang="ko">`, viewport 메타를 기존 `public/index.html` 관례에 맞춰 구성한다
    - Landing_View(한국어 서비스 소개), Room_Creation_Form(Display_Name 입력 + Submit_Action), 초기 숨김 상태의 Invite_Panel(복사 버튼·방 진입 버튼·수동 복사용 readonly 링크 요소) 마크업을 만든다
    - 320~767px에서 가로 스크롤 없이 세로 단일 열이 되도록 반응형 CSS, `:focus-visible` 포커스 표시, DOM 순서와 일치하는 포커스 순서, 모든 상호작용 요소의 비어있지 않은 접근성 레이블 및 검증 안내의 `aria-describedby` 연관을 제공한다
    - `logic.js`를 `<script type="module">`로 import 한다
    - _Requirements: 1.1, 1.2, 2.1, 5.1, 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 6.2 부수효과 계층 배선 및 전체 통합
    - `?token=` 쿼리에서 `Access_Token`을 읽어 초기 상태에 주입한다
    - 액션 디스패치 → `reduce` → `computeVisibility`/`renderInvitePanel` 기반 DOM 렌더의 단방향 흐름을 배선한다
    - `buildCreateRoomRequest`로 구성한 요청을 `fetch`로 전송하고, 주입 가능한(테스트용) `AbortController` 기반 10초 타임아웃을 적용해 초과 시 요청을 취소하고 `classifyOutcome`로 `timeout` 결과를 만든다. 응답 도착 시 타이머 해제 후 `classifyResponse`/`classifyOutcome`로 결과 액션을 디스패치한다
    - `copyInviteLink` 호출, 성공 시 확인 메시지 표시·실패 시 수동 복사 폴백 노출, 방 진입 시 `buildHandoff` 페이로드로 로비 인계(1회)를 배선한다
    - _Requirements: 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3_

  - [x]* 6.3 예제 DOM 테스트 작성 (happy-dom)
    - 초기 렌더에 한국어 소개 문구·Display_Name 입력·Submit_Action 존재, 초기 Invite_Panel 숨김, 성공 패널의 복사 버튼 존재를 검증한다
    - 모든 상호작용 요소의 접근성 레이블 비어있지 않음, Tab 포커스 순서가 DOM 순서와 일치, 검증 안내의 `aria-describedby` 연관을 검증한다
    - _Requirements: 1.1, 1.2, 2.1, 5.1, 10.2, 10.4, 10.5_

  - [x]* 6.4 통합 테스트 작성 (happy-dom + fake timers)
    - 가짜 타이머로 10초 경과 시 `AbortController`가 진행 중 `fetch`를 취소하는지 검증한다
    - 클립보드 어댑터 실패 모킹 시 수동 복사용 링크 요소가 노출되는지 검증한다
    - 각 오류 종류(validation 400 / server 5xx / network)에 대응하는 한국어 메시지 문구가 표시되는지 검증한다
    - _Requirements: 3.5, 5.4, 7.1, 8.1, 8.2_

- [x] 7. 최종 체크포인트 - 모든 테스트 통과 확인
  - 모든 테스트가 통과하는지 확인하고, 의문이 생기면 사용자에게 질문한다.

## Notes

- `*`로 표시된 하위 작업은 선택 사항(테스트)이며 빠른 MVP를 위해 건너뛸 수 있다. 핵심 구현 작업은 표시되지 않는다.
- Correctness Property 1~15는 각각 하나의 속성 기반 테스트로 구현되며, 구현 직후 가까운 위치에 배치해 오류를 조기에 잡는다.
- 모든 속성 테스트는 `numRuns: 100` 이상으로 실행하고 `Feature: frontend-applications, Property {N}: {텍스트}` 태그를 주석으로 단다.
- 시각/접근성/타이머/클립보드 폴백 등 속성으로 다루지 않는 요구사항은 예제·통합 테스트(6.3, 6.4)로 검증한다.
- 각 작업은 추적성을 위해 구체적인 요구사항 절을 참조한다.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.4", "2.3"] },
    { "id": 4, "tasks": ["2.6", "2.5"] },
    { "id": 5, "tasks": ["3.1", "2.7"] },
    { "id": 6, "tasks": ["4.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10"] },
    { "id": 7, "tasks": ["4.3", "4.2"] },
    { "id": 8, "tasks": ["5.1", "4.4"] },
    { "id": 9, "tasks": ["6.1", "5.2"] },
    { "id": 10, "tasks": ["6.2"] },
    { "id": 11, "tasks": ["6.3", "6.4"] }
  ]
}
```
