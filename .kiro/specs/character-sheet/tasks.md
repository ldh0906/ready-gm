# Implementation Plan: Character_Sheet_App (시나리오 적응형 캐릭터 시트 작성 화면)

## Overview

host-entry·room-lobby·game-play가 확립한 관례를 그대로 미러링한다(빌드 단계 없는 정적 `public/*.html`, 바닐라 JS ES 모듈, 인라인 CSS, 다크 테마, 순수 로직 분리). 순수 로직은 `public/character/logic.js`(노드에서 직접 import 가능한 ES 모듈)에 모으고, `public/character/index.html`은 그 모듈을 import 해 DOM 배선과 부수효과(`fetch` + `AbortController` 10초 타임아웃, 진행 인디케이터 200ms 타이밍, 확정 2단계 순차 전송, Next_Screen 네비게이션)만 담당한다.

테스트는 이미 devDependency인 `vitest` + `fast-check`로 작성하고, DOM 배선 테스트는 `happy-dom`(이미 devDependency) 환경에서 수행한다. `vitest.config.ts`의 `include`는 이미 `public/**/*.test.js`를 매칭한다. 설계의 Correctness Property 1~23은 각각 **정확히 하나의** 속성 기반 테스트가 되며, 최소 100회 반복(`numRuns: 100`)으로 실행하고 다음 태그를 주석으로 단다: `Feature: character-sheet, Property {N}: {속성 텍스트}`. 진행 인디케이터 200ms 타이밍·10초 타임아웃 발화·2단계 순차 전송·네비게이션·시각/접근성·정적 DOM은 예제·통합 테스트로 검증한다.

구현 언어/스택은 설계가 명시한 바닐라 JS(ES 모듈)이므로 별도 언어 선택은 필요하지 않다. 모든 외부 의존성(`fetch`, 타이머, 네비게이션, DOM)은 주입 가능하게 만들어 아직 배선되지 않은 백엔드 항목(Scenario_Sheet_Schema/Attribute_Proposal/Record_Character/Confirm_Character Endpoint)도 모킹으로 완전히 테스트한다.

## Tasks

- [x] 1. 프로젝트 구조와 테스트 인프라 준비
  - [x] 1.1 `public/character/logic.js` 순수 로직 모듈 스캐폴드 생성
    - `public/character/` 디렉터리와 `logic.js` ES 모듈을 만든다
    - 상태/오류 타입 주석을 정의한다: `AreaPhase`(idle/loading/loaded/error), `ErrorKind`(server/network/timeout/auth/invalid), `RecordRejection`(NAME_TAKEN/INVALID_ATTRIBUTES/ALREADY_CONFIRMED/UNKNOWN_PLAYER/OTHER), `LastRequest`(schema/proposal/record/confirm/null)
    - 상수 정의: `REQUEST_TIMEOUT_MS = 10000`, `DEFAULT_ATTRIBUTE_LADDER = { min: -2, max: 4 }`, `DEFAULT_RUNG_LABELS`(-2=끔찍함 … +4=탁월함), 이름 100자·기타 Narrative_Field 2000자 길이 한도
    - 한국어 사용자 메시지 상수(인계 무효, 빈 컨셉 안내, 빈 이름 안내, 저장 확인, 거부 사유별 메시지, NO_CHARACTER, 타임아웃/네트워크/서버/인증 거부 구분 메시지, 스키마 폴백 안내)를 선언한다
    - 초기 상태 팩토리 `createInitialState(handoff)`를 정의한다(handoff, handoffValid, schemaArea/schemaErrorKind/activeSchema/usingDefaultSchema, narrativeValues, traitValues, proposal/record/confirm 단계, errorKind, notice, lastRequest, confirmed, nextHandoffDone). `activeSchema` 초기값은 Default_Sheet_Schema로 둔다
    - 이후 단계에서 채울 순수 함수 export 스텁을 선언한다(`parseHandoff`, `isHandoffValid`, `buildAuthHeaders`, `buildSchemaRequest`, `buildProposalRequest`, `buildRecordRequest`, `buildConfirmRequest`, `classifyOutcome`, `classifyRecordResult`, `defaultSheetSchema`, `validateSchema`, `selectActiveSchema`, `renderModel`, `renderedTraitKeys`, `renderedFieldIds`, `renderedSectionIds`, `esc`, `isValidLevel`, `initialLevel`, `rungLabel`, `clampFieldValue`, `trimForSend`, `setTraitLevel`, `collectRatedTraitSet`, `validateProposal`, `decideConfirmStep`, `buildNextHandoff`, `buildNextSearch`, `reduce`, `computeVisibility`, `nextRequestForRetry`)
    - _Requirements: 1.1, 13.7_

  - [x] 1.2 속성/DOM 테스트가 동작하도록 vitest 설정 확인
    - `vitest.config.ts`의 `include`가 `public/**/*.test.js`를 매칭하는지 확인한다(이미 매칭하면 변경 불필요)
    - DOM 배선 테스트용 `happy-dom`이 devDependency로 존재하는지 확인하고, 파일별 `// @vitest-environment happy-dom` 지정 방식을 따른다(순수 로직 테스트는 기본 node 환경 유지)
    - 새 런타임/빌드 의존성은 추가하지 않는다
    - _Requirements: 1.1_

