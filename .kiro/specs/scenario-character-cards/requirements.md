# Requirements Document

## Introduction

ready-gm은 친구들과 함께 즐기는 멀티플레이 TRPG 세션을 AI GM이 진행해 주는 웹 플랫폼입니다. 본 스펙은 **시나리오 작성 방식(authoring style)** 의 두 가지 횡단 관심사에 집중합니다.

첫째, **능력치 없는 시나리오에서 능력치 관련 UI를 감춥니다.** 현재 캐릭터 시트 작성 화면(Character_Sheet_App)은 시나리오에 평가 항목(Rated_Trait)이 하나도 없어도 "AI 제안"(능력치 제안) 동작과 능력치 설정 영역을 항상 표시합니다. 예를 들어 "가라앉을 때까지"(until-it-sinks)는 평가 항목이 없는 서사 전용·GM리스 미스터리인데도 AI 제안 버튼이 보이고, 누르면 백엔드가 `PROPOSAL_INVALID`로 거부합니다. 본 스펙은 평가 항목이 없거나 시나리오가 제안을 명시적으로 끄면, AI 제안 동작과 능력치 설정 영역을 **아예 표시하지 않도록** 만듭니다.

둘째, **캐릭터 카드(Character Card) 기반의 새로운 시트 작성 방식을 도입합니다.** 일부 시나리오는 미리 정의된 역할 카드 한 벌(예: until-it-sinks의 지배인·작가·지질학자)을 함께 싣습니다. 플레이어는 그 카드 중 **정확히 하나를 고르고**(고정된 역할/정체성), 그 위에 자신만의 배경·서사를 직접 적습니다. 본 스펙은 이 카드 기반 작성을 시트/시나리오 작성 방식의 하나로 다루며, 카드 선택을 기록하고 검증합니다.

핵심 설계 원칙은 기존 character-sheet·flexible-stat-allocation 스펙과 동일한 **단일 시트 스키마(Active_Sheet_Schema) 확장**입니다. 시트 스키마에 (1) 능력치 제안 지원 여부를 나타내는 플래그와 (2) 선택 가능한 캐릭터 카드 목록을 실어 보내고, 화면은 그 스키마에 따라 능력치 영역·제안 동작·카드 선택 영역을 렌더링합니다. 새 작성 방식을 더할 때 시트 렌더·기록·확정의 골격을 바꾸지 않고 스키마 한 곳만 확장하도록 설계합니다.

본 스펙은 기존 동작을 **보존**합니다. EZFudge 범용 시트(UNIVERSAL_SHEET)와 "끔찍한 거위들"(terrible-geese) 시트는 능력치 제안 동작과 능력치 설정 영역을 지금과 동일하게 계속 표시합니다. "가라앉을 때까지"(until-it-sinks)는 능력치 영역·제안 동작이 사라진 카드 기반 서사 시트로 전환됩니다.

### 백엔드/프론트엔드 계약 근거 (실제 코드 확인)

본 스펙은 다음 실제 코드를 근거로 합니다.

