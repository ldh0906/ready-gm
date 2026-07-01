# Implementation Plan: 시나리오 캐릭터 카드 (scenario-character-cards)

## Overview

이 계획은 직전에 병합된 `flexible-stat-allocation` 확장 **위에 가산적으로(additive)** 쌓아 두 가지 횡단 관심사를 구현한다. 기존 `character-sheet`·`flexible-stat-allocation` 스펙의 관례를 그대로 미러링한다(빌드 단계 없는 정적 `public/*.html`, 바닐라 JS ES 모듈, 순수 로직 분리, 백엔드는 `src/services/` TypeScript, vitest + fast-check, happy-dom, 서버 측 무작위 주입).

1. **능력치 없는 시나리오에서 능력치 UI 감추기**: 시트 스키마(Active_Sheet_Schema)에 정확히 하나의 `attributeProposalSupported` 불리언을 실어, 거짓이면 화면이 Propose_Action(`#proposeBtn`)·Stat_Setting_Section을 표시하지 않고 제안 요청도 전송하지 않게 한다.
2. **캐릭터 카드(Character_Card) 기반 작성**: 시트 스키마에 `characterCards?: CharacterCard[]`를 실어, 플레이어가 그중 정확히 하나(Selected_Card)를 고르고 그 위에 배경 서사(Backstory_Field)를 적게 한다. 카드 선택은 프론트엔드·백엔드가 동일하게 검증(검증 패리티)하며, 카드 기반 시트에서 카드를 고르지 않으면 `INVALID_CARD`로 거부된다.

작업은 다음 네 곳을 확장하되 기존 `allocation` 경로·기존 거부 사유와 충돌하지 않는다(독립 경로).
- **백엔드 스키마 해석기**(`src/services/sheet-schema.ts`): `CharacterCard` 타입과 `SheetSchema`의 `attributeProposalSupported`(필수)·`characterCards`(선택) 추가, 도출 규칙·카드 부착·기존 시트 보존.
- **백엔드 서비스**(`src/services/character-service.ts`): `recordCharacter`의 카드 검증 → `INVALID_CARD`, 검증 순서(`ALREADY_CONFIRMED` 우선) 보존.
- **프론트엔드 순수 로직**(`public/character/logic.js`): `validateCardSelection`·`isCardBasedSheet`·`validateCardList`·`cardListModel`·`selectCard`, `validateSchema`/`selectActiveSchema`/`computeVisibility`/`renderModel`/`reduce`/`classifyRecordResult` 확장, 신규 한국어 메시지.
- **정적 페이지**(`public/character/index.html`): 카드 목록 단일 선택·배경 서사 렌더, 제안 버튼·능력치 영역 숨김, `INVALID_CARD` 안내, 확정 잠금 배선.

구현 언어/스택은 설계가 명시한 바닐라 JS(ES 모듈, 프론트)와 TypeScript(`src/services`, 백엔드)이므로 별도 언어 선택은 필요하지 않다. 모든 외부 의존성(`fetch`, 타이머, DOM)은 주입 가능하게 만들어 아직 배선되지 않은 의도된 엔드포인트도 모킹/주입으로 완전히 테스트한다.

설계의 Correctness Property 1~19는 각각 **정확히 하나의** 속성 기반 테스트(`fast-check`)가 되며, 최소 100회 반복(`numRuns: 100`)으로 실행하고 다음 태그를 주석으로 단다: `Feature: scenario-character-cards, Property {N}: {속성 텍스트}`. **검증 패리티(Property 12)** 는 프론트엔드 `validateCardSelection`과 백엔드 카드 검증기를 같은 테스트에서 import 해 동일 생성 입력으로 대조한다. 200ms 선택 해제 타이밍·제안 요청 미전송의 실제 fetch 차단·DOM 표시/숨김·한국어 문구는 예제·통합 테스트로 다룬다.

> 셸 주의: `npm`/`node`/`npx` 명령은 `& ` 접두어로 실행한다. 백엔드 재빌드는 `& npm run build`, 테스트는 `& npx vitest run <경로>`.

## Tasks

