# Requirements Document

## Introduction

ready-gm은 친구들과 함께 즐기는 멀티플레이 TRPG 세션을 AI GM이 진행해 주는 웹 플랫폼입니다. 본 스펙은 **캐릭터 능력치 배분 방식(stat allocation)** 을 일반화하는 하나의 횡단 관심사에 집중합니다. 현재 캐릭터 시트는 평가 항목(Rated_Trait)마다 자기 사다리(Trait_Ladder) 안에서 값을 독립적으로 고르는 단일 방식만 지원합니다. 예를 들어 "끔찍한 거위들"(terrible-geese) 시트는 세 능력치를 각각 `[1, 4]` 구간에서 자유롭게 고르게 두고, 능력치 총합이나 배분 규칙을 강제하지 않습니다.

여러 시나리오·규칙계는 서로 다른 능력치 배분 관행을 씁니다: 정해진 점수 묶음을 나눠 쓰는 **포인트 바이(point-buy, 총합 강제)**, 정해진 숫자 한 벌을 능력치에 일대일로 배정하는 **고정값 배정(standard array)**, 주사위를 굴려 능력치를 정하는 **랜덤(dice-rolled)** 등이 대표적입니다. 본 스펙은 이런 서로 다른 규칙을 하나의 **교체 가능한 배분 규칙(Allocation_Rule)** 추상으로 표현하고, 그 규칙을 시나리오별로 선택(현재 시나리오별 시트 스키마 선택과 동일한 방식)하며, **프론트엔드와 백엔드가 동일한 규칙으로 동일하게 검증**하도록 만드는 것을 목표로 합니다.

핵심 설계 원칙은 **단일 소켓(single pluggable structure)** 입니다. 시트 스키마(Active_Sheet_Schema)에 정확히 하나의 Allocation_Rule을 실어 보내고, 그 규칙의 종류(Allocation_Mode)에 따라 능력치 한 벌(Rated_Trait_Set)이 유효한지 판정합니다. 새 방식을 추가할 때 시트 렌더·기록·확정의 골격을 바꾸지 않고 규칙 한 종류만 더하면 되도록 설계합니다.

본 스펙은 기존 동작을 **보존**합니다. 기존 EZFudge 범용 시트(UNIVERSAL_SHEET)와 거위 시트(GEESE_SHEET)의 능력치 배분 동작은 "사다리 선택(LADDER_SELECT)" 방식으로 그대로 유지됩니다.

### 백엔드/프론트엔드 계약 근거 (실제 코드 확인)

본 스펙은 다음 실제 코드를 근거로 합니다.

- **시트 스키마 해석기**(`src/services/sheet-schema.ts`): `UNIVERSAL_SHEET`·`GEESE_SHEET`·`SINKS_SHEET`와, `sheetSchemaForScenario(scenario)`가 시나리오에 따라 시트(`SheetSchema`)를 돌려준다. `expectedTraitSpecForScenario(scenario)`는 서버가 능력치를 검증할 때 쓸 `{ keys, ladder }`(평가 항목 키 목록과 공통 사다리)를 돌려준다. 현재 `SheetSchema`에는 능력치 배분 규칙을 표현하는 필드가 없으며, 각 `RatedTraitSpec`은 `ladder`만 가진다.
- **캐릭터 서비스**(`src/services/character-service.ts`): `recordCharacter(playerId, { name, concept, attributes }, options?)`는 `options.traitKeys`·`options.ladder`를 받아, 각 `traitKey`의 값이 `ladder` 안의 정수인지 `isValidAttributeLevel`로 검증한다. 위반 시 `INVALID_ATTRIBUTES`로 거부한다. 빈 `traitKeys` 배열은 능력치 검증 생략(서사 전용 시트)을 뜻하고, `options` 자체를 생략하면 기본 EZFudge 네 키를 검증한다. **현재는 사다리 경계만 검증하며, 총합·고정값·랜덤 같은 배분 규칙은 검증하지 않는다.**
- **EZFudge 코어**(`src/core/ezfudge.ts`): `DEFAULT_ATTRIBUTE_LADDER = [-2, +4]`, `isValidAttributeLevel(level, ladder)`는 정수이며 사다리 안일 때만 참. 사다리는 시나리오·규칙계가 다른 구간을 쓰도록 **구성 가능**하다고 명시된다.
- **시나리오 서비스**(`src/services/scenario-service.ts`): `Scenario`는 `{ id, title, summary, openingSeed, endingCondition, genre, category, hasSpecialRules, system }`. `hasSpecialRules`/`system`/`id`로 시나리오별 규칙계를 구분하며, `sheetSchemaForScenario`가 이 정보로 시트를 고른다.
- **프론트엔드 순수 로직**(`public/character/logic.js`): `validateSchema(body)`는 스키마 응답을 검증·정규화하고, 누락·형식 위반 `Trait_Ladder`를 기본 `[-2, +4]`로 보정한다. `selectActiveSchema(outcome)`는 유효하면 채택, 아니면 `defaultSheetSchema()`로 폴백한다. `renderModel`은 각 Rated_Trait 편집 요소의 선택 가능 값을 그 사다리의 정수로 제한한다. **현재는 능력치 사이의 배분 제약(총합 등)을 검증·강제하는 순수 함수가 없다.**
- **주사위**(`public/game/dice.js`, `src/` 다이스 서비스): 무작위는 항상 서버 측에서 생성된다는 프로젝트 규약이 있다(`src/core/ezfudge.ts`의 advantage 주석 등). 랜덤 배분의 굴림 결과는 서버가 생성한다.