- **시나리오 서비스**(`src/services/scenario-service.ts`): `Scenario`는 `{ id, title, summary, openingSeed, endingCondition, genre, category, hasSpecialRules, system, allocation? }` 형태다. `UNTIL_IT_SINKS`는 `hasSpecialRules: true`, `system: "카드 기반(GM리스)"`인 GM리스 협동 미스터리이며, 그 도입부와 종료 조건은 "역할을 맡은 인물들이 매일 저녁 대화로 사건을 풀어 가는" 카드 중심 진행을 묘사한다. 현재 `Scenario`에는 캐릭터 카드 목록을 담는 필드가 없다.
- **시트 스키마 해석기**(`src/services/sheet-schema.ts`): `sheetSchemaForScenario(scenario)`가 시나리오에 따라 `SheetSchema`를 돌려준다. `UNIVERSAL_SHEET`·`GEESE_SHEET`는 평가 항목이 있고, `SINKS_SHEET`는 `traits: []`(서사 전용)이며 이름·역할/컨셉·태도·목표 같은 `narrativeFields`만 가진다. `SINKS_SHEET`의 `concept` 안내는 "지배인·작가·지질학자 등 섬에서 맡은 역할 하나를 고르라"고 안내한다. 현재 `SheetSchema`에는 능력치 제안 지원 여부 플래그도, 선택 가능한 카드 목록 필드도 없다. `expectedTraitSpecForScenario(scenario)`는 `traits`가 0개이면 `{ keys: [], ... }`를 돌려주어 "능력치 검증 없음"을 뜻한다.
- **프론트엔드 순수 로직**(`public/character/logic.js`): `validateSchema(body)`는 스키마 응답을 검증·정규화하며 빈 `traits` 배열(서사 전용 시트)을 허용한다. `renderModel(schema, values)`는 스키마가 정의한 Sheet_Section만, 그 안의 Narrative_Field·Rated_Trait를 정의 순서대로 렌더한다. `computeVisibility(state)`는 `proposeEnabled` 등 동작 활성 여부를 도출하지만, 현재는 평가 항목이 0개여도 Propose_Action을 활성/표시한다. `PROPOSAL_INVALID_MESSAGE` 등 한국어 메시지와 인계·토큰·요청 빌더가 이미 존재한다.
- **프론트엔드 화면**(`public/character/index.html`): `#proposeBtn`("AI 제안 받기") 버튼과 능력치 설정·진행 인디케이터 요소를 렌더하고, `computeVisibility` 결과로 버튼 활성/비활성을 배선한다. 현재는 평가 항목이 없어도 제안 버튼·능력치 영역이 DOM에 보인다.
- **캐릭터 서비스**(`src/services/character-service.ts`): `recordCharacter(playerId, { name, concept, attributes }, options?)`는 확정 전 캐릭터를 기록/갱신하고, 거부 사유로 `NAME_TAKEN`·`INVALID_ATTRIBUTES`·`ALREADY_CONFIRMED`·`UNKNOWN_PLAYER`를 돌려준다. `confirmCharacter`는 확정(잠금)하며 확정 후 기록은 `ALREADY_CONFIRMED`로 거부된다. 현재 캐릭터 카드 선택을 받거나 검증하는 경로는 없다.
- **AI 제안**(character-sheet 스펙): 의도된 Attribute_Proposal_Endpoint는 Active_Sheet_Schema가 정의한 각 Rated_Trait에 대한 제안 값을 돌려준다. 평가 항목이 0개인 시트에 대해서는 제안할 대상이 없다.

> 본 스펙은 기존 character-sheet·flexible-stat-allocation 스펙과 동일하게, **현재 플레이테스트 서버에 아직 배선되지 않은 백엔드 항목**을 아래 "범위 밖 / 가정"에 명시한다. 프론트엔드 순수 로직과 백엔드 서비스 로직은 각각 vitest + fast-check로 모킹 없이 명세·검증할 수 있다.

## 범위 밖 / 가정 (Assumptions)

- **능력치 제안 지원 플래그는 의도된 계약이다**: 현재 `SheetSchema`에는 능력치 제안 지원 여부를 표현하는 필드가 없다. 본 스펙은 `SheetSchema`에 정확히 하나의 Attribute_Proposal_Supported 불리언을 싣는 의도된 확장 위에서 동작을 정의한다. 시나리오가 값을 지정하지 않으면 평가 항목 개수에서 도출한다(0개면 거짓).
- **캐릭터 카드 목록을 담는 스키마 필드는 의도된 계약이다**: 현재 `SheetSchema`·`Scenario`에는 카드 목록 필드가 없다. flexible-stat-allocation이 Allocation_Rule을 의도된 확장으로 둔 것과 동일하게, 본 스펙은 `SheetSchema`에 선택 가능한 Character_Card_List를 싣는 의도된 확장 위에서 동작을 정의한다. 카드 목록이 비어 있거나 없으면 그 시트는 카드 기반이 아니다(기존 시트 보존).
- **카드 선택의 기록·검증은 의도된 확장이다**: 본 스펙은 `recordCharacter`(또는 의도된 Record_Character_Endpoint)가 선택된 Card_Id를 함께 받아 기록하고 검증하는 의도된 확장 위에서 백엔드 동작을 정의한다. 기존 `recordCharacter` 호출 형태와 거부 사유(`NAME_TAKEN`·`INVALID_ATTRIBUTES`·`ALREADY_CONFIRMED`·`UNKNOWN_PLAYER`)는 보존된다.
- **실제 REST/실시간 배선은 후속 작업**: 시트 스키마·기록·확정·제안 엔드포인트의 실제 HTTP 배선은 character-sheet 스펙과 동일하게 의도된 계약으로 두고, 본 스펙은 그 계약 위에서 순수 로직과 서비스 로직을 명세한다.
- **기존 시트 동작 보존**: UNIVERSAL_SHEET·GEESE_SHEET의 능력치 제안 동작·능력치 설정 영역 표시와, 모든 시트의 능력치 배분(flexible-stat-allocation) 동작은 변경하지 않는다.
- **상류·하류 화면은 범위 밖**: 본 화면으로의 진입 흐름과 확정 후 다음 화면의 내부 동작은 character-sheet 스펙과 동일하게 범위 밖이다.