- [x] 1. CharacterCard 데이터 모델·스캐폴드 (백엔드 + 프론트엔드)
  - [x] 1.1 백엔드 `CharacterCard` 타입과 `SheetSchema` 필드 추가
    - `src/services/sheet-schema.ts`에 `CharacterCard` 인터페이스(`id`·`roleLabel`·`premise`·선택적 `backstoryGuidance`)를 정의한다
    - `SheetSchema`에 `attributeProposalSupported: boolean`(필수)과 `characterCards?: CharacterCard[]`(선택) 두 필드를 추가한다(기존 `sections`·`narrativeFields`·`traits`·`allocation` 등 보존)
    - `until-it-sinks`용 `SINKS_CARDS` 상수(지배인·작가·지질학자, 각 `id`·`roleLabel`·`premise`·`backstoryGuidance`)를 정의한다
    - 새 런타임/빌드 의존성은 추가하지 않는다(vitest·fast-check·happy-dom은 기존 devDependency)
    - _Requirements: 1.1, 3.1, 3.3_

  - [x] 1.2 프론트엔드 타입 주석과 순수 함수 export 스텁·신규 메시지 선언
    - `public/character/logic.js`에 `CharacterCard`·`CardSelectionValidation` 타입 주석과 `CharacterSheetState`에 `selectedCardId: string | null` 필드 주석을 추가한다
    - 이후 단계에서 채울 순수 함수 export 스텁을 선언한다: `validateCardSelection`, `isCardBasedSheet`, `validateCardList`, `cardListModel`, `selectCard`
    - 기존 `defaultSheetSchema`·`validateSchema`·`selectActiveSchema`·`computeVisibility`·`renderModel`·`reduce`·`classifyRecordResult`·`buildRecordRequest`를 본 스펙 확장 대상으로 표시하는 주석을 남긴다(기존 `flexible-stat-allocation` 확장 주석 보존)
    - 신규 거부 사유 상수 `INVALID_CARD`, 한국어 메시지 상수 `CARD_REQUIRED_MESSAGE`("역할 카드를 먼저 선택" 안내, `INVALID_CARD` 응답 메시지와 동일 문구 공유)를 선언한다(기존 `INVALID_ALLOCATION`·`SCHEMA_FALLBACK` 메시지와 구분)
    - _Requirements: 1.1, 5.1, 6.4_

- [x] 2. Sheet_Schema_Resolver — 제안 플래그·카드 목록 부착 (`src/services/sheet-schema.ts`)
  - [x] 2.1 `deriveAttributeProposalSupported`·`cardsForScenario`와 스키마 해석 확장 구현
    - `deriveAttributeProposalSupported(traits, scenario): boolean` → `traits.length === 0`이면 거짓(요구사항 1.2), 시나리오 `Attribute_Proposal_Disabled === true`이면 거짓(요구사항 1.3), 그 외(`traits.length ≥ 1` 그리고 제안 비활성 아님)이면 참(요구사항 1.4)
    - `cardsForScenario(scenario): CharacterCard[] | undefined` → 시나리오 id 기준으로 카드 목록을 매핑한다(`until-it-sinks` → `SINKS_CARDS`, 그 외 카드 기반 아님은 `undefined`)
    - `sheetSchemaForScenario(scenario)`가 반환 스키마에 정확히 하나의 `attributeProposalSupported`를 항상 포함하고(요구사항 1.1), 카드 기반 시나리오면 트림 후 1자 이상 `id`·`roleLabel`과 `premise`를 갖고 모든 `id`가 고유한 `characterCards`를 부착하도록 확장한다(요구사항 3.1, 3.2)
    - `UNIVERSAL_SHEET`·`GEESE_SHEET`는 `attributeProposalSupported: true`·`characterCards` 없음으로 보존(요구사항 1.5, 3.5), `SINKS_SHEET`(`until-it-sinks`)는 `attributeProposalSupported: false`(traits 0개) + 지배인·작가·지질학자 카드로 둔다(요구사항 1.6, 3.3, 3.4 비카드 시나리오는 미부착)
    - `expectedTraitSpecForScenario(scenario)` 반환값에 `characterCards`(카드 기반 시)를 추가한다(기존 `keys`·`ladder`·`allocation` 보존)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 2.2 Property 1 속성 테스트 작성
    - **Property 1: 해석된 스키마는 정확히 하나의 attributeProposalSupported를 가지며 도출 규칙을 따른다**
    - 시나리오 생성기(임의 `Rated_Trait_Count`(0 포함), 임의 `Attribute_Proposal_Disabled`(참/거짓/누락))로 `sheetSchemaForScenario`가 항상 정확히 하나의 불리언 `attributeProposalSupported`를 포함하고, `count === 0` 또는 disabled=참이면 거짓, `count ≥ 1` 그리고 disabled≠참이면 참임을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 1: 해석된 스키마는 정확히 하나의 attributeProposalSupported를 가지며 도출 규칙을 따른다`, `numRuns: 100`
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

  - [ ]* 2.3 Property 2 속성 테스트 작성
    - **Property 2: 카드 기반 해석 스키마의 카드 형태 불변식**
    - 카드 기반 작성을 지정한 시나리오 생성기로 `sheetSchemaForScenario`가 해석한 `characterCards`가 1개 이상이고, 각 카드의 `id`·`roleLabel`이 트림 후 1자 이상이며 `premise`를 갖고, 목록 안 모든 `id`가 서로 다름(고유)을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 2: 카드 기반 해석 스키마의 카드 형태 불변식`, `numRuns: 100`
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 2.4 기존 시트 보존·카드 예제 테스트 작성
    - `UNIVERSAL_SHEET`·`terrible-geese` → `attributeProposalSupported: true`·카드 기반 아님(요구사항 1.5, 3.5), `until-it-sinks` → `attributeProposalSupported: false`·`characterCards`에 "지배인"·"작가"·"지질학자" Card_Role_Label 포함(요구사항 1.6, 3.3)을 예제로 검증
    - _Requirements: 1.5, 1.6, 3.3, 3.5_

