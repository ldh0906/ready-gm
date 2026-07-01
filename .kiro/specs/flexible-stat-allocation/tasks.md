# Implementation Plan: 유연한 능력치 배분 (flexible-stat-allocation)

## Overview

이 계획은 캐릭터 시트의 능력치 배분을, 시트 스키마(Active_Sheet_Schema)에 정확히 하나의 교체 가능한 `Allocation_Rule`을 싣는 **단일 소켓** 구조로 일반화한다. 기존 `character-sheet`·`room-lobby` 스펙의 관례를 그대로 미러링한다(빌드 단계 없는 정적 `public/*.html`, 바닐라 JS ES 모듈, 순수 로직 분리, 백엔드는 `src/services/` TypeScript, vitest + fast-check, 서버 측 무작위 주입).

작업은 다음 세 곳을 확장한다.
- **백엔드 스키마 해석기**(`src/services/sheet-schema.ts`): 해석된 스키마에 정확히 하나의 `Allocation_Rule`을 싣고(미지정·무효 시 `LADDER_SELECT`), 기존 시트 동작을 보존한다.
- **백엔드 검증기**(`src/services/character-service.ts`): `RecordCharacterOptions.allocationRule`을 수용해 사다리 경계 → 배분 제약 순서로 검증하고 `INVALID_ALLOCATION` 거부 사유를 추가한다.
- **프론트엔드 순수 로직**(`public/character/logic.js`): 모드별 배분 검증·스키마 규칙 검증·초기값·고정값 재배정·굴림 응답 검증·편집 모델/가시성 순수 함수를 추가하고, 부수효과(`fetch` + 10초 타임아웃, 200ms 인디케이터, 굴림 요청)는 `public/character/index.html`이 담당한다.

설계의 Correctness Property 1~23은 각각 **정확히 하나의** 속성 기반 테스트(`fast-check`)가 되며, 최소 100회 반복(`numRuns: 100`)으로 실행하고 다음 태그를 주석으로 단다: `Feature: flexible-stat-allocation, Property {N}: {속성 텍스트}`. **검증 패리티(Property 17)** 와 **Initial_Allocation 유효성(Property 10)** 은 프론트엔드 `validateAllocation`과 백엔드 검증기를 같은 테스트에서 import 해 동일 생성 입력으로 대조한다. 200ms 인디케이터 타이밍·10초 타임아웃 발화·실제 무작위 생성·특정 시나리오 보존·한국어 문구는 예제·통합 테스트로 다룬다.

구현 언어/스택은 설계가 명시한 바닐라 JS(ES 모듈, 프론트)와 TypeScript(`src/services`, 백엔드)이므로 별도 언어 선택은 필요하지 않다. 모든 외부 의존성(`fetch`, 타이머, 무작위원, DOM)은 주입 가능하게 만들어 아직 배선되지 않은 의도된 엔드포인트(Allocation_Roll_Endpoint 등)도 모킹/주입으로 완전히 테스트한다.

## Tasks

- [x] 1. Allocation_Rule 데이터 모델·스캐폴드 (백엔드 + 프론트엔드)
  - [x] 1.1 백엔드 `Allocation_Rule` 판별 유니온 타입과 상수 정의
    - `src/services/sheet-schema.ts`(또는 필요 시 `src/core`의 작은 공유 스펙 모듈)에 `AllocationMode = "LADDER_SELECT" | "POINT_BUY" | "FIXED_VALUE" | "DICE_ROLL"`와 `LadderSelectRule`·`PointBuyRule`(`baseLevel`·`pointPool`)·`FixedValueRule`(`valuePool: number[]`)·`DiceRollRule`(`diceFormula`·`forcedRandom`) 인터페이스, `AllocationRule` 유니온을 정의한다
    - `SheetSchema`에 `allocation: AllocationRule` 필드를 추가한다(정확히 하나)
    - `defaultAllocationRule(): { mode: "LADDER_SELECT" }`를 정의한다
    - _Requirements: 1.1_

  - [x] 1.2 프론트엔드 `Allocation_Rule` 타입 주석과 순수 함수 export 스텁 선언
    - `public/character/logic.js`에 `AllocationMode`·`AllocationRule`·`RatedTraitSet`·`AllocationValidation` 타입 주석을 추가한다
    - 이후 단계에서 채울 순수 함수 export 스텁을 선언한다: `validateAllocation`, `validateAllocationRule`, `initialAllocation`, `pointBuyRemaining`, `assignFixedValue`, `allocationEditModel`, `parseDiceFormula`, `rollAllocation`, `buildRollRequest`, `validateRollResponse`
    - 기존 `defaultSheetSchema`·`validateSchema`·`selectActiveSchema`·`setTraitLevel`·`computeVisibility`·`reduce`·`classifyRecordResult`를 본 스펙 확장 대상으로 표시하는 주석을 남긴다
    - 신규 거부 사유 상수 `INVALID_ALLOCATION`과 한국어 메시지 상수(배분 규칙 미충족 안내, 굴림 실패/무효 응답 안내, 규칙 폴백 안내)를 선언한다
    - 새 런타임/빌드 의존성은 추가하지 않는다(vitest·fast-check·happy-dom은 기존 devDependency)
    - _Requirements: 1.1_

