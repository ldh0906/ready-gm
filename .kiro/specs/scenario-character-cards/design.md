# Design Document

## Overview

이 문서는 ready-gm의 **시나리오 작성 방식(scenario-character-cards)** 횡단 관심사 설계를 정의한다. 두 가지 관심사를 다룬다.

1. **능력치 없는 시나리오에서 능력치 관련 UI 감추기.** 시트 스키마(Active_Sheet_Schema)에 정확히 하나의 **Attribute_Proposal_Supported** 불리언을 실어, 그 값이 거짓이면 화면이 Propose_Action(`#proposeBtn`)과 Stat_Setting_Section을 **아예 표시하지 않고** 제안 요청도 전송하지 않게 한다.
2. **캐릭터 카드(Character_Card) 기반 작성 방식 도입.** 시트 스키마에 선택 가능한 **Character_Card_List**를 실어, 플레이어가 그중 **정확히 하나**(Selected_Card)를 고르고 그 위에 자신의 배경 서사(Backstory_Field)를 적게 한다. 카드 선택은 프론트엔드·백엔드가 **동일하게 검증**(검증 패리티)하며, 카드 기반 시트에서 카드를 고르지 않으면 `INVALID_CARD`로 거부된다.

핵심 설계 원칙은 기존 `character-sheet`·`flexible-stat-allocation` 스펙과 동일한 **단일 시트 스키마 확장(single pluggable schema)** 이다.

- **스키마 한 곳만 확장**: `SheetSchema`에 `attributeProposalSupported: boolean`(필수)과 `characterCards?: CharacterCard[]`(선택) 두 필드를 더한다. 시트 렌더·기록·확정의 골격은 그대로 두고, 화면은 그 스키마에 따라 능력치 영역·제안 동작·카드 선택 영역을 렌더한다.
- **검증 패리티(validation parity)**: 동일한 Character_Card_List와 동일한 카드 선택 입력에 대해 프론트엔드 순수 검증기(`public/character/logic.js`의 `validateCardSelection`)와 백엔드 검증기(`CharacterService.recordCharacter`)가 **동일한 유효/무효 판정**을 산출한다. `flexible-stat-allocation`이 `validateAllocation`을 양쪽에서 미러링한 것과 동일한 패턴이다.
- **기존 동작 보존(additive)**: `UNIVERSAL_SHEET`·`GEESE_SHEET`는 `attributeProposalSupported: true`이고 카드가 없어 기존 능력치 제안·설정 동작을 그대로 보존한다. `until-it-sinks`(`SINKS_SHEET`)만 `attributeProposalSupported: false`인 카드 기반 서사 시트로 전환된다.
- **우아한 폴백**: 시나리오 스키마의 카드 목록이 깨져 있으면 그 스키마를 채택하지 않고 `Default_Sheet_Schema`(카드 기반 아님)로 폴백해 작성을 이어간다.

### 설계 목표

- 요구사항 1~8을 모두 충족하는, 시트 스키마 해석(`src/services/sheet-schema.ts`)·프론트엔드 순수 로직(`public/character/logic.js`)·백엔드 서비스 로직(`src/services/character-service.ts`)의 확장 설계를 정의한다.
- 직전에 병합된 `flexible-stat-allocation` 확장(`AllocationRule`·`allocation` 필드·공유 `validateAllocation`·`INVALID_ALLOCATION`·모드 인식 UI) **위에 가산적으로(additive)** 쌓되 충돌하지 않는다. 기존 `allocation` 경로와 본 스펙의 카드/제안 플래그 경로는 독립적이다.
- 기존 스펙이 확립한 아키텍처·관례를 **그대로 미러링**한다(빌드 단계 없는 정적 `public/*.html`, 바닐라 JS ES 모듈, 순수 로직 분리, vitest + fast-check, 서버 측 무작위).
- 카드 검증(Card_Validator)을 DOM·네트워크·무작위에서 분리된 **순수 함수**로 명세해, 아직 배선되지 않은 의도된 엔드포인트에 대해서도 모킹/주입으로 완전히 단위·속성 테스트할 수 있게 한다.

### 백엔드 계약 매핑 (실제 코드 근거)

본 설계는 다음 실제 코드 계약 위에서 동작을 정의한다(요구사항 "백엔드/프론트엔드 계약 근거" 절과 일치).

| 구성요소 | 실제 코드 근거 (현재 상태) | 본 스펙의 확장 |
| --- | --- | --- |
| `Scenario` | `src/services/scenario-service.ts` — `UNTIL_IT_SINKS`는 `hasSpecialRules: true`, `system: "카드 기반(GM리스)"`. 카드 목록 필드 없음. | 시나리오 → 카드 기반 작성 판정의 근거. 카드 목록은 Resolver가 시나리오 id 기준으로 부착(시트 선택 방식과 동일). |
| `SheetSchema` / `RatedTraitSpec` | `src/services/sheet-schema.ts` — 이미 `allocation: AllocationRule` 필드 보유(flexible-stat-allocation). | `attributeProposalSupported: boolean`(필수) + `characterCards?: CharacterCard[]`(선택) 추가 |
| `sheetSchemaForScenario` / `expectedTraitSpecForScenario` | `src/services/sheet-schema.ts` — 시나리오별 시트 선택 + `allocation` 정규화. | 해석 시 `attributeProposalSupported`를 도출하고, 카드 기반 시나리오면 `characterCards`를 부착 |
| `UNIVERSAL_SHEET` / `GEESE_SHEET` / `SINKS_SHEET` | `src/services/sheet-schema.ts` — `SINKS_SHEET.traits = []`(서사 전용). | UNIVERSAL/GEESE는 `attributeProposalSupported: true`, 카드 없음. SINKS는 `false` + 지배인·작가·지질학자 카드 |
| `CharacterService.recordCharacter` / `RecordCharacterOptions` | `src/services/character-service.ts` — 이미 `options.allocationRule`·`INVALID_ALLOCATION` 보유. | `options.characterCards` + `selectedCardId`(또는 `input.selectedCardId`) 수용, `INVALID_CARD` 거부 사유 추가 |
| `validateSchema` / `selectActiveSchema` / `defaultSheetSchema` | `public/character/logic.js` — 이미 `allocation` 검증·정규화·폴백. | 카드 목록 검증·정규화 + `attributeProposalSupported` 도출/폴백 추가 |
| `computeVisibility` / `renderModel` / `reduce` | `public/character/logic.js` — 이미 모드 인식 가시성·렌더·전이. | 제안/능력치 영역 숨김, 빈 섹션 숨김, 카드 목록 렌더·단일 선택 전이·`INVALID_CARD` 처리 추가 |