- [x] 3. Frontend_Card_Validator — 공유 카드 검증·카드 기반 판정 (`public/character/logic.js`)
  - [x] 3.1 `validateCardSelection`·`isCardBasedSheet` 구현
    - `validateCardSelection(cardList, selectedId): { ok: true } | { ok: false, reason: "INVALID_CARD" }` → 설계의 "카드 선택 검증 알고리즘"을 순수 함수로 구현한다: (1) `cardList`가 없거나 빈 배열이면 항상 유효(카드 기반 아님), (2) 1개 이상이면 `selectedId`가 트림 후 1자 이상이어야 하고, (3) 트림한 `selectedId`가 목록의 어떤 카드의 트림한 `id`와 정확히 일치해야 유효, 그렇지 않으면 `INVALID_CARD`
    - `isCardBasedSheet(schema): boolean` → `schema.characterCards`가 1개 이상이면 참, 없음/빈 배열이면 거짓
    - 순수성 보장: 직전 판정 상태에 의존하지 않고 입력만으로 결정한다(멱등)
    - _Requirements: 5.3, 5.4, 6.2_

  - [ ]* 3.2 Property 10 속성 테스트 작성
    - **Property 10: 카드 선택 검증 알고리즘 (Frontend_Card_Validator)**
    - `cardList`(없음/빈 배열 또는 유효 1개 이상)와 `selectedId`(목록 내 id·목록 외 문자열·빈·공백·누락) 생성기로 `validateCardSelection`이 (a) 카드 기반 아님이면 항상 유효, (b) 카드 기반이면 트림 후 1자 이상이고 목록의 어떤 트림 id와 정확히 일치할 때만 유효, 그 외 `INVALID_CARD`임을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 10: 카드 선택 검증 알고리즘 (Frontend_Card_Validator)`, `numRuns: 100`
    - **Validates: Requirements 5.4, 6.2**

  - [ ]* 3.3 Property 11 속성 테스트 작성
    - **Property 11: 카드 선택 검증의 결정성·멱등성**
    - 동일 `cardList`·동일 `selectedId` 생성기로 `validateCardSelection`을 2회 이상 반복 호출해도 판정 순서·직전 상태와 무관하게 매번 동일한 판정(동일 유효/무효·동일 사유 분류)을 산출함을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 11: 카드 선택 검증의 결정성·멱등성`, `numRuns: 100`
    - **Validates: Requirements 5.3**

  - [ ]* 3.4 Property 3 속성 테스트 작성
    - **Property 3: 카드 기반이 아닌 시나리오는 Card_Based_Sheet가 아니다**
    - 카드 기반 작성을 지정하지 않은 시나리오 생성기로 `sheetSchemaForScenario`가 해석한 `characterCards`가 없거나 빈 배열이고, 그 스키마에 대해 `isCardBasedSheet`가 거짓을 반환함을 검증(백엔드 해석기 + 프론트엔드 판정 대조)
    - 태그 주석: `Feature: scenario-character-cards, Property 3: 카드 기반이 아닌 시나리오는 Card_Based_Sheet가 아니다`, `numRuns: 100`
    - **Validates: Requirements 3.4, 3.5**

