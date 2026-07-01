# Design Document

## Overview

이 문서는 ready-gm의 **유연한 능력치 배분(flexible-stat-allocation)** 횡단 관심사 설계를 정의한다. 목표는 현재 "각 평가 항목을 자기 사다리 안에서 독립적으로 고르는" 단일 방식만 지원하는 캐릭터 시트를, **교체 가능한 배분 규칙(Allocation_Rule)** 하나를 시트 스키마(Active_Sheet_Schema)에 실어 보내는 **단일 소켓(single pluggable structure)** 구조로 일반화하는 것이다.

핵심 설계 원칙은 다음과 같다.

- **하나의 규칙, 네 종류**: 시트 스키마에 정확히 하나의 `Allocation_Rule`을 싣고, 그 규칙의 `Allocation_Mode`(`LADDER_SELECT`·`POINT_BUY`·`FIXED_VALUE`·`DICE_ROLL`) 하나로 능력치 한 벌(Rated_Trait_Set)의 유효성을 판정한다. 시트 렌더·기록·확정의 골격은 그대로 두고 규칙 한 종류를 더하는 것으로 새 방식을 추가한다.
- **검증 패리티(validation parity)**: 동일한 `Allocation_Rule`과 동일한 `Rated_Trait_Set`에 대해 프론트엔드 순수 검증기(`public/character/logic.js`)와 백엔드 검증기(`CharacterService.recordCharacter`)가 **동일한 유효/무효 판정과 동일한 거부 사유 분류**를 산출한다.
- **기존 동작 보존**: `UNIVERSAL_SHEET`·`GEESE_SHEET`·`SINKS_SHEET`의 능력치 배분 동작은 `LADDER_SELECT`(거위는 사다리 `{1,4}`, 싱크는 평가 항목 0개)로 그대로 보존된다.
- **서버 측 무작위**: 랜덤 배분(`DICE_ROLL`)의 굴림은 항상 서버가 생성한다(프로젝트 규약). 클라이언트는 무작위 값을 만들지 않는다.

### 설계 목표

- 요구사항 1~10을 모두 충족하는, 시트 스키마 해석·프론트엔드 순수 로직·백엔드 서비스 로직의 확장 설계를 정의한다.
- 기존 `character-sheet`·`room-lobby` 스펙이 확립한 아키텍처·관례를 **그대로 미러링**한다(빌드 단계 없는 정적 `public/*.html`, 바닐라 JS ES 모듈, 순수 로직 분리, vitest + fast-check, 서버 측 무작위 주입).
- 배분 검증(Allocation_Validator)을 DOM·네트워크·무작위에서 분리된 **순수 함수**로 명세해, 아직 배선되지 않은 의도된 엔드포인트에 대해서도 모킹/주입으로 완전히 단위·속성 테스트할 수 있게 한다.

### 백엔드 계약 매핑 (실제 코드 근거)

본 설계는 다음 실제 코드 계약 위에서 동작을 정의한다(요구사항 "백엔드/프론트엔드 계약 근거" 절과 일치).

| 구성요소 | 실제 코드 근거 | 본 스펙의 확장 |
| --- | --- | --- |
| `SheetSchema` / `RatedTraitSpec` | `src/services/sheet-schema.ts` | `SheetSchema`에 `allocation: Allocation_Rule` 필드 1개 추가 |
| `sheetSchemaForScenario` / `expectedTraitSpecForScenario` | `src/services/sheet-schema.ts` | 해석 시 정확히 하나의 `Allocation_Rule`을 싣고(미지정·무효 시 `LADDER_SELECT`), 검증 정보에 규칙을 포함 |
| `CharacterService.recordCharacter` / `RecordCharacterOptions` | `src/services/character-service.ts` | `options.allocationRule`(의도된 확장) 수용, `INVALID_ALLOCATION` 거부 사유 추가 |
| `isValidAttributeLevel` / `AttributeLadder` / `DEFAULT_ATTRIBUTE_LADDER` | `src/core/ezfudge.ts` | 사다리 경계 검증을 그대로 재사용(정수 + 구간) |
| `Scenario` (`hasSpecialRules`·`system`·`id`) | `src/services/scenario-service.ts` | 시나리오별 규칙계 구분(현행 시트 선택 방식과 동일) |
| `validateSchema` / `selectActiveSchema` / `renderModel` / `defaultSheetSchema` | `public/character/logic.js` | `Allocation_Rule` 검증·정규화·폴백, 모드별 렌더·초기값·검증 순수 함수 추가 |
| 서버 측 다이스 (`public/game/dice.js`, `src/core/dice.js`) | rng 주입형 균등 굴림 | `DICE_ROLL`의 Dice_Formula를 서버 측 주입 무작위로 굴려 한정(clamp) |

> **범위 밖(요구사항 가정과 동일)**: 시트 스키마·기록·확정·굴림 엔드포인트의 실제 HTTP/실시간 배선은 의도된 계약으로 둔다. 본 설계는 그 계약 위에서 순수 로직과 서비스 로직을 명세하며, `fetch`·타이머·네비게이션·무작위원은 모두 주입 가능(injectable)하게 만들어 모킹으로 테스트한다.

### 요구사항 정합성 메모 (Requirement Reconciliation Notes)

설계 중 요구사항 간 두 가지 **충돌 가능 지점**을 발견했다. 본 설계는 아래 결정으로 진행하되, 요구사항 명확화 단계로 되돌릴 것을 권한다(문서 끝 "열린 질문" 참조).

1. **`FIXED_VALUE`의 사다리 위반 분류 — 4.4 vs 8.2/9.3.**
   - 요구사항 9.3과 8.2는 "어떤 모드에서든 사다리 밖/비정수 값은 `INVALID_ATTRIBUTES`"라는 **일반 규칙**을 둔다.
   - 요구사항 4.4는 `FIXED_VALUE`에서 사다리 밖/비정수 값을 **`INVALID_ALLOCATION`**으로 분류한다.
   - **결정**: 모드별 요구사항(2·3·4·5)을 더 구체적인 규칙으로 보아 **특수 우선(specific-over-general)** 으로 해석한다. 즉 `LADDER_SELECT`·`POINT_BUY`·`DICE_ROLL`의 사다리 위반은 `INVALID_ATTRIBUTES`(9.3), `FIXED_VALUE`의 모든 위반(다중집합 불일치 + 사다리 위반)은 `INVALID_ALLOCATION`(4.3·4.4)으로 분류한다. 패리티(요구사항 6.3)는 두 검증기가 이 동일한 분류를 따르도록 보장한다.

2. **`POINT_BUY`의 Initial_Allocation 유효성 — 3.5 vs 6.5.**
   - 요구사항 3.5(+Glossary 예시)는 `POINT_BUY` 초기 *표시*를 "모든 항목 Base_Level"로 둔다(소비 점수 0).
   - 요구사항 6.5(+Glossary 정의)는 모든 모드의 **Initial_Allocation은 유효**여야 한다고 요구한다. 그러나 `Point_Pool > 0`이면 "모두 Base_Level"은 소비 합 0 ≠ Point_Pool이어서 `POINT_BUY` 유효 조건(3.2)을 충족하지 못한다.
   - **결정**: 두 개념을 분리한다 — (a) **초기 표시(initial display)**: `POINT_BUY` 화면은 모든 항목을 Base_Level로 시작하고 남은 점수 인디케이터로 `Point_Pool`을 안내한다(3.5·3.6). 이 상태는 점수를 다 쓰기 전까지 *미완성(저장 시 무효)*이다. (b) **Initial_Allocation(검증 패리티용 정준 유효 집합)**: 각 모드가 정의하는 **유효한** 시작 집합이며, `POINT_BUY`는 모든 항목을 Base_Level로 둔 뒤 스키마 정의 순서대로 각 항목을 사다리 최대치까지 올려 `Point_Pool`을 결정적으로 모두 소비한 집합으로 정의한다(3.1이 `Point_Pool ≤ 총 여유분`을 보장하므로 항상 구성 가능). `Point_Pool = 0`이면 이는 "모두 Base_Level"과 같다. 요구사항 6.5의 속성은 이 정준 Initial_Allocation에 대해 성립한다.