> **범위 밖(요구사항 가정과 동일)**: 시트 스키마·기록·확정·제안 엔드포인트의 실제 HTTP/실시간 배선은 의도된 계약으로 둔다. 본 설계는 그 계약 위에서 순수 로직과 서비스 로직을 명세하며, `fetch`·타이머·네비게이션은 모두 주입 가능(injectable)하게 만들어 모킹으로 테스트한다.

### 요구사항 정합성 메모 (Requirement Reconciliation Notes)

1. **`attributeProposalSupported` 누락 시 폴백 도출 — 요구사항 1.1 vs 7.4.**
   - 요구사항 1.1은 Resolver가 항상 정확히 하나의 플래그를 싣도록 요구한다(백엔드가 항상 명시).
   - 요구사항 7.4는 스키마 응답에 플래그가 **없을 때** 프론트엔드가 `Rated_Trait_Count`에서 도출하도록 요구한다(하위호환).
   - **결정**: 두 경로를 분리한다 — (a) Resolver는 항상 명시적으로 플래그를 싣는다(1.1~1.6). (b) `validateSchema`는 응답에 플래그가 있으면 그 불리언을 정규화해 쓰고, 없으면 `traits.length > 0`으로 도출한다(7.4). 두 경로 모두 채택된 Active_Sheet_Schema에는 정확히 하나의 불리언이 존재한다.

2. **카드 선택의 빈/무효 구분 — 요구사항 6.2.**
   - "카드 선택 없음"(selectedCardId 누락/빈 문자열)과 "목록에 없는 Card_Id"는 둘 다 `INVALID_CARD`로 거부한다. 검증기는 두 경우를 하나의 무효 판정으로 합치고, 사용자 메시지는 동일하게 "역할 카드를 먼저 선택" 안내를 쓴다(요구사항 5.1, 6.4).

## Architecture

### 단일 스키마 확장(Single Schema Extension) 개요

```mermaid
graph TD
  subgraph Resolver["Sheet_Schema_Resolver (src/services/sheet-schema.ts)"]
    SC["Scenario (id, hasSpecialRules, ...)"] --> SS["Active_Sheet_Schema<br/>traits[] + allocation<br/>+ <b>attributeProposalSupported</b><br/>+ <b>characterCards?</b>"]
  end

  SS -->|스키마 응답| FE
  SS -->|검증 정보(카드 목록 포함)| BE

  subgraph FE["Frontend (public/character/logic.js)"]
    FV["validateSchema → 카드 목록 검증·정규화<br/>+ attributeProposalSupported 도출/폴백"]
    FR["renderModel / index.html<br/>빈 섹션·능력치 영역·제안 동작 숨김<br/>카드 목록 단일 선택 렌더"]
    FC["<b>validateCardSelection(cardList, selectedId)</b><br/>Frontend_Card_Validator (순수)"]
    FS["selectCard 전이 / isCardBasedSheet"]
  end

  subgraph BE["Backend (src/services/character-service.ts)"]
    BC["recordCharacter(..., { characterCards, selectedCardId })<br/><b>Backend_Card_Validator</b> → INVALID_CARD"]
  end

  FC -. "동일 목록·동일 선택 → 동일 판정 (검증 패리티)" .-> BC
```

**핵심 추상**: 시트의 "작성 방식"은 스키마에 실린 두 데이터(제안 지원 플래그, 카드 목록)로만 표현된다. 화면은 그 데이터에서 가시성과 검증을 **도출**할 뿐, 시나리오 종류를 직접 분기하지 않는다. 새 카드 기반 시나리오 추가 = Resolver에서 카드 목록 부착 한 곳만 확장.

### 계층 분리 원칙 (sibling 미러링)

`character-sheet`·`flexible-stat-allocation` 스펙과 동일한 3계층을 유지한다.

- **순수 로직 계층**: 프론트엔드는 `public/character/logic.js`에 **카드 선택 검증·단일 선택 전이·카드 기반 시트 판정·스키마 카드 목록 검증·제안 지원 도출** 순수 함수를 추가한다. 백엔드는 `src/services/character-service.ts`에 **카드 선택 검증**을 추가하고, 공유 알고리즘을 `src/services/sheet-schema.ts`(또는 동등한 공유 모듈)에 둘 수 있다.
- **부수효과 계층**: `public/character/index.html`의 스크립트가 `fetch`·`AbortController` 10초 타임아웃·200ms 인디케이터·DOM 갱신·카드 클릭 배선을 담당한다.
- **View 계층**: 단일 상태에서 도출한 렌더 모델·가시성으로 화면을 그린다. 제안 동작·능력치 영역·빈 섹션의 표시 여부와 카드 목록의 단일 선택 표시가 모두 상태의 함수다.

### 검증 패리티 전략

프론트엔드(JS, `public/`)와 백엔드(TS, `src/`)는 빌드 단계가 없어 동일 모듈을 직접 공유하지 않는다. 따라서 **동일한 카드 검증 알고리즘 명세**(아래 "카드 선택 검증 알고리즘")를 두 곳에서 각각 구현하고, 두 구현이 동일 입력에 동일 판정을 내림을 **패리티 속성 테스트**로 보장한다(요구사항 5.2). 패리티 테스트는 vitest에서 프론트엔드 `validateCardSelection`(`public/character/logic.js`)과 백엔드 검증기를 모두 import 해 동일 생성 입력으로 대조한다. 이는 직전에 병합된 `validateAllocation` 패리티 테스트와 동일한 방식이다.

### 카드 선택 검증 알고리즘 (Card Selection Validation Algorithm) — 패리티의 단일 명세

입력: `cardList`(Character_Card_List 또는 비어 있음/없음), `selectedId`(선택된 Card_Id 또는 누락/빈 문자열).
출력: `{ ok: true }` 또는 `{ ok: false, reason: "INVALID_CARD" }`.