## Glossary

- **Character_Sheet_App**: 캐릭터 시트 작성을 담당하는 프론트엔드 애플리케이션(`public/character/`). 본 스펙이 동작을 정의하는 시스템.
- **Sheet_Schema_Resolver**: 시나리오를 받아 Active_Sheet_Schema를 돌려주는 백엔드 구성요소(`sheetSchemaForScenario`). 본 스펙에서 시트 스키마에 능력치 제안 지원 플래그와 카드 목록을 싣는다.
- **Character_Service**: 캐릭터 기록/확정 백엔드 서비스(`src/services/character-service.ts`).
- **Active_Sheet_Schema**: 현재 Character_Sheet_App이 렌더·검증·전송에 사용 중인 시트 스키마. 유효한 시나리오 스키마를 채택했으면 그것이고, 아니면 Default_Sheet_Schema다. 항상 정확히 하나가 존재한다.
- **Default_Sheet_Schema**: 시나리오가 스키마를 제공하지 않거나 스키마 검증이 실패했을 때 쓰는 기본 스키마. EZFudge 네 평가 항목(Might·Agility·Wits·Spirit, 사다리 `[-2, +4]`)과 이름·컨셉 Narrative_Field를 가지며, 카드 기반이 아니고 능력치 제안을 지원한다.
- **Sheet_Section**: Active_Sheet_Schema가 정의하는 시트의 한 구획. 화면은 스키마가 정의한 Sheet_Section만 렌더한다.
- **Narrative_Field**: Active_Sheet_Schema가 정의하는 자유 텍스트 서사 항목(이름·컨셉·배경 등). 이름(Character_Name)과 컨셉은 모든 스키마가 갖는 기본 Narrative_Field다.
- **Rated_Trait**: Active_Sheet_Schema가 정의하는 평가 항목. Trait_Key·표시 레이블·Trait_Ladder를 가지며 하나의 정수 Trait_Level을 갖는다.
- **Rated_Trait_Count**: Active_Sheet_Schema가 정의한 Rated_Trait의 개수(0 이상의 정수). 0이면 서사 전용 시트다.
- **Stat_Setting_Section**: Active_Sheet_Schema가 정의한 Rated_Trait들의 평가 편집 요소를 담아 화면에 표시되는 능력치 설정 영역.
- **Attribute_Proposal_Supported**: Active_Sheet_Schema에 실리는 불리언 플래그. 그 시트에서 AI 능력치 제안 동작을 제공할지를 나타낸다.
- **Attribute_Proposal_Disabled**: 한 Scenario(또는 시트 정의)가 능력치 제안을 명시적으로 끄도록 지정하는 불리언 입력. 참이면 평가 항목이 있어도 Attribute_Proposal_Supported가 거짓이 된다.
- **Propose_Action**: 플레이어가 AI 능력치 제안을 요청하는 사용자 동작 요소(화면의 "AI 제안" 버튼, `#proposeBtn`).
- **Attribute_Proposal_Endpoint**: (의도된) Character_Concept과 시나리오를 받아 각 Rated_Trait에 대한 제안 값을 돌려주는 백엔드 엔드포인트.
- **Character_Card**: 한 Card_Based_Sheet가 싣는, 선택 가능한 미리 정의된 역할 카드. 식별자(Card_Id), 역할 레이블(Card_Role_Label), 전제/설명(Card_Premise)을 가지며, 선택적으로 배경 작성 안내(Card_Backstory_Guidance)를 가진다.
- **Card_Id**: 한 Character_Card의 식별자. 한 Character_Card_List 안에서 고유하다.
- **Card_Role_Label**: 한 Character_Card가 부여하는 역할/정체성의 표시 이름(예: "지배인", "작가", "지질학자").
- **Card_Premise**: 한 Character_Card의 역할 전제·설명 텍스트.
- **Card_Backstory_Guidance**: 한 Character_Card가 플레이어의 배경 서사 작성을 돕기 위해 제공하는 선택적 안내 텍스트.
- **Character_Card_List**: 한 Active_Sheet_Schema가 싣는, 선택 가능한 Character_Card들의 순서 있는 목록.
- **Card_Based_Sheet**: 비어 있지 않은 Character_Card_List를 싣는 Active_Sheet_Schema. 플레이어가 카드 하나를 골라 작성하는 시트다.
- **Selected_Card**: 플레이어가 Card_Based_Sheet에서 현재 선택한 정확히 하나의 Character_Card.
- **Card_Selection_Action**: 플레이어가 Character_Card_List에서 하나의 Character_Card를 고르는 사용자 동작 요소.
- **Backstory_Field**: Card_Based_Sheet에서 플레이어가 선택한 역할 위에 자신의 배경·서사를 직접 적는 Narrative_Field.
- **Save_Action**: 플레이어가 현재 시트를 확정 전 캐릭터로 기록하는 사용자 동작 요소.
- **Confirm_Action**: 플레이어가 기록한 캐릭터를 확정(잠금)하는 사용자 동작 요소.
- **Confirmed_State**: 캐릭터가 확정되어 더 이상 수정할 수 없는 상태(`confirmed === true`).
- **Record_Character_Endpoint**: (의도된) `CharacterService.recordCharacter`를 노출하는 백엔드 엔드포인트. 본 스펙에서 Card_Based_Sheet의 경우 선택된 Card_Id를 함께 받는다.
- **INVALID_CARD**: Card_Based_Sheet에서 기록된 카드 선택이 없거나, 선택된 Card_Id가 그 시트의 Character_Card_List에 속하지 않을 때의 거부 사유.
- **Frontend_Card_Validator**: `public/character/logic.js`에 추가되는, Card_Based_Sheet의 카드 선택 유효성을 판정하는 순수 함수.
- **Backend_Card_Validator**: `CharacterService.recordCharacter`가 수행하는 카드 선택 검증. Frontend_Card_Validator와 동일한 판정을 내려야 한다(검증 패리티).
- **Request_Timeout**: REST 요청에 적용되는 클라이언트 타임아웃. 10초(10000밀리초).