- [x] 2. 순수 보조 함수 구현 (인계 파싱·검증 · 토큰 헤더 · 요청 구성 · 결과/기록 분류)
  - [x] 2.1 `parseHandoff`·`isHandoffValid`·`buildAuthHeaders` 구현
    - `parseHandoff(search)` → 쿼리에서 `roomId`·`playerId`·`token`을 공백 제거 후 추출(부재 키는 `""`, 토큰은 트림 후 빈 문자열이면 `""`)
    - `isHandoffValid(handoff)` → 트림된 `roomId`와 `playerId`가 모두 비어 있지 않을 때만 true
    - `buildAuthHeaders(token)` → 토큰이 비어 있지 않으면 `{ "x-playtest-token": token }`, 아니면 `{}`
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 11.1, 11.2_

  - [x] 2.2 REST 요청 빌더 구현
    - `buildSchemaRequest(roomId, token)` → `GET /rooms/{encodeURIComponent(roomId)}/sheet-schema`
    - `buildProposalRequest(roomId, playerId, concept, traitKeys, token)` → `POST /rooms/{roomId}/players/{playerId}/proposal`, body `{ concept: trimForSend(concept), traitKeys }`
    - `buildRecordRequest(handoff, name, narrative, ratedTraitSet)` → `POST /rooms/{roomId}/players/{playerId}/character`, body `{ name: trimForSend(name), narrative: <트림된 필드 맵>, attributes: ratedTraitSet }`
    - `buildConfirmRequest(handoff)` → `POST /rooms/{roomId}/players/{playerId}/character/confirm`
    - 네 빌더 모두 `buildAuthHeaders(token)`로 헤더를 구성한다(토큰 비어 있으면 `x-playtest-token` 미포함)
    - _Requirements: 4.1, 6.1, 7.1, 7.2, 13.1, 11.1, 11.2_

  - [x]* 2.3 Property 2 속성 테스트 작성
    - **Property 2: 접근 토큰과 요청 헤더는 동치다**
    - 토큰 생성기(빈 문자열 + 특수문자 포함 임의 비공백 문자열) × 네 요청 빌더로 `x-playtest-token` 존재/부재와 값 무변형을 검증
    - 태그 주석: `Feature: character-sheet, Property 2: 접근 토큰과 요청 헤더는 동치다`, `numRuns: 100`
    - **Validates: Requirements 1.2, 1.5, 11.1, 11.2**

  - [x]* 2.4 Property 3 속성 테스트 작성
    - **Property 3: REST 요청 명세는 올바른 URL·메서드·본문을 만든다**
    - 임의 `roomId`·`playerId`·스키마·작성 값 생성기로 `buildSchemaRequest`/`buildProposalRequest`/`buildRecordRequest`/`buildConfirmRequest`의 URL(인코딩 포함)·메서드·본문(트림된 컨셉·Trait_Key 목록·트림된 이름·서사·Rated_Trait_Set)을 검증
    - 태그 주석: `Feature: character-sheet, Property 3: REST 요청 명세는 올바른 URL·메서드·본문을 만든다`, `numRuns: 100`
    - **Validates: Requirements 4.1, 6.1, 7.1, 7.2, 13.1**

  - [x] 2.5 `classifyOutcome`·`classifyRecordResult` 구현
    - `classifyOutcome({ kind, response? })` → 네트워크 실패=`network`, 타임아웃=`timeout`, HTTP 401/403=`auth`, HTTP 500~599=`server`, 2xx=`success`
    - `classifyRecordResult(outcome)` → 본문의 `reason` 필드를 우선 분류(`NAME_TAKEN`/`INVALID_ATTRIBUTES`/`ALREADY_CONFIRMED`/`UNKNOWN_PLAYER`/그 외는 `OTHER`), 전송/HTTP 오류는 `classifyOutcome`로 환원, 2xx 정상 본문은 `"success"`
    - _Requirements: 9.5, 10.1, 10.2, 10.3, 11.5, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x]* 2.6 Property 4 속성 테스트 작성
    - **Property 4: 요청 결과는 오류 종류로 정확히 환원된다**
    - 결과 생성기(2xx, 401, 403, 임의 5xx, `network`, `timeout`)로 `classifyOutcome`가 `network`/`timeout`/`auth`/`server`/`success`로 환원하고 네 오류 종류가 서로 구별됨을 검증
    - 태그 주석: `Feature: character-sheet, Property 4: 요청 결과는 오류 종류로 정확히 환원된다`, `numRuns: 100`
    - **Validates: Requirements 9.5, 10.1, 10.2, 10.3, 11.5**