## Architecture

### 단일 소켓(Single Pluggable Structure) 개요

```mermaid
graph TD
  subgraph Resolver["Sheet_Schema_Resolver (src/services/sheet-schema.ts)"]
    SC["Scenario"] --> SS["Active_Sheet_Schema<br/>traits[] + <b>allocation: Allocation_Rule</b>"]
  end

  SS -->|스키마 응답| FE
  SS -->|검증 정보(규칙 포함)| BE

  subgraph FE["Frontend (public/character/logic.js)"]
    FV["validateSchema → Allocation_Rule 검증·폴백"]
    FR["renderModel / initialAllocation (모드별 편집 UI·초기값)"]
    FA["<b>validateAllocation(rule, schema, set)</b><br/>Frontend_Allocation_Validator"]
  end

  subgraph BE["Backend (src/services/character-service.ts)"]
    BA["recordCharacter(..., { allocationRule })<br/><b>Backend_Allocation_Validator</b>"]
  end

  subgraph Roll["Allocation_Roll_Endpoint (의도된 계약)"]
    DR["Dice_Formula 파싱 → 서버 측 무작위 굴림 → 사다리로 clamp"]
  end

  FR -. "DICE_ROLL: Dice_Roll_Action" .-> DR
  DR -. "각 Trait_Level (clamp된 정수)" .-> FR
  FA -. "동일 규칙·동일 집합 → 동일 판정 (검증 패리티)" .-> BA
```

**핵심 추상**: `Allocation_Rule`은 정확히 하나의 `Allocation_Mode`와 그 모드에 필요한 매개변수만 담는 판별 유니온(discriminated union)이다. 시트 렌더·기록·확정 골격은 규칙의 *종류*를 직접 분기하지 않고, 모드별 전략(검증·초기값·편집 UI)을 한 곳(`Allocation_Validator`, `initialAllocation`, 렌더 모델)에서 디스패치한다. 새 모드 추가 = 이 전략 테이블에 한 항목 추가.

### 계층 분리 원칙 (sibling 미러링)

`character-sheet` 스펙과 동일한 3계층을 유지한다.

- **순수 로직 계층**: 프론트엔드는 `public/character/logic.js`에 모드별 **배분 검증·초기값·스키마 규칙 검증·고정값 배정 전이·굴림 응답 검증** 순수 함수를 추가한다. 백엔드는 `src/services/character-service.ts`(+필요 시 `src/core`의 작은 공유 스펙 모듈)에 **배분 검증**을 추가한다. 무작위는 주입원으로 받는다.
- **부수효과 계층**: `public/character/index.html`의 스크립트가 `fetch`(굴림 요청 포함)·`AbortController` 10초 타임아웃·200ms 인디케이터·DOM 갱신을 담당한다.
- **View 계층**: 단일 상태에서 도출한 렌더 모델로 화면을 그린다. 모드에 따라 평가 편집 요소의 형태(사다리 선택 / 포인트 배분 / 고정값 일대일 배정 / 굴림 후 표시)가 달라진다.

### 검증 패리티 전략

프론트엔드(JS, `public/`)와 백엔드(TS, `src/`)는 빌드 단계가 없어 동일 모듈을 직접 공유하지 않는다. 따라서 **동일한 검증 알고리즘 명세**(아래 "배분 검증 알고리즘")를 두 곳에서 각각 구현하고, 두 구현이 동일 입력에 동일 판정을 내림을 **패리티 속성 테스트**로 보장한다(요구사항 6). 패리티 테스트는 vitest에서 프론트엔드 `validateAllocation`(`public/character/logic.js`)과 백엔드 검증기를 모두 import 해 동일 생성 입력으로 대조한다.

### 배분 검증 알고리즘 (Allocation Validation Algorithm) — 패리티의 단일 명세

입력: `rule: Allocation_Rule`, `schema`(정의된 Trait_Key 목록과 각 Trait_Ladder), `set: Rated_Trait_Set`.
출력: `{ ok: true }` 또는 `{ ok: false, reason: "INVALID_ATTRIBUTES" | "INVALID_ALLOCATION" }`.

공통 선행 검사(키 집합): `set`이 스키마가 정의한 모든 Trait_Key에 정확히 하나의 값을 부여하고, 정의되지 않은 Trait_Key를 포함하지 않아야 한다. 위반 시 `INVALID_ATTRIBUTES`(요구사항 2.4). 평가 항목이 0개인 스키마(서사 전용)는 항상 유효(검증 미적용, 요구사항 8.6).

모드별 판정:

- **`LADDER_SELECT`** (요구사항 2)
  1. 각 Trait_Level이 자신의 Trait_Ladder 안의 정수인가? 아니면 `INVALID_ATTRIBUTES`.
  2. 항목 간 제약 없음 → 통과 시 유효.

- **`POINT_BUY`** (요구사항 3) — 2단계
  1. **사다리 경계**: 각 Trait_Level이 `Base_Level` 이상이며 자신의 Trait_Ladder 안의 정수인가? 아니면 `INVALID_ATTRIBUTES`(요구사항 3.4·8.2).
  2. **배분 제약**: `Σ(Trait_Level − Base_Level) === Point_Pool`인가? 아니면(초과 또는 미달) `INVALID_ALLOCATION`(요구사항 3.3·8.3).

- **`FIXED_VALUE`** (요구사항 4) — 단일 배분 제약(특수 우선 결정)
  - 모든 Trait_Level을 모은 다중집합이 `Value_Pool` 다중집합과 원소·개수 모두 정확히 일치하고, 각 Trait_Level이 자신의 Trait_Ladder 안의 정수인가? 모두 참이면 유효, 하나라도 위반이면 `INVALID_ALLOCATION`(요구사항 4.2·4.3·4.4).

- **`DICE_ROLL`** (요구사항 5)
  1. 각 Trait_Level이 자신의 Trait_Ladder 안의 정수인가? 아니면 `INVALID_ATTRIBUTES`.
  2. 항목 간 제약 없음 → 통과 시 유효(굴림 결과는 서버가 사다리로 clamp하므로 항상 사다리 안).

백엔드 기록(요구사항 8)은 이 알고리즘을 호출하되, 사다리 경계 위반(`INVALID_ATTRIBUTES`)이면 배분 제약을 검사하지 않고 즉시 거부하며 어떤 데이터도 기록·갱신하지 않는다. 통과 시에만 확정 전 캐릭터를 그 집합으로 기록한다(요구사항 8.4). 확정된 캐릭터는 모드와 무관하게 `ALREADY_CONFIRMED`로 거부(요구사항 10.3).

### 결정성·멱등성

배분 검증은 순수 함수이며 직전 판정 상태에 의존하지 않는다. 동일 규칙·동일 집합을 여러 번 판정해도 매번 동일한 판정·동일한 거부 사유를 산출한다(요구사항 6.4).

## Components and Interfaces

### 1. Sheet_Schema_Resolver — 단일 배분 규칙 부착 (`src/services/sheet-schema.ts`)