1. **카드 기반 아님 판정**: `cardList`가 없거나 빈 배열이면 그 시트는 Card_Based_Sheet가 아니다 → **항상 유효**(`{ ok: true }`). 카드 검증을 적용하지 않는다(요구사항 5.4, 6.3).
2. **선택 존재 검사**: `cardList`가 1개 이상이면(Card_Based_Sheet), `selectedId`가 공백 제거 후 1자 이상이어야 한다. 누락·빈 문자열·전부 공백이면 `INVALID_CARD`(요구사항 5.1, 6.2).
3. **소속 검사**: `selectedId`(트림)가 `cardList`의 어떤 Character_Card의 Card_Id(트림)와 정확히 일치해야 한다. 일치하는 카드가 없으면 `INVALID_CARD`(요구사항 6.2).
4. 위를 통과하면 유효(`{ ok: true }`).

이 알고리즘은 순수하며 직전 판정 상태에 의존하지 않는다. 동일 입력을 여러 번 판정해도 매번 동일한 판정을 산출한다(결정성·멱등성, 요구사항 5.3).

백엔드 기록(요구사항 6)은 이 알고리즘을 호출하되, `INVALID_CARD`이면 어떤 캐릭터 데이터도 기록·갱신하지 않고 즉시 거부한다(요구사항 6.2). 확정된 캐릭터는 카드 검증보다 **먼저** `ALREADY_CONFIRMED`로 거부한다(요구사항 8.3, 기존 동작 보존).

### 능력치 제안 지원 도출 (Attribute_Proposal_Supported Derivation)

Resolver(백엔드)와 `validateSchema`(프론트엔드)는 동일한 도출 규칙을 따른다.

- `Rated_Trait_Count === 0` → `false`(요구사항 1.2).
- 시나리오의 `Attribute_Proposal_Disabled === true` → `false`(요구사항 1.3, 백엔드 한정 입력).
- 그 외(`Rated_Trait_Count ≥ 1` 그리고 제안 비활성 아님) → `true`(요구사항 1.4).
- 프론트엔드 폴백: 스키마 응답에 플래그가 없으면 `traits.length > 0`으로 도출(요구사항 7.4).

### 검증 순서 (백엔드 recordCharacter)

직전에 병합된 `flexible-stat-allocation` 경로와 충돌하지 않도록, `recordCharacter`의 검증 순서를 다음으로 확장한다.

1. `UNKNOWN_PLAYER` 검사(기존).
2. `ALREADY_CONFIRMED` 검사(기존, 요구사항 8.3).
3. **카드 검증(신규)**: `options.characterCards`가 비어 있지 않으면(Card_Based_Sheet) "카드 선택 검증 알고리즘"으로 `selectedCardId`를 검증. `INVALID_CARD`면 어떤 데이터도 기록하지 않고 거부(요구사항 6.2). 카드 목록이 없거나 비어 있으면 이 단계를 건너뛴다(요구사항 6.3).
4. 능력치 검증(기존 `allocationRule` 또는 `traitKeys`/`ladder` 경로).
5. `NAME_TAKEN` 검사(기존).
6. 기록·갱신(선택된 Card_Id를 캐릭터에 함께 저장).

## Components and Interfaces

### 1. Sheet_Schema_Resolver — 제안 플래그·카드 목록 부착 (`src/services/sheet-schema.ts`)

- **책임**
  - 해석한 Active_Sheet_Schema에 정확히 하나의 `attributeProposalSupported` 불리언을 싣는다(요구사항 1.1). 값은 "능력치 제안 지원 도출" 규칙으로 정한다(요구사항 1.2~1.4).
  - `UNIVERSAL_SHEET`·`terrible-geese`는 `attributeProposalSupported: true`(요구사항 1.5), `until-it-sinks`는 `false`(요구사항 1.6)로 둔다.
  - 시나리오가 카드 기반 작성을 지정하면(현재 `until-it-sinks`) Active_Sheet_Schema에 1개 이상 원소의 `characterCards`를 부착하되, 각 카드가 트림 후 1자 이상 `id`·`roleLabel`과 `premise`를 갖고 모든 `id`가 고유하도록 보장한다(요구사항 3.1, 3.2). `until-it-sinks`는 지배인·작가·지질학자 Card_Role_Label 카드를 포함한다(요구사항 3.3).
  - 카드 기반이 아닌 시나리오(UNIVERSAL/GEESE 등)는 `characterCards`를 부착하지 않는다(없음/빈 배열) → Card_Based_Sheet 아님(요구사항 3.4, 3.5).
- **인터페이스**
  - `sheetSchemaForScenario(scenario): SheetSchema` — 기존 시그니처 유지, 반환 스키마에 `attributeProposalSupported`(항상)·`characterCards`(카드 기반 시) 추가.
  - `expectedTraitSpecForScenario(scenario): { keys, ladder, allocation, characterCards? }` — 서버 검증용 정보에 `characterCards`(카드 기반 시) 포함. 기존 `keys`·`ladder`·`allocation` 보존.
  - 내부: `deriveAttributeProposalSupported(traits, scenario): boolean`, `cardsForScenario(scenario): CharacterCard[] | undefined` — 시나리오 id 기준 카드 목록(시트 선택 방식과 동일하게 id→카드 매핑).

### 2. Card_Validator — 공유 검증 명세 (Frontend + Backend)

위 "카드 선택 검증 알고리즘"을 실현하는 한 쌍의 구현.

- **Frontend_Card_Validator** (`public/character/logic.js`)
  - `validateCardSelection(cardList, selectedId): { ok: true } | { ok: false, reason: "INVALID_CARD" }` — 순수 판정.
  - `isCardBasedSheet(schema): boolean` — `schema.characterCards`가 1개 이상이면 참.
- **Backend_Card_Validator** (`src/services/character-service.ts`, 공유 모듈은 `sheet-schema.ts`에 둘 수 있음)
  - `recordCharacter`가 `options.characterCards`를 받으면 동일 알고리즘으로 `selectedCardId`를 판정한다. 동일 입력에 프론트엔드와 동일 판정을 산출한다(검증 패리티).

### 3. Card 기록 확장 — `RecordCharacterOptions`·`CharacterInput` (`src/services/character-service.ts`)

- **책임**
  - `options.characterCards`(의도된 확장)가 1개 이상이면 그 목록으로 카드 선택을 검증한다(요구사항 6.1, 6.2). `selectedCardId`는 `options.selectedCardId` 또는 `input.selectedCardId`로 전달한다.
  - `INVALID_CARD`면 어떤 데이터도 기록하지 않고 거부한다(요구사항 6.2). 통과하면 선택된 Card_Id를 캐릭터에 함께 저장한다(요구사항 6.1).
  - `characterCards` 없이/빈 배열로 호출되면(카드 기반 아님) 카드 검증을 적용하지 않고 기존 동작을 변경 없이 수행한다(요구사항 6.3).
  - 확정된 캐릭터에 대한 호출은 카드 검증보다 먼저 `ALREADY_CONFIRMED`로 거부하고 기존 카드 선택·서사 값을 보존한다(요구사항 8.3).