> 본 스펙은 기존 character-sheet 스펙과 동일하게, **현재 플레이테스트 서버에 아직 배선되지 않은 백엔드 항목**을 아래 "범위 밖 / 가정"에 명시한다. 프론트엔드 순수 로직과 백엔드 서비스 로직은 각각 vitest + fast-check로 모킹 없이(또는 주입된 무작위원으로) 명세·검증할 수 있다.

## 범위 밖 / 가정 (Assumptions)

- **Allocation_Rule을 담는 스키마 필드는 의도된 계약이다**: 현재 `SheetSchema`/`RatedTraitSpec`에는 배분 규칙 필드가 없다. 본 스펙은 `SheetSchema`에 정확히 하나의 `Allocation_Rule`을 싣는 의도된 확장 위에서 동작을 정의한다. 시나리오가 규칙을 지정하지 않으면 사다리 선택(LADDER_SELECT)이 기본값이다.
- **`recordCharacter`의 배분 검증 옵션은 의도된 확장이다**: 본 스펙은 `RecordCharacterOptions`에 `Allocation_Rule`(또는 그와 동등한 검증 정보)을 전달하는 의도된 확장 위에서 백엔드 검증을 정의한다. 기존 `traitKeys`·`ladder` 옵션과 기본 EZFudge 동작은 보존된다.
- **랜덤 굴림 엔드포인트는 의도된 계약이다**: 랜덤 배분의 굴림(Dice_Roll_Action)은 서버 측 무작위로 수행되는 의도된 엔드포인트(Allocation_Roll_Endpoint) 위에서 정의한다. 무작위 값 자체는 서버가 생성한다.
- **실제 REST/실시간 배선은 후속 작업**: 시트 스키마·기록·확정·굴림 엔드포인트의 실제 HTTP 배선은 character-sheet 스펙과 동일하게 의도된 계약으로 두고, 본 스펙은 그 계약 위에서 순수 로직과 서비스 로직을 명세한다.
- **고정값 배정의 값 개수**: 고정값 배정(FIXED_VALUE)에서 Value_Pool의 원소 개수는 그 스키마의 Rated_Trait 개수와 같다고 가정한다(각 평가 항목에 값 하나씩 일대일 배정).
- **기존 시트 동작 보존**: UNIVERSAL_SHEET·GEESE_SHEET·SINKS_SHEET의 기존 능력치 배분 동작은 변경하지 않는다(각각 LADDER_SELECT 또는 평가 항목 없음).

## Glossary