- **책임**
  - 시나리오를 해석한 `Active_Sheet_Schema`에 정확히 하나의 `Allocation_Rule`을 싣는다. 시나리오가 규칙을 지정하지 않거나 모드가 네 종류와 일치하지 않으면 `LADDER_SELECT`로 둔다(요구사항 1.1·1.2·1.3).
  - `UNIVERSAL_SHEET`→`LADDER_SELECT`(요구사항 1.4), `terrible-geese`→`LADDER_SELECT` + 세 항목 사다리 `{1,4}`(요구사항 1.5), 평가 항목 0개 시트→`LADDER_SELECT`(요구사항 1.6)로 기존 동작을 보존한다.
  - 모드별 매개변수 적법성을 보장한다: `POINT_BUY`는 정수 `Base_Level`(모든 사다리 안)과 `0 ≤ Point_Pool ≤ Σ(ladder.max − Base_Level)`(요구사항 3.1); `FIXED_VALUE`는 정수 원소·개수 = Rated_Trait 개수(≥1)인 `Value_Pool`(요구사항 4.1); `DICE_ROLL`은 `Dice_Formula`와 `Forced_Random`(미제공 시 거짓, 요구사항 5.1).
- **인터페이스**
  - `sheetSchemaForScenario(scenario): SheetSchema` — 기존 시그니처 유지, 반환 스키마에 `allocation` 추가.
  - `expectedTraitSpecForScenario(scenario): { keys, ladder, allocation }` — 서버 검증용 정보에 `allocation` 포함(또는 동등한 검증 정보). 기존 `keys`·`ladder` 보존.
  - 내부: `defaultAllocationRule(): { mode: "LADDER_SELECT" }`, `normalizeAllocationRule(raw, traits): Allocation_Rule` — 무효 입력을 `LADDER_SELECT`로 보정.

### 2. Allocation_Validator — 공유 검증 명세 (Frontend + Backend)

위 "배분 검증 알고리즘"을 실현하는 한 쌍의 구현.

- **Frontend_Allocation_Validator** (`public/character/logic.js`)
  - `validateAllocation(rule, schema, ratedTraitSet): { ok: true } | { ok: false, reason }` — 모드별 판정(순수).
  - 내부 헬퍼: `pointBuySpent(set, baseLevel)`, `multisetEqual(a, b)`, `withinLadder(level, ladder)`(기존 `isValidLevel` 재사용).
- **Backend_Allocation_Validator** (`src/services/character-service.ts`)
  - `recordCharacter(playerId, input, options?)`가 `options.allocationRule`을 받으면 동일 알고리즘으로 판정한다. 기존 `traitKeys`·`ladder` 기반 사다리 경계 검증은 알고리즘의 1단계로 흡수한다.

### 3. Allocation_Rule 확장 — `RecordCharacterOptions` (`src/services/character-service.ts`)

- **책임**
  - `options.allocationRule`이 주어지면 그 규칙으로 배분을 검증한다(요구사항 8.1). 사다리 경계 위반은 `INVALID_ATTRIBUTES`, 배분 제약 위반은 `INVALID_ALLOCATION`으로 거부하고 어떤 데이터도 기록하지 않는다(요구사항 8.2·8.3).
  - `allocationRule` 없이(기존 호출 형태) 호출되면 기존 동작(`traitKeys`·`ladder`, 또는 옵션 생략 시 기본 EZFudge 네 키)을 변경 없이 수행한다(요구사항 8.5). 빈 `traitKeys`/0개 항목은 검증 미적용(요구사항 8.6).
- **인터페이스(확장)**
  ```ts
  interface RecordCharacterOptions {
    traitKeys?: string[];        // 기존
    ladder?: AttributeLadder;    // 기존
    allocationRule?: AllocationRule; // 의도된 확장
  }
  type RecordCharacterResult =
    | { ok: true; character: Character }
    | { ok: false; reason: "NAME_TAKEN"; message: string }
    | { ok: false; reason: "ALREADY_CONFIRMED"; message: string }
    | { ok: false; reason: "INVALID_ATTRIBUTES"; message: string }
    | { ok: false; reason: "INVALID_ALLOCATION"; message: string } // 신규 (요구사항 8.3)
    | { ok: false; reason: "UNKNOWN_PLAYER"; message: string }
    | { ok: false; reason: "NO_CHARACTER"; message: string };
  ```

### 4. Schema_Engine 확장 — 규칙 검증·폴백 (`public/character/logic.js`)

- **책임**
  - 스키마 응답의 `Allocation_Rule`을 검증한다: 모드가 네 종류 중 하나이고 그 모드의 필수 매개변수를 모두 갖출 때에만 유효(요구사항 7.1). `POINT_BUY`는 정수 `Base_Level` + 0 이상 정수 `Point_Pool`; `FIXED_VALUE`는 정수 원소·개수 = Rated_Trait 개수인 `Value_Pool`; `DICE_ROLL`은 공백 제거 시 1자 이상 `Dice_Formula` + 불리언 `Forced_Random`.
  - 규칙 누락/무효이면 그 스키마를 채택하지 않고 `Default_Sheet_Schema`(모드 `LADDER_SELECT`)로 폴백하고 한국어 안내를 표시한다(요구사항 7.2·7.3·7.4).
- **인터페이스(확장)**
  - `validateSchema(body): { ok: true, schema } | { ok: false }` — 기존 검증에 `validateAllocationRule(body.allocation, traits)`를 추가.
  - `validateAllocationRule(raw, traits): { ok: true, rule } | { ok: false }`.
  - `defaultSheetSchema()` — 기존 Default에 `allocation: { mode: "LADDER_SELECT" }` 포함(요구사항 7.3).
  - `selectActiveSchema(outcome)` — 규칙 무효도 폴백 경로로 흡수(항상 정확히 하나의 유효 Active_Sheet_Schema + 유효 규칙).

### 5. Allocation_Renderer & Initial_Allocation — 모드별 편집 UI·초기값 (`public/character/logic.js`)

- **책임**
  - 모드별 편집 모델을 도출한다: `LADDER_SELECT`(사다리 선택, 기존), `POINT_BUY`(Base_Level 시작 + 남은 점수 표시), `FIXED_VALUE`(Value_Pool 일대일 배정), `DICE_ROLL`(굴림 동작 + Forced_Random 시 읽기 전용).
  - 모드별 **Initial_Allocation**(정준 유효 시작 집합)을 계산한다(요구사항 3.5·4.6·6.5). 정의는 "요구사항 정합성 메모 2" 참조.
  - `POINT_BUY`: 어떤 Trait_Level이 표시·변경되면 `남은 점수 = Point_Pool − Σ(Trait_Level − Base_Level)`를 계산한다(요구사항 3.6; 200ms 표시는 부수효과 계층 타이밍).
  - `FIXED_VALUE`: Value_Pool 각 값 인스턴스를 정확히 한 Rated_Trait에 일대일 배정하고, 이미 배정된 인스턴스를 다른 항목으로 옮기면 직전 항목을 미배정으로 되돌린다(요구사항 4.5; 200ms는 타이밍). 초기 배정은 Value_Pool 내림차순을 스키마 정의 순서에 큰 값부터 배정(요구사항 4.6).
- **인터페이스**
  - `initialAllocation(rule, schema): Record<TraitKey, number>` — 모드별 정준 유효 집합.
  - `pointBuyRemaining(rule, set): number` — 남은 배분 점수(요구사항 3.6).
  - `assignFixedValue(state, traitKey, valueInstanceIndex): state'` — 고정값 일대일 재배정(이전 항목 미배정 복원, 요구사항 4.5).
  - `allocationEditModel(rule, schema, values): {...}` — 모드별 편집 요소 도출(읽기 전용 여부 포함).

### 6. Dice_Roll_Client & Allocation_Roll_Endpoint — 서버 측 굴림 (요구사항 5)