- [x] 3. 스키마 엔진·렌더 모델·사다리 구현
  - [x] 3.1 `defaultSheetSchema`·`validateSchema`·`selectActiveSchema` 구현
    - `defaultSheetSchema()` → 네 Attribute_Key(Might·Agility·Wits·Spirit)를 Trait_Ladder `[-2,4]`의 Rated_Trait로, 이름(maxLength 100)·컨셉(maxLength 2000)을 Narrative_Field로, `narrative`·`attributes` 두 Sheet_Section을 갖는 결정적 스키마 반환
    - `validateSchema(body)` → Rated_Trait가 1개 이상이고 각 Rated_Trait가 Trait_Key를 가지며 이름·컨셉 Narrative_Field를 포함하는지 검증, 누락된 Trait_Ladder는 기본 `[-2,4]`로 정규화, 통과 시 `{ ok: true, schema }` 아니면 `{ ok: false }`
    - `selectActiveSchema(outcome)` → 성공+유효이면 채택 스키마, 성공+무효 또는 오류이면 `defaultSheetSchema()`를 반환(항상 정확히 하나의 유효 스키마)
    - _Requirements: 13.2, 13.5, 13.6, 13.7, 13.8_

  - [x]* 3.2 Property 6 속성 테스트 작성
    - **Property 6: Default_Sheet_Schema 구성**
    - 임의 입력과 무관하게 `defaultSheetSchema()`가 정확히 네 Attribute_Key(Trait_Ladder `[-2,4]`)와 이름(maxLength 100)·컨셉(maxLength 2000) Narrative_Field를 갖는 동일한 스키마를 반환함을 검증
    - 태그 주석: `Feature: character-sheet, Property 6: Default_Sheet_Schema 구성`, `numRuns: 100`
    - **Validates: Requirements 13.8**

  - [x]* 3.3 Property 5 속성 테스트 작성
    - **Property 5: 스키마 검증·채택과 단일 Active_Sheet_Schema 불변식**
    - 스키마 결과 생성기(성공+유효 스키마(일부 Trait_Ladder 누락 포함) / 성공+무효(Rated_Trait 0개, Trait_Key·Trait_Ladder 결여) / network·timeout·server·auth 오류)로 `selectActiveSchema`가 항상 하나의 유효 `SheetSchema`를 반환하고 유효 시 채택·무효/오류 시 Default 폴백, 누락 Trait_Ladder가 `[-2,4]`로 정규화됨을 검증
    - 태그 주석: `Feature: character-sheet, Property 5: 스키마 검증·채택과 단일 Active_Sheet_Schema 불변식`, `numRuns: 100`
    - **Validates: Requirements 13.2, 13.5, 13.6, 13.7**

  - [x] 3.4 `renderModel`·`renderedTraitKeys`·`renderedFieldIds`·`renderedSectionIds`·`esc` 구현
    - `renderModel(schema, values)` → 스키마가 정의한 Sheet_Section만, 각 섹션 안에 소속 Narrative_Field 입력·Rated_Trait 편집을 배치한 렌더 모델 반환(정의되지 않은 것은 렌더하지 않음)
    - 각 Rated_Trait 편집 요소의 선택 가능 값을 그 Trait_Ladder의 정수 집합 `[min..max]`로 제한하고, 모든 텍스트(서사 값·레이블)는 `esc`로 이스케이프
    - `renderedTraitKeys`/`renderedFieldIds`/`renderedSectionIds` → 렌더 집합 일치 검증용 식별자 배열 반환
    - `esc(value)` → host-entry의 HTML 이스케이프 패턴 재사용
    - _Requirements: 2.1, 2.2, 5.2, 13.3, 13.4, 3.4_

  - [x]* 3.5 Property 7 속성 테스트 작성
    - **Property 7: 렌더 모델은 Active_Sheet_Schema와 정확히 일치한다**
    - 스키마 생성기(임의 개수 Rated_Trait·Sheet_Section·이름/컨셉 포함 Narrative_Field)로 렌더된 Sheet_Section·Rated_Trait(Trait_Key)·Narrative_Field(식별자) 집합이 스키마 집합과 개수·식별자 모두에서 일치, 각 Rated_Trait 선택 값 집합이 Trait_Ladder 정수 집합과 일치, 모든 Narrative_Field 안내·Rated_Trait 레이블이 비어 있지 않음을 검증
    - 태그 주석: `Feature: character-sheet, Property 7: 렌더 모델은 Active_Sheet_Schema와 정확히 일치한다`, `numRuns: 100`
    - **Validates: Requirements 2.1, 2.2, 5.2, 13.3, 13.4**

  - [x]* 3.6 Property 12 속성 테스트 작성
    - **Property 12: 텍스트는 HTML로 해석되지 않게 이스케이프된다**
    - 임의 문자열(`<`·`>`·`&`·이모지 포함) 생성기로 `esc` 출력에 이스케이프되지 않은 `<`·`>`·`&`가 없고 디코드하면 원래 문자열과 같음을 검증
    - 태그 주석: `Feature: character-sheet, Property 12: 텍스트는 HTML로 해석되지 않게 이스케이프된다`, `numRuns: 100`
    - **Validates: Requirements 3.4**

  - [x] 3.7 `isValidLevel`·`initialLevel`·`rungLabel` 구현
    - `isValidLevel(level, ladder)` → `Number.isInteger(level) && ladder.min <= level <= ladder.max`
    - `initialLevel(ladder)` → 0이 사다리 안이면 0, 아니면 `ladder.min`
    - `rungLabel(level, trait)` → 기본 Attribute_Ladder `[-2,4]`이면 `DEFAULT_RUNG_LABELS` 고정 매핑, 비기본 사다리이면 스키마가 제공한 등급 레이블
    - _Requirements: 2.3, 2.5, 5.1, 5.5_

  - [x]* 3.8 Property 8 속성 테스트 작성
    - **Property 8: 초기 Trait_Level**
    - 0을 포함/불포함하는 임의 정수 구간 `[min,max]`(min ≤ max) 생성기로 `initialLevel`이 0이 사다리 안이면 0, 아니면 `min`을 반환함을 검증
    - 태그 주석: `Feature: character-sheet, Property 8: 초기 Trait_Level`, `numRuns: 100`
    - **Validates: Requirements 2.3**

  - [x]* 3.9 Property 9 속성 테스트 작성
    - **Property 9: Trait_Level → Ladder_Rung_Label 매핑**
    - 기본 사다리 `[-2,4]`와 비기본 사다리(등급 레이블 제공) 생성기로 `rungLabel`이 기본 사다리에서는 고정 매핑(-2=끔찍함 … +4=탁월함), 비기본 사다리에서는 스키마 제공 레이블을 반환함을 검증
    - 태그 주석: `Feature: character-sheet, Property 9: Trait_Level → Ladder_Rung_Label 매핑`, `numRuns: 100`
    - **Validates: Requirements 2.5**