- **인터페이스(확장)**
  ```ts
  interface CharacterInput {
    name: string;
    concept: string;
    attributes: Record<string, AttributeLevel>;
    selectedCardId?: string; // 의도된 확장 (요구사항 6.1)
  }
  interface RecordCharacterOptions {
    traitKeys?: string[];            // 기존
    ladder?: AttributeLadder;        // 기존
    allocationRule?: AllocationRule; // 기존(flexible-stat-allocation)
    characterCards?: CharacterCard[]; // 의도된 확장 (요구사항 6.1)
    selectedCardId?: string;          // input 대신 options로도 전달 가능
  }
  type RecordCharacterResult =
    | { ok: true; character: Character }
    | { ok: false; reason: "NAME_TAKEN"; message: string }
    | { ok: false; reason: "ALREADY_CONFIRMED"; message: string }
    | { ok: false; reason: "INVALID_ATTRIBUTES"; message: string }
    | { ok: false; reason: "INVALID_ALLOCATION"; message: string } // 기존(flexible-stat-allocation)
    | { ok: false; reason: "INVALID_CARD"; message: string }       // 신규 (요구사항 6.2)
    | { ok: false; reason: "UNKNOWN_PLAYER"; message: string }
    | { ok: false; reason: "NO_CHARACTER"; message: string };
  ```
  - `Character`(저장 타입)에 선택된 카드를 보존하기 위한 선택 필드(`selectedCardId?: string`)를 추가한다.

### 4. Schema_Engine 확장 — 카드 목록 검증·제안 플래그 도출·폴백 (`public/character/logic.js`)

- **책임**
  - 스키마 응답의 `characterCards`를 검증·정규화한다(요구사항 7.1): 없거나 빈 배열이면 카드 기반 아님(유효); 또는 1개 이상이며 모든 원소가 트림 후 1자 이상 `id`·`roleLabel`을 갖고 모든 `id`가 고유할 때에만 유효. 그 외(빈 id/roleLabel, 중복 id)는 무효.
  - 카드 목록이 무효이면 그 스키마를 채택하지 않고 `Default_Sheet_Schema`(카드 기반 아님)로 폴백하고 한국어 안내를 표시한다(요구사항 7.2, 7.3).
  - 스키마 응답에서 `attributeProposalSupported`를 정규화하거나, 없으면 `traits.length > 0`으로 도출한다(요구사항 7.4).
- **인터페이스(확장)**
  - `validateSchema(body): { ok: true, schema } | { ok: false }` — 기존 검증(traits·narrativeFields·allocation)에 `validateCardList(body.characterCards)`와 `attributeProposalSupported` 도출을 추가.
  - `validateCardList(raw): { ok: true, cards: CharacterCard[] } | { ok: false }` — 빈/없음은 `{ ok: true, cards: [] }`로 정규화.
  - `defaultSheetSchema()` — 기존 Default에 `attributeProposalSupported: true`(네 평가 항목 보유)와 `characterCards: []`(카드 기반 아님)를 포함(요구사항 7.3, Glossary Default_Sheet_Schema 정의).
  - `selectActiveSchema(outcome)` — 카드 목록 무효도 폴백 경로로 흡수(항상 정확히 하나의 유효 Active_Sheet_Schema).

### 5. Visibility & Render — 제안/능력치 영역·빈 섹션 숨김, 카드 렌더 (`public/character/logic.js`, `public/character/index.html`)

- **책임**
  - `computeVisibility`가 `attributeProposalSupported`가 거짓이면 `proposeEnabled: false` + 신규 `proposeVisible: false`를 도출해 Propose_Action(`#proposeBtn`)을 표시하지 않게 한다(요구사항 2.1). 부수효과 계층은 제안 요청을 전송하지 않는다(요구사항 2.2).
  - `Rated_Trait_Count === 0`이면 Stat_Setting_Section과 모든 Rated_Trait 편집 요소를 표시하지 않게 도출한다(요구사항 2.3). `≥ 1`이면 기존대로 표시(요구사항 2.6).
  - `renderModel`은 한 Sheet_Section에 소속된 Narrative_Field와 Rated_Trait가 모두 0개이면 그 섹션을 렌더 결과에서 제외한다(요구사항 2.4). 카드 전용 섹션 등 비어 보이는 섹션을 감춘다.
  - `renderModel`(또는 신규 `cardListModel`)은 Card_Based_Sheet에서 각 Character_Card를 `roleLabel`·`premise`(+있으면 `backstoryGuidance`)와 함께, 어떤 카드도 미리 선택하지 않은 상태로 렌더한다(요구사항 4.1). Selected_Card는 선택된 것으로 식별 가능하게 표시한다(요구사항 4.4). 모든 텍스트는 `esc`로 이스케이프한다.
  - Backstory_Field는 스키마가 정의한 Narrative_Field(이름·역할/컨셉·태도·목표 등)로 렌더한다(요구사항 4.2).
  - 확정 상태에서는 Card_Selection_Action을 읽기 전용(비활성)으로 도출하고 Selected_Card를 변경하지 않는다(요구사항 8.1).
- **인터페이스(확장)**
  - `computeVisibility(state)` 반환에 `proposeVisible: boolean`, `statSectionVisible: boolean`, `cardSelectionEnabled: boolean` 추가(기존 플래그 보존).
  - `cardListModel(schema, selectedCardId): { cards: Array<{ id, roleLabel, premise, backstoryGuidance, selected: boolean }> }` — 단일 선택 표시 모델.
  - `index.html`은 위 가시성/모델로 `#proposeBtn`·능력치 영역·카드 목록 DOM을 표시/숨김·배선한다(부수효과 계층).

### 6. Card_Selection 전이 & Reducer (`public/character/logic.js`)