- **책임 (프론트엔드)**
  - `DICE_ROLL`에서 Dice_Roll_Action 시 `Room_Id`(+있으면 Access_Token)를 담아 `Allocation_Roll_Endpoint`에 굴림을 요청하고, 무작위를 클라이언트에서 생성하지 않는다(요구사항 5.2).
  - 응답이 모든 Rated_Trait에 정수 Trait_Level을 담을 때에만 적용한다. 누락·비정수면 적용하지 않고 한국어 오류를 표시하며 기존 값을 유지한다(요구사항 5.8).
  - 타임아웃 10초 초과·네트워크·서버 오류면 한국어 오류를 표시하고 기존 Trait_Level을 유지하며 무작위를 만들지 않는다(요구사항 5.7).
  - `Forced_Random`이 참이면 모든 평가 편집 요소를 읽기 전용으로(요구사항 5.5), 거짓이면 굴림 후 각 항목을 사다리 안 정수로 편집 가능(요구사항 5.6). 편집 시 사다리 밖/비정수 값은 적용하지 않고 직전 값 유지(요구사항 5.9).
- **책임 (의도된 백엔드 엔드포인트)**
  - 각 Rated_Trait에 대해 `Dice_Formula`를 **서버 측 주입 무작위**로 굴려 합을 구하고, 결과를 그 Rated_Trait의 Trait_Ladder로 **clamp**(min 미만→min, max 초과→max, 사이→그대로)한 정수 Trait_Level을 돌려준다(요구사항 5.3).
- **인터페이스**
  - `buildRollRequest(handoff): { url, method, headers, body }` — `POST /rooms/{roomId}/allocation-roll`(의도된 계약), Access_Token은 `x-playtest-token` 헤더.
  - `validateRollResponse(body, schema): { ok: true, values } | { ok: false }` — 모든 Trait_Key 정수 검증(요구사항 5.8).
  - `parseDiceFormula(formula): { count, sides, modifier } | null` — `NdM`·`NdM±K` 파싱.
  - `rollAllocation(rule, schema, rng): Record<TraitKey, number>` — 항목별 굴림·합·clamp(순수, rng 주입; 무작위 생성은 서버/주입원 책임).

### 7. Confirmed_State 잠금 — 모드 무관 보존 (요구사항 10)

- **책임**
  - 확정 상태에서는 모드와 무관하게 모든 평가 편집 요소와 Dice_Roll_Action을 읽기 전용으로 표시하고 Trait_Level을 확정 시점 값으로 유지한다(요구사항 10.1·10.2). 기존 `computeVisibility`에 모드 무관 잠금 규칙을 확장한다.
  - 확정된 캐릭터에 대한 `recordCharacter`는 모드와 무관하게 `ALREADY_CONFIRMED`로 거부하고 집합을 보존한다(요구사항 10.3, 기존 동작 유지).

### 8. Error_Mapping — 거부 사유 → 한국어 메시지 (요구사항 8.7·9)

- **책임**
  - `INVALID_ALLOCATION` 응답을 받으면 배분 규칙(총합 또는 고정값 배정) 미충족 안내를 표시하고 입력(Rated_Trait_Set·서사 값)을 보존한다(요구사항 8.7·9.1·9.2).
  - `INVALID_ATTRIBUTES`는 사다리 범위 이탈 안내(기존 메시지 계열)로 표시하고 입력을 보존한다(요구사항 9.4).
  - 어느 거부도 캐릭터를 Confirmed_State로 전이시키지 않는다(요구사항 9.1·9.2·9.4).
- **인터페이스**
  - 기존 `classifyRecordResult(outcome)`에 `INVALID_ALLOCATION` 분기를 추가하고, `RECORD_REJECTION_MESSAGES`에 한국어 메시지를 추가한다.

## Data Models

### Allocation_Rule (판별 유니온)

```ts
type AllocationMode = "LADDER_SELECT" | "POINT_BUY" | "FIXED_VALUE" | "DICE_ROLL";

interface LadderSelectRule {
  mode: "LADDER_SELECT";               // 기존 동작 보존 (요구사항 1·2)
}
interface PointBuyRule {
  mode: "POINT_BUY";
  baseLevel: number;                   // 모든 Trait_Ladder 안의 정수 (요구사항 3.1)
  pointPool: number;                   // 0 ≤ pointPool ≤ Σ(ladder.max − baseLevel) (요구사항 3.1)
}
interface FixedValueRule {
  mode: "FIXED_VALUE";
  valuePool: number[];                 // 정수 다중집합, 길이 = Rated_Trait 개수 ≥ 1 (요구사항 4.1)
}
interface DiceRollRule {
  mode: "DICE_ROLL";
  diceFormula: string;                 // "3d6", "2d6+1" 등 (요구사항 5.1)
  forcedRandom: boolean;               // 미제공 시 false (요구사항 5.1)
}
type AllocationRule = LadderSelectRule | PointBuyRule | FixedValueRule | DiceRollRule;
```

### SheetSchema 확장 (`src/services/sheet-schema.ts` / `public/character/logic.js`)

```ts
interface SheetSchema {
  // ... 기존 필드 (sections, narrativeFields, traits, genre, system 등) 보존 ...
  allocation: AllocationRule;          // 정확히 하나 (요구사항 1.1)
}
```

- `traits`의 각 `RatedTraitSpec.ladder = { min, max }`는 기존대로 유지된다. `Trait_Ladder` 미지정 시 기본 `{ min: -2, max: 4 }`(`DEFAULT_ATTRIBUTE_LADDER`)로 정규화한다.
- 보존 규칙: `UNIVERSAL_SHEET.allocation = { mode: "LADDER_SELECT" }`, `GEESE_SHEET.allocation = { mode: "LADDER_SELECT" }`(사다리 `{1,4}` 유지), `SINKS_SHEET.allocation = { mode: "LADDER_SELECT" }`(traits 빈 배열).

### Rated_Trait_Set

```ts
type RatedTraitSet = Record<string /* Trait_Key */, number /* Trait_Level (정수) */>;
```

### 검증 결과

```ts
type AllocationValidation =
  | { ok: true }
  | { ok: false; reason: "INVALID_ATTRIBUTES" }   // 사다리 경계 위반 (요구사항 9.3, FIXED_VALUE 제외)
  | { ok: false; reason: "INVALID_ALLOCATION" };   // 배분 제약 위반 (요구사항 8.3) + FIXED_VALUE 전체 (요구사항 4.4)
```

### Dice_Formula 모델

```ts
interface ParsedDiceFormula {
  count: number;     // 주사위 개수 N (≥1)
  sides: number;     // 면 수 M (≥1)
  modifier: number;  // 고정 보정 ±K (없으면 0)
}
// "NdM" 또는 "NdM+K" / "NdM-K". 파싱 실패 시 null.
// 한 Rated_Trait 값 = clamp( Σ(rollDie(sides) × count) + modifier, ladder.min, ladder.max )
```

### 모드별 Initial_Allocation (정준 유효 집합)

| 모드 | Initial_Allocation 정의 | 유효성 근거 |
| --- | --- | --- |
| `LADDER_SELECT` | 각 항목 = `initialLevel(ladder)`(0이 사다리 안이면 0, 아니면 min) | 항목 독립 사다리 검사 통과 |
| `POINT_BUY` | 모든 항목 Base_Level → 스키마 순서대로 사다리 max까지 올려 Point_Pool 전부 소비 | `Σ(level−base) = Point_Pool` (요구사항 3.2) |
| `FIXED_VALUE` | Value_Pool 내림차순을 스키마 순서에 큰 값부터 일대일 배정 (요구사항 4.6) | 다중집합 = Value_Pool |
| `DICE_ROLL` | 각 항목 = `initialLevel(ladder)`(굴림 전 표시값) | 각 값 사다리 안 |