- [x] 4. Schema_Engine 확장 — 카드 목록 검증·제안 플래그 도출·폴백 (`public/character/logic.js`)
  - [x] 4.1 `validateCardList`·`attributeProposalSupported` 도출과 스키마 채택/폴백 구현
    - `validateCardList(raw): { ok: true, cards: CharacterCard[] } | { ok: false }` → 없거나 빈 배열이면 `{ ok: true, cards: [] }`(카드 기반 아님)로 정규화; 1개 이상이며 모든 원소가 트림 후 1자 이상 `id`·`roleLabel`을 갖고 모든 `id`가 고유할 때에만 유효; 빈 `id`/`roleLabel`(전부 공백 포함)·중복 `id`·비객체 원소는 무효
    - `defaultSheetSchema()`에 `attributeProposalSupported: true`(네 평가 항목 보유)와 `characterCards: []`(카드 기반 아님)를 포함시킨다(기존 `allocation: { mode: "LADDER_SELECT" }` 보존)
    - `validateSchema(body)`에 `validateCardList(body.characterCards)`를 추가해 카드 목록이 무효이면 스키마를 채택하지 않게 하고, `attributeProposalSupported`를 응답에 있으면 불리언으로 정규화·없으면 `traits.length > 0`으로 도출한다(요구사항 7.4)
    - `selectActiveSchema(outcome)`가 카드 목록 무효도 폴백 경로로 흡수해 항상 정확히 하나의 유효 Active_Sheet_Schema(카드 기반 아님 Default + `usingDefaultSchema: true` + `SCHEMA_FALLBACK` 한국어 안내)를 반환하게 한다
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 4.2 Property 16 속성 테스트 작성
    - **Property 16: 카드 목록 스키마 검증 (validateCardList)**
    - `characterCards` 페이로드 생성기(없음/빈 배열, 유효 1개 이상, 빈 id/roleLabel, 중복 id, 비객체 원소)로 `validateCardList`가 없음/빈 배열이거나 모든 원소 트림 후 1자 이상 `id`·`roleLabel` + 고유 id일 때에만, 그리고 오직 그 때에만 유효로 인정함을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 16: 카드 목록 스키마 검증 (validateCardList)`, `numRuns: 100`
    - **Validates: Requirements 7.1**

  - [ ]* 4.3 Property 17 속성 테스트 작성
    - **Property 17: 카드 목록 무효 시 기본 스키마 폴백**
    - 성공(2xx) 스키마 응답이지만 `characterCards`가 Property 16 유효 조건을 충족하지 못하는 생성기로 `selectActiveSchema`(및 `validateSchema`)가 그 스키마를 채택하지 않고 카드 기반이 아닌 `Default_Sheet_Schema`를 채택함(`isCardBasedSheet` 거짓)을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 17: 카드 목록 무효 시 기본 스키마 폴백`, `numRuns: 100`
    - **Validates: Requirements 7.2**

  - [ ]* 4.4 Property 18 속성 테스트 작성
    - **Property 18: attributeProposalSupported 폴백 도출**
    - `attributeProposalSupported` 플래그가 없는 성공 스키마 응답 생성기(임의 `Rated_Trait_Count`)로 `validateSchema`가 채택한 스키마의 `attributeProposalSupported`를 `count === 0`이면 거짓, `count ≥ 1`이면 참으로 도출함을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 18: attributeProposalSupported 폴백 도출`, `numRuns: 100`
    - **Validates: Requirements 7.4**

  - [ ]* 4.5 카드 목록 무효 폴백 안내 예제 테스트 작성
    - 카드 목록 무효 성공 응답에서 `selectActiveSchema`가 `usingDefaultSchema: true`와 `SCHEMA_FALLBACK` 한국어 안내를 설정해 작성을 계속하게 함(요구사항 7.3)을 예제로 검증
    - _Requirements: 7.3_

- [x] 5. 백엔드 카드 선택 기록·검증 (`src/services/character-service.ts`)
  - [x] 5.1 `recordCharacter` 카드 검증과 검증 순서 확장 구현
    - `CharacterInput`에 `selectedCardId?: string`, `RecordCharacterOptions`에 `characterCards?: CharacterCard[]`·`selectedCardId?: string`, `Character` 저장 타입에 `selectedCardId?: string`를 추가하고, `RecordCharacterResult`에 `{ ok: false; reason: "INVALID_CARD"; message: string }` 분기와 한국어/영문 메시지를 추가한다(기존 `INVALID_ALLOCATION`·`ALREADY_CONFIRMED` 등 보존)
    - `recordCharacter`가 프론트엔드 `validateCardSelection`과 동일한 알고리즘으로 카드 선택을 판정한다(검증 패리티). `options.characterCards`가 1개 이상이면 `options.selectedCardId` 또는 `input.selectedCardId`를 검증해 통과 시 선택된 Card_Id와 입력된 Narrative_Field 값으로 확정 전 캐릭터를 기록·갱신(`confirmed: false`)하고, `INVALID_CARD`면 어떤 캐릭터 데이터도 기록·갱신하지 않고 거부한다
    - `characterCards`가 없거나 빈 배열이면(카드 기반 아님) 카드 검증을 적용하지 않고 기존 동작을 변경 없이 수행한다
    - 검증 순서를 `UNKNOWN_PLAYER` → `ALREADY_CONFIRMED` → 카드 검증(신규) → 능력치 검증(기존 `allocationRule`/`traitKeys`·`ladder`) → `NAME_TAKEN` → 기록으로 둔다. 확정된 캐릭터는 카드 검증보다 먼저 `ALREADY_CONFIRMED`로 거부하고 저장된 `selectedCardId`·Narrative_Field 값을 변경 없이 보존한다
    - _Requirements: 6.1, 6.2, 6.3, 8.3_

  - [ ]* 5.2 Property 13 속성 테스트 작성
    - **Property 13: 백엔드 카드 기록·거부와 비카드 보존**
    - `recordCharacter` 호출 생성기(유효 카드 목록 + 목록 내/외/빈/누락 `selectedCardId`, 그리고 카드 없음/빈 배열)로 (a) 목록에 속하면 `confirmed: false`로 기록되고 저장된 `selectedCardId`가 설정됨, (b) 미선택·목록 외면 `INVALID_CARD` 거부 + 미기록·미갱신, (c) 카드 없음/빈 배열이면 카드 검증 미적용·기존 동작 보존을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 13: 백엔드 카드 기록·거부와 비카드 보존`, `numRuns: 100`
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [ ]* 5.3 Property 14 속성 테스트 작성
    - **Property 14: 확정된 캐릭터는 카드 선택을 잠근다**
    - Confirmed_State 캐릭터(저장된 `selectedCardId`·서사 값 보유) + 임의 카드 목록·`selectedCardId` 생성기로 `recordCharacter`가 카드 검증보다 먼저 `ALREADY_CONFIRMED`로 거부하고, 확정된 캐릭터의 `selectedCardId`·Narrative_Field 값을 변경 없이 보존함을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 14: 확정된 캐릭터는 카드 선택을 잠근다`, `numRuns: 100`
    - **Validates: Requirements 8.3**

- [x] 6. 체크포인트 - 카드 검증 패리티 확인
  - [x] 6.1 프론트엔드·백엔드 카드 검증기 통합 지점 정리
    - 프론트엔드 `validateCardSelection`과 백엔드 `recordCharacter`의 카드 검증이 동일 알고리즘 명세(카드 기반 아님 → 선택 존재 → 소속 검사)를 따르는지 대조하고, 모든 테스트가 통과하는지 `& npx vitest run`으로 확인한다. 의문이 생기면 사용자에게 질문한다.

  - [ ]* 6.2 Property 12 속성 테스트 작성
    - **Property 12: 프론트엔드·백엔드 카드 검증 패리티**
    - 동일 Character_Card_List·동일 `selectedId` 생성기로 같은 테스트에서 프론트엔드 `validateCardSelection`(`public/character/logic.js`)과 백엔드 카드 검증 경로(`recordCharacter`)를 모두 호출해 동일한 유효/무효 판정과(무효 시) 동일한 `INVALID_CARD` 분류를 산출함을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 12: 프론트엔드·백엔드 카드 검증 패리티`, `numRuns: 100`
    - **Validates: Requirements 5.2**