- **Stat_Allocation_System**: 본 스펙이 정의하는 능력치 배분 추상과 그 검증을 통칭하는 시스템. 시트 스키마에 실린 Allocation_Rule과, 그 규칙으로 Rated_Trait_Set을 판정하는 프론트엔드·백엔드 검증으로 구성된다.
- **Sheet_Schema_Resolver**: 시나리오를 받아 시트 스키마를 돌려주는 백엔드 구성요소(`sheetSchemaForScenario`). 본 스펙에서 시트 스키마에 정확히 하나의 Allocation_Rule을 싣는다.
- **Active_Sheet_Schema**: 현재 렌더·검증·전송에 사용 중인 시트 스키마. 정확히 하나의 Allocation_Rule을 포함한다.
- **Rated_Trait**: 시트 스키마가 정의하는 평가 항목. Trait_Key·표시 레이블·Trait_Ladder를 가지며 하나의 정수 Trait_Level을 갖는다.
- **Trait_Key**: 한 Rated_Trait의 식별자.
- **Trait_Ladder**: 한 Rated_Trait가 사용하는 정수 포함 구간 `{ min, max }`. 미지정 시 기본 EZFudge 사다리 `[-2, +4]`.
- **Trait_Level**: 한 Rated_Trait의 값. 해당 Trait_Ladder 안의 정수.
- **Rated_Trait_Set**: Active_Sheet_Schema가 정의한 모든 Rated_Trait에 각각 하나의 Trait_Level을 부여한 한 벌(`Record<Trait_Key, Trait_Level>`).
- **Allocation_Rule**: 한 Active_Sheet_Schema에 실리는 교체 가능한 능력치 배분 규칙. 정확히 하나의 Allocation_Mode와, 그 모드에 필요한 매개변수(Base_Level·Point_Pool·Value_Pool·Dice_Formula·Forced_Random 등)를 갖는다.
- **Allocation_Mode**: Allocation_Rule의 종류. 다음 네 가지 중 하나다 — `LADDER_SELECT`(사다리 선택), `POINT_BUY`(총합 강제 포인트 바이), `FIXED_VALUE`(고정값 배정), `DICE_ROLL`(랜덤 굴림).
- **LADDER_SELECT**: 각 Rated_Trait의 Trait_Level을 그 Trait_Ladder 안에서 독립적으로 고르는 방식. 평가 항목 사이의 제약이 없다. 기존 UNIVERSAL_SHEET·GEESE_SHEET의 동작.
- **POINT_BUY**: 모든 Rated_Trait가 Base_Level에서 시작하고, Point_Pool만큼의 점수를 올려 배분하는 방식. 올린 점수의 총합이 Point_Pool과 정확히 같아야 한다.
- **FIXED_VALUE**: 정해진 숫자 한 벌(Value_Pool)을 각 Rated_Trait에 일대일로 배정하는 방식. Value_Pool의 각 값은 정확히 한 번씩 쓰인다.
- **DICE_ROLL**: 주사위 식(Dice_Formula)을 굴려 각 Rated_Trait의 Trait_Level을 정하는 방식. 무작위는 서버가 생성한다.
- **Base_Level**: POINT_BUY에서 각 Rated_Trait의 시작 정수 값.
- **Point_Pool**: POINT_BUY에서 Base_Level 위로 추가 배분할 수 있는 점수 총량(0 이상의 정수).
- **Value_Pool**: FIXED_VALUE에서 Rated_Trait들에 배정할 정수 값의 다중집합(multiset). 원소 개수는 Rated_Trait 개수와 같다.
- **Dice_Formula**: DICE_ROLL에서 한 Rated_Trait의 값을 만들기 위해 굴리는 주사위 식(예: `3d6`, `2d6+1`).
- **Forced_Random**: DICE_ROLL에서 굴림 결과를 플레이어가 편집할 수 없도록 강제하는지를 나타내는 불리언.
- **Allocation_Validator**: Allocation_Rule과 Rated_Trait_Set을 받아 유효/무효를 판정하는 검증 계약. 프론트엔드(Frontend_Allocation_Validator, `public/character/logic.js`의 순수 함수)와 백엔드(Backend_Allocation_Validator, `CharacterService.recordCharacter`)에서 각각 실현되며, 두 구현은 동일한 판정을 내려야 한다(검증 패리티).
- **Frontend_Allocation_Validator**: `public/character/logic.js`에 추가되는, Allocation_Rule로 Rated_Trait_Set을 판정하는 순수 함수.
- **Backend_Allocation_Validator**: `CharacterService.recordCharacter`가 Allocation_Rule(또는 동등한 검증 정보)을 받아 수행하는 능력치 배분 검증.
- **Character_Sheet_App**: 캐릭터 시트 작성 프론트엔드(`public/character/`).
- **Character_Service**: 캐릭터 기록/확정 백엔드 서비스(`src/services/character-service.ts`).
- **Initial_Allocation**: 한 Allocation_Rule이 정의하는, 처음 표시할 유효한 Rated_Trait_Set(예: 모든 항목 Base_Level, 고정값을 사다리 정의 순서대로 배정 등). Allocation_Validator는 어떤 Allocation_Rule의 Initial_Allocation도 유효로 판정해야 한다.
- **Dice_Roll_Action**: DICE_ROLL 시트에서 플레이어가 굴림을 요청하는 사용자 동작.
- **Allocation_Roll_Endpoint**: (의도된) DICE_ROLL의 Dice_Formula를 서버 측 무작위로 굴려 각 Rated_Trait의 Trait_Level을 돌려주는 백엔드 엔드포인트.
- **INVALID_ALLOCATION**: 능력치 한 벌이 사다리 경계는 만족하지만 Allocation_Rule의 배분 제약(총합·고정값 다중집합 등)을 위반했을 때의 거부 사유.

## Requirements

### Requirement 1: 시트 스키마에 단일 배분 규칙 부착

**User Story:** 시나리오 작성자로서, 한 시나리오의 능력치 배분 방식을 시트 스키마에 하나로 실어 보내고 싶다. 그래야 시나리오마다 다른 배분 규칙을 같은 골격으로 표현할 수 있다.

#### Acceptance Criteria

1. WHEN the Sheet_Schema_Resolver가 한 Scenario에 대한 Active_Sheet_Schema를 해석하면, THE Sheet_Schema_Resolver SHALL 그 Active_Sheet_Schema에 정확히 하나의 Allocation_Rule을 포함시키며, 그 Allocation_Rule의 Allocation_Mode를 `LADDER_SELECT`, `POINT_BUY`, `FIXED_VALUE`, `DICE_ROLL` 중 정확히 하나로 둔다.
2. IF 한 Scenario가 Allocation_Rule을 지정하지 않으면, THEN THE Sheet_Schema_Resolver SHALL 그 Active_Sheet_Schema의 Allocation_Mode를 `LADDER_SELECT`로 설정한다.
3. IF 한 Scenario가 지정한 Allocation_Mode가 `LADDER_SELECT`, `POINT_BUY`, `FIXED_VALUE`, `DICE_ROLL` 중 어느 것과도 정확히 일치하지 않으면, THEN THE Sheet_Schema_Resolver SHALL 그 Active_Sheet_Schema의 Allocation_Mode를 `LADDER_SELECT`로 설정한다.
4. THE Sheet_Schema_Resolver SHALL `UNIVERSAL_SHEET`에서 해석된 Active_Sheet_Schema의 Allocation_Mode를 `LADDER_SELECT`로 두어 기존 EZFudge 능력치 배분 동작을 보존한다.
5. THE Sheet_Schema_Resolver SHALL `terrible-geese` Scenario에서 해석된 Active_Sheet_Schema의 Allocation_Mode를 `LADDER_SELECT`로 두고 세 평가 항목 각각의 Trait_Ladder를 `{ min: 1, max: 4 }`로 두어 기존 거위 시트의 능력치 배분 동작을 보존한다.
6. WHILE Active_Sheet_Schema의 Rated_Trait 개수가 0인 동안(서사 전용 시트), THE Sheet_Schema_Resolver SHALL 그 Active_Sheet_Schema의 Allocation_Mode를 `LADDER_SELECT`로 두어 능력치 배분 검증이 어떤 평가 항목에도 적용되지 않게 한다.