> `POINT_BUY` 화면의 **초기 표시**는 모든 항목 Base_Level(요구사항 3.5)이며, 위 정준 Initial_Allocation은 검증 패리티 속성(요구사항 6.5)이 참조하는 유효 집합이다("요구사항 정합성 메모 2").

## Correctness Properties

*속성(property)이란 시스템의 모든 유효한 실행에서 참이어야 하는 특성 또는 동작으로, 시스템이 무엇을 해야 하는지에 대한 형식적 진술이다. 속성은 사람이 읽는 명세와 기계가 검증 가능한 정확성 보증 사이의 다리 역할을 한다.*

본 기능의 PBT 대상은 DOM·네트워크·무작위에서 분리된 **순수 로직**이다: 시트 스키마 해석(`sheetSchemaForScenario`/`normalizeAllocationRule`), 프론트엔드 순수 함수(`validateAllocation`, `validateAllocationRule`, `selectActiveSchema`, `defaultSheetSchema`, `initialAllocation`, `pointBuyRemaining`, `assignFixedValue`, `allocationEditModel`, `setTraitLevel`, `parseDiceFormula`, `rollAllocation`, `buildRollRequest`, `validateRollResponse`, `reduce`, `computeVisibility`), 백엔드 검증(`CharacterService.recordCharacter`). 200ms 인디케이터 타이밍·10초 타임아웃 발화·실제 무작위 생성·레이아웃은 속성이 아닌 예제/통합 테스트로 다룬다(Testing Strategy 참조). 아래 속성들은 prework 분석을 reflection으로 통합한 것이다(중복 분류 항목은 모드별 검증 속성으로 흡수).

### Property 1: 해석된 스키마는 정확히 하나의 유효한 Allocation_Rule을 갖는다

*For any* Scenario에 대해, `sheetSchemaForScenario`가 해석한 Active_Sheet_Schema는 정확히 하나의 `Allocation_Rule`을 포함하고 그 `Allocation_Mode`는 `LADDER_SELECT`·`POINT_BUY`·`FIXED_VALUE`·`DICE_ROLL` 중 정확히 하나다. 시나리오가 규칙을 지정하지 않거나, 지정한 모드가 네 종류 중 어느 것과도 일치하지 않으면 해석된 모드는 `LADDER_SELECT`다.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: POINT_BUY 규칙의 매개변수 경계

*For any* 해석된 `POINT_BUY` Active_Sheet_Schema에 대해, `Base_Level`은 모든 Rated_Trait의 Trait_Ladder 안의 정수이고, `Point_Pool`은 정수이며 `0 ≤ Point_Pool ≤ Σ(Trait_Ladder.max − Base_Level)`(모든 Rated_Trait 합)을 만족한다.

**Validates: Requirements 3.1**

### Property 3: FIXED_VALUE 규칙의 Value_Pool 형태

*For any* 해석된 `FIXED_VALUE` Active_Sheet_Schema에 대해, `Value_Pool`의 모든 원소는 정수이고 원소 개수는 그 스키마의 Rated_Trait 개수와 정확히 같으며 1 이상이다.

**Validates: Requirements 4.1**

### Property 4: DICE_ROLL 규칙의 매개변수와 Forced_Random 기본값

*For any* 해석된 `DICE_ROLL` Active_Sheet_Schema에 대해, 규칙은 하나의 `Dice_Formula`와 하나의 불리언 `Forced_Random`을 가지며, 원본이 `Forced_Random`을 제공하지 않으면 그 값은 거짓이다.

**Validates: Requirements 5.1**

### Property 5: 항목 독립 사다리 검증 (LADDER_SELECT · DICE_ROLL)

*For any* `LADDER_SELECT` 또는 `DICE_ROLL` 규칙과 임의의 Rated_Trait_Set에 대해, `validateAllocation`은 스키마가 정의한 모든 Trait_Key가 정확히 하나씩 존재하고(정의되지 않은 Trait_Key 없음) 각 Trait_Level이 자신의 Trait_Ladder 안의 정수일 때에만, 그리고 오직 그 때에만 유효로 판정한다. 어떤 Trait_Level이 사다리 밖이거나 정수가 아니거나 키 집합이 어긋나면 `INVALID_ATTRIBUTES`로 무효이며, 둘 이상의 Trait_Level 사이의 어떤 관계 제약도 적용하지 않는다.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 5.4, 9.3**

### Property 6: POINT_BUY 2단계 검증과 사유 분류

*For any* `POINT_BUY` 규칙과 임의의 Rated_Trait_Set에 대해, `validateAllocation`은 (1) 모든 Trait_Level이 `Base_Level` 이상이며 자신의 Trait_Ladder 안의 정수이고 (2) `Σ(Trait_Level − Base_Level) === Point_Pool`일 때에만 유효로 판정한다. 1단계(사다리 경계)를 위반하면 합이 `Point_Pool`과 같은지와 무관하게 `INVALID_ATTRIBUTES`로, 1단계는 통과하지만 합이 `Point_Pool`보다 크거나 작으면 `INVALID_ALLOCATION`으로 무효로 판정한다.

**Validates: Requirements 3.2, 3.3, 3.4, 9.3**

### Property 7: FIXED_VALUE 다중집합 검증

*For any* `FIXED_VALUE` 규칙과 임의의 Rated_Trait_Set에 대해, `validateAllocation`은 모든 Trait_Level을 모은 다중집합이 `Value_Pool` 다중집합과 원소·개수 모두 정확히 일치하고 각 Trait_Level이 자신의 Trait_Ladder 안의 정수일 때에만 유효로 판정하며, 다중집합 불일치든 사다리 밖/비정수든 어떤 위반이라도 `INVALID_ALLOCATION` 사유로 무효로 판정한다.

**Validates: Requirements 4.2, 4.3, 4.4**

### Property 8: POINT_BUY 남은 배분 점수 계산

*For any* `POINT_BUY` 규칙과 임의의 Rated_Trait_Set에 대해, `pointBuyRemaining`은 `Point_Pool − Σ(Trait_Level − Base_Level)`(모든 Rated_Trait 합)과 정확히 같은 값을 반환한다.

**Validates: Requirements 3.6**

### Property 9: FIXED_VALUE 일대일 배정 전이

*For any* 고정값 배정 상태와 한 Value_Pool 값 인스턴스·대상 Rated_Trait에 대해, `assignFixedValue`는 그 값 인스턴스를 대상 항목에 배정하고, 그 값 인스턴스가 직전에 다른 Rated_Trait에 배정되어 있었다면 그 직전 항목을 미배정 상태로 되돌리며, 어떤 값 인스턴스도 동시에 둘 이상의 Rated_Trait에 배정되지 않는다.

**Validates: Requirements 4.5**

### Property 10: 모든 모드의 Initial_Allocation은 유효하다

*For any* 네 모드 중 하나의 `Allocation_Rule`과 그 스키마에 대해, `initialAllocation`이 만든 정준 Rated_Trait_Set은 `Frontend_Allocation_Validator`와 `Backend_Allocation_Validator` 모두에서 유효로 판정되며 어떤 거부 사유도 산출하지 않는다. 특히 `FIXED_VALUE`의 Initial_Allocation은 `Value_Pool`을 내림차순으로 정렬해 스키마 정의 순서대로 큰 값부터 일대일 배정한 집합이고(그 다중집합은 `Value_Pool`과 같다), `POINT_BUY`의 Initial_Allocation은 `Point_Pool`을 결정적으로 모두 소비해 `Σ(level − Base_Level) === Point_Pool`을 만족한다.

**Validates: Requirements 4.6, 6.5**