- [x] 2. Sheet_Schema_Resolver — 단일 배분 규칙 부착과 정규화 (`src/services/sheet-schema.ts`)
  - [x] 2.1 `normalizeAllocationRule`와 스키마 해석 확장 구현
    - `normalizeAllocationRule(raw, traits): AllocationRule` → 모드가 네 종류와 일치하지 않거나 매개변수가 부적법하면 `LADDER_SELECT`로 보정한다. `POINT_BUY`는 정수 `baseLevel`(모든 사다리 안)과 `0 ≤ pointPool ≤ Σ(ladder.max − baseLevel)`를 보장, `FIXED_VALUE`는 정수 원소·개수 = Rated_Trait 개수(≥1)인 `valuePool`을 보장, `DICE_ROLL`은 `diceFormula`와 `forcedRandom`(미제공 시 false)을 보장한다
    - `UNIVERSAL_SHEET`·`GEESE_SHEET`·`SINKS_SHEET`에 `allocation: { mode: "LADDER_SELECT" }`를 부착한다(거위는 세 항목 사다리 `{1,4}` 유지, 싱크는 traits 빈 배열 유지)
    - `sheetSchemaForScenario(scenario)`가 반환 스키마에 정확히 하나의 정규화된 `allocation`을 포함하도록 확장한다(시나리오 미지정·무효 시 `LADDER_SELECT`)
    - `expectedTraitSpecForScenario(scenario)` 반환값에 `allocation`을 추가한다(기존 `keys`·`ladder` 보존)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.1, 4.1, 5.1_

  - [ ]* 2.2 Property 1 속성 테스트 작성
    - **Property 1: 해석된 스키마는 정확히 하나의 유효한 Allocation_Rule을 갖는다**
    - 시나리오 생성기(규칙 미지정·네 모드·무효 모드 문자열)로 `sheetSchemaForScenario`가 항상 정확히 하나의 `allocation`을 포함하고 모드가 네 종류 중 하나이며, 미지정·무효 모드는 `LADDER_SELECT`로 해석됨을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 1: 해석된 스키마는 정확히 하나의 유효한 Allocation_Rule을 갖는다`, `numRuns: 100`
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [ ]* 2.3 Property 2 속성 테스트 작성
    - **Property 2: POINT_BUY 규칙의 매개변수 경계**
    - 임의 Rated_Trait 사다리 집합 생성기로 해석된 `POINT_BUY` 규칙의 `baseLevel`이 모든 사다리 안 정수이고 `pointPool`이 정수이며 `0 ≤ pointPool ≤ Σ(ladder.max − baseLevel)`을 만족함을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 2: POINT_BUY 규칙의 매개변수 경계`, `numRuns: 100`
    - **Validates: Requirements 3.1**

  - [ ]* 2.4 Property 3 속성 테스트 작성
    - **Property 3: FIXED_VALUE 규칙의 Value_Pool 형태**
    - 임의 개수(≥1) Rated_Trait 스키마 생성기로 해석된 `FIXED_VALUE` 규칙의 `valuePool` 모든 원소가 정수이고 개수가 Rated_Trait 개수와 정확히 같으며 1 이상임을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 3: FIXED_VALUE 규칙의 Value_Pool 형태`, `numRuns: 100`
    - **Validates: Requirements 4.1**

  - [ ]* 2.5 Property 4 속성 테스트 작성
    - **Property 4: DICE_ROLL 규칙의 매개변수와 Forced_Random 기본값**
    - `forcedRandom` 제공/누락을 포함한 `DICE_ROLL` 원본 생성기로 해석된 규칙이 하나의 `diceFormula`와 불리언 `forcedRandom`을 가지며, 원본이 `forcedRandom`을 제공하지 않으면 false임을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 4: DICE_ROLL 규칙의 매개변수와 Forced_Random 기본값`, `numRuns: 100`
    - **Validates: Requirements 5.1**

  - [ ]* 2.6 기존 시트 보존 예제 테스트 작성
    - `UNIVERSAL_SHEET`→`LADDER_SELECT`(요구사항 1.4), `terrible-geese`→`LADDER_SELECT` + 세 항목 사다리 `{1,4}`(요구사항 1.5), `until-it-sinks`(0개 항목)→`LADDER_SELECT`(요구사항 1.6)로 해석됨을 예제로 검증
    - _Requirements: 1.4, 1.5, 1.6_