### Requirement 2: 사다리 선택 방식 검증 (기존 동작 보존)

**User Story:** 플레이어로서, 거위 시트처럼 각 능력치를 사다리 안에서 자유롭게 고르는 시트를 그대로 쓰고 싶다. 그래야 기존 시나리오 동작이 바뀌지 않는다.

#### Acceptance Criteria

1. WHILE Active_Sheet_Schema의 Allocation_Mode가 `LADDER_SELECT`인 동안, WHEN the Allocation_Validator가 한 Rated_Trait_Set을 판정하면, THE Allocation_Validator SHALL Active_Sheet_Schema가 정의한 모든 Rated_Trait이 그 Rated_Trait_Set에 각각 정확히 하나의 Trait_Level로 존재하고 그 Trait_Level이 모두 각자의 Trait_Ladder 안의 정수일 때에만, 그리고 오직 그 때에만 그 Rated_Trait_Set을 유효로 판정한다.
2. WHILE Active_Sheet_Schema의 Allocation_Mode가 `LADDER_SELECT`인 동안, THE Allocation_Validator SHALL 각 Rated_Trait의 유효성을 그 Rated_Trait의 Trait_Level이 자신의 Trait_Ladder 안의 정수인지로만 독립적으로 판정하고, 둘 이상의 Rated_Trait의 Trait_Level 사이의 관계에 대한 제약(총합 상한·하한, 다중집합·분포 제약 등)을 적용하지 않는다.
3. IF Active_Sheet_Schema의 Allocation_Mode가 `LADDER_SELECT`이고 Rated_Trait_Set 안의 어떤 Rated_Trait의 Trait_Level이 그 Rated_Trait의 Trait_Ladder 밖의 값이거나 정수가 아니면, THEN THE Allocation_Validator SHALL 그 Rated_Trait_Set을 `INVALID_ATTRIBUTES` 사유로 무효로 판정한다.
4. IF Active_Sheet_Schema의 Allocation_Mode가 `LADDER_SELECT`이고 Rated_Trait_Set이 Active_Sheet_Schema가 정의한 Rated_Trait 중 하나라도 Trait_Level을 제공하지 않거나, Active_Sheet_Schema에 정의되지 않은 Trait_Key에 Trait_Level을 부여하면, THEN THE Allocation_Validator SHALL 그 Rated_Trait_Set을 `INVALID_ATTRIBUTES` 사유로 무효로 판정한다.

### Requirement 3: 포인트 바이(총합 강제) 방식 검증

**User Story:** 플레이어로서, 모든 능력치를 기준값에서 시작해 정해진 점수만큼 나눠 올리고 싶다. 그래야 캐릭터들이 같은 예산으로 균형 있게 만들어진다.

#### Acceptance Criteria

1. WHEN the Sheet_Schema_Resolver가 Allocation_Mode가 `POINT_BUY`인 Active_Sheet_Schema를 해석하면, THE Sheet_Schema_Resolver SHALL 그 Allocation_Rule에 모든 Rated_Trait의 Trait_Ladder 안에 드는 하나의 정수 Base_Level과, 0 이상이며 모든 Rated_Trait에 대한 `(Trait_Ladder의 최대 정수 − Base_Level)`의 합 이하인 하나의 정수 Point_Pool을 포함시킨다.
2. WHILE Active_Sheet_Schema의 Allocation_Mode가 `POINT_BUY`인 동안, WHEN the Allocation_Validator가 한 Rated_Trait_Set을 판정하면, THE Allocation_Validator SHALL 모든 Rated_Trait의 Trait_Level이 Base_Level 이상이며 각자의 Trait_Ladder 안의 정수이고, 또한 모든 Rated_Trait에 대한 `(Trait_Level − Base_Level)`의 합이 Point_Pool과 정확히 같을 때에만 그 Rated_Trait_Set을 유효로 판정한다.
3. IF Active_Sheet_Schema의 Allocation_Mode가 `POINT_BUY`이고 모든 Rated_Trait의 Trait_Level이 각자 Base_Level 이상이며 자신의 Trait_Ladder 안의 정수이지만 모든 Rated_Trait에 대한 `(Trait_Level − Base_Level)`의 합이 Point_Pool보다 크거나 작으면, THEN THE Allocation_Validator SHALL 그 Rated_Trait_Set을 `INVALID_ALLOCATION` 사유로 무효로 판정한다.
4. IF Active_Sheet_Schema의 Allocation_Mode가 `POINT_BUY`이고 어떤 Rated_Trait의 Trait_Level이 Base_Level 미만이거나 그 Trait_Ladder 밖이거나 정수가 아니면, THEN THE Allocation_Validator SHALL 모든 Rated_Trait에 대한 `(Trait_Level − Base_Level)`의 합이 Point_Pool과 같은지와 무관하게 그 Rated_Trait_Set을 `INVALID_ATTRIBUTES` 사유로 무효로 판정한다.
5. WHILE Active_Sheet_Schema의 Allocation_Mode가 `POINT_BUY`인 동안, WHEN the Character_Sheet_App가 초기 작성 상태를 표시하면, THE Character_Sheet_App SHALL 모든 Rated_Trait의 Trait_Level을 Base_Level로 둔 Rated_Trait_Set을 Initial_Allocation으로 표시한다.
6. WHILE Active_Sheet_Schema의 Allocation_Mode가 `POINT_BUY`인 동안, WHEN 어떤 Rated_Trait의 Trait_Level이 표시되거나 변경되면, THE Character_Sheet_App SHALL 남은 배분 점수를 `Point_Pool − 모든 Rated_Trait에 대한 (Trait_Level − Base_Level)의 합`으로 계산하여 200밀리초 이내에 표시한다.