## Requirements

### Requirement 1: 시트 스키마에 능력치 제안 지원 플래그 부착

**User Story:** 시나리오 작성자로서, 능력치가 없는 시나리오에서는 AI 능력치 제안이 의미가 없으니, 그 시트가 제안을 지원하는지를 시트 스키마에 하나로 실어 보내고 싶다. 그래야 화면이 불필요한 제안 동작을 감출 수 있다.

#### Acceptance Criteria

1. WHEN the Sheet_Schema_Resolver가 한 Scenario에 대한 Active_Sheet_Schema를 해석하면, THE Sheet_Schema_Resolver SHALL 그 Active_Sheet_Schema에 정확히 하나의 Attribute_Proposal_Supported 불리언을 포함시킨다.
2. IF Active_Sheet_Schema의 Rated_Trait_Count가 0이면, THEN THE Sheet_Schema_Resolver SHALL 그 Active_Sheet_Schema의 Attribute_Proposal_Supported를 거짓으로 설정한다.
3. IF 한 Scenario의 Attribute_Proposal_Disabled가 참이면, THEN THE Sheet_Schema_Resolver SHALL Rated_Trait_Count가 1 이상이어도 그 Active_Sheet_Schema의 Attribute_Proposal_Supported를 거짓으로 설정한다.
4. WHERE Active_Sheet_Schema의 Rated_Trait_Count가 1 이상이고 그 Scenario의 Attribute_Proposal_Disabled가 참이 아닌 경우, THE Sheet_Schema_Resolver SHALL 그 Active_Sheet_Schema의 Attribute_Proposal_Supported를 참으로 설정한다.
5. THE Sheet_Schema_Resolver SHALL `UNIVERSAL_SHEET`와 `terrible-geese` Scenario에서 해석된 Active_Sheet_Schema의 Attribute_Proposal_Supported를 참으로 두어 기존 능력치 제안 동작을 보존한다.
6. THE Sheet_Schema_Resolver SHALL `until-it-sinks` Scenario에서 해석된 Active_Sheet_Schema의 Attribute_Proposal_Supported를 거짓으로 둔다.