- [x] 4. 서사·평가·제안·확정·인계 보조 함수 구현
  - [x] 4.1 `clampFieldValue`·`trimForSend` 구현
    - `clampFieldValue(value, maxLength)` → 입력을 앞뒤 공백 포함 그대로 보존하되 길이만 제한(이름 100 / 기타 2000)
    - `trimForSend(value)` → 앞뒤 공백만 제거하고 내부 공백 보존
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6_

  - [x]* 4.2 Property 11 속성 테스트 작성
    - **Property 11: 전송 정규화는 내부 공백을 보존한다**
    - 앞뒤 공백·내부 공백 포함 임의 문자열 생성기로 `trimForSend`가 앞뒤 공백만 제거하고 내부 공백을 모두 보존함을 검증
    - 태그 주석: `Feature: character-sheet, Property 11: 전송 정규화는 내부 공백을 보존한다`, `numRuns: 100`
    - **Validates: Requirements 3.3**

  - [x] 4.3 `setTraitLevel`·`collectRatedTraitSet` 구현
    - `setTraitLevel(values, schema, traitKey, level)` → 지정 값이 해당 Trait_Ladder 안 정수이면 그 Trait_Key만 갱신한 새 맵, 무효(사다리 밖·비정수)이면 입력 맵 그대로 반환
    - `collectRatedTraitSet(values, schema)` → 스키마가 정의한 각 Trait_Key의 Trait_Level을 변형 없이 그대로 담은 Rated_Trait_Set 반환
    - _Requirements: 5.1, 5.4, 5.5_

  - [x]* 4.4 Property 15 속성 테스트 작성
    - **Property 15: 평가 편집은 해당 항목만 갱신하고 무효 값은 거부한다**
    - 현재 Trait_Level 맵 + 임의 Trait_Key·지정 값(유효/사다리 밖/비정수) 생성기로 `setTraitLevel`이 유효 값이면 해당 키만 갱신·나머지 불변, 무효 값이면 맵 전체 불변임을 검증
    - 태그 주석: `Feature: character-sheet, Property 15: 평가 편집은 해당 항목만 갱신하고 무효 값은 거부한다`, `numRuns: 100`
    - **Validates: Requirements 5.1, 5.5**

  - [x]* 4.5 Property 16 속성 테스트 작성
    - **Property 16: Rated_Trait_Set은 변형 없이 수집된다**
    - 스키마와 일관된 임의 Trait_Level 한 벌 생성기로 `collectRatedTraitSet`이 각 Trait_Key에 대해 표시된 Trait_Level을 변형 없이 그대로 담음을 검증
    - 태그 주석: `Feature: character-sheet, Property 16: Rated_Trait_Set은 변형 없이 수집된다`, `numRuns: 100`
    - **Validates: Requirements 5.4**

  - [x] 4.6 `validateProposal` 구현
    - `validateProposal(body, schema)` → 본문이 스키마의 모든 Rated_Trait에 대한 값을 담고 각 값이 해당 Trait_Ladder 안 정수일 때만 `{ ok: true, values }`, 하나라도 누락·사다리 밖·비정수이면 `{ ok: false }`
    - _Requirements: 4.3, 4.5_

  - [x] 4.7 `decideConfirmStep` 구현
    - `decideConfirmStep(recordResult)` → `success`면 `send-confirm`, `NAME_TAKEN`/`INVALID_ATTRIBUTES`면 `blocked-rejection`, `ALREADY_CONFIRMED`면 `blocked-already-confirmed`
    - _Requirements: 7.2, 7.3, 7.4_

  - [x] 4.8 `buildNextHandoff`·`buildNextSearch` 구현
    - `buildNextHandoff(handoff)` → `{ roomId, playerId }`, 토큰이 비어 있지 않으면 `token` 포함(변형 없이)
    - `buildNextSearch(handoff)` → `?roomId=…&playerId=…&token=…`(토큰은 비어 있지 않을 때만) 쿼리 문자열
    - _Requirements: 8.2, 11.3, 11.4_