### Requirement 4: 고정값 배정 방식 검증

**User Story:** 플레이어로서, 정해진 숫자 묶음(예: 15, 13, 12)을 능력치마다 하나씩 배정하고 싶다. 그래야 표준 배열 방식의 캐릭터를 만들 수 있다.

#### Acceptance Criteria

1. WHEN the Sheet_Schema_Resolver가 Allocation_Mode가 `FIXED_VALUE`인 Active_Sheet_Schema를 해석하면, THE Sheet_Schema_Resolver SHALL 그 Allocation_Rule에, 모든 원소가 정수이고 원소 개수가 그 Active_Sheet_Schema의 Rated_Trait 개수와 정확히 같으며 원소 개수가 1 이상인 다중집합 Value_Pool을 포함시킨다.
2. WHILE Active_Sheet_Schema의 Allocation_Mode가 `FIXED_VALUE`인 동안, WHEN the Allocation_Validator가 한 Rated_Trait_Set을 판정하면, THE Allocation_Validator SHALL 모든 Rated_Trait의 Trait_Level을 모은 다중집합이 Value_Pool 다중집합과 원소와 개수 모두에서 정확히 일치하고, 각 Trait_Level이 그 Rated_Trait의 Trait_Ladder 안의 정수일 때에만 그 Rated_Trait_Set을 유효로 판정한다.
3. IF Active_Sheet_Schema의 Allocation_Mode가 `FIXED_VALUE`이고 모든 Rated_Trait의 Trait_Level을 모은 다중집합이 Value_Pool 다중집합과 원소 또는 개수에서 일치하지 않으면, THEN THE Allocation_Validator SHALL 그 Rated_Trait_Set을 `INVALID_ALLOCATION` 사유로 무효로 판정한다.
4. IF Active_Sheet_Schema의 Allocation_Mode가 `FIXED_VALUE`이고 어떤 Rated_Trait의 Trait_Level이 그 Rated_Trait의 Trait_Ladder 안의 정수가 아니면, THEN THE Allocation_Validator SHALL 그 Rated_Trait_Set을 `INVALID_ALLOCATION` 사유로 무효로 판정한다.
5. WHEN Active_Sheet_Schema의 Allocation_Mode가 `FIXED_VALUE`이면, THE Character_Sheet_App SHALL Value_Pool의 각 값 인스턴스를 정확히 하나의 Rated_Trait에 일대일로 배정하는 편집 요소를 제공하고, 한 값 인스턴스가 한 Rated_Trait에 배정되면 그 값 인스턴스를 다른 Rated_Trait에 다시 배정할 수 없도록 표시하며, 플레이어가 이미 배정된 값 인스턴스를 다른 Rated_Trait로 옮기면 200밀리초 이내에 직전 Rated_Trait를 미배정 상태로 되돌려 표시한다.
6. WHEN Active_Sheet_Schema의 Allocation_Mode가 `FIXED_VALUE`이면, THE Character_Sheet_App SHALL Value_Pool의 값들을 내림차순으로 정렬하고 Active_Sheet_Schema가 정의한 Rated_Trait 목록 순서대로 큰 값부터 차례로 하나씩 일대일 배정한 Rated_Trait_Set을 Initial_Allocation으로 표시한다.

### Requirement 5: 랜덤(주사위) 방식 검증과 서버 측 굴림

**User Story:** 플레이어로서, 능력치를 주사위로 굴려 정하고 싶고, 시나리오가 요구하면 그 결과를 바꾸지 못하게 하고 싶다. 그래야 운에 맡기는 규칙을 그대로 즐길 수 있다.

#### Acceptance Criteria