### Requirement 2: 능력치 제안 동작과 능력치 설정 영역 표시 제어

**User Story:** 플레이어로서, 능력치가 없는 시나리오에서는 AI 제안 버튼이나 능력치 설정 화면이 아예 보이지 않길 바란다. 그래야 의미 없는 동작으로 혼란스럽지 않다.

#### Acceptance Criteria

1. WHILE Active_Sheet_Schema의 Attribute_Proposal_Supported가 거짓인 동안, THE Character_Sheet_App SHALL Propose_Action 요소를 화면에 표시하지 않는다.
2. WHILE Active_Sheet_Schema의 Attribute_Proposal_Supported가 거짓인 동안, THE Character_Sheet_App SHALL Attribute_Proposal_Endpoint로 어떤 제안 요청도 전송하지 않는다.
3. WHILE Active_Sheet_Schema의 Rated_Trait_Count가 0인 동안, THE Character_Sheet_App SHALL Stat_Setting_Section과 모든 Rated_Trait 평가 편집 요소를 화면에 표시하지 않는다.
4. WHEN the Character_Sheet_App가 한 Sheet_Section에 소속된 Narrative_Field와 Rated_Trait가 모두 0개인 Sheet_Section을 렌더하면, THE Character_Sheet_App SHALL 그 Sheet_Section을 화면에 표시하지 않는다.
5. WHILE Active_Sheet_Schema의 Attribute_Proposal_Supported가 참인 동안, THE Character_Sheet_App SHALL Propose_Action 요소를 표시하고 기존 활성/비활성 규칙(인계 유효·비확정·진행 중 아님)에 따라 동작 가능하게 둔다.
6. WHILE Active_Sheet_Schema의 Rated_Trait_Count가 1 이상인 동안, THE Character_Sheet_App SHALL Stat_Setting_Section과 각 Rated_Trait의 평가 편집 요소를 표시하여 기존 능력치 설정 동작을 보존한다.

### Requirement 3: 시트 스키마에 캐릭터 카드 목록 부착

**User Story:** 시나리오 작성자로서, 미리 정의한 역할 카드 한 벌을 시나리오에 실어 보내고 싶다. 그래야 플레이어가 그중 하나를 골라 그 역할로 이야기를 시작할 수 있다.

#### Acceptance Criteria

1. WHERE 한 Scenario가 카드 기반 작성을 지정하는 경우, THE Sheet_Schema_Resolver SHALL 그 Active_Sheet_Schema에 원소가 1개 이상인 Character_Card_List를 포함시키고, 그 Character_Card_List의 각 Character_Card가 공백을 제거하면 1자 이상인 Card_Id, 공백을 제거하면 1자 이상인 Card_Role_Label, 그리고 Card_Premise를 갖도록 한다.
2. THE Sheet_Schema_Resolver SHALL 한 Active_Sheet_Schema의 Character_Card_List 안에서 모든 Card_Id가 서로 다르도록(고유하도록) 보장한다.
3. THE Sheet_Schema_Resolver SHALL `until-it-sinks` Scenario를 Character_Card_List에 "지배인"·"작가"·"지질학자" Card_Role_Label을 가진 Character_Card를 포함하는 Card_Based_Sheet로 해석한다.
4. WHERE 한 Scenario가 카드 기반 작성을 지정하지 않는 경우, THE Sheet_Schema_Resolver SHALL 그 Active_Sheet_Schema의 Character_Card_List를 비어 있게(또는 없게) 두어 그 시트가 Card_Based_Sheet가 아니게 한다.
5. THE Sheet_Schema_Resolver SHALL `UNIVERSAL_SHEET`와 `terrible-geese` Scenario에서 해석된 Active_Sheet_Schema를 Card_Based_Sheet가 아닌 시트로 두어 기존 시트 동작을 보존한다.