### Property 11: DICE_ROLL 굴림 결과는 항상 사다리 안으로 한정된다

*For any* `DICE_ROLL` 규칙, 스키마, 그리고 임의의 주입 무작위원(rng)에 대해, `rollAllocation`이 각 Rated_Trait에 대해 `Dice_Formula`를 굴려 산출한 Trait_Level은 그 Rated_Trait의 Trait_Ladder 최소 정수 미만이면 최소 정수로, 최대 정수 초과이면 최대 정수로, 그 사이이면 그대로 한정(clamp)된 정수다(따라서 항상 사다리 안의 정수다).

**Validates: Requirements 5.3**

### Property 12: Dice_Formula 파싱 라운드 트립

*For any* 유효한 `ParsedDiceFormula`(`count ≥ 1`, `sides ≥ 1`, 정수 `modifier`)에 대해, 그것을 표준 문자열(`NdM`, 또는 `modifier`가 0이 아니면 `NdM+K`/`NdM-K`)로 출력한 뒤 `parseDiceFormula`로 다시 파싱하면 원래 `{ count, sides, modifier }`와 동등한 값을 얻는다. 또한 문법에 맞지 않는 문자열에 대해 `parseDiceFormula`는 `null`을 반환한다.

**Validates: Requirements 5.1, 5.3**

### Property 13: 굴림 요청 명세와 토큰 전달

*For any* 인계 값(roomId·playerId·token)에 대해, `buildRollRequest`는 `Allocation_Roll_Endpoint`를 그 `roomId`로 대상 지정하는 요청 명세를 만들고, Access_Token이 비어 있지 않으면 `x-playtest-token` 헤더에 그 값을 변형 없이 포함하며 비어 있으면 그 헤더를 포함하지 않는다. 요청 명세 구성은 어떤 무작위 값도 클라이언트에서 생성하지 않는다.

**Validates: Requirements 5.2**

### Property 14: 굴림 응답 검증과 실패 시 값 보존

*For any* 스키마와 굴림 응답 본문에 대해, `validateRollResponse`는 본문이 스키마의 모든 Rated_Trait에 대한 정수 Trait_Level을 담을 때에만 `ok: true`를 반환한다. 응답이 무효(누락·비정수)이거나 굴림 요청이 타임아웃·네트워크·서버 오류로 종료되면, 해당 결과를 reduce 한 뒤에도 모든 Rated_Trait의 기존 Trait_Level이 변경 없이 유지되고 오류 안내가 설정된다.

**Validates: Requirements 5.7, 5.8**

### Property 15: 평가 편집은 해당 항목만 갱신하고 무효 값은 거부한다

*For any* 현재 Rated_Trait_Set과 임의의 Trait_Key·지정 값에 대해, 지정 값이 그 Rated_Trait의 Trait_Ladder 안의 정수이면 `setTraitLevel`은 그 Trait_Key의 Trait_Level만 갱신하고 다른 모든 항목은 변경하지 않으며, 지정 값이 사다리 밖이거나 정수가 아니면 Rated_Trait_Set을 변경 없이 그대로 유지한다.

**Validates: Requirements 5.9**

### Property 16: 읽기 전용 도출 (Forced_Random · Confirmed_State)

*For any* Active_Sheet_Schema의 모드와 작성 상태에 대해, `allocationEditModel`/`computeVisibility`는 (a) 캐릭터가 Confirmed_State이면 모드와 무관하게 모든 Rated_Trait 평가 편집 요소와 Dice_Roll_Action을 읽기 전용으로 도출하고 표시 Trait_Level을 확정 시점 값으로 유지하며, (b) 모드가 `DICE_ROLL`이고 `Forced_Random`이 참이면(비확정이라도) 모든 평가 편집 요소를 읽기 전용으로, 거짓이면 굴림 이후 각 항목을 편집 가능으로 도출한다. 확정 상태에서 평가 편집·굴림 시도가 발생해도 `reduce`는 모든 Trait_Level을 변경하지 않는다.

**Validates: Requirements 5.5, 5.6, 10.1, 10.2**

### Property 17: 프론트엔드·백엔드 검증 패리티

*For any* 네 모드 중 하나의 동일한 `Allocation_Rule`과 동일한 Rated_Trait_Set에 대해, `Frontend_Allocation_Validator`와 `Backend_Allocation_Validator`는 동일한 유효/무효 판정을 내린다. 둘 다 유효로 판정하면 어느 쪽도 거부 사유를 산출하지 않고, 무효로 판정하면 동일한 거부 사유 분류(`INVALID_ATTRIBUTES` 또는 `INVALID_ALLOCATION`)를 산출한다.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 18: 검증의 결정성·멱등성

*For any* 동일한 `Allocation_Rule`과 동일한 Rated_Trait_Set에 대해, `validateAllocation`을 임의의 횟수(2회 이상) 호출해도 판정 순서나 직전 판정 상태와 무관하게 매번 동일한 판정과 동일한 거부 사유 분류를 산출한다.

**Validates: Requirements 6.4**

### Property 19: 백엔드 기록은 단계 순서로 검증하고 거부 시 기록하지 않는다

*For any* `Allocation_Rule`과 Rated_Trait_Set에 대해, `recordCharacter`는 먼저 사다리 경계를 검사하고 그 검사를 통과한 경우에만 배분 제약을 검사한다. 사다리 경계 위반이면 배분 제약 충족 여부와 무관하게 `INVALID_ATTRIBUTES`로, 사다리 경계는 통과하지만 배분 제약을 위반하면 `INVALID_ALLOCATION`으로 거부하며, 두 거부 모두 어떤 캐릭터 데이터도 기록·갱신하지 않는다. 사다리 경계와 배분 제약을 모두 충족하면 확정 전 캐릭터를 그 Rated_Trait_Set으로 기록·갱신한다(`confirmed: false`).

**Validates: Requirements 8.1, 8.2, 8.3, 8.4**

### Property 20: 규칙 없는 호출과 평가 항목 0개는 기존 동작을 보존한다

*For any* `allocationRule` 없이(기존 호출 형태) 호출된 `recordCharacter`에 대해, 동작은 기존과 동일하다(주어진 `traitKeys`·`ladder` 기반 사다리 경계 검증, 옵션 생략 시 기본 EZFudge 네 키 검증). *For any* 빈 `traitKeys` 또는 Rated_Trait가 0개인 스키마에 대해서는 어떤 능력치 배분 검증도 적용하지 않는다.

**Validates: Requirements 8.5, 8.6**

### Property 21: 확정된 캐릭터는 모드와 무관하게 잠긴다

*For any* Confirmed_State 캐릭터와 임의의 `Allocation_Rule`에 대해, `recordCharacter`는 그 호출을 `ALREADY_CONFIRMED` 사유로 거부하고 확정된 Rated_Trait_Set을 변경 없이 보존한다.

**Validates: Requirements 10.3**

### Property 22: 스키마 규칙 검증과 무효 시 기본 스키마 폴백

*For any* 스키마 응답의 `allocation` 페이로드에 대해, `validateAllocationRule`은 그 모드가 네 종류 중 하나이고 그 모드의 필수 매개변수(POINT_BUY: 정수 Base_Level + 0 이상 정수 Point_Pool; FIXED_VALUE: 정수 원소·개수 = Rated_Trait 개수인 Value_Pool; DICE_ROLL: 공백 제거 시 1자 이상 Dice_Formula + 불리언 Forced_Random)를 모두 갖출 때에만, 그리고 오직 그 때에만 유효로 인정한다. 성공 응답이지만 규칙이 무효(누락·모드 불일치·매개변수 미비)이면 `selectActiveSchema`는 그 스키마를 채택하지 않고 Allocation_Mode가 `LADDER_SELECT`인 `Default_Sheet_Schema`를 채택한다.