- [x] 5. 상태 리듀서와 재시도 구성 구현
  - [x] 5.1 단방향 상태 전이 `reduce(state, action)` 구현
    - `HANDOFF_PARSED`: `handoff` 저장, `isHandoffValid`로 `handoffValid` 설정. 무효면 어떤 요청 단계도 `loading`으로 진입하지 않고 모든 작성 컨트롤을 비활성으로 둔다
    - `SCHEMA_STARTED`/`PROPOSAL_STARTED`/`RECORD_STARTED`/`CONFIRM_STARTED`: 해당 단계 `phase="loading"`
    - `SCHEMA_RESOLVED`: `selectActiveSchema(outcome)`로 Active_Sheet_Schema 채택, `traitValues`를 각 Rated_Trait의 `initialLevel`로 재구성, 오류/무효이면 `usingDefaultSchema=true`+폴백 안내
    - `NARRATIVE_CHANGED`: `clampFieldValue`로 길이 제한 후 입력 그대로 보존
    - `TRAIT_CHANGED`: `setTraitLevel`로 유효 값이면 해당 키만 갱신, 무효면 불변
    - `PROPOSAL_SUCCEEDED`: `validateProposal` 통과 시 `traitValues`를 제안 값으로 갱신(편집 가능 유지), 실패 시 기존 값 유지 + `invalid` 안내 / `PROPOSAL_BLANK_CONCEPT`: 요청 미전송 + 컨셉 입력 안내
    - `RECORD_RESULT`: `success`면 저장 확인 + 비확정 유지, 거부 사유별 메시지 + 입력 보존, `ALREADY_CONFIRMED`만 `confirmed=true` / `SAVE_BLANK_NAME`: 요청 미전송 + 이름 안내 + 입력 보존
    - `CONFIRM_RECORD_RESULT`: `success`면 확정 단계로, `NAME_TAKEN`/`INVALID_ATTRIBUTES`면 확정 미전송 + 메시지, `ALREADY_CONFIRMED`면 확정 미전송 + `confirmed=true` / `CONFIRM_BLANK_NAME`: 기록·확정 모두 미전송 + 이름 안내 + 입력 보존
    - `CONFIRM_RESULT`: `success`면 `confirmed=true`, `NO_CHARACTER`면 `confirmed` 불변 + 메시지 + 입력 보존
    - `*_FAILED`: 해당 단계 `error`, `errorKind`·`lastRequest` 설정, **인계 식별자·토큰·플레이어 입력 보존**, `auth`는 별도 메시지
    - `NEXT_HANDOFF`: `confirmed===true && nextHandoffDone===false`일 때만 `nextHandoffDone=true`(인계 1회), 그 외 무변화
    - 각 오류 종류·거부 사유에 대응하는 한국어 메시지를 매핑한다
    - _Requirements: 1.3, 1.4, 13.2, 13.5, 13.6, 13.7, 3.1, 3.2, 3.5, 3.6, 5.1, 5.5, 4.2, 4.3, 4.4, 4.5, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.3, 8.4, 10.5, 11.5_

  - [x] 5.2 `nextRequestForRetry` 구현
    - `nextRequestForRetry(state)` → 보존된 입력으로 `lastRequest`에 해당하는 직전 실패 요청 명세를 `build*Request`로 1회 재구성(없으면 `null`)
    - _Requirements: 10.6_

  - [x]* 5.3 Property 1 속성 테스트 작성
    - **Property 1: 인계 파싱과 검증, 무효 시 요청 차단**
    - 인계 생성기(앞뒤 임의 공백·공백만·키 부재 조합)로 `parseHandoff` 트림 추출·`isHandoffValid` 동치를 검증하고, 무효 인계 `HANDOFF_PARSED` reduce 후 어떤 요청 단계도 `loading`이 아님을 검증
    - 태그 주석: `Feature: character-sheet, Property 1: 인계 파싱과 검증, 무효 시 요청 차단`, `numRuns: 100`
    - **Validates: Requirements 1.1, 1.3**

  - [x]* 5.4 Property 10 속성 테스트 작성
    - **Property 10: 서사 입력은 그대로 보존되고 길이만 제한된다**
    - Narrative_Field 식별자 + 임의 입력 문자열(앞뒤 공백·한도 100/2000 경계 포함) 생성기로 `NARRATIVE_CHANGED` reduce 후 보존 값이 길이 제한 결과와 정확히 일치하고 한도 미만 입력은 앞뒤 공백 포함 입력과 동일함을 검증
    - 태그 주석: `Feature: character-sheet, Property 10: 서사 입력은 그대로 보존되고 길이만 제한된다`, `numRuns: 100`
    - **Validates: Requirements 3.1, 3.2, 3.5, 3.6**

  - [x]* 5.5 Property 13 속성 테스트 작성
    - **Property 13: 제안 요청과 빈 컨셉 차단**
    - Active_Sheet_Schema + 컨셉 문자열 생성기(공백만/비어있지 않음)로 컨셉 트림 길이 ≥1이면 `buildProposalRequest` 본문에 트림된 컨셉과 모든 Trait_Key가 포함되고, 트림 길이 0이면 제안 미전송 + 컨셉 입력 안내 전이임을 검증
    - 태그 주석: `Feature: character-sheet, Property 13: 제안 요청과 빈 컨셉 차단`, `numRuns: 100`
    - **Validates: Requirements 4.1, 4.2**

  - [x]* 5.6 Property 14 속성 테스트 작성
    - **Property 14: 제안 응답 검증과 적용**
    - 스키마 + 제안 응답 본문 생성기(모든 Trait_Key에 사다리 안 정수=유효 / 일부 누락·사다리 밖·비정수=무효)로 `validateProposal` 판정과 `PROPOSAL_SUCCEEDED` reduce 후 유효 시 모든 Trait_Level 갱신·무효 시 기존 값 불변을 검증
    - 태그 주석: `Feature: character-sheet, Property 14: 제안 응답 검증과 적용`, `numRuns: 100`
    - **Validates: Requirements 4.3, 4.5**

  - [x]* 5.7 Property 17 속성 테스트 작성
    - **Property 17: 기록 결과 분류는 상태를 정확히 전이하고 입력을 보존한다**
    - 기록 결과 생성기(success + 5개 거부 사유)로 `classifyRecordResult`+`RECORD_RESULT` reduce 후 성공은 저장 확인·비확정 유지, 모든 거부는 Narrative_Field·Rated_Trait_Set 보존, `ALREADY_CONFIRMED`만 Confirmed_State 표시임을 검증
    - 태그 주석: `Feature: character-sheet, Property 17: 기록 결과 분류는 상태를 정확히 전이하고 입력을 보존한다`, `numRuns: 100`
    - **Validates: Requirements 6.3, 6.4, 6.5, 6.6, 6.7, 6.8**

  - [x]* 5.8 Property 18 속성 테스트 작성
    - **Property 18: 빈 이름은 저장·확정을 차단하고 입력을 보존한다**
    - 트림 길이 0인 이름 + 임의 작성 상태 생성기로 Save_Action/Confirm_Action 시도 시 Record·Confirm 요청 모두 미전송 + 이름 안내 전이 + 모든 입력(Narrative_Field·Rated_Trait_Set) 보존을 검증
    - 태그 주석: `Feature: character-sheet, Property 18: 빈 이름은 저장·확정을 차단하고 입력을 보존한다`, `numRuns: 100`
    - **Validates: Requirements 6.2, 7.6**

  - [x]* 5.9 Property 19 속성 테스트 작성
    - **Property 19: 확정은 기록 성공 시에만 진행된다**
    - 선행 기록 결과 생성기로 `decideConfirmStep`이 success→`send-confirm`, `NAME_TAKEN`/`INVALID_ATTRIBUTES`→`blocked-rejection`, `ALREADY_CONFIRMED`→`blocked-already-confirmed`를 반환하고, `CONFIRM_RESULT`가 `NO_CHARACTER`이면 Confirmed_State 비전이·입력 보존임을 검증
    - 태그 주석: `Feature: character-sheet, Property 19: 확정은 기록 성공 시에만 진행된다`, `numRuns: 100`
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5**

  - [x]* 5.10 Property 20 속성 테스트 작성
    - **Property 20: 확정 성공은 작성 상태를 잠근다**
    - 임의 작성 상태에서 `CONFIRM_RESULT`가 `success`이면 reduce 후 `confirmed===true`가 되고 `computeVisibility`가 모든 Narrative_Field 입력·Rated_Trait 편집·Propose_Action·Save_Action을 비활성(읽기 전용)으로 도출함을 검증
    - 태그 주석: `Feature: character-sheet, Property 20: 확정 성공은 작성 상태를 잠근다`, `numRuns: 100`
    - **Validates: Requirements 7.7, 7.8**

  - [x]* 5.11 Property 21 속성 테스트 작성
    - **Property 21: Next_Screen 인계 페이로드와 1회 인계**
    - 인계 값 + 임의 횟수(N≥1) `NEXT_HANDOFF` 생성기로 `buildNextHandoff`/`buildNextSearch`가 `roomId`·`playerId`(+비어있지 않은 토큰)를 포함, `confirmed===true`이면 `nextHandoffDone`이 한 번만 false→true 전이, `confirmed===false`이면 미인계, 어느 경우에도 `handoff` 불변임을 검증
    - 태그 주석: `Feature: character-sheet, Property 21: Next_Screen 인계 페이로드와 1회 인계`, `numRuns: 100`
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 11.3, 11.4**

  - [x]* 5.12 Property 22 속성 테스트 작성
    - **Property 22: 복구 가능 오류는 입력을 보존하고 동일 입력 재시도를 허용한다**
    - 임의 작성 상태 + 임의 전송 오류(`timeout`/`network`/`server`/`auth`) 생성기로 `*_FAILED` reduce 후 `handoff`·Narrative_Field·Rated_Trait_Set 불변, `lastRequest` 기록, `nextRequestForRetry`가 동일 보존 입력으로 직전 요청을 1회 재구성함을 검증
    - 태그 주석: `Feature: character-sheet, Property 22: 복구 가능 오류는 입력을 보존하고 동일 입력 재시도를 허용한다`, `numRuns: 100`
    - **Validates: Requirements 10.5, 10.6, 11.5**