### Requirement 4: 카드 기반 시트의 표시와 선택

**User Story:** 플레이어로서, 시나리오가 제공한 역할 카드들을 보고 그중 하나를 골라 내 인물의 출발점으로 삼고 싶다. 그래야 정해진 역할 위에 내 이야기를 덧붙일 수 있다.

#### Acceptance Criteria

1. WHEN the Character_Sheet_App가 Card_Based_Sheet의 초기 작성 상태를 표시하면, THE Character_Sheet_App SHALL Character_Card_List의 각 Character_Card를 그 Card_Role_Label과 Card_Premise와 함께 표시하고, 어떤 Character_Card도 미리 선택하지 않은 상태로 표시한다.
2. WHEN the Character_Sheet_App가 Card_Based_Sheet의 초기 작성 상태를 표시하면, THE Character_Sheet_App SHALL 플레이어가 배경 서사를 적을 수 있도록 Active_Sheet_Schema가 정의한 각 Backstory_Field 입력 요소를 함께 표시한다.
3. WHEN the Player가 Card_Based_Sheet에서 Card_Selection_Action으로 한 Character_Card를 선택하면, THE Character_Sheet_App SHALL 그 Character_Card를 유일한 Selected_Card로 두고, 직전에 선택돼 있던 Character_Card가 있으면 그 선택을 200밀리초 이내에 해제하여, 항상 최대 하나의 Selected_Card만 존재하게 한다.
4. WHILE 한 Card_Based_Sheet에서 정확히 하나의 Selected_Card가 존재하는 동안, THE Character_Sheet_App SHALL 그 Selected_Card를 선택된 것으로 식별 가능하게 표시한다.
5. WHEN the Player가 Card_Based_Sheet에서 Save_Action 또는 Confirm_Action을 수행하고 정확히 하나의 Selected_Card가 존재하면, THE Character_Sheet_App SHALL Record_Character_Endpoint 요청에 그 Selected_Card의 Card_Id와 플레이어가 입력한 Narrative_Field 값을 포함시킨다.

### Requirement 5: 카드 선택 필수 검증 (프론트엔드)

**User Story:** 플레이어로서, 카드 기반 시나리오에서 역할 카드를 고르지 않고 저장·확정하려 하면 분명히 안내받고 싶다. 그래야 역할 없는 인물이 잘못 확정되지 않는다.

#### Acceptance Criteria

1. IF Active_Sheet_Schema가 Card_Based_Sheet이고 Selected_Card가 존재하지 않는 상태로 Save_Action 또는 Confirm_Action이 수행되면, THEN THE Character_Sheet_App SHALL 역할 카드를 먼저 선택해야 한다는 한국어 오류 메시지를 표시하고, Record_Character_Endpoint 또는 Confirm_Character_Endpoint로 요청을 전송하지 않으며, 플레이어가 입력한 Narrative_Field 값(이름 포함)을 변경 없이 보존하고, 캐릭터를 Confirmed_State로 전이시키지 않는다.
2. WHEN 동일한 Card_Based_Sheet의 Character_Card_List와 동일한 카드 선택 입력이 주어지면, THE Frontend_Card_Validator와 THE Backend_Card_Validator SHALL 그 카드 선택에 대해 동일한 유효/무효 판정을 내린다.
3. WHEN the Frontend_Card_Validator가 동일한 Character_Card_List와 동일한 카드 선택 입력을 임의의 횟수(2회 이상) 판정하면, THE Frontend_Card_Validator SHALL 판정 순서나 직전 판정 상태와 무관하게 매번 동일한 판정을 산출한다.
4. WHEN the Character_Sheet_App가 Card_Based_Sheet가 아닌(Character_Card_List가 비어 있거나 없는) Active_Sheet_Schema에서 Save_Action 또는 Confirm_Action을 수행하면, THE Character_Sheet_App SHALL 카드 선택 검증을 적용하지 않는다(기존 시트 동작 보존).

### Requirement 6: 백엔드 카드 선택 기록·검증

**User Story:** 개발자로서, 카드 기반 시나리오의 캐릭터를 기록할 때 서버가 카드 선택을 강제하길 바란다. 그래야 시나리오가 제공하지 않은 역할이나 빈 역할이 저장되지 않는다.

#### Acceptance Criteria