- [x] 7. Visibility & Render — 제안/능력치 영역·빈 섹션 숨김, 카드 렌더 (`public/character/logic.js`)
  - [x] 7.1 `computeVisibility`·`cardListModel`·`renderModel` 표시 도출 확장 구현
    - `computeVisibility(state)` 반환에 `proposeVisible`·`statSectionVisible`·`cardSelectionEnabled`를 추가한다(기존 플래그 보존): `attributeProposalSupported`가 거짓이면 `proposeVisible: false`·`proposeEnabled: false`, 참이면 `proposeVisible: true`이고 활성 여부는 기존 규칙(인계 유효·비확정·진행 중 아님)과 정확히 일치; `Rated_Trait_Count === 0`이면 `statSectionVisible: false`, `≥ 1`이면 참; Confirmed_State이면 `cardSelectionEnabled: false`(읽기 전용)로 도출하고 `selectedCardId`를 확정 시점 값에서 변경하지 않는다
    - `cardListModel(schema, selectedCardId): { cards: Array<{ id, roleLabel, premise, backstoryGuidance, selected }> }` → Card_Based_Sheet의 모든 카드를 산출하고, `selectedCardId`가 null이면 모두 `selected: false`, 목록의 한 id이면 그 카드 하나만 `selected: true`(나머지 거짓)로 표시한다(모든 텍스트는 `esc` 이스케이프 대상)
    - `renderModel(schema, values)`를 확장해 소속 Narrative_Field와 Rated_Trait가 모두 0개인 Sheet_Section을 결과에서 제외하고, 비어 있지 않은 섹션은 스키마 정의 순서대로 보존하며, `Rated_Trait_Count === 0`이면 어떤 Rated_Trait 평가 편집 요소도 산출하지 않고 스키마가 정의한 각 Backstory_Field(Narrative_Field) 입력 요소는 산출한다
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2, 4.4, 8.1_

  - [ ]* 7.2 Property 4 속성 테스트 작성
    - **Property 4: 능력치 제안 동작 표시 도출 (Propose_Action)**
    - 작성 상태 생성기(임의 `attributeProposalSupported`·인계 유효/무효·확정/비확정·진행 중 여부)로 `computeVisibility`가 거짓이면 `proposeVisible`·`proposeEnabled` 모두 거짓, 참이면 `proposeVisible` 참이고 `proposeEnabled`가 기존 활성 규칙과 정확히 일치함을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 4: 능력치 제안 동작 표시 도출 (Propose_Action)`, `numRuns: 100`
    - **Validates: Requirements 2.1, 2.5**

  - [ ]* 7.3 Property 5 속성 테스트 작성
    - **Property 5: 능력치 설정 영역 표시 도출 (Stat_Setting_Section)**
    - Active_Sheet_Schema·작성 상태 생성기(임의 `Rated_Trait_Count`)로 `count === 0`이면 `statSectionVisible` 거짓이고 `renderModel`이 어떤 Rated_Trait 편집 요소도 산출하지 않으며, `count ≥ 1`이면 `statSectionVisible` 참이고 각 Rated_Trait 편집 요소를 산출함을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 5: 능력치 설정 영역 표시 도출 (Stat_Setting_Section)`, `numRuns: 100`
    - **Validates: Requirements 2.3, 2.6**

  - [ ]* 7.4 Property 6 속성 테스트 작성
    - **Property 6: 빈 Sheet_Section은 렌더되지 않는다**
    - Active_Sheet_Schema 생성기(빈 섹션·비어 있지 않은 섹션 혼합)로 `renderModel` 결과가 Narrative_Field·Rated_Trait가 모두 0개인 섹션을 포함하지 않고, 비어 있지 않은 섹션은 스키마 정의 순서대로 보존함을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 6: 빈 Sheet_Section은 렌더되지 않는다`, `numRuns: 100`
    - **Validates: Requirements 2.4**

  - [ ]* 7.5 Property 7 속성 테스트 작성
    - **Property 7: 카드 목록 렌더 모델은 정확히 하나의 선택을 표시하고 모든 카드·서사 입력을 렌더한다**
    - Card_Based_Sheet·선택 상태(`selectedCardId`가 null 또는 목록의 한 id) 생성기로 `cardListModel`이 모든 카드를 `roleLabel`·`premise`(+있으면 `backstoryGuidance`)와 함께 산출하고, null이면 모두 미선택·한 id이면 그 카드 하나만 `selected: true`로 표시하며, `renderModel`이 스키마가 정의한 각 Backstory_Field 입력 요소를 산출함을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 7: 카드 목록 렌더 모델은 정확히 하나의 선택을 표시하고 모든 카드·서사 입력을 렌더한다`, `numRuns: 100`
    - **Validates: Requirements 4.1, 4.2, 4.4**

  - [ ]* 7.6 Property 19 속성 테스트 작성
    - **Property 19: 확정 상태의 카드 선택 읽기 전용 도출**
    - Confirmed_State 작성 상태 생성기로 `computeVisibility`가 Card_Based_Sheet의 Card_Selection_Action을 읽기 전용(`cardSelectionEnabled` 거짓)으로 도출하고 `selectedCardId`를 확정 시점 값에서 변경하지 않음을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 19: 확정 상태의 카드 선택 읽기 전용 도출`, `numRuns: 100`
    - **Validates: Requirements 8.1**

- [x] 8. Card_Selection 전이·Reducer·거부 매핑 (`public/character/logic.js`)
  - [x] 8.1 `selectCard`·`reduce`·`buildRecordRequest`·거부 매핑 확장 구현
    - `selectCard(state, cardId): CharacterSheetState` → Card_Based_Sheet이고 비확정이면 `cardId`를 유일한 Selected_Card로 두고 직전 선택을 해제해 항상 최대 하나의 Selected_Card만 존재하게 하며(`state.selectedCardId` 갱신), 확정 상태이면 변경하지 않는다
    - `reduce`에 `CARD_SELECTED`(payload `cardId`) 액션을 추가해 `selectCard` 전이를 적용하고, 확정 상태에서는 무시한다(요구사항 8.2)
    - `reduce`의 record/confirm 결과 경로에 `INVALID_CARD` 분기를 추가해 `CARD_REQUIRED_MESSAGE` 한국어 안내를 설정하고, 입력한 Narrative_Field 값(이름 포함)·`selectedCardId`를 변경 없이 보존하며, `confirmed`를 참으로 전이시키지 않는다. 또한 사전 게이트에서 `validateCardSelection`이 무효이면(카드 기반 + 미선택) 요청 미전송 의도를 표현하고 동일 안내를 설정한다(카드 기반 아님이면 검증 미적용)
    - `classifyRecordResult`에 본문 `reason === "INVALID_CARD"` 분기를 추가하고, `RecordRejection`·`RECORD_REJECTION_MESSAGES`에 `INVALID_CARD` 한국어 메시지를 추가한다(기존 `INVALID_ALLOCATION` 분기와 동일 패턴, `CARD_REQUIRED_MESSAGE`와 동일 문구 공유)
    - `buildRecordRequest`(또는 동등 요청 빌더)를 확장해 정확히 하나의 Selected_Card가 있을 때 요청 본문에 그 Card_Id와 플레이어가 입력한 Narrative_Field 값(앞뒤 공백만 제거, 내부 공백 보존)을 포함한다
    - _Requirements: 4.3, 4.5, 5.1, 6.4, 8.2_

  - [ ]* 8.2 Property 8 속성 테스트 작성
    - **Property 8: 카드 단일 선택 전이와 확정 시 잠금**
    - Card_Based_Sheet 상태 + 임의 카드 선택 시퀀스(목록 내/외 혼합) 생성기로 비확정 상태에서 `selectCard`/`CARD_SELECTED` 적용 후 `state.selectedCardId`가 마지막 선택 id와 같고 직전 선택은 해제되어 항상 최대 하나만 존재하며, 확정 상태에서는 어떤 선택 시도에도 `selectedCardId`가 변경 없이 유지됨을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 8: 카드 단일 선택 전이와 확정 시 잠금`, `numRuns: 100`
    - **Validates: Requirements 4.3, 8.2**

  - [ ]* 8.3 Property 9 속성 테스트 작성
    - **Property 9: 저장·확정 요청은 선택된 Card_Id와 서사 값을 포함한다**
    - 인계 값·이름·서사 값 맵·`selectedCardId`(목록의 한 id) 생성기로 정확히 하나의 Selected_Card가 있을 때 `buildRecordRequest`가 만든 본문이 그 Card_Id와 Narrative_Field 값(앞뒤 공백만 제거·내부 공백 보존)을 포함함을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 9: 저장·확정 요청은 선택된 Card_Id와 서사 값을 포함한다`, `numRuns: 100`
    - **Validates: Requirements 4.5**

  - [ ]* 8.4 Property 15 속성 테스트 작성
    - **Property 15: 카드 미선택·INVALID_CARD는 입력을 보존하고 확정을 막는다**
    - 작성 상태 + 사전 무효(카드 기반·미선택) 또는 백엔드 `INVALID_CARD` 응답 생성기로 (a) Save/Confirm 게이트 평가 시 `validateCardSelection`이 무효라 어떤 기록/확정 요청도 전송되지 않고, (b) reduce 후 Narrative_Field 값(이름 포함)·`selectedCardId`가 변경 없이 보존되며, 카드 선택을 요구하는 한국어 안내가 설정되고, Confirmed_State로 전이하지 않음을 검증
    - 태그 주석: `Feature: scenario-character-cards, Property 15: 카드 미선택·INVALID_CARD는 입력을 보존하고 확정을 막는다`, `numRuns: 100`
    - **Validates: Requirements 5.1, 6.4**

  - [ ]* 8.5 INVALID_CARD 한국어 문구 예제 테스트 작성
    - 프론트엔드 사전 검증(`CARD_REQUIRED_MESSAGE`)과 백엔드 `INVALID_CARD` 응답 매핑(`RECORD_REJECTION_MESSAGES`)이 "역할 카드를 먼저 선택" 동일 한국어 문구를 표시함(요구사항 5.1, 6.4)을 예제로 검증
    - _Requirements: 5.1, 6.4_

- [x] 9. 정적 페이지 부수효과 배선 (`public/character/index.html`)
  - [x] 9.1 카드 목록 렌더·선택·숨김·잠금·INVALID_CARD 배선
    - `computeVisibility`/`cardListModel`/`renderModel`로 화면을 그린다: `attributeProposalSupported`가 거짓이면 `#proposeBtn`(Propose_Action)을 DOM에 표시하지 않고 제안 요청을 전송하지 않으며, `Rated_Trait_Count === 0`이면 Stat_Setting_Section·모든 평가 편집 요소를 표시하지 않고, 빈 Sheet_Section을 감춘다
    - Card_Based_Sheet에서 각 Character_Card를 `roleLabel`·`premise`(+`backstoryGuidance`)와 함께 미리 선택 없이 렌더하고, Card_Selection_Action 클릭 시 `CARD_SELECTED`를 디스패치해 단일 선택을 적용하며 직전 선택을 200밀리초 이내에 해제 표시한다. Backstory_Field 입력 요소를 함께 렌더한다(모든 텍스트 `esc` 이스케이프)
    - Save/Confirm 시 카드 기반이면 `validateCardSelection`으로 사전 검증해 무효이면 요청을 전송하지 않고 한국어 안내를 표시하며 입력을 보존한다. 유효이면 `buildRecordRequest`로 선택된 Card_Id를 포함해 `fetch`하고(주입 가능한 `AbortController` 10초 타임아웃), `INVALID_CARD` 응답이면 한국어 안내 표시 + 입력 보존 + 확정 미전이를 배선한다
    - Confirmed_State이면 Card_Selection_Action을 읽기 전용(비활성)으로 배선하고 조작 시도에도 Selected_Card를 변경하지 않는다
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 6.4, 8.1, 8.2_

  - [ ]* 9.2 통합 테스트 작성 (happy-dom + fake timers + 가짜 fetch)
    - 가짜 fetch로 `attributeProposalSupported`가 거짓일 때 `#proposeBtn`이 DOM에 없고 제안 엔드포인트로 요청이 전송되지 않음(요구사항 2.2)을, `Rated_Trait_Count === 0`일 때 Stat_Setting_Section과 빈 섹션이 표시되지 않음(요구사항 2.3, 2.4)을 검증한다
    - 가짜 타이머로 카드 선택 시 직전 선택이 200밀리초 이내에 해제 표시됨(요구사항 4.3 타이밍)을, happy-dom으로 카드 목록 단일 선택 표시·Backstory_Field 렌더·확정 시 카드 선택 읽기 전용·`INVALID_CARD` 안내 표시를 검증한다
    - _Requirements: 2.2, 2.3, 2.4, 4.3, 8.1_