- [x] 6. 뷰 모델 가시성 구현
  - [x] 6.1 `computeVisibility(state)` 구현
    - 인계 무효이면 모든 작성 컨트롤 비활성, 유효·비확정이면 Narrative_Field 입력·Rated_Trait 편집·Propose/Save/Confirm 활성
    - 어느 요청 단계(schema/proposal/record/confirm)가 `loading`이면 그 진행 인디케이터 표시 + Propose/Save/Confirm 비활성, 모든 단계가 `loading`을 벗어나면 인디케이터 해제·재활성(확정 성공 시 잠금 규칙 우선)
    - 오류로 종료된 요청에 동일 입력 재시도 동작 활성, Next_Screen 진입 동작은 `confirmed===true`일 때만 활성
    - _Requirements: 1.4, 2.4, 4.4, 5.3, 8.1, 8.4, 9.2, 9.3, 9.4, 10.4, 13.9_

  - [x]* 6.2 Property 23 속성 테스트 작성
    - **Property 23: 가시성은 상태의 함수다**
    - 임의 상태 생성기(인계 유효/무효, 각 단계 idle/loading/loaded/error, confirmed true/false)로 `computeVisibility`가 (a) 인계 무효 시 작성 컨트롤 비활성·유효·비확정 시 활성, (b) loading 단계 인디케이터 표시 + 동작 비활성, (c) 오류 시 재시도 활성, (d) Next 진입은 confirmed일 때만 활성을 도출함을 검증
    - 태그 주석: `Feature: character-sheet, Property 23: 가시성은 상태의 함수다`, `numRuns: 100`
    - **Validates: Requirements 1.4, 2.4, 4.4, 5.3, 8.1, 9.2, 9.3, 9.4, 10.4, 13.9**