**Validates: Requirements 7.1, 7.2, 7.3**

### Property 23: 배분 거부는 입력을 보존하고 확정을 막는다

*For any* 작성 상태와 거부 결과(`INVALID_ALLOCATION` 또는 `INVALID_ATTRIBUTES`)에 대해, 해당 결과를 reduce 하면 플레이어가 입력한 Narrative_Field 값(이름·컨셉 포함)과 Rated_Trait_Set이 변경 없이 보존되고, 거부 사유에 대응하는 한국어 오류 안내(배분 규칙 미충족 / 사다리 범위 이탈)가 설정되며, 캐릭터는 Confirmed_State로 전이하지 않는다.

**Validates: Requirements 8.7, 9.1, 9.2, 9.4**

## Error Handling

### 거부 사유와 사용자 메시지

배분 검증의 거부 사유는 두 종류이며 서로 구별되는 한국어 메시지로 매핑된다.

| 사유 | 발생 조건 | 사용자 메시지(요지) | 요구사항 |
| --- | --- | --- | --- |
| `INVALID_ATTRIBUTES` | 사다리 밖/비정수/`POINT_BUY` Base 미만(`FIXED_VALUE` 제외), 키 집합 불일치 | 평가 항목 값이 사다리 범위를 벗어났다는 안내 | 2.3, 2.4, 3.4, 5.9, 9.3, 9.4 |
| `INVALID_ALLOCATION` | `POINT_BUY` 합 ≠ Point_Pool, `FIXED_VALUE` 다중집합 불일치/사다리 위반 | 배분 규칙(총합 또는 고정값 배정)을 충족하지 못했다는 안내 | 3.3, 4.3, 4.4, 8.3, 8.7, 9.1, 9.2 |

`INVALID_ALLOCATION`은 기존 `RecordRejection`/`RECORD_REJECTION_MESSAGES`(`public/character/logic.js`)와 백엔드 `RecordCharacterResult`(`character-service.ts`)에 신규로 추가한다. 두 메시지 계열은 서로 구분되어 플레이어가 "값 범위 문제"와 "배분 규칙 문제"를 구별할 수 있다.

### 굴림 실패 처리 (DICE_ROLL)

- 굴림 요청은 다른 REST 요청과 동일하게 `AbortController` 10초 타임아웃을 적용한다(`character-sheet`의 `REQUEST_TIMEOUT_MS`와 동일). 타임아웃·네트워크·서버 오류는 한국어 오류를 표시하고 모든 Trait_Level을 변경 없이 유지하며, 무작위 값을 클라이언트에서 생성하지 않는다(요구사항 5.7, Property 14).
- 성공 응답이라도 어떤 Rated_Trait의 Trait_Level이 없거나 비정수이면 적용하지 않고 한국어 오류를 표시하며 기존 값을 유지한다(요구사항 5.8, Property 14).
- 타이머 발화·fetch 취소 자체는 가짜 타이머 통합 테스트로 검증하고, 오류 종류 분류는 기존 `classifyOutcome`(Property는 character-sheet 스펙에서 커버)이 담당한다.

### 회복·보존 정책

- 모든 거부(`INVALID_ALLOCATION`·`INVALID_ATTRIBUTES`·`ALREADY_CONFIRMED`)와 전송 오류에서 인계 식별자·Access_Token과 플레이어 입력(Narrative_Field·Rated_Trait_Set)을 보존하고, 캐릭터를 Confirmed_State로 전이시키지 않는다(Property 23, 21).
- 스키마 응답의 `Allocation_Rule`이 무효이면 `LADDER_SELECT` 기본 스키마로 우아하게 폴백하고 한국어 안내를 표시하며 플레이어가 작성을 계속할 수 있게 한다(Property 22, 요구사항 7.4).
- 확정된 캐릭터는 모드와 무관하게 잠금이 보존된다(Property 16, 21).

## Testing Strategy

### 이중 테스트 접근

- **속성 테스트(Property tests)**: 위 Correctness Properties 1~23을 검증한다. 프론트엔드 순수 로직(`public/character/logic.js`)은 노드 환경 vitest에서, 백엔드 검증(`src/services/character-service.ts`·`src/services/sheet-schema.ts`)은 src 테스트에서 검증한다. **패리티 속성(Property 17)** 과 **Initial_Allocation 유효성(Property 10)** 은 프론트엔드 `validateAllocation`과 백엔드 검증기를 같은 테스트에서 import 해 동일 생성 입력으로 대조한다.
- **예제/단위 테스트(Example tests)**: 특정 시나리오 보존(`UNIVERSAL_SHEET`→LADDER_SELECT, `terrible-geese`→LADDER_SELECT+{1,4}, `until-it-sinks`→0개 항목; 요구사항 1.4, 1.5, 1.6), `POINT_BUY` 초기 표시값=Base_Level(요구사항 3.5), 폴백 한국어 안내 문구(요구사항 7.4), `INVALID_ALLOCATION`/`INVALID_ATTRIBUTES` 한국어 메시지 문구(요구사항 9.1, 9.2, 9.4) 등 입력에 따라 의미 있게 달라지지 않는 항목.
- **통합 테스트(Integration tests)**: 굴림 요청의 10초 `AbortController` 타임아웃 발화·fetch 취소·배선, 200ms 인디케이터 타이밍, `FIXED_VALUE` 재배정 200ms 표시, 굴림 결과 적용 후 DOM 갱신을 가짜 타이머·가짜 fetch로 검증한다.

### 도구

- **속성 테스트 라이브러리**: `fast-check`(기존 `package.json` devDependency). 직접 구현하지 않고 이 라이브러리를 사용한다.
- **테스트 러너**: `vitest`(기존). 프론트엔드 순수 모듈(`public/**/*.test.js`)은 노드 환경, DOM 배선은 `happy-dom`, 백엔드(`src/**/*.test.ts`)는 노드 환경에서 실행한다.
- **무작위 주입**: `DICE_ROLL` 굴림은 `public/game/dice.js`·`src/core/dice.js`의 rng 주입 패턴을 따라 결정적 시드 무작위원을 주입해 테스트한다. 실제 무작위 생성은 서버/주입원 책임이며 속성 대상이 아니다.

### 속성 테스트 규칙

- 각 속성 테스트는 최소 **100회 반복**으로 실행한다(`fast-check`의 `numRuns: 100` 이상).
- 각 속성 테스트는 설계 문서의 속성을 주석으로 참조한다.
- 태그 형식: **Feature: flexible-stat-allocation, Property {번호}: {속성 텍스트}**
- 각 Correctness Property는 **하나의** 속성 기반 테스트로 구현한다.

#### 생성기(Generator) 전략

- **시나리오 생성기**: 규칙 미지정·네 모드·무효 모드 문자열을 가진 시나리오 — Property 1.
- **스키마 생성기**: 임의 개수(≥1)의 Rated_Trait(임의 Trait_Key·Trait_Ladder), 0개 항목(서사 전용) — Property 5, 20. 그리고 각 모드의 적법 규칙 생성기:
  - `POINT_BUY`: 사다리 안 `Base_Level`과 `[0, 총 여유분]` 범위의 `Point_Pool` — Property 2, 6, 8, 10.
  - `FIXED_VALUE`: 길이 = 항목 개수인 정수 `Value_Pool` — Property 3, 7, 9, 10.
  - `DICE_ROLL`: `NdM`/`NdM±K` 형태 `Dice_Formula`와 불리언/누락 `Forced_Random` — Property 4, 11, 16.