- [x] 3. 프론트엔드 스키마 규칙 검증과 폴백 (`public/character/logic.js`)
  - [x] 3.1 `validateAllocationRule`·`defaultSheetSchema`·`selectActiveSchema` 확장 구현
    - `validateAllocationRule(raw, traits): { ok: true, rule } | { ok: false }` → 모드가 네 종류 중 하나이고 필수 매개변수를 모두 갖출 때에만 유효(POINT_BUY: 정수 `baseLevel` + 0 이상 정수 `pointPool`; FIXED_VALUE: 정수 원소·개수 = Rated_Trait 개수인 `valuePool`; DICE_ROLL: 공백 제거 시 1자 이상 `diceFormula` + 불리언 `forcedRandom`)
    - `defaultSheetSchema()`에 `allocation: { mode: "LADDER_SELECT" }`를 포함시킨다
    - `validateSchema(body)`에 `validateAllocationRule(body.allocation, traits)`를 추가해 규칙이 무효이면 스키마를 채택하지 않게 한다
    - `selectActiveSchema(outcome)`가 규칙 무효도 폴백 경로로 흡수해 항상 정확히 하나의 유효 Active_Sheet_Schema + 유효 규칙을 반환하게 한다
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 3.2 Property 22 속성 테스트 작성
    - **Property 22: 스키마 규칙 검증과 무효 시 기본 스키마 폴백**
    - `allocation` 페이로드 생성기(유효 네 모드 / 누락 / 모드 불일치 / 매개변수 미비)로 `validateAllocationRule`이 유효 조건을 정확히 인정하고, 성공 응답이지만 규칙이 무효이면 `selectActiveSchema`가 `LADDER_SELECT` Default_Sheet_Schema로 폴백함을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 22: 스키마 규칙 검증과 무효 시 기본 스키마 폴백`, `numRuns: 100`
    - **Validates: Requirements 7.1, 7.2, 7.3**

- [x] 4. 프론트엔드 배분 검증 알고리즘 (`public/character/logic.js`)
  - [x] 4.1 `validateAllocation`과 헬퍼 구현
    - `validateAllocation(rule, schema, ratedTraitSet): { ok: true } | { ok: false, reason }` → 공통 선행 키 집합 검사(모든 Trait_Key 정확히 하나, 정의되지 않은 키 없음; 위반 시 `INVALID_ATTRIBUTES`; 0개 항목 스키마는 항상 유효) 후 모드별 판정을 디스패치한다
    - `LADDER_SELECT`/`DICE_ROLL`: 각 Trait_Level이 자기 사다리 안 정수일 때만 유효, 아니면 `INVALID_ATTRIBUTES`, 항목 간 제약 없음
    - `POINT_BUY`: 1단계 사다리 경계(`baseLevel` 이상 + 사다리 안 정수, 위반 시 `INVALID_ATTRIBUTES`), 2단계 `Σ(level − baseLevel) === pointPool`(위반 시 `INVALID_ALLOCATION`)
    - `FIXED_VALUE`: Trait_Level 다중집합이 `valuePool`과 원소·개수 정확히 일치 + 각 값 사다리 안 정수일 때만 유효, 어떤 위반이든 `INVALID_ALLOCATION`(특수 우선 결정)
    - 헬퍼 `pointBuySpent(set, baseLevel)`·`multisetEqual(a, b)`·`withinLadder(level, ladder)`(기존 `isValidLevel` 재사용)를 구현한다
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.2, 3.3, 3.4, 4.2, 4.3, 4.4, 5.4, 9.3_

  - [ ]* 4.2 Property 5 속성 테스트 작성
    - **Property 5: 항목 독립 사다리 검증 (LADDER_SELECT · DICE_ROLL)**
    - `LADDER_SELECT`/`DICE_ROLL` 규칙 + 유효/무효(사다리 밖·비정수·키 누락/초과) Rated_Trait_Set 생성기로 모든 키 정확히 하나·각 값 사다리 안 정수일 때만 유효, 위반 시 `INVALID_ATTRIBUTES`, 항목 간 제약 미적용을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 5: 항목 독립 사다리 검증 (LADDER_SELECT · DICE_ROLL)`, `numRuns: 100`
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 5.4, 9.3**

  - [ ]* 4.3 Property 6 속성 테스트 작성
    - **Property 6: POINT_BUY 2단계 검증과 사유 분류**
    - `POINT_BUY` 규칙 + Rated_Trait_Set 생성기(사다리/Base 위반, 합 초과/미달, 정확히 일치)로 1단계 위반은 합과 무관하게 `INVALID_ATTRIBUTES`, 1단계 통과·합 불일치는 `INVALID_ALLOCATION`, 둘 다 충족 시 유효임을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 6: POINT_BUY 2단계 검증과 사유 분류`, `numRuns: 100`
    - **Validates: Requirements 3.2, 3.3, 3.4, 9.3**

  - [ ]* 4.4 Property 7 속성 테스트 작성
    - **Property 7: FIXED_VALUE 다중집합 검증**
    - `FIXED_VALUE` 규칙 + Rated_Trait_Set 생성기(다중집합 일치, 중복/누락 불일치, 사다리 밖/비정수)로 다중집합 일치 + 사다리 안 정수일 때만 유효이고 어떤 위반이든 `INVALID_ALLOCATION`임을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 7: FIXED_VALUE 다중집합 검증`, `numRuns: 100`
    - **Validates: Requirements 4.2, 4.3, 4.4**

  - [ ]* 4.5 Property 18 속성 테스트 작성
    - **Property 18: 검증의 결정성·멱등성**
    - 동일 규칙·동일 Rated_Trait_Set 생성기로 `validateAllocation`을 2회 이상 반복 호출해도 판정 순서·직전 상태와 무관하게 매번 동일한 판정·동일한 거부 사유 분류를 산출함을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 18: 검증의 결정성·멱등성`, `numRuns: 100`
    - **Validates: Requirements 6.4**

- [x] 5. 백엔드 기록·확정 시 배분 검증 (`src/services/character-service.ts`)
  - [x] 5.1 `RecordCharacterOptions.allocationRule` 수용과 단계 순서 검증 구현
    - `RecordCharacterOptions`에 `allocationRule?: AllocationRule`을 추가하고, `RecordCharacterResult`에 `{ ok: false; reason: "INVALID_ALLOCATION"; message: string }` 분기와 한국어/영문 메시지를 추가한다
    - `recordCharacter`가 `allocationRule`을 받으면 프론트엔드와 동일한 배분 검증 알고리즘으로 판정한다: 먼저 사다리 경계(`INVALID_ATTRIBUTES`)를 검사하고 통과 시에만 배분 제약(`INVALID_ALLOCATION`)을 검사한다. 두 거부 모두 어떤 캐릭터 데이터도 기록·갱신하지 않는다
    - 두 검사를 모두 통과하면 확정 전 캐릭터를 그 Rated_Trait_Set으로 기록·갱신한다(`confirmed: false`)
    - `allocationRule` 없이 호출되면 기존 동작(`traitKeys`·`ladder` 사다리 경계 검증, 옵션 생략 시 기본 EZFudge 네 키)을 변경 없이 수행하고, 빈 `traitKeys`/0개 항목은 검증을 적용하지 않는다
    - 확정된 캐릭터에 대한 호출은 모드와 무관하게 `ALREADY_CONFIRMED`로 거부하고 집합을 보존한다(기존 동작 유지)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 10.3_

  - [ ]* 5.2 Property 19 속성 테스트 작성
    - **Property 19: 백엔드 기록은 단계 순서로 검증하고 거부 시 기록하지 않는다**
    - 규칙·Rated_Trait_Set 생성기로 사다리 경계 위반은 배분 제약과 무관하게 `INVALID_ATTRIBUTES`, 경계 통과·배분 위반은 `INVALID_ALLOCATION`, 두 거부 모두 미기록·미갱신, 모두 충족 시 `confirmed: false`로 기록됨을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 19: 백엔드 기록은 단계 순서로 검증하고 거부 시 기록하지 않는다`, `numRuns: 100`
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

  - [ ]* 5.3 Property 20 속성 테스트 작성
    - **Property 20: 규칙 없는 호출과 평가 항목 0개는 기존 동작을 보존한다**
    - `allocationRule` 없는 호출 + 빈 `traitKeys`/0개 항목 스키마 생성기로 기존 사다리 경계 검증(또는 기본 EZFudge 네 키)이 그대로 수행되고, 0개 항목은 배분 검증이 적용되지 않음을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 20: 규칙 없는 호출과 평가 항목 0개는 기존 동작을 보존한다`, `numRuns: 100`
    - **Validates: Requirements 8.5, 8.6**

  - [ ]* 5.4 Property 21 속성 테스트 작성
    - **Property 21: 확정된 캐릭터는 모드와 무관하게 잠긴다**
    - Confirmed_State 캐릭터 + 임의 `Allocation_Rule` 생성기로 `recordCharacter`가 `ALREADY_CONFIRMED`로 거부하고 확정된 Rated_Trait_Set을 변경 없이 보존함을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 21: 확정된 캐릭터는 모드와 무관하게 잠긴다`, `numRuns: 100`
    - **Validates: Requirements 10.3**