- **책임**
  - `selectCard(state, cardId)`: Card_Based_Sheet이고 비확정이면 그 `cardId`를 유일한 Selected_Card로 두고 직전 선택을 해제해 **항상 최대 하나의 Selected_Card**만 존재하게 한다(요구사항 4.3). 확정 상태면 변경하지 않는다(요구사항 8.1, 8.2).
  - `reduce`에 `CARD_SELECTED` 액션을 추가: `selectCard` 전이를 적용. 확정 상태에서는 무시(요구사항 8.2).
  - `reduce`에 `RECORD_RESOLVED`/`CONFIRM_RESOLVED` 경로의 `INVALID_CARD` 처리를 추가: 한국어 오류 안내를 설정하고, 입력한 Narrative_Field 값(이름 포함)·Selected_Card를 변경 없이 보존하며, `confirmed`를 참으로 전이시키지 않는다(요구사항 5.1, 6.4).
  - Save/Confirm 의도 처리: Card_Based_Sheet이고 Selected_Card가 없으면 `validateCardSelection`이 무효를 돌려주므로, 부수효과 계층은 요청을 전송하지 않고 reduce가 `INVALID_CARD` 안내를 설정한다(요구사항 5.1). 카드 기반 아님이면 검증을 적용하지 않는다(요구사항 5.4).
- **인터페이스(확장)**
  - `selectCard(state, cardId): CharacterSheetState` — 단일 선택 전이(순수).
  - `state.selectedCardId: string | null` — 신규 상태 필드(Selected_Card의 Card_Id).
  - `reduce` 액션: `CARD_SELECTED`(payload `cardId`), 그리고 record/confirm 결과의 `INVALID_CARD` 분기.

### 7. Error_Mapping — `INVALID_CARD` → 한국어 메시지 (`public/character/logic.js`)

- **책임**
  - 프론트엔드 사전 검증(카드 미선택)과 백엔드 `INVALID_CARD` 응답 모두에서 "역할 카드를 먼저 선택" 한국어 안내를 표시하고 입력(이름·서사 값)·Selected_Card를 보존하며 확정으로 전이하지 않는다(요구사항 5.1, 6.4).
- **인터페이스(확장)**
  - `RecordRejection`에 `INVALID_CARD` 추가, `RECORD_REJECTION_MESSAGES`에 한국어 메시지 추가, `classifyRecordResult`에 본문 `reason === "INVALID_CARD"` 분기 추가(기존 `INVALID_ALLOCATION` 분기와 동일 패턴).
  - 신규 상수 `CARD_REQUIRED_MESSAGE`(프론트 사전 검증용) — `INVALID_CARD` 응답 메시지와 동일 문구를 공유할 수 있다.

## Data Models

### Character_Card

```ts
interface CharacterCard {
  id: string;                  // Card_Id: 트림 후 1자 이상, 목록 내 고유 (요구사항 3.1, 3.2)
  roleLabel: string;           // Card_Role_Label: 트림 후 1자 이상 (요구사항 3.1)
  premise: string;             // Card_Premise: 역할 전제·설명 (요구사항 3.1)
  backstoryGuidance?: string;  // Card_Backstory_Guidance: 선택적 배경 작성 안내
}
```

### SheetSchema 확장 (`src/services/sheet-schema.ts` / `public/character/logic.js`)

```ts
interface SheetSchema {
  // ... 기존 필드 (sections, narrativeFields, traits, allocation, genre, system 등) 보존 ...
  attributeProposalSupported: boolean;   // 정확히 하나 (요구사항 1.1)
  characterCards?: CharacterCard[];       // 1개 이상이면 Card_Based_Sheet, 없음/빈 배열이면 아님 (요구사항 3.4)
}
```

- 보존 규칙:
  - `UNIVERSAL_SHEET`: `attributeProposalSupported: true`, `characterCards` 없음(요구사항 1.5, 3.5).
  - `GEESE_SHEET`: `attributeProposalSupported: true`, `characterCards` 없음(요구사항 1.5, 3.5).
  - `SINKS_SHEET`(`until-it-sinks`): `attributeProposalSupported: false`(traits 0개, 요구사항 1.6), `characterCards: [지배인, 작가, 지질학자]`(요구사항 3.3).
- `Default_Sheet_Schema`: `attributeProposalSupported: true`(네 평가 항목 보유), `characterCards: []`(카드 기반 아님).

### until-it-sinks Character_Card_List (예시 데이터)

```ts
const SINKS_CARDS: CharacterCard[] = [
  { id: "manager",     roleLabel: "지배인",   premise: "섬 호텔의 운영을 책임지는 인물. 모두를 안심시키려 하지만 비밀이 많다.", backstoryGuidance: "어떻게 이 섬에 오게 됐는지, 무엇을 숨기는지 적어 주세요." },
  { id: "writer",      roleLabel: "작가",     premise: "휴양을 핑계로 섬에 머무는 작가. 사람들을 관찰하고 기록한다.",          backstoryGuidance: "무엇을 쓰러 왔는지, 누구에게 관심이 있는지 적어 주세요." },
  { id: "geologist",   roleLabel: "지질학자", premise: "섬이 가라앉는 원인을 조사하러 온 학자. 데이터에 집착한다.",            backstoryGuidance: "어떤 가설을 품고 있는지, 무엇을 두려워하는지 적어 주세요." },
];
```

### CharacterInput / Character 확장

```ts
interface CharacterInput {
  name: string;
  concept: string;
  attributes: Record<string, AttributeLevel>;
  selectedCardId?: string;  // Card_Based_Sheet에서 선택된 Card_Id (요구사항 6.1)
}

interface Character {
  // ... 기존 필드 ...
  selectedCardId?: string;  // 기록·확정 시 보존되는 Selected_Card의 Card_Id (요구사항 6.1, 8.3)
}
```

### 카드 검증 결과

```ts
type CardSelectionValidation =
  | { ok: true }
  | { ok: false; reason: "INVALID_CARD" };  // 카드 미선택 또는 목록에 없는 Card_Id (요구사항 6.2)
```

### 프론트엔드 상태 확장 (`public/character/logic.js`)

```ts
interface CharacterSheetState {
  // ... 기존 필드 (handoff, activeSchema, narrativeValues, traitValues, confirmed 등) 보존 ...
  selectedCardId: string | null;  // Selected_Card의 Card_Id, 미선택이면 null (요구사항 4.3)
}
```

## Correctness Properties

*속성(property)이란 시스템의 모든 유효한 실행에서 참이어야 하는 특성 또는 동작으로, 시스템이 무엇을 해야 하는지에 대한 형식적 진술이다. 속성은 사람이 읽는 명세와 기계가 검증 가능한 정확성 보증 사이의 다리 역할을 한다.*