- [x] 10. 최종 체크포인트 - 모든 테스트 통과 확인
  - [x] 10.1 백엔드 재빌드 + 전체 테스트 통과 확인
    - `& npm run build`로 백엔드를 재빌드하고 `& npx vitest run`으로 본 스펙의 속성·예제·통합 테스트와 기존 762개 테스트(특히 `flexible-stat-allocation` 경로)가 모두 통과하는지 확인한다. 의문이 생기면 사용자에게 질문한다.

## Notes

- `*`로 표시된 하위 작업은 선택 사항(테스트)이며 빠른 MVP를 위해 건너뛸 수 있다. 핵심 구현 작업(`*` 없음)은 반드시 구현한다.
- Correctness Property 1~19는 각각 정확히 하나의 속성 기반 테스트로 구현되며, 구현 직후 가까운 위치에 배치해 오류를 조기에 잡는다. 검증 패리티(Property 12)는 프론트엔드 `validateCardSelection`과 백엔드 카드 검증기를 같은 테스트에서 import 해 동일 생성 입력으로 대조한다.
- 모든 속성 테스트는 `numRuns: 100` 이상으로 실행하고 `Feature: scenario-character-cards, Property {N}: {텍스트}` 태그를 주석으로 단다.
- 200ms 선택 해제 타이밍·제안 요청 미전송의 실제 fetch 차단·DOM 표시/숨김(2.2·4.3·8.1)·특정 시나리오 보존(1.5·1.6·3.3·3.5)·한국어 문구(5.1·6.4·7.3) 등 속성으로 다루지 않는 요구사항은 예제·통합 테스트(2.4, 4.5, 8.5, 9.2)로 검증한다.
- 본 스펙은 `flexible-stat-allocation` 위에 가산적으로 쌓으며 기존 `allocation` 경로·거부 사유(`INVALID_ALLOCATION`·`ALREADY_CONFIRMED` 등)와 충돌하지 않는다. 검증 순서는 `UNKNOWN_PLAYER` → `ALREADY_CONFIRMED` → 카드 검증 → 능력치 검증 → `NAME_TAKEN`이다.
- 셸 주의: `npm`/`node`/`npx`는 `& ` 접두어로 실행한다.
- 각 작업은 추적성을 위해 구체적인 요구사항 절과 설계의 Correctness Property를 참조한다.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.2", "3.3", "3.4", "4.1", "5.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4", "4.5", "5.2", "5.3", "6.2", "7.1"] },
    { "id": 4, "tasks": ["7.2", "7.3", "7.4", "7.5", "7.6", "8.1"] },
    { "id": 5, "tasks": ["8.2", "8.3", "8.4", "8.5", "9.1"] },
    { "id": 6, "tasks": ["9.2"] }
  ]
}
```