1. WHEN the Sheet_Schema_Resolver가 Allocation_Mode가 `DICE_ROLL`인 Active_Sheet_Schema를 해석하면, THE Sheet_Schema_Resolver SHALL 그 Allocation_Rule에 하나의 Dice_Formula와 하나의 Forced_Random 불리언을 포함시키며, Active_Sheet_Schema가 Forced_Random 값을 제공하지 않으면 Forced_Random을 거짓으로 취급한다.
2. WHEN the Player가 `DICE_ROLL` 시트에서 Dice_Roll_Action을 수행하면, THE Character_Sheet_App SHALL Room_Id(그리고 존재하면 Access_Token)를 포함하여 Allocation_Roll_Endpoint에 굴림을 요청하고, 무작위 값을 클라이언트에서 생성하지 않는다.
3. WHEN the Allocation_Roll_Endpoint가 각 Rated_Trait에 대해 Dice_Formula로 굴린 결과를 반환하면, THE Allocation_Roll_Endpoint SHALL 각 결과 값이 그 Rated_Trait의 Trait_Ladder의 최소 정수보다 작으면 그 최소 정수로, 최대 정수보다 크면 그 최대 정수로, 그 사이의 정수이면 그대로 한정(clamp)한 정수를 그 Rated_Trait의 Trait_Level로 돌려준다.
4. WHILE Active_Sheet_Schema의 Allocation_Mode가 `DICE_ROLL`인 동안, WHEN the Allocation_Validator가 한 Rated_Trait_Set을 판정하면, THE Allocation_Validator SHALL 모든 Rated_Trait의 Trait_Level이 각자의 Trait_Ladder 안의 정수일 때에만 그 Rated_Trait_Set을 유효로 판정한다.
5. WHERE Active_Sheet_Schema의 Allocation_Mode가 `DICE_ROLL`이고 Forced_Random이 참인 경우, THE Character_Sheet_App SHALL 모든 Rated_Trait의 평가 편집 요소를 읽기 전용으로 표시하여 플레이어가 굴림 결과를 수정할 수 없게 한다.
6. WHERE Active_Sheet_Schema의 Allocation_Mode가 `DICE_ROLL`이고 Forced_Random이 거짓인 경우, THE Character_Sheet_App SHALL 굴림 이후 플레이어가 각 Rated_Trait의 Trait_Level을 그 Trait_Ladder 안의 정수로 편집할 수 있게 한다.
7. IF the Player가 수행한 Dice_Roll_Action의 Allocation_Roll_Endpoint 요청이 전송 후 10초(10000밀리초) 이내에 응답하지 않거나 네트워크 오류 또는 서버 오류로 종료되면, THEN THE Character_Sheet_App SHALL 굴림에 실패했다는 한국어 오류 메시지를 표시하고 모든 Rated_Trait의 기존 Trait_Level을 변경 없이 유지하며 무작위 값을 클라이언트에서 생성하지 않는다.
8. IF the Allocation_Roll_Endpoint가 성공 응답을 반환했으나 그 응답에 Active_Sheet_Schema가 정의한 Rated_Trait 중 하나라도 Trait_Level이 없거나 어떤 Trait_Level이 정수가 아니면, THEN THE Character_Sheet_App SHALL 그 응답을 적용하지 않고 굴림 결과를 받지 못했다는 한국어 오류 메시지를 표시하며 모든 Rated_Trait의 기존 Trait_Level을 변경 없이 유지한다.
9. WHERE Active_Sheet_Schema의 Allocation_Mode가 `DICE_ROLL`이고 Forced_Random이 거짓인 경우, IF 어떤 Rated_Trait의 평가 편집 요소로 그 Rated_Trait의 Trait_Ladder 밖의 값 또는 정수가 아닌 값이 지정되면, THEN THE Character_Sheet_App SHALL 그 값을 적용하지 않고 해당 Rated_Trait의 직전 Trait_Level을 변경 없이 유지한다.

### Requirement 6: 프론트엔드·백엔드 검증 패리티

**User Story:** 운영자로서, 프론트엔드에서 통과한 배분이 백엔드에서 거부되거나 그 반대가 되는 일이 없길 바란다. 그래야 플레이어가 일관된 규칙을 경험한다.

#### Acceptance Criteria

1. WHEN 네 가지 Allocation_Mode(`LADDER_SELECT`·`POINT_BUY`·`FIXED_VALUE`·`DICE_ROLL`) 중 어느 하나의 동일한 Allocation_Rule과 동일한 Rated_Trait_Set이 주어지면, THE Frontend_Allocation_Validator와 THE Backend_Allocation_Validator SHALL 동일한 유효/무효 판정을 내린다.
2. WHEN 동일한 Allocation_Rule과 동일한 Rated_Trait_Set에 대해 the Frontend_Allocation_Validator와 the Backend_Allocation_Validator가 모두 유효로 판정하면, THE Frontend_Allocation_Validator와 THE Backend_Allocation_Validator SHALL 어떤 거부 사유도 산출하지 않는다.
3. WHEN 동일한 Allocation_Rule과 동일한 Rated_Trait_Set이 무효로 판정되면, THE Frontend_Allocation_Validator와 THE Backend_Allocation_Validator SHALL 동일한 거부 사유 분류(`INVALID_ATTRIBUTES` 또는 `INVALID_ALLOCATION`)를 산출한다.
4. WHEN 동일한 Allocation_Rule과 동일한 Rated_Trait_Set으로 the Allocation_Validator를 임의의 횟수(2회 이상) 판정하면, THE Allocation_Validator SHALL 판정 순서나 직전 판정 상태와 무관하게 매번 동일한 판정과 동일한 거부 사유 분류를 산출한다.
5. WHEN the Frontend_Allocation_Validator와 the Backend_Allocation_Validator가 네 가지 Allocation_Mode 중 어느 하나의 Allocation_Rule의 Initial_Allocation을 판정하면, THE Frontend_Allocation_Validator와 THE Backend_Allocation_Validator SHALL 그 Initial_Allocation을 유효로 판정하고 어떤 거부 사유도 산출하지 않는다.