- [x] 7. 정적 페이지와 부수효과 계층 배선 - 순수 로직 통합
  - 모든 순수 로직과 테스트가 통과하는지 확인하고, 의문이 생기면 사용자에게 질문한다(아래 7.x 진행 전 체크포인트).

  - [x] 7.1 `public/character/index.html` 레이아웃·스타일·접근성 마크업 작성
    - 다크 테마 인라인 CSS, `<html lang="ko">`, viewport 메타를 기존 `public/index.html`·sibling 관례에 맞춰 구성한다
    - Character_Sheet_View 영역 마크업: 인계 무효 안내 영역, 스키마 폴백 안내, Sheet_Section 컨테이너(서사 입력·평가 편집을 동적 렌더할 마운트 지점), 영역별 진행 인디케이터, Propose_Action·Save_Action·Confirm_Action·Next_Screen 진입·재시도 버튼, 오류/상태 메시지 라이브 영역(`aria-live`)을 만든다
    - 320~767px에서 가로 스크롤 없이 세로 단일 열, 768px 이상 전체 표시, `:focus-visible` 포커스 표시(명도 대비 3:1), DOM 순서와 일치하는 포커스 순서, 모든 상호작용 요소의 비어있지 않은 접근성 레이블을 제공한다
    - `logic.js`를 `<script type="module">`로 import 한다
    - _Requirements: 1.4, 2.4, 3.4, 12.1, 12.2, 12.4, 12.5, 12.6, 12.7_

  - [x] 7.2 부수효과 계층 배선 및 전체 통합
    - `parseHandoff(location.search)`로 인계를 읽어 초기 상태에 주입하고, 무효이면 안내 표시 후 어떤 백엔드 요청도 시작하지 않는다
    - 액션 디스패치 → `reduce` → `computeVisibility`/`renderModel` 기반 DOM 렌더의 단방향 흐름을 배선한다
    - 유효 인계 시 `buildSchemaRequest`로 Scenario_Sheet_Schema를 조회하고 `SCHEMA_RESOLVED`로 Active_Sheet_Schema를 채택해 시트를 동적 렌더한다
    - 각 REST 요청(스키마/제안/기록/확정)을 `build*Request`로 구성해 `fetch`로 전송하고, 주입 가능한 `AbortController` 기반 10초 타임아웃을 적용해 초과 시 취소하고 `classifyOutcome`로 `timeout`을 만든다. 응답 시 타이머 해제 후 `classifyOutcome`/`classifyRecordResult`/`validateProposal`/`validateSchema`로 결과 액션을 디스패치한다
    - 전송 200ms 이내 진행 인디케이터 표시·완료 200ms 이내 해제, 인디케이터 동안 Propose/Save/Confirm 비활성을 배선한다
    - Confirm_Action은 먼저 `buildRecordRequest`로 기록 후 `decideConfirmStep` 결과가 `send-confirm`일 때만 `buildConfirmRequest`로 확정을 전송하는 2단계 순차 흐름을 배선한다
    - 확정 성공 시 Next_Screen 진입 동작을 활성화하고, 진입 시 `buildNextSearch`로 구성한 쿼리로 Next_Screen에 1회 인계(`NEXT_HANDOFF`)한다
    - 전송 오류 시 `nextRequestForRetry`로 동일 입력 재시도 동작을 배선한다
    - _Requirements: 1.2, 1.3, 4.1, 4.3, 4.4, 4.5, 5.1, 6.1, 6.3, 7.1, 7.2, 7.7, 8.1, 8.2, 8.3, 9.1, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.6, 11.1, 11.3, 11.5, 13.1, 13.6, 13.9_

  - [x]* 7.3 예제 DOM 테스트 작성 (happy-dom)
    - Default_Sheet_Schema 렌더 시 네 능력치 편집·이름/컨셉 입력·Propose/Save/Confirm/Next 버튼 존재, 초기 비활성 규칙, 한국어 메시지 문구(타임아웃·네트워크·서버·인증 거부 구분, 빈 컨셉·빈 이름 안내, NO_CHARACTER, 스키마 폴백)를 검증한다
    - 모든 상호작용 요소의 접근성 레이블 비어있지 않음, Tab 포커스 순서가 DOM 순서와 일치하고 비활성·읽기전용 제외, Enter/Space 활성화, 오류/상태 메시지의 `aria-live` 라이브 영역 제공을 검증한다
    - _Requirements: 10.1, 10.2, 10.3, 11.5, 12.2, 12.3, 12.5, 12.6_

  - [x]* 7.4 통합 테스트 작성 (happy-dom + fake timers + 가짜 fetch/네비게이터)
    - 가짜 타이머로 10초 경과 시 `AbortController`가 진행 중 `fetch`를 취소하는지, 전송 200ms 이내 인디케이터 표시·완료 200ms 이내 해제 타이밍을 검증한다
    - 확정 2단계 순차 전송(기록 성공 후에만 확정 요청 전송, 기록 거부 시 확정 미전송)을 검증한다
    - 가짜 네비게이터로 확정 후 Next_Screen으로 실제 쿼리 인계가 1회만 일어나는지, 재시도 동작이 보존 입력으로 직전 요청을 1회 재전송하는지 검증한다
    - 동적 스키마 렌더(유효 스키마 채택 시 그 구성, 오류/무효 시 Default 폴백 + 안내)를 검증한다
    - _Requirements: 5.1, 7.1, 7.2, 8.2, 9.1, 9.4, 9.5, 10.1, 10.6, 13.6, 13.9_