본 기능의 PBT 대상은 DOM·네트워크·무작위에서 분리된 **순수 로직**이다: 시트 스키마 해석(`sheetSchemaForScenario`, `deriveAttributeProposalSupported`, `cardsForScenario`), 프론트엔드 순수 함수(`validateCardSelection`, `isCardBasedSheet`, `validateCardList`, `validateSchema`, `selectActiveSchema`, `cardListModel`, `renderModel`, `selectCard`, `computeVisibility`, `buildRecordRequest`, `reduce`), 백엔드 카드 검증(`CharacterService.recordCharacter`). 200ms 선택 해제 타이밍·10초 타임아웃 발화·제안 요청 미전송의 실제 fetch 차단·레이아웃은 속성이 아닌 예제/통합 테스트로 다룬다(Testing Strategy 참조). 아래 속성들은 prework 분석을 reflection으로 통합한 것이다(중복 분류 항목은 통합 속성으로 흡수했다).

### Property 1: 해석된 스키마는 정확히 하나의 attributeProposalSupported를 가지며 도출 규칙을 따른다

*For any* Scenario(임의의 `Rated_Trait_Count`와 임의의 `Attribute_Proposal_Disabled` 입력)에 대해, `sheetSchemaForScenario`가 해석한 Active_Sheet_Schema는 정확히 하나의 불리언 `attributeProposalSupported`를 포함하고, 그 값은 `Rated_Trait_Count === 0`이거나 `Attribute_Proposal_Disabled`가 참이면 거짓이고, `Rated_Trait_Count ≥ 1`이며 `Attribute_Proposal_Disabled`가 참이 아니면 참이다.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 2: 카드 기반 해석 스키마의 카드 형태 불변식

*For any* 카드 기반 작성을 지정한 Scenario에 대해, `sheetSchemaForScenario`가 해석한 Active_Sheet_Schema의 `characterCards`는 원소가 1개 이상이고, 각 Character_Card는 공백 제거 후 1자 이상인 `id`와 공백 제거 후 1자 이상인 `roleLabel`과 `premise`를 가지며, 그 목록 안의 모든 `id`는 서로 다르다(고유).

**Validates: Requirements 3.1, 3.2**

### Property 3: 카드 기반이 아닌 시나리오는 Card_Based_Sheet가 아니다

*For any* 카드 기반 작성을 지정하지 않은 Scenario에 대해, `sheetSchemaForScenario`가 해석한 Active_Sheet_Schema의 `characterCards`는 없거나 빈 배열이며, `isCardBasedSheet`는 그 스키마에 대해 거짓을 반환한다.

**Validates: Requirements 3.4, 3.5**

### Property 4: 능력치 제안 동작 표시 도출 (Propose_Action)

*For any* 작성 상태에 대해, `computeVisibility`는 Active_Sheet_Schema의 `attributeProposalSupported`가 거짓이면 Propose_Action을 표시하지 않도록(`proposeVisible` 거짓, `proposeEnabled` 거짓) 도출하고, 참이면 Propose_Action을 표시하며(`proposeVisible` 참) 그 활성 여부는 기존 활성 규칙(인계 유효·비확정·진행 중 아님)과 정확히 일치하도록 도출한다.

**Validates: Requirements 2.1, 2.5**

### Property 5: 능력치 설정 영역 표시 도출 (Stat_Setting_Section)

*For any* Active_Sheet_Schema와 작성 상태에 대해, `Rated_Trait_Count === 0`이면 `computeVisibility`는 Stat_Setting_Section을 표시하지 않도록(`statSectionVisible` 거짓) 도출하고 `renderModel`은 어떤 Rated_Trait 평가 편집 요소도 산출하지 않으며, `Rated_Trait_Count ≥ 1`이면 Stat_Setting_Section을 표시하고(`statSectionVisible` 참) `renderModel`은 각 Rated_Trait의 평가 편집 요소를 산출한다.

**Validates: Requirements 2.3, 2.6**

### Property 6: 빈 Sheet_Section은 렌더되지 않는다

*For any* Active_Sheet_Schema에 대해, `renderModel`의 결과는 소속된 Narrative_Field와 Rated_Trait가 모두 0개인 Sheet_Section을 포함하지 않으며, 그 외 비어 있지 않은 Sheet_Section은 스키마 정의 순서대로 보존한다.

**Validates: Requirements 2.4**

### Property 7: 카드 목록 렌더 모델은 정확히 하나의 선택을 표시하고 모든 카드·서사 입력을 렌더한다

*For any* Card_Based_Sheet와 선택 상태(`selectedCardId`가 null이거나 목록의 한 Card_Id)에 대해, `cardListModel`은 Character_Card_List의 **모든** 카드를 각자의 `roleLabel`·`premise`(+있으면 `backstoryGuidance`)와 함께 산출하고, `selectedCardId`가 null이면 어떤 카드도 선택되지 않은 것으로(`selected` 모두 거짓), `selectedCardId`가 목록의 한 Card_Id이면 그 카드 정확히 하나만 `selected: true`로(나머지는 거짓) 표시한다. 또한 `renderModel`은 그 스키마가 정의한 각 Backstory_Field(Narrative_Field) 입력 요소를 산출한다.

**Validates: Requirements 4.1, 4.2, 4.4**

### Property 8: 카드 단일 선택 전이와 확정 시 잠금

*For any* Card_Based_Sheet 상태와 임의의 카드 선택 시퀀스(임의의 Card_Id들)에 대해, 비확정 상태에서 `selectCard`(또는 `reduce`의 `CARD_SELECTED`)를 적용하면 `state.selectedCardId`는 마지막으로 선택한 Card_Id와 같고 직전 선택은 해제되어 **항상 최대 하나의 Selected_Card**만 존재하며, 확정 상태(`confirmed === true`)에서는 어떤 카드 선택 시도에도 `selectedCardId`가 변경 없이 그대로 유지된다.

**Validates: Requirements 4.3, 8.2**

### Property 9: 저장·확정 요청은 선택된 Card_Id와 서사 값을 포함한다

*For any* 인계 값·이름·서사 값 맵·`selectedCardId`에 대해, 정확히 하나의 Selected_Card가 존재할 때 `buildRecordRequest`(또는 동등한 요청 빌더)가 만든 요청 본문은 그 Selected_Card의 Card_Id와 플레이어가 입력한 Narrative_Field 값(앞뒤 공백만 제거, 내부 공백 보존)을 포함한다.