- **Rated_Trait_Set 생성기**: 유효 집합(각 모드 제약 충족)과 무효 집합(사다리 밖·비정수·키 누락/초과·합 초과/미달·다중집합 불일치) — Property 5, 6, 7, 17, 18, 19.
- **무작위원 생성기**: `[0,1)` 결정적 시드 rng, 경계 근처(0, 1−ε) 포함 — Property 11.
- **Dice_Formula 생성기**: 유효 `{count, sides, modifier}`(modifier 0 포함)와 비문법 문자열 — Property 12.
- **굴림 응답 생성기**: 모든 키 정수(유효), 일부 누락·비정수(무효) — Property 14.
- **인계/토큰 생성기**: 빈/비공백 토큰, 키 부재 — Property 13.
- **상태 생성기**: 인계 유효/무효, `confirmed` true/false, 각 모드 — Property 16, 23.
- **엣지 케이스**: 사다리 경계값(min·max·0), `Point_Pool` 0과 최대, `Value_Pool` 중복 원소, 음수 정수, 0개 항목 스키마.

### 예제·통합 테스트 대상 (속성 비적용 요구사항)

다음은 입력에 따라 의미 있게 달라지지 않거나(특정 시나리오·문구), 부수효과 타이밍 영역이라 속성이 아닌 예제·통합으로 다룬다.

- **1.4 / 1.5 / 1.6** — 특정 기존 시트(`UNIVERSAL_SHEET`·`terrible-geese`·`until-it-sinks`)의 모드·사다리 보존(예제). 0개 항목 검증 미적용은 Property 20도 커버.
- **3.5** — `POINT_BUY` 초기 표시값 = 모든 항목 Base_Level(예제). 정준 Initial_Allocation 유효성은 Property 10.
- **3.6 / 4.5(타이밍)** — 남은 점수·재배정의 200ms 이내 표시(가짜 타이머 통합). 계산·전이 로직은 Property 8, 9.
- **5.2(무작위 부재)** — 굴림 시 클라이언트가 무작위를 만들지 않음(구조적 예제 + Property 13의 요청 구성).
- **5.7(타이머·취소)** — 10초 경과 시 `AbortController`가 굴림 fetch를 취소하는지(가짜 타이머 통합). 값 보존은 Property 14.
- **7.4** — 폴백 한국어 안내 문구(예제). 폴백 채택은 Property 22.
- **9.1 / 9.2 / 9.4(문구)** — 거부 사유별 한국어 메시지 문구(예제). 보존·비확정·분류는 Property 23, 6, 7.

## 요구사항 추적 요약

| 요구사항 | 설계 반영 |
| --- | --- |
| 1.1 단일 규칙·유효 모드 | Property 1 |
| 1.2 미지정 시 LADDER_SELECT | Property 1 |
| 1.3 무효 모드 폴백 | Property 1 |
| 1.4 UNIVERSAL 보존 | 예제 |
| 1.5 terrible-geese 보존 | 예제 |
| 1.6 0개 항목 LADDER_SELECT | 예제 / Property 20 |
| 2.1 LADDER_SELECT 유효 조건 | Property 5 |
| 2.2 항목 간 제약 없음 | Property 5 |
| 2.3 사다리 위반 INVALID_ATTRIBUTES | Property 5 |
| 2.4 키 집합 위반 INVALID_ATTRIBUTES | Property 5 |
| 3.1 POINT_BUY 매개변수 경계 | Property 2 |
| 3.2 POINT_BUY 유효 조건 | Property 6 |
| 3.3 합 불일치 INVALID_ALLOCATION | Property 6 |
| 3.4 사다리/Base 위반 INVALID_ATTRIBUTES | Property 6 |
| 3.5 초기 표시 Base_Level | 예제 / Property 10 |
| 3.6 남은 점수 계산 | Property 8 / 통합(타이밍) |
| 4.1 FIXED_VALUE Value_Pool 형태 | Property 3 |
| 4.2 FIXED_VALUE 유효 조건 | Property 7 |
| 4.3 다중집합 불일치 INVALID_ALLOCATION | Property 7 |
| 4.4 사다리 위반 INVALID_ALLOCATION | Property 7 |
| 4.5 일대일 재배정 | Property 9 / 통합(타이밍) |
| 4.6 초기 내림차순 배정 | Property 10 |
| 5.1 DICE_ROLL 매개변수·기본값 | Property 4, 12 |
| 5.2 서버 굴림 요청·무작위 부재 | Property 13 / 예제 |
| 5.3 결과 clamp | Property 11, 12 |
| 5.4 DICE_ROLL 유효 조건 | Property 5 |
| 5.5 Forced_Random 읽기전용 | Property 16 |
| 5.6 Forced_Random 거짓 편집 가능 | Property 16 |
| 5.7 굴림 실패 보존 | Property 14 / 통합(타이머) |
| 5.8 무효 응답 미적용·보존 | Property 14 |
| 5.9 무효 편집 미적용·유지 | Property 15 |
| 6.1 검증 패리티 | Property 17 |
| 6.2 유효 시 사유 없음 | Property 17 |
| 6.3 무효 시 동일 분류 | Property 17 |
| 6.4 결정성·멱등성 | Property 18 |
| 6.5 Initial_Allocation 유효 | Property 10 |
| 7.1 규칙 유효 인정 조건 | Property 22 |
| 7.2 무효 규칙 Default 폴백 | Property 22 |
| 7.3 Default LADDER_SELECT | Property 22 |
| 7.4 폴백 안내·계속 | 예제 |
| 8.1 단계 순서 검증 | Property 19 |
| 8.2 사다리 위반 거부·미기록 | Property 19 |
| 8.3 배분 위반 거부·미기록 | Property 19 |
| 8.4 충족 시 기록 | Property 19 |
| 8.5 규칙 없는 호출 보존 | Property 20 |
| 8.6 0개 항목 검증 미적용 | Property 20 |
| 8.7 INVALID_ALLOCATION 보존 | Property 23 |
| 9.1 POINT_BUY 초과 거부·보존 | Property 23 / 예제(문구) |
| 9.2 FIXED_VALUE 위반 거부·보존 | Property 23 / 예제(문구) |
| 9.3 사다리 위반 INVALID_ATTRIBUTES | Property 5, 6 |
| 9.4 INVALID_ATTRIBUTES 보존 | Property 23 / 예제(문구) |
| 10.1 확정 읽기전용·유지 | Property 16 |
| 10.2 확정 조작 무시 | Property 16 |
| 10.3 확정 ALREADY_CONFIRMED | Property 21 |

## 열린 질문 (Open Questions — 요구사항 명확화 권고)

설계 중 발견한 두 충돌 지점은 "요구사항 정합성 메모"의 결정으로 진행했으나, 요구사항 단계로 되돌려 확정할 것을 권한다.

1. **`FIXED_VALUE` 사다리 위반의 거부 사유**: 요구사항 4.4(`INVALID_ALLOCATION`)와 9.3/8.2(`INVALID_ATTRIBUTES`)가 충돌한다. 본 설계는 특수 우선으로 `FIXED_VALUE` 위반을 `INVALID_ALLOCATION`으로 통일했다(Property 7). 9.3을 "FIXED_VALUE 제외 일반 규칙"으로 확정할지 확인이 필요하다.
2. **`POINT_BUY`의 Initial_Allocation 유효성**: 요구사항 3.5(초기 표시=모두 Base_Level)와 6.5(Initial_Allocation은 유효)가 `Point_Pool > 0`일 때 충돌한다. 본 설계는 "초기 표시"와 "정준 유효 Initial_Allocation"을 분리했다(Property 10). 검증 패리티 속성이 참조하는 Initial_Allocation 정의를 확정할지 확인이 필요하다.