- [x] 6. 체크포인트 - 검증 패리티 확인
  - [x] 6.1 프론트엔드·백엔드 검증기 통합 지점 정리
    - 프론트엔드 `validateAllocation`과 백엔드 검증 경로가 동일 알고리즘 명세(키 집합 → 모드별 판정 → 사유 분류)를 따르는지 대조하고, 모든 테스트가 통과하는지 확인한다. 의문이 생기면 사용자에게 질문한다

  - [ ]* 6.2 Property 17 속성 테스트 작성
    - **Property 17: 프론트엔드·백엔드 검증 패리티**
    - 네 모드 중 하나의 동일 `Allocation_Rule`과 동일 Rated_Trait_Set 생성기로, 같은 테스트에서 프론트엔드 `validateAllocation`과 백엔드 검증기를 모두 호출해 동일한 유효/무효 판정과(무효 시) 동일한 거부 사유 분류를 산출함을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 17: 프론트엔드·백엔드 검증 패리티`, `numRuns: 100`
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [x] 7. Initial_Allocation·남은 점수·고정값 재배정 (`public/character/logic.js`)
  - [x] 7.1 `initialAllocation` 구현 (모드별 정준 유효 집합)
    - `initialAllocation(rule, schema): Record<TraitKey, number>` → `LADDER_SELECT`/`DICE_ROLL`은 각 항목 `initialLevel(ladder)`, `POINT_BUY`는 모든 항목 Base_Level에서 시작해 스키마 정의 순서대로 사다리 max까지 올려 `pointPool`을 결정적으로 모두 소비한 집합, `FIXED_VALUE`는 `valuePool` 내림차순을 스키마 순서에 큰 값부터 일대일 배정한 집합을 반환한다
    - _Requirements: 4.6, 6.5_

  - [ ]* 7.2 Property 10 속성 테스트 작성
    - **Property 10: 모든 모드의 Initial_Allocation은 유효하다**
    - 네 모드 규칙·스키마 생성기로 `initialAllocation`이 만든 집합을 같은 테스트에서 프론트엔드 `validateAllocation`과 백엔드 검증기 모두에 통과시킴을 검증한다. 특히 `FIXED_VALUE` 다중집합 = `valuePool`, `POINT_BUY` `Σ(level − baseLevel) === pointPool` 확인
    - 태그 주석: `Feature: flexible-stat-allocation, Property 10: 모든 모드의 Initial_Allocation은 유효하다`, `numRuns: 100`
    - **Validates: Requirements 4.6, 6.5**

  - [x] 7.3 `pointBuyRemaining` 구현
    - `pointBuyRemaining(rule, set): number` → `pointPool − Σ(Trait_Level − baseLevel)`(모든 Rated_Trait 합)을 반환한다(순수 계산; 200ms 표시 타이밍은 부수효과 계층)
    - _Requirements: 3.6_

  - [ ]* 7.4 Property 8 속성 테스트 작성
    - **Property 8: POINT_BUY 남은 배분 점수 계산**
    - `POINT_BUY` 규칙 + 임의 Rated_Trait_Set 생성기로 `pointBuyRemaining`이 `pointPool − Σ(level − baseLevel)`과 정확히 같음을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 8: POINT_BUY 남은 배분 점수 계산`, `numRuns: 100`
    - **Validates: Requirements 3.6**

  - [x] 7.5 `assignFixedValue` 구현
    - `assignFixedValue(state, traitKey, valueInstanceIndex): state'` → `valuePool`의 값 인스턴스를 대상 Rated_Trait에 일대일 배정하고, 그 인스턴스가 직전에 다른 항목에 배정되어 있었다면 그 직전 항목을 미배정으로 되돌린다. 어떤 값 인스턴스도 동시에 둘 이상의 항목에 배정되지 않음을 보장한다
    - _Requirements: 4.5_

  - [ ]* 7.6 Property 9 속성 테스트 작성
    - **Property 9: FIXED_VALUE 일대일 배정 전이**
    - 고정값 배정 상태 + 값 인스턴스·대상 항목 생성기로 `assignFixedValue`가 대상에 배정하고 직전 항목을 미배정으로 복원하며 어떤 인스턴스도 중복 배정되지 않음을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 9: FIXED_VALUE 일대일 배정 전이`, `numRuns: 100`
    - **Validates: Requirements 4.5**

- [x] 8. 평가 편집·편집 모델·가시성 (`public/character/logic.js`)
  - [x] 8.1 `setTraitLevel` 배분 편집 적용 확장
    - 기존 `setTraitLevel(values, schema, traitKey, level)`를 배분 편집 맥락(특히 `DICE_ROLL` Forced_Random=false 편집)에서 재사용·확장한다: 지정 값이 그 Trait_Ladder 안 정수이면 해당 Trait_Key만 갱신, 사다리 밖·비정수이면 직전 Trait_Level을 변경 없이 유지한다
    - _Requirements: 5.9_

  - [x] 8.2 `allocationEditModel`·`computeVisibility` 모드별 읽기 전용 도출 구현
    - `allocationEditModel(rule, schema, values): {...}` → 모드별 편집 요소를 도출한다(`LADDER_SELECT` 사다리 선택, `POINT_BUY` Base 시작 + 남은 점수, `FIXED_VALUE` 일대일 배정, `DICE_ROLL` 굴림 동작 + 읽기 전용 여부)
    - `computeVisibility`를 확장해 (a) Confirmed_State이면 모드와 무관하게 모든 평가 편집 요소·Dice_Roll_Action을 읽기 전용으로 도출하고 표시 Trait_Level을 확정 시점 값으로 유지, (b) `DICE_ROLL` + `forcedRandom`=true이면 비확정이라도 모든 평가 편집 요소를 읽기 전용으로, false이면 굴림 이후 편집 가능으로 도출한다
    - `reduce`가 확정 상태에서의 평가 편집·굴림 시도에 대해 모든 Trait_Level을 변경하지 않도록 보장한다
    - _Requirements: 5.5, 5.6, 10.1, 10.2_

  - [ ]* 8.3 Property 15 속성 테스트 작성
    - **Property 15: 평가 편집은 해당 항목만 갱신하고 무효 값은 거부한다**
    - 현재 Rated_Trait_Set + Trait_Key·지정 값(유효/사다리 밖/비정수) 생성기로 `setTraitLevel`이 유효 값이면 해당 키만 갱신·나머지 불변, 무효 값이면 직전 Trait_Level 유지임을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 15: 평가 편집은 해당 항목만 갱신하고 무효 값은 거부한다`, `numRuns: 100`
    - **Validates: Requirements 5.9**

  - [ ]* 8.4 Property 16 속성 테스트 작성
    - **Property 16: 읽기 전용 도출 (Forced_Random · Confirmed_State)**
    - 모드·작성 상태 생성기로 `allocationEditModel`/`computeVisibility`가 (a) Confirmed_State 시 모드 무관 읽기 전용 + Trait_Level 유지, (b) `DICE_ROLL` forcedRandom=true 읽기 전용·false 편집 가능을 도출하고, 확정 상태 편집·굴림 시도 시 `reduce`가 Trait_Level을 변경하지 않음을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 16: 읽기 전용 도출 (Forced_Random · Confirmed_State)`, `numRuns: 100`
    - **Validates: Requirements 5.5, 5.6, 10.1, 10.2**

- [ ] 9. DICE_ROLL 서버 측 굴림 순수 로직 (`public/character/logic.js`)
  - [x] 9.1 `parseDiceFormula` 구현
    - `parseDiceFormula(formula): { count, sides, modifier } | null` → `NdM`·`NdM+K`·`NdM-K`를 파싱(`count ≥ 1`, `sides ≥ 1`, `modifier` 없으면 0), 문법에 맞지 않으면 `null`을 반환한다
    - _Requirements: 5.1, 5.3_

  - [ ]* 9.2 Property 12 속성 테스트 작성
    - **Property 12: Dice_Formula 파싱 라운드 트립**
    - 유효 `{count≥1, sides≥1, 정수 modifier}` 생성기로 표준 문자열(`NdM`/`NdM±K`)로 출력 후 `parseDiceFormula`로 다시 파싱하면 원래 값과 동등하고, 비문법 문자열은 `null`을 반환함을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 12: Dice_Formula 파싱 라운드 트립`, `numRuns: 100`
    - **Validates: Requirements 5.1, 5.3**

  - [x] 9.3 `rollAllocation` 구현 (rng 주입 + clamp)
    - `rollAllocation(rule, schema, rng): Record<TraitKey, number>` → 각 Rated_Trait에 대해 `diceFormula`를 주입 무작위원(rng)으로 굴려 합·보정을 구하고, 결과를 그 Trait_Ladder로 clamp(min 미만→min, max 초과→max, 사이→그대로)한 정수 Trait_Level을 돌려준다(무작위 생성은 주입원/서버 책임)
    - _Requirements: 5.3_

  - [ ]* 9.4 Property 11 속성 테스트 작성
    - **Property 11: DICE_ROLL 굴림 결과는 항상 사다리 안으로 한정된다**
    - `DICE_ROLL` 규칙·스키마 + 결정적 시드 rng(경계 0, 1−ε 포함) 생성기로 `rollAllocation` 산출 Trait_Level이 항상 사다리 안 정수로 clamp됨을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 11: DICE_ROLL 굴림 결과는 항상 사다리 안으로 한정된다`, `numRuns: 100`
    - **Validates: Requirements 5.3**

  - [x] 9.5 `buildRollRequest` 구현
    - `buildRollRequest(handoff): { url, method, headers, body }` → `POST /rooms/{encodeURIComponent(roomId)}/allocation-roll`(의도된 계약)을 구성하고, Access_Token이 비어 있지 않으면 `x-playtest-token` 헤더에 변형 없이 포함하며 비어 있으면 미포함한다. 어떤 무작위 값도 클라이언트에서 생성하지 않는다
    - _Requirements: 5.2_

  - [ ]* 9.6 Property 13 속성 테스트 작성
    - **Property 13: 굴림 요청 명세와 토큰 전달**
    - 인계 값(roomId·playerId·token, 빈/비공백 토큰) 생성기로 `buildRollRequest`가 그 roomId로 엔드포인트를 대상 지정하고, 비공백 토큰만 `x-playtest-token`에 변형 없이 포함하며, 요청 구성이 무작위를 만들지 않음을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 13: 굴림 요청 명세와 토큰 전달`, `numRuns: 100`
    - **Validates: Requirements 5.2**

  - [x] 9.7 `validateRollResponse`와 굴림 결과 `reduce` 처리 구현
    - `validateRollResponse(body, schema): { ok: true, values } | { ok: false }` → 본문이 스키마의 모든 Rated_Trait에 정수 Trait_Level을 담을 때에만 `ok: true`
    - `reduce`에 굴림 성공/실패/무효 응답 액션을 추가한다: 유효 응답이면 Trait_Level 적용(forcedRandom에 따라 읽기전용/편집가능), 무효 응답·타임아웃·네트워크·서버 오류이면 모든 기존 Trait_Level을 변경 없이 유지하고 한국어 오류 안내를 설정하며 무작위를 클라이언트에서 만들지 않는다
    - _Requirements: 5.7, 5.8_

  - [ ]* 9.8 Property 14 속성 테스트 작성
    - **Property 14: 굴림 응답 검증과 실패 시 값 보존**
    - 스키마 + 굴림 응답 본문 생성기(모든 키 정수=유효, 일부 누락·비정수=무효)와 전송 오류(타임아웃·네트워크·서버)로 `validateRollResponse` 판정과, 무효·오류 결과를 reduce 한 뒤에도 모든 기존 Trait_Level이 보존되고 오류 안내가 설정됨을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 14: 굴림 응답 검증과 실패 시 값 보존`, `numRuns: 100`
    - **Validates: Requirements 5.7, 5.8**

- [x] 10. 거부 사유 매핑과 입력 보존 (`public/character/logic.js`)
  - [x] 10.1 `classifyRecordResult`·`RECORD_REJECTION_MESSAGES`·`reduce` 확장 구현
    - `classifyRecordResult`에 `INVALID_ALLOCATION` 분기를 추가하고, `RECORD_REJECTION_MESSAGES`에 배분 규칙(총합 또는 고정값 배정) 미충족 한국어 메시지를 추가한다(기존 `INVALID_ATTRIBUTES` 사다리 범위 안내와 구분)
    - `reduce`가 `INVALID_ALLOCATION`·`INVALID_ATTRIBUTES` 거부 결과를 받으면 플레이어 입력(Narrative_Field 값(이름·컨셉)·Rated_Trait_Set)을 변경 없이 보존하고, 거부 사유에 대응하는 한국어 안내를 설정하며, 캐릭터를 Confirmed_State로 전이시키지 않게 한다
    - _Requirements: 8.7, 9.1, 9.2, 9.4_

  - [ ]* 10.2 Property 23 속성 테스트 작성
    - **Property 23: 배분 거부는 입력을 보존하고 확정을 막는다**
    - 작성 상태 + 거부 결과(`INVALID_ALLOCATION`/`INVALID_ATTRIBUTES`) 생성기로 reduce 후 Narrative_Field(이름·컨셉)·Rated_Trait_Set이 보존되고, 사유별 한국어 안내가 설정되며, Confirmed_State로 전이하지 않음을 검증
    - 태그 주석: `Feature: flexible-stat-allocation, Property 23: 배분 거부는 입력을 보존하고 확정을 막는다`, `numRuns: 100`
    - **Validates: Requirements 8.7, 9.1, 9.2, 9.4**

  - [ ]* 10.3 거부 문구·초기 표시 예제 테스트 작성
    - `INVALID_ALLOCATION`(POINT_BUY 합 초과·FIXED_VALUE 일대일 배정 위반)과 `INVALID_ATTRIBUTES`(사다리 범위 이탈)의 한국어 메시지 문구(요구사항 9.1, 9.2, 9.4)와, `POINT_BUY` 초기 표시값이 모든 항목 Base_Level임(요구사항 3.5)을 예제로 검증
    - _Requirements: 3.5, 9.1, 9.2, 9.4_

- [x] 11. 정적 페이지 부수효과 배선 (`public/character/index.html`)
  - [x] 11.1 모드별 렌더·굴림 요청·인디케이터·잠금 배선
    - `allocationEditModel`/`computeVisibility`/`renderModel`로 모드별 편집 UI를 동적 렌더한다(LADDER_SELECT 사다리 선택, POINT_BUY 남은 점수 표시, FIXED_VALUE 일대일 배정 UI, DICE_ROLL 굴림 버튼)
    - `DICE_ROLL` Dice_Roll_Action 시 `buildRollRequest`로 `Allocation_Roll_Endpoint`에 `fetch`하고, 주입 가능한 `AbortController` 기반 10초 타임아웃을 적용한다. 응답은 `validateRollResponse`로 검증해 유효 시에만 적용하고, 타임아웃·네트워크·서버·무효 응답이면 한국어 오류를 표시하고 기존 Trait_Level을 유지한다(무작위를 클라이언트에서 만들지 않음)
    - `POINT_BUY` 남은 점수·`FIXED_VALUE` 재배정 결과를 200ms 이내에 표시하고, `forcedRandom`=true·Confirmed_State 시 모든 평가 편집 요소·굴림 동작을 읽기 전용으로 배선한다
    - `INVALID_ALLOCATION`/`INVALID_ATTRIBUTES` 거부 시 한국어 안내 표시 + 입력 보존을 배선한다. 규칙 무효 스키마는 `LADDER_SELECT` 기본 스키마로 폴백하고 안내를 표시한다
    - _Requirements: 3.5, 3.6, 4.5, 5.2, 5.5, 5.6, 5.7, 5.8, 7.4, 8.7, 9.1, 9.2, 9.4, 10.1, 10.2_

  - [ ]* 11.2 통합 테스트 작성 (happy-dom + fake timers + 가짜 fetch)
    - 가짜 타이머로 10초 경과 시 `AbortController`가 굴림 `fetch`를 취소하는지, 200ms 이내 남은 점수·재배정·인디케이터 표시 타이밍을 검증한다
    - 가짜 fetch로 굴림 성공 응답 적용·무효 응답/오류 시 기존 값 보존, `forcedRandom`=true 읽기전용, 모드별 동적 렌더와 규칙 무효 시 Default 폴백을 검증한다
    - _Requirements: 3.6, 4.5, 5.2, 5.7, 5.8, 7.4_

- [x] 12. 최종 체크포인트 - 모든 테스트 통과 확인
  - 모든 속성·예제·통합 테스트가 통과하는지 확인하고, 의문이 생기면 사용자에게 질문한다.

## Notes

- `*`로 표시된 하위 작업은 선택 사항(테스트)이며 빠른 MVP를 위해 건너뛸 수 있다. 핵심 구현 작업은 표시되지 않는다.
- Correctness Property 1~23은 각각 정확히 하나의 속성 기반 테스트로 구현되며, 구현 직후 가까운 위치에 배치해 오류를 조기에 잡는다. 검증 패리티(Property 17)와 Initial_Allocation 유효성(Property 10)은 프론트엔드 `validateAllocation`과 백엔드 검증기를 같은 테스트에서 import 해 동일 생성 입력으로 대조한다.
- 모든 속성 테스트는 `numRuns: 100` 이상으로 실행하고 `Feature: flexible-stat-allocation, Property {N}: {텍스트}` 태그를 주석으로 단다.
- 200ms 인디케이터 타이밍·10초 타임아웃 발화·실제 무작위 생성·특정 시나리오 보존(1.4·1.5·1.6)·`POINT_BUY` 초기 표시값(3.5)·한국어 문구(7.4·9.1·9.2·9.4) 등 속성으로 다루지 않는 요구사항은 예제·통합 테스트(2.6, 10.3, 11.2)로 검증한다.
- 설계 "요구사항 정합성 메모"의 두 결정(FIXED_VALUE 위반은 `INVALID_ALLOCATION`으로 통일, POINT_BUY 초기 표시와 정준 Initial_Allocation 분리)을 따른다. 설계 "열린 질문"이 요구사항 단계로 확정되면 4.x·7.x 작업을 그에 맞춰 갱신한다.
- 모든 외부 의존성(`fetch`, 타이머, 무작위원, DOM)은 주입 가능하게 만들어 아직 배선되지 않은 의도된 엔드포인트도 모킹/주입으로 완전히 테스트한다.
- 각 작업은 추적성을 위해 구체적인 요구사항 절을 참조한다.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "3.2", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4", "4.5", "5.1", "7.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "6.2", "7.2", "7.3"] },
    { "id": 5, "tasks": ["7.4", "7.5"] },
    { "id": 6, "tasks": ["7.6", "8.1"] },
    { "id": 7, "tasks": ["8.2"] },
    { "id": 8, "tasks": ["8.3", "8.4", "9.1"] },
    { "id": 9, "tasks": ["9.2", "9.3"] },
    { "id": 10, "tasks": ["9.4", "9.5"] },
    { "id": 11, "tasks": ["9.6", "9.7"] },
    { "id": 12, "tasks": ["9.8", "10.1"] },
    { "id": 13, "tasks": ["10.2", "10.3", "11.1"] },
    { "id": 14, "tasks": ["11.2"] }
  ]
}
```