**Validates: Requirements 4.5**

### Property 10: 카드 선택 검증 알고리즘 (Frontend_Card_Validator)

*For any* `cardList`(없음/빈 배열 또는 1개 이상)와 임의의 `selectedId`(누락·빈 문자열·임의 문자열)에 대해, `validateCardSelection`은 (a) `cardList`가 없거나 비어 있으면(카드 기반 아님) 항상 유효를 반환하고, (b) `cardList`가 1개 이상이면 `selectedId`가 공백 제거 후 1자 이상이고 그 트림 값이 목록의 어떤 Character_Card의 Card_Id(트림)와 정확히 일치할 때에만 유효를 반환하며, 그렇지 않으면(미선택·빈·목록에 없는 Card_Id) `INVALID_CARD` 사유로 무효를 반환한다.

**Validates: Requirements 5.4, 6.2**

### Property 11: 카드 선택 검증의 결정성·멱등성

*For any* 동일한 `cardList`와 동일한 `selectedId`에 대해, `validateCardSelection`을 임의의 횟수(2회 이상) 호출해도 판정 순서나 직전 판정 상태와 무관하게 매번 동일한 판정(동일한 유효/무효와 동일한 사유 분류)을 산출한다.

**Validates: Requirements 5.3**

### Property 12: 프론트엔드·백엔드 카드 검증 패리티

*For any* 동일한 Character_Card_List와 동일한 카드 선택 입력(`selectedId`)에 대해, `Frontend_Card_Validator`(`validateCardSelection`)와 `Backend_Card_Validator`(`recordCharacter`의 카드 검증)는 동일한 유효/무효 판정을 내린다. 둘 다 유효로 판정하면 어느 쪽도 카드 거부 사유를 산출하지 않고, 무효로 판정하면 둘 다 `INVALID_CARD`로 분류한다.

**Validates: Requirements 5.2**

### Property 13: 백엔드 카드 기록·거부와 비카드 보존

*For any* `recordCharacter` 호출에 대해, (a) `options.characterCards`가 1개 이상이고 `selectedCardId`가 그 목록에 속하면 확정 전 캐릭터를 그 Card_Id와 입력된 Narrative_Field 값으로 기록·갱신하고(`confirmed: false`, 저장된 `selectedCardId` 설정), (b) `options.characterCards`가 1개 이상이지만 카드 선택이 없거나 목록에 속하지 않으면 `INVALID_CARD` 사유로 거부하며 어떤 캐릭터 데이터도 기록·갱신하지 않고, (c) `options.characterCards`가 없거나 빈 배열이면 카드 검증을 적용하지 않고 기존 동작(능력치·이름 검증·기록)을 변경 없이 수행한다.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 14: 확정된 캐릭터는 카드 선택을 잠근다

*For any* Confirmed_State 캐릭터에 대해, `recordCharacter`는 카드 검증보다 먼저 그 호출을 `ALREADY_CONFIRMED` 사유로 거부하고, 확정된 캐릭터의 카드 선택(`selectedCardId`)과 Narrative_Field 값을 변경 없이 그대로 보존한다.

**Validates: Requirements 8.3**

### Property 15: 카드 미선택·INVALID_CARD는 입력을 보존하고 확정을 막는다

*For any* 작성 상태에 대해, (a) Active_Sheet_Schema가 Card_Based_Sheet이고 Selected_Card가 없는 상태에서 Save/Confirm 게이트를 평가하면 `validateCardSelection`이 무효를 산출하므로 어떤 기록/확정 요청도 전송되지 않고, (b) 그 사전 무효 또는 백엔드 `INVALID_CARD` 응답을 `reduce`로 처리하면 플레이어가 입력한 Narrative_Field 값(이름 포함)과 `selectedCardId`가 변경 없이 보존되고, 카드 선택을 요구하는 한국어 오류 안내가 설정되며, 캐릭터는 Confirmed_State로 전이하지 않는다.

**Validates: Requirements 5.1, 6.4**

### Property 16: 카드 목록 스키마 검증 (validateCardList)

*For any* 스키마 응답의 `characterCards` 페이로드에 대해, `validateCardList`는 그것이 없거나 빈 배열이거나(카드 기반 아님), 또는 원소가 1개 이상이며 모든 원소가 공백 제거 후 1자 이상인 `id`와 공백 제거 후 1자 이상인 `roleLabel`을 갖고 모든 `id`가 고유할 때에만, 그리고 오직 그 때에만 유효로 인정한다.

**Validates: Requirements 7.1**

### Property 17: 카드 목록 무효 시 기본 스키마 폴백

*For any* 성공(2xx) 스키마 응답이지만 그 `characterCards`가 Property 16의 유효 조건을 충족하지 못하는 경우에 대해, `selectActiveSchema`(및 `validateSchema`)는 그 스키마를 채택하지 않고 카드 기반이 아닌 `Default_Sheet_Schema`를 Active_Sheet_Schema로 채택한다(`isCardBasedSheet`가 거짓).

**Validates: Requirements 7.2**

### Property 18: attributeProposalSupported 폴백 도출

*For any* `attributeProposalSupported` 플래그가 없는 성공 스키마 응답에 대해, `validateSchema`는 채택한 스키마의 `attributeProposalSupported`를 그 스키마의 `Rated_Trait_Count`가 0이면 거짓으로, 1 이상이면 참으로 도출한다.

**Validates: Requirements 7.4**

### Property 19: 확정 상태의 카드 선택 읽기 전용 도출

*For any* Confirmed_State 작성 상태에 대해, `computeVisibility`는 Card_Based_Sheet의 Card_Selection_Action을 읽기 전용(비활성, `cardSelectionEnabled` 거짓)으로 도출하고, `selectedCardId`(Selected_Card)를 확정 시점 값에서 변경하지 않는다.

**Validates: Requirements 8.1**

## Error Handling

### 거부 사유와 사용자 메시지

본 스펙이 추가하는 거부 사유는 `INVALID_CARD` 하나이며, 직전에 병합된 `INVALID_ALLOCATION`/`INVALID_ATTRIBUTES`와 구별되는 한국어 메시지로 매핑된다.