1. WHEN `recordCharacter`가 Card_Based_Sheet에 대해 그 Character_Card_List에 속하는 Card_Id 하나와 함께 호출되면, THE Character_Service SHALL 확정 전 캐릭터를 그 Card_Id와 입력된 Narrative_Field 값으로 기록·갱신한다.
2. IF `recordCharacter`가 Card_Based_Sheet에 대해 카드 선택 없이 호출되거나 그 Character_Card_List에 속하지 않는 Card_Id와 함께 호출되면, THEN THE Character_Service SHALL 그 호출을 `INVALID_CARD` 사유로 거부하고 어떤 캐릭터 데이터도 기록·갱신하지 않는다.
3. WHEN `recordCharacter`가 Card_Based_Sheet가 아닌 시트에 대해 호출되면, THE Character_Service SHALL 카드 선택 검증을 적용하지 않고 기존 동작을 변경 없이 수행한다.
4. IF the Character_Sheet_App가 `INVALID_CARD` 사유의 거부 응답을 받으면, THEN THE Character_Sheet_App SHALL 역할 카드를 선택해야 한다는 한국어 오류 메시지를 표시하고, 플레이어가 입력한 Narrative_Field 값(이름 포함)을 변경 없이 보존하며, 캐릭터를 Confirmed_State로 전이시키지 않는다.

### Requirement 7: 프론트엔드 스키마 검증과 폴백

**User Story:** 플레이어로서, 시나리오 시트에 실린 카드 목록이 깨져 있어도 화면이 멈추지 않고 작성을 이어갈 수 있길 바란다.

#### Acceptance Criteria

1. WHEN the Character_Sheet_App가 시트 스키마 응답을 검증하면, THE Character_Sheet_App SHALL 그 응답의 Character_Card_List를, 없거나 비어 있는 경우(카드 기반 아님)이거나, 또는 원소가 1개 이상이며 모든 원소가 공백 제거 후 1자 이상인 Card_Id와 공백 제거 후 1자 이상인 Card_Role_Label을 갖고 모든 Card_Id가 고유한 경우에만 유효로 인정한다.
2. IF 시트 스키마 응답이 성공이지만 그 Character_Card_List가 criterion 1의 유효 조건을 충족하지 못하면, THEN THE Character_Sheet_App SHALL 그 스키마를 채택하지 않고 Default_Sheet_Schema(카드 기반 아님)를 Active_Sheet_Schema로 사용한다.
3. WHEN the Character_Sheet_App가 Default_Sheet_Schema로 폴백하면, THE Character_Sheet_App SHALL 기본 시트로 작성을 이어간다는 한국어 안내를 표시하고 플레이어가 캐릭터 작성을 계속할 수 있게 한다.
4. WHEN 시트 스키마 응답에 Attribute_Proposal_Supported 플래그가 없으면, THE Character_Sheet_App SHALL 그 시트의 Rated_Trait_Count가 0이면 Attribute_Proposal_Supported를 거짓으로, 1 이상이면 참으로 도출하여 능력치 제안 동작 표시를 결정한다.

### Requirement 8: 확정된 카드 선택의 잠금 보존

**User Story:** 플레이어로서, 캐릭터를 확정한 뒤에는 선택한 역할 카드가 바뀌지 않길 바란다. 그래야 세션에 들어갈 준비가 확실해진다.

#### Acceptance Criteria

1. WHILE 캐릭터가 Confirmed_State인 동안, THE Character_Sheet_App SHALL Card_Based_Sheet의 Card_Selection_Action을 읽기 전용(비활성) 상태로 표시하고, Selected_Card를 확정 시점의 선택에서 변경하지 않고 그대로 유지한다.
2. WHILE 캐릭터가 Confirmed_State인 동안, IF Card_Selection_Action에 대한 조작 시도가 발생하면, THEN THE Character_Sheet_App SHALL Selected_Card를 변경하지 않고 그대로 유지한다.
3. IF 확정된 캐릭터(Confirmed_State)에 대해 `recordCharacter`가 호출되면, THEN THE Character_Service SHALL 그 호출을 `ALREADY_CONFIRMED` 사유로 거부하고, 확정된 캐릭터의 카드 선택과 Narrative_Field 값을 변경 없이 그대로 보존한다.