### Requirement 7: 프론트엔드 스키마 검증과 폴백

**User Story:** 플레이어로서, 시나리오 시트에 실린 배분 규칙이 깨져 있어도 화면이 멈추지 않고 작성을 이어갈 수 있길 바란다.

#### Acceptance Criteria

1. WHEN the Character_Sheet_App가 시트 스키마 응답을 검증하면, THE Character_Sheet_App SHALL 그 응답에 실린 Allocation_Rule의 Allocation_Mode가 `LADDER_SELECT`·`POINT_BUY`·`FIXED_VALUE`·`DICE_ROLL` 중 하나이고, 그 모드에 필요한 매개변수(POINT_BUY는 정수 Base_Level과 0 이상의 정수 Point_Pool, FIXED_VALUE는 모든 원소가 정수이며 원소 개수가 Rated_Trait 개수와 정확히 같은 Value_Pool, DICE_ROLL은 공백을 제거하면 1자 이상인 Dice_Formula와 불리언 Forced_Random)를 모두 갖출 때에만 그 Allocation_Rule을 유효로 인정한다.
2. IF 시트 스키마 응답이 성공이지만 그 Allocation_Rule이 criterion 1에 정의된 유효 조건을 충족하지 못하면(Allocation_Rule 누락, Allocation_Mode가 네 종류 중 하나가 아님, 또는 해당 모드의 필수 매개변수 미비), THEN THE Character_Sheet_App SHALL 그 스키마를 채택하지 않고 Default_Sheet_Schema(Allocation_Mode `LADDER_SELECT`)를 Active_Sheet_Schema로 사용한다.
3. THE Character_Sheet_App SHALL Default_Sheet_Schema의 Allocation_Mode를 `LADDER_SELECT`로 두어 폴백 시 기존 사다리 선택 동작을 유지한다.
4. WHEN the Character_Sheet_App가 Default_Sheet_Schema로 폴백하면, THE Character_Sheet_App SHALL 기본 시트로 작성을 이어간다는 한국어 안내를 표시하고 플레이어가 캐릭터 작성을 계속할 수 있게 한다.

### Requirement 8: 백엔드 기록·확정 시 배분 검증

**User Story:** 개발자로서, 캐릭터를 기록할 때 서버가 시나리오의 배분 규칙을 강제하길 바란다. 그래야 변조된 능력치가 저장되지 않는다.

#### Acceptance Criteria

1. WHEN `recordCharacter`가 한 Allocation_Rule과 함께 호출되면, THE Character_Service SHALL 입력된 Rated_Trait_Set을 the Backend_Allocation_Validator로 판정하되, 먼저 모든 Rated_Trait의 Trait_Level이 각자의 Trait_Ladder 안의 정수인지(사다리 경계)를 검사하고, 그 검사를 통과한 경우에만 배분 제약(총합 또는 고정값 다중집합)을 검사한다.
2. IF the Backend_Allocation_Validator가 입력된 Rated_Trait_Set을 사다리 경계 위반으로 판정하면, THEN THE Character_Service SHALL 배분 제약 충족 여부와 무관하게 `recordCharacter`를 `INVALID_ATTRIBUTES` 사유로 거부하고 어떤 캐릭터 데이터도 기록·갱신하지 않는다.
3. IF the Backend_Allocation_Validator가 입력된 Rated_Trait_Set의 사다리 경계는 충족하지만 배분 제약(모든 Trait_Level의 `(Trait_Level − Base_Level)` 합이 Point_Pool과 정확히 같지 않거나, Trait_Level들의 다중집합이 Value_Pool 다중집합과 정확히 같지 않음)을 위반한다고 판정하면, THEN THE Character_Service SHALL `recordCharacter`를 `INVALID_ALLOCATION` 사유로 거부하고 어떤 캐릭터 데이터도 기록·갱신하지 않는다.
4. WHEN `recordCharacter`가 한 Allocation_Rule과 함께 호출되고 입력된 Rated_Trait_Set이 사다리 경계와 배분 제약을 모두 충족하면, THE Character_Service SHALL 확정 전 캐릭터를 그 Rated_Trait_Set으로 기록·갱신한다.
5. WHEN `recordCharacter`가 Allocation_Rule 없이(기존 호출 형태) 호출되면, THE Character_Service SHALL 기존 동작(`traitKeys`·`ladder` 기반 사다리 경계 검증, 또는 옵션 생략 시 기본 EZFudge 네 키 검증)을 변경 없이 수행한다.
6. WHEN `recordCharacter`가 빈 `traitKeys` 또는 Rated_Trait가 0개인 Active_Sheet_Schema에 대해 호출되면, THE Character_Service SHALL 능력치 배분 검증을 적용하지 않는다(서사 전용 시트 보존).
7. IF the Character_Sheet_App가 `INVALID_ALLOCATION` 사유의 거부 응답을 받으면, THEN THE Character_Sheet_App SHALL 능력치 배분 규칙(총합 또는 고정값 배정)을 충족하지 못했다는 한국어 오류 메시지를 표시하고 플레이어가 입력한 Rated_Trait_Set과 서사 항목 값을 변경 없이 보존한다.