- [x] 8. 최종 체크포인트 - 모든 테스트 통과 확인
  - 모든 테스트가 통과하는지 확인하고, 의문이 생기면 사용자에게 질문한다.

## Notes

- `*`로 표시된 하위 작업은 선택 사항(테스트)이며 빠른 MVP를 위해 건너뛸 수 있다. 핵심 구현 작업은 표시되지 않는다.
- Correctness Property 1~23은 각각 하나의 속성 기반 테스트로 구현되며, 구현 직후 가까운 위치에 배치해 오류를 조기에 잡는다. 리듀서·가시성에 의존하는 속성(1·10·13·14·17·18·19·20·21·22·23)은 `reduce`/`computeVisibility` 구현 직후 에픽 5·6에 모은다.
- 모든 속성 테스트는 `numRuns: 100` 이상으로 실행하고 `Feature: character-sheet, Property {N}: {텍스트}` 태그를 주석으로 단다.
- 진행 인디케이터 200ms 타이밍·10초 타임아웃 발화·확정 2단계 순차·Next_Screen 네비게이션·시각/접근성·정적 DOM·오류 문구 구분 등 속성으로 다루지 않는 요구사항은 예제·통합 테스트(7.3, 7.4)로 검증한다.
- 모든 외부 의존성(`fetch`, 타이머, 네비게이션, DOM)은 주입 가능하게 만들어 아직 배선되지 않은 백엔드 항목도 모킹으로 완전히 테스트한다.
- 각 작업은 추적성을 위해 구체적인 요구사항 절을 참조한다.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.5", "2.3", "2.4"] },
    { "id": 4, "tasks": ["3.1", "2.6"] },
    { "id": 5, "tasks": ["3.4", "3.2", "3.3"] },
    { "id": 6, "tasks": ["3.7", "3.5", "3.6"] },
    { "id": 7, "tasks": ["4.1", "3.8", "3.9"] },
    { "id": 8, "tasks": ["4.3", "4.2"] },
    { "id": 9, "tasks": ["4.6", "4.4", "4.5"] },
    { "id": 10, "tasks": ["4.7"] },
    { "id": 11, "tasks": ["4.8"] },
    { "id": 12, "tasks": ["5.1"] },
    { "id": 13, "tasks": ["5.2"] },
    { "id": 14, "tasks": ["6.1"] },
    { "id": 15, "tasks": ["5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "5.9", "5.10", "5.11", "5.12", "6.2"] },
    { "id": 16, "tasks": ["7.1"] },
    { "id": 17, "tasks": ["7.2"] },
    { "id": 18, "tasks": ["7.3", "7.4"] }
  ]
}
```