| 사유 | 발생 조건 | 사용자 메시지(요지) | 요구사항 |
| --- | --- | --- | --- |
| `INVALID_CARD` | Card_Based_Sheet에서 카드 미선택 또는 목록에 없는 Card_Id | 역할 카드를 먼저 선택해야 한다는 안내 | 5.1, 6.2, 6.4 |
| `INVALID_ATTRIBUTES` / `INVALID_ALLOCATION` | (기존) 사다리/배분 위반 | (기존 메시지) | flexible-stat-allocation |
| `NAME_TAKEN` / `ALREADY_CONFIRMED` / `UNKNOWN_PLAYER` | (기존) | (기존 메시지) | character-sheet |

- `INVALID_CARD`는 프론트엔드 `RecordRejection`·`RECORD_REJECTION_MESSAGES`(`public/character/logic.js`)와 백엔드 `RecordCharacterResult`(`character-service.ts`)에 신규로 추가한다. `classifyRecordResult`는 본문 `reason === "INVALID_CARD"`를 기존 분기들(`INVALID_ALLOCATION` 등)과 동일한 패턴으로 분류한다.
- 프론트엔드 사전 검증(카드 미선택)과 백엔드 응답은 **동일한 한국어 문구**를 공유해, 사용자가 "역할 카드를 골라야 한다"는 동일 안내를 받는다(요구사항 5.1, 6.4).

### 회복·보존 정책

- 카드 거부(`INVALID_CARD`)와 전송 오류에서 인계 식별자·Access_Token과 플레이어 입력(Narrative_Field·Selected_Card)을 보존하고, 캐릭터를 Confirmed_State로 전이시키지 않는다(Property 15).
- 스키마 응답의 `characterCards`가 무효이면 카드 기반이 아닌 `Default_Sheet_Schema`로 우아하게 폴백하고 한국어 안내(`SCHEMA_FALLBACK_MESSAGE`)를 표시하며 플레이어가 작성을 계속할 수 있게 한다(Property 17, 요구사항 7.3).
- 확정된 캐릭터는 카드 선택이 잠겨 보존된다(Property 14, 19).
- 빈 섹션·능력치 영역·제안 동작 숨김은 표시 도출의 일부이며, 어떤 데이터도 삭제하지 않는다(보존). 폴백·숨김 모두 작성 흐름을 멈추지 않는다.

## Testing Strategy

### 이중 테스트 접근

- **속성 테스트(Property tests)**: 위 Correctness Properties 1~19를 검증한다. 프론트엔드 순수 로직(`public/character/logic.js`)은 노드 환경 vitest에서, 백엔드 검증(`src/services/character-service.ts`·`src/services/sheet-schema.ts`)은 src 테스트에서 검증한다. **카드 검증 패리티(Property 12)** 는 프론트엔드 `validateCardSelection`과 백엔드 카드 검증기를 같은 테스트에서 import 해 동일 생성 입력으로 대조한다(직전 `validateAllocation` 패리티 테스트와 동일 방식).
- **예제/단위 테스트(Example tests)**: 입력에 따라 의미 있게 달라지지 않는 항목 — `UNIVERSAL_SHEET`·`terrible-geese` → `attributeProposalSupported: true`·카드 기반 아님(요구사항 1.5, 3.5), `until-it-sinks` → `attributeProposalSupported: false`·지배인·작가·지질학자 카드(요구사항 1.6, 3.3), `INVALID_CARD` 한국어 메시지 문구(요구사항 5.1, 6.4), 카드 목록 무효 폴백 시 `SCHEMA_FALLBACK` 안내·`usingDefaultSchema: true`(요구사항 7.3).
- **통합 테스트(Integration tests)**: `attributeProposalSupported`가 거짓일 때 Propose_Action이 DOM에 없고 제안 요청이 전송되지 않음(요구사항 2.2)을 가짜 fetch로 검증, 카드 선택 시 직전 선택의 200ms 이내 해제 표시(요구사항 4.3 타이밍)를 가짜 타이머로 검증, 능력치 영역·빈 섹션·카드 목록의 실제 DOM 표시/숨김(happy-dom)을 검증.

### 도구

- **속성 테스트 라이브러리**: `fast-check`(기존 `package.json` devDependency). 직접 구현하지 않고 이 라이브러리를 사용한다.
- **테스트 러너**: `vitest`(기존). 프론트엔드 순수 모듈(`public/**/*.test.js`)은 노드 환경, DOM 배선은 `happy-dom`, 백엔드(`src/**/*.test.ts`)는 노드 환경에서 실행한다.

### 속성 테스트 규칙

- 각 속성 테스트는 최소 **100회 반복**으로 실행한다(`fast-check`의 `numRuns: 100` 이상).
- 각 속성 테스트는 설계 문서의 속성을 주석으로 참조한다.
- 태그 형식: **Feature: scenario-character-cards, Property {번호}: {속성 텍스트}**
- 각 Correctness Property는 **하나의** 속성 기반 테스트로 구현한다.

#### 생성기(Generator) 전략

- **시나리오/스키마 생성기**: 임의 개수(0개 포함)의 Rated_Trait, 임의의 `Attribute_Proposal_Disabled`(참/거짓/누락) — Property 1, 5, 18. 카드 기반·비카드 시나리오 — Property 2, 3, 17.
- **Character_Card_List 생성기**:
  - 유효 목록: 1개 이상, 트림 후 1자 이상 고유 `id`·1자 이상 `roleLabel`·임의 `premise`·선택적 `backstoryGuidance` — Property 2, 7, 10, 12, 13, 16.
  - 무효 목록: 빈 `id`/`roleLabel`(전부 공백 포함), 중복 `id`, 비객체 원소 — Property 16, 17.
  - 없음/빈 배열(카드 기반 아님) — Property 3, 10(a), 13(c), 16.
- **선택 입력(`selectedId`) 생성기**: 목록의 한 Card_Id(유효), 목록에 없는 문자열, 빈 문자열, 공백 문자열, 누락(null/undefined) — Property 10, 11, 12, 13, 15.
- **선택 시퀀스 생성기**: 임의 길이의 Card_Id 선택 시퀀스(목록 내/외 혼합) — Property 8.
- **작성 상태 생성기**: 비확정/확정, 임의 Narrative_Field 값(앞뒤·내부 공백 포함), 임의 `selectedCardId` — Property 4, 8, 9, 15, 19.
- **확정 캐릭터 생성기**: 저장된 `selectedCardId`·서사 값을 가진 `confirmed: true` 캐릭터 — Property 14.