### Requirement 9: 잘못된 배분 입력의 거부 (오류 조건)

**User Story:** 플레이어로서, 규칙을 어긴 능력치 배분은 명확히 거부되길 바란다. 그래야 실수로 잘못된 캐릭터를 확정하지 않는다.

#### Acceptance Criteria

1. IF Allocation_Mode가 `POINT_BUY`이고 올린 점수의 총합이 Point_Pool을 초과하는 Rated_Trait_Set으로 Save_Action 또는 Confirm_Action이 수행되면, THEN THE Character_Sheet_App SHALL the Allocation_Validator가 그 Rated_Trait_Set을 무효로 판정한 결과에 따라 배분 점수 총합이 Point_Pool을 초과했음을 식별하는 한국어 오류 메시지를 표시하고, 플레이어가 입력한 Narrative_Field 값(이름·컨셉 포함)과 Rated_Trait_Set을 변경 없이 보존하며, 캐릭터를 Confirmed_State로 전이시키지 않는다.
2. IF Allocation_Mode가 `FIXED_VALUE`이고 어떤 값이 두 Rated_Trait에 중복 배정되었거나 Value_Pool의 어떤 값이 배정되지 않은 Rated_Trait_Set으로 Save_Action 또는 Confirm_Action이 수행되면, THEN THE Character_Sheet_App SHALL the Allocation_Validator가 그 Rated_Trait_Set을 무효로 판정한 결과에 따라 Value_Pool의 각 값이 Rated_Trait에 일대일로 배정되지 않았음을 식별하는 한국어 오류 메시지를 표시하고, 플레이어가 입력한 Narrative_Field 값(이름·컨셉 포함)과 Rated_Trait_Set을 변경 없이 보존하며, 캐릭터를 Confirmed_State로 전이시키지 않는다.
3. IF 어떤 Allocation_Mode에서든 어떤 Rated_Trait의 Trait_Level이 그 Trait_Ladder 밖이거나 정수가 아닌 Rated_Trait_Set으로 검증이 수행되면, THEN THE Allocation_Validator SHALL 그 Rated_Trait_Set을 `INVALID_ATTRIBUTES` 사유로 무효로 판정한다.
4. IF the Allocation_Validator가 어떤 Rated_Trait_Set을 `INVALID_ATTRIBUTES` 사유로 무효로 판정한 결과로 Save_Action 또는 Confirm_Action이 거부되면, THEN THE Character_Sheet_App SHALL 평가 항목이 해당 Trait_Ladder 범위를 벗어났음을 식별하는 한국어 오류 메시지를 표시하고, 플레이어가 입력한 Narrative_Field 값(이름·컨셉 포함)과 Rated_Trait_Set을 변경 없이 보존하며, 캐릭터를 Confirmed_State로 전이시키지 않는다.

### Requirement 10: 확정된 캐릭터의 배분 잠금 보존

**User Story:** 플레이어로서, 캐릭터를 확정한 뒤에는 어떤 배분 방식이든 능력치가 바뀌지 않길 바란다. 그래야 세션에 들어갈 준비가 확실해진다.

#### Acceptance Criteria

1. WHILE 캐릭터가 Confirmed_State인 동안, THE Character_Sheet_App SHALL Active_Sheet_Schema의 Allocation_Mode와 무관하게 모든 Rated_Trait의 평가 편집 요소와 Dice_Roll_Action을 읽기 전용(비활성) 상태로 표시하고, 각 Rated_Trait의 표시된 Trait_Level을 확정 시점의 값에서 변경하지 않고 그대로 유지한다.
2. WHILE 캐릭터가 Confirmed_State인 동안, IF 어떤 Rated_Trait의 평가 편집 요소 또는 Dice_Roll_Action에 대한 조작 시도가 발생하면, THEN THE Character_Sheet_App SHALL Active_Sheet_Schema의 Allocation_Mode와 무관하게 모든 Rated_Trait의 Trait_Level을 변경하지 않고 그대로 유지한다.
3. IF 확정된 캐릭터(Confirmed_State)에 대해 `recordCharacter`가 호출되면, THEN THE Character_Service SHALL Active_Sheet_Schema의 Allocation_Mode와 무관하게 그 호출을 `ALREADY_CONFIRMED` 사유로 거부하고, 확정된 캐릭터의 Rated_Trait_Set을 변경 없이 그대로 보존한다.
