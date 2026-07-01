# Requirements Document

## Introduction

ready-gm은 친구들과 함께 즐기는 멀티플레이 TRPG 세션을 AI GM이 진행해 주는 웹 플랫폼입니다. 이 스펙은 host-entry(방 생성) → room-lobby(대기실) → game-play(세션 진행) 흐름 사이에서, 플레이어가 자신의 캐릭터를 만드는 **캐릭터 시트 작성 화면(Character_Sheet_App)** 하나에 집중합니다. 캐릭터 시트는 TRPG의 핵심 산출물로, 이름·컨셉 같은 서사 요소와 능력치·기능 같은 평가 항목을 함께 담아 플레이어가 자신의 분신을 확정하는 자리입니다.

본 스펙의 핵심 설계 원칙은 **시나리오 적응형(scenario-adaptive)** 시트입니다. 방에 선택된 시나리오가 바뀌면, 작성 화면에 나타나는 구성(시트 섹션·평가 항목·서사 프롬프트)도 그 시나리오에 맞게 달라집니다. 즉 시트는 "이름 + 능력치 네 개"로 하드코딩되지 않고, 시나리오가 정의한 **캐릭터 시트 스키마(Scenario_Sheet_Schema)** 에 따라 동적으로 렌더링됩니다. 시나리오가 별도 스키마를 제공하지 않으면 기본값으로 EZFudge 네 능력치 한 벌을 사용합니다.

본 화면은 인계 계약(`?roomId=...&playerId=...&token=...`)으로 진입하는 **플레이어별 화면**이며, 플레이어가 캐릭터 이름·컨셉 등 서사 항목을 입력하고, AI에게 컨셉에 맞는 평가 항목(능력치 등) 제안을 받고, 제안을 각 항목의 EZFudge 사다리 안에서 직접 다듬고, 캐릭터를 저장(편집 가능)했다가 확정(잠금)하는 경험을 다룹니다. 캐릭터가 확정되면 본 화면은 다음 화면으로의 인계 지점을 제공합니다.

본 화면은 기존 프로젝트의 접근 방식(빌드 단계 없는 정적 `public/*.html`, 바닐라 JS ES 모듈, 인라인 CSS, 다크 테마)을 그대로 따르며, host-entry·room-lobby·game-play와 동일하게 순수 로직을 `public/character/logic.js` ES 모듈로 분리하고 `public/character/index.html`이 그 모듈을 import 해 DOM에 배선하는 구조로 구현합니다(vitest + fast-check 단위/속성 테스트, happy-dom DOM 테스트).

### 설계 근거 (보편적 TRPG 캐릭터 시트 작성 관행)

본 시트 구성은 여러 시스템에 걸친 캐릭터 요소 분류 체계를 근거로 한다(아래 출처는 모두 의역이며 원문 직접 인용이 아니다 — 라이선스 준수를 위해 내용을 재서술함).

- 범용 캐릭터 요소 분류(Hero Forge Games, "Taxonomy and nomenclature of RPG character elements")는 캐릭터 요소를 Character, 종족/혈통(Species/Ancestry), 능력치(Attribute, 타고난 수치), 특성/특수능력(Trait), 클래스/원형/컨셉(Class/Archetype/Concept), 레벨(Level), 기능(Skill), 행동(Action), 단서적 묘사(Aspect, 짧은 서술), 배경(Background) 등으로 나눈다. 시스템마다 이 분류의 **부분집합**을 고른다: FATE는 Aspect+Skill, FATE Accelerated는 Attribute+Aspect, D&D는 Attribute+Species+Class+Skill+Background 식이다. 즉 "어떤 항목을 시트에 둘지"는 시스템(본 프로젝트에서는 시나리오)이 정한다.
- Fudge/FATE SRD는 모든 특성을 7단 형용사 사다리로 평가하며(본 프로젝트 EZFudge 사다리 [-2..+4], 끔찍함..탁월함이 이에 대응한다), 특성은 능력치·기능·재능/Aspect·결점 등으로 구성된다. 특히 능력치의 개수와 선택은 의도적으로 고정하지 않고 게임/세계관마다 고르도록 둔다.
- 가벼운 범용 시스템의 캐릭터 생성 설계 원칙(Mythcreants, "Six Signs of Good Character Creation")은 적은 수치, 한눈에 보이는 선택, 최소한의 계산, 강한 서사 훅(컨셉·배경·목표)을 권장하여 몰입과 플레이어 주도성을 높인다.

이 근거에 따라 본 시트는 이름과 네 능력치를 넘어, 시나리오가 요구하면 컨셉/원형, 짧은 배경/내력, 선택적 Aspect형 짧은 묘사와 기능(Skill)까지 담을 수 있어야 한다. 단, 평가되는 모든 항목(Rated_Trait)은 주사위·난이도 계산이 의존하는 EZFudge 사다리(기본 [-2..+4])를 평가 척도로 공유한다.

### 백엔드 계약 근거 (실제 코드 확인)

이 스펙은 다음 실제 백엔드 코드를 근거로 합니다(`src/services/character-service.ts`, `src/services/types.ts`, `src/services/scenario-service.ts`, `src/core/types.ts`, `src/core/ezfudge.ts`, `src/http/app.ts` 확인).

- **EZFudge 능력치 키**는 기본 스키마에서 정확히 네 개다(`src/core/types.ts`의 `AttributeKey`): `Might`, `Agility`, `Wits`, `Spirit`.
- **EZFudge 능력치 사다리**는 정수 구간 `[-2, +4]`이며(`src/core/ezfudge.ts`의 `ATTRIBUTE_LEVEL_MIN`/`ATTRIBUTE_LEVEL_MAX`, `DEFAULT_ATTRIBUTE_LADDER`), `isValidAttributeLevel(level, ladder)`은 정수이면서 주어진 사다리 안에 있을 때만 참이다. 설계상 끔찍함(Terrible)=-2 … 탁월함(Superb)=+4 의 명명 사다리에 대응한다.
- **EZFudge 사다리는 구성 가능하다(grounding for scenario adaptivity)**: `src/core/types.ts`의 `EngineConfig.attributeLadder` 주석과 `src/core/ezfudge.ts`의 `DEFAULT_ATTRIBUTE_LADDER`/`isValidAttributeLevel(level, ladder)` 주석은 사다리 구간이 **기본값이며 시나리오나 대체 규칙계가 다른 사다리를 쓸 수 있도록 구성 가능**하다고 명시한다. 따라서 평가 항목(Rated_Trait)은 각자 어떤 사다리를 쓰는지 스키마가 지정할 수 있으며, 미지정 시 기본 EZFudge 사다리 [-2..+4]를 따른다.
- **Scenario 엔티티**(`src/services/scenario-service.ts`의 `Scenario`)는 `{ id, title, summary, openingSeed, endingCondition }` 형태이며, 방의 선택 시나리오는 `Room.scenarioId`로 기록된다. 현재 `Scenario` 타입에는 캐릭터 시트 구성 필드가 없으므로, 시나리오별 시트 구성은 아래 가정의 의도된 계약(Scenario_Sheet_Schema)으로 둔다.
- **Character 엔티티**(`src/services/types.ts`): `{ id, playerId, roomId, name, concept, attributes: Record<AttributeKey, AttributeLevel>, confirmed }`. `confirmed === true`이면 능력치가 잠겨 더 이상 수정할 수 없다. (시나리오별 추가 평가 항목·서사 항목을 담는 확장은 아래 가정의 의도된 계약으로 둔다.)
- **CharacterService**(`src/services/character-service.ts`)의 동작 규칙:
  - `recordCharacter(playerId, { name, concept, attributes })` 는 확정 전까지 캐릭터(이름·컨셉·능력치)를 기록/갱신한다. 거부 사유: `NAME_TAKEN`(방 안에서 이름 중복, 대소문자·공백 무시 비교), `INVALID_ATTRIBUTES`(능력치가 사다리 밖), `ALREADY_CONFIRMED`(이미 확정됨), `UNKNOWN_PLAYER`.
  - `confirmCharacter(playerId)` 는 캐릭터를 확정(능력치 잠금)한다. 기록된 캐릭터가 없으면 `NO_CHARACTER`로 거부하며, 이미 확정된 캐릭터를 다시 확정하면 멱등적으로 성공한다.
  - 능력치 검증은 구성 가능한 사다리(`attributeLadder`, 기본 `DEFAULT_ATTRIBUTE_LADDER`)에 대해 `isValidAttributeLevel`로 수행된다.
- **AI 능력치 제안**: AI 요청 종류에 `attributes`가 존재하며(`src/core/types.ts`의 `RequestType`), trpg-session-engine 요구사항 4.2에 따라 AI_GM은 플레이어의 컨셉과 방에 적용된 시나리오에 부합하는 EZFudge 평가 항목 한 벌을 제안한다.
- **접근 토큰(`?token`)** 은 host-entry·room-lobby와 동일하게 REST 요청의 `x-playtest-token` 헤더로 전달된다(`src/http/app.ts`의 보안 주석 참조).

> 본 스펙은 room-lobby·game-play가 했던 것과 동일하게, **현재 플레이테스트 서버에 아직 배선되지 않은 백엔드 항목**을 아래 "범위 밖 / 가정(Assumptions)"에 명시한다. 프론트엔드는 이 계약에 대해 모킹된 `fetch`로 완전하게 명세·구현·단위/DOM 테스트할 수 있다.

## 범위 밖 / 가정 (Assumptions)

다음 항목은 **의도된(intended) 백엔드 계약**으로서 본 화면이 통합 대상으로 삼되, 현재 서버(`src/http/app.ts`는 `POST /rooms`, `GET /rooms/:token`, `GET /rooms/:id/invite`, `GET /scenarios`, `GET /rooms/:id/summary`만 노출)에 아직 배선돼 있지 않으므로 명시적으로 가정으로 둔다. 프론트엔드는 모킹으로 테스트 가능하며, 실제 동작은 해당 백엔드 배선이 추가된 뒤에 검증된다.

- **시나리오별 캐릭터 시트 스키마 엔드포인트 부재 (Directive B의 핵심 계약)**: 현재 `Scenario` 타입에는 시트 구성 정보가 없고, 방의 선택 시나리오를 받아 시트 구성을 돌려주는 엔드포인트도 배선돼 있지 않다. 본 화면의 시나리오 적응형 동작은 의도된 Scenario_Sheet_Schema_Endpoint 위에서 정의한다. 이 엔드포인트는 방의 선택 Scenario를 받아, 화면이 렌더링할 Scenario_Sheet_Schema(나타날 Sheet_Section 목록, 평가할 Rated_Trait 목록과 각 항목의 Trait_Key·표시 레이블·Trait_Ladder, 시나리오별 Narrative_Field 프롬프트)를 돌려준다. 이 계약의 실제 근거는 EZFudge 사다리가 "시나리오/대체 규칙계가 다른 사다리를 쓸 수 있도록 구성 가능"하다고 명시한 `src/core/types.ts`·`src/core/ezfudge.ts` 주석이다. 시나리오가 스키마를 제공하지 않거나 엔드포인트가 미배선·실패이면 본 화면은 Default_Sheet_Schema(EZFudge 네 능력치 Might·Agility·Wits·Spirit, 사다리 [-2..+4], 기본 Narrative_Field로 이름·컨셉)를 사용한다.
- **캐릭터 기록/확정 REST 엔드포인트 부재**: `CharacterService.recordCharacter`/`confirmCharacter`는 서비스 계층에 구현돼 있으나 이를 노출하는 REST(또는 실시간) 엔드포인트가 아직 없다. 본 화면의 저장/확정 요구사항은 이 서비스 계약을 그대로 노출하는 의도된 엔드포인트(아래 Glossary의 Record_Character_Endpoint, Confirm_Character_Endpoint) 위에서 정의하며, 거부 사유(`NAME_TAKEN`, `INVALID_ATTRIBUTES`, `ALREADY_CONFIRMED`, `NO_CHARACTER`)는 서비스의 결과 코드를 따른다. 시나리오 스키마가 능력치 외 추가 Rated_Trait나 Narrative_Field를 정의하는 경우, 의도된 Record_Character_Endpoint는 그 확장된 시트(전체 Rated_Trait_Set과 Narrative_Field 값)를 받아 기록한다.
- **AI 능력치 제안 엔드포인트 부재**: AI 요청 종류 `attributes`는 코어에 존재하나 컨셉을 받아 제안 값을 돌려주는 REST 엔드포인트가 아직 배선되지 않았다. 본 화면의 AI 제안 요구사항은 의도된 Attribute_Proposal_Endpoint 위에서 정의하며, 이 엔드포인트는 Active_Sheet_Schema가 정의한 각 Rated_Trait에 대한 제안 값을 돌려준다. AI 제안 사용은 선택이며, 플레이어는 제안 없이도 평가 항목을 직접 입력해 저장·확정할 수 있다.
- **상류 진입 흐름(게스트 참가 등)은 범위 밖**: 본 화면으로 진입하기 직전의 화면(초대 링크 참가, 표시 이름 입력 등)은 후속 스펙에서 다룬다. 본 화면은 인계로 전달된 `roomId`·`playerId`(필요 시 `token`)를 신뢰한다.
- **다음 화면(인계 대상)은 범위 밖**: 확정 후 이동하는 화면(로비 복귀 또는 게임 진행 화면)의 내부 동작은 본 스펙 범위 밖이다. 본 화면은 그 화면으로의 **인계 지점만** 제공한다.
- **세션 시작 게이트는 범위 밖**: "모든 플레이어가 확정해야 세션 시작 가능"(`CharacterService.canStart`/`startSession`)은 호스트의 로비·세션 시작 책임이며 본 화면 밖이다. 본 화면은 단일 플레이어 본인의 캐릭터 작성만 다룬다.

## Glossary

- **Character_Sheet_App**: 캐릭터 시트 작성을 담당하는 프론트엔드 애플리케이션. 본 스펙이 정의하는 시스템.
- **Character_Sheet_View**: 플레이어가 보는 캐릭터 작성 화면 영역. 서사 항목 입력, 평가 항목 편집, AI 제안·저장·확정 제어를 표시한다.
- **Player**: 본 화면에서 자신의 캐릭터를 작성하는 사용자. 본 화면의 유일한 사용자.
- **Handoff_Params**: 페이지 URL 쿼리로 전달되는 인계 값 묶음. `roomId`, `playerId`(필수)와 선택적 `token`으로 구성된다.
- **Room_Id**: 인계로 전달된 방 식별자(`roomId`). 시트 스키마·캐릭터 기록·확정·제안 요청에 사용된다.
- **Player_Id**: 인계로 전달된, 캐릭터를 작성하는 플레이어의 식별자(`playerId`).
- **Access_Token**: 공개 바인딩된 서버를 보호하기 위한 공유 비밀 값. 페이지 URL의 `?token=` 쿼리 파라미터로 전달될 수 있으며, REST 요청의 `x-playtest-token` 헤더로 전송된다.
- **Scenario**: 방에 선택된 시나리오 엔티티. `{ id, title, summary, openingSeed, endingCondition }`(`src/services/scenario-service.ts`).
- **Scenario_Sheet_Schema**: (의도된) 한 Scenario에 대응하는 캐릭터 시트 구성. 나타날 Sheet_Section 목록, 평가할 Rated_Trait 목록(각 항목의 Trait_Key·표시 레이블·Trait_Ladder), 시나리오별 Narrative_Field 정의를 담는다.
- **Default_Sheet_Schema**: 시나리오가 스키마를 제공하지 않거나 스키마 로드가 실패했을 때 쓰는 기본 스키마. 네 Attribute_Key(Might·Agility·Wits·Spirit)를 Attribute_Ladder `[-2, +4]`의 Rated_Trait로, 이름(Character_Name)과 컨셉(Character_Concept)을 Narrative_Field로 갖는다.
- **Active_Sheet_Schema**: 현재 Character_Sheet_App이 렌더링·검증·전송에 사용 중인 스키마. 유효한 Scenario_Sheet_Schema를 채택했으면 그것이고, 그렇지 않으면 Default_Sheet_Schema다. 항상 정확히 하나가 존재한다.
- **Scenario_Sheet_Schema_Endpoint**: (의도된) 방의 선택 Scenario를 받아 Active_Sheet_Schema로 쓸 Scenario_Sheet_Schema를 돌려주는 백엔드 엔드포인트.
- **Sheet_Section**: Active_Sheet_Schema가 정의하는 시트의 한 구획(예: 능력치, 기능, 서사 항목). 화면은 스키마가 정의한 Sheet_Section만 렌더링한다.
- **Rated_Trait**: Active_Sheet_Schema가 정의하는 평가 항목. Trait_Key, 표시 레이블, Trait_Ladder를 가지며, 하나의 정수 Trait_Level 값을 갖는다. Default_Sheet_Schema의 Rated_Trait는 네 Attribute_Key다.
- **Trait_Key**: 한 Rated_Trait의 식별자.
- **Trait_Ladder**: 한 Rated_Trait가 사용하는 정수 포함 구간 사다리. Active_Sheet_Schema가 항목별로 지정할 수 있으며, 미지정 시 Attribute_Ladder `[-2, +4]`를 기본값으로 한다.
- **Trait_Level**: 한 Rated_Trait의 값. 해당 Trait_Ladder 안의 정수.
- **Rated_Trait_Set**: Active_Sheet_Schema가 정의한 모든 Rated_Trait에 각각 하나의 Trait_Level을 부여한 한 벌. Default_Sheet_Schema에서는 Attribute_Set과 동일하다.
- **Narrative_Field**: Active_Sheet_Schema가 정의하는 자유 텍스트 서사 항목(예: 컨셉/원형, 배경/내력, 시나리오별 프롬프트). 이름(Character_Name)과 컨셉(Character_Concept)은 모든 스키마가 갖는 기본 Narrative_Field다.
- **Character_Name**: 모든 스키마가 갖는 기본 Narrative_Field 중 하나. 플레이어가 입력하는 캐릭터 이름. 공백을 제거했을 때 한 글자 이상이어야 하며 방 안에서 고유해야 한다.
- **Character_Concept**: 모든 스키마가 갖는 기본 Narrative_Field 중 하나. 플레이어가 입력하는 캐릭터 컨셉(자유 텍스트 설명). AI 평가 항목 제안의 입력이 된다.
- **Attribute_Key**: Default_Sheet_Schema의 Rated_Trait를 이루는 EZFudge 능력치 키. 정확히 `Might`, `Agility`, `Wits`, `Spirit` 네 개.
- **Attribute_Ladder**: EZFudge 능력치 사다리. 정수 포함 구간 `[-2, +4]`. Default_Sheet_Schema의 Trait_Ladder.
- **Attribute_Level**: 한 Attribute_Key의 값(Trait_Level의 특수형). Attribute_Ladder 안의 정수.
- **Ladder_Rung_Label**: 한 Trait_Level에 대응하는 한국어 표시 이름. 기본 EZFudge 사다리(Attribute_Ladder)의 매핑은 -2=끔찍함, -1=빈약함, 0=평범함, +1=양호함, +2=우수함, +3=훌륭함, +4=탁월함이며, 기본 사다리가 아닌 Trait_Ladder에서는 Active_Sheet_Schema가 제공한 등급 레이블을 사용한다.
- **Attribute_Set**: 네 Attribute_Key 각각에 하나의 Attribute_Level을 부여한 한 벌(`Record<Attribute_Key, Attribute_Level>`). Default_Sheet_Schema의 Rated_Trait_Set.
- **Proposed_Trait_Values**: Attribute_Proposal_Endpoint가 돌려준, AI가 컨셉·시나리오에 맞춰 Active_Sheet_Schema의 각 Rated_Trait에 제안한 Trait_Level 한 벌(Rated_Trait_Set 형태). Default_Sheet_Schema에서는 네 Attribute_Key에 대한 제안 값(Proposed_Attributes)과 같다.
- **Attribute_Proposal_Endpoint**: (의도된) Character_Concept(과 방의 시나리오)을 받아 Active_Sheet_Schema가 정의한 각 Rated_Trait에 대한 Proposed_Trait_Values를 돌려주는 백엔드 엔드포인트. AI 요청 종류 `attributes`에 대응한다.
- **Record_Character_Endpoint**: (의도된) `CharacterService.recordCharacter`를 노출하는 백엔드 엔드포인트. Character_Name·Narrative_Field 값·Rated_Trait_Set을 받아 확정 전 캐릭터를 기록/갱신하고, 성공 시 Character를, 거부 시 사유(`NAME_TAKEN`, `INVALID_ATTRIBUTES`, `ALREADY_CONFIRMED`, `UNKNOWN_PLAYER`)를 돌려준다.
- **Confirm_Character_Endpoint**: (의도된) `CharacterService.confirmCharacter`를 노출하는 백엔드 엔드포인트. 기록된 캐릭터를 확정(잠금)하고, 기록된 캐릭터가 없으면 `NO_CHARACTER`로 거부한다.
- **Character**: 캐릭터 엔티티. `{ id, playerId, roomId, name, concept, attributes, confirmed }`.
- **Confirmed_State**: 캐릭터가 확정되어 평가 항목이 잠긴 상태(`confirmed === true`).
- **Propose_Action**: 플레이어가 AI 평가 항목 제안을 요청하는 사용자 동작 요소.
- **Save_Action**: 플레이어가 현재 시트를 확정 전 캐릭터로 기록하는 사용자 동작 요소.
- **Confirm_Action**: 플레이어가 현재 시트를 기록한 뒤 확정(잠금)하는 사용자 동작 요소.
- **Next_Screen**: 확정 후 이동하는 다음 화면(범위 밖). 본 화면은 이 화면으로의 인계 지점만 제공한다.
- **Request_Timeout**: REST 요청에 적용되는 클라이언트 타임아웃. 10초(10000밀리초)로 한다(host-entry·room-lobby와 동일).

## Requirements

### Requirement 1: 인계 파라미터 읽기 및 검증

**User Story:** 플레이어로서, 캐릭터 작성 화면에 들어왔을 때 내가 속한 올바른 방·플레이어로 정확히 연결되고 싶다. 그래야 내 캐릭터가 우리 세션에 제대로 기록된다.

#### Acceptance Criteria

1. WHEN the Character_Sheet_App가 로드되면, THE Character_Sheet_App SHALL 페이지 URL 쿼리에서 `roomId` 값의 앞뒤 공백을 제거한 결과를 Room_Id로, `playerId` 값의 앞뒤 공백을 제거한 결과를 Player_Id로 읽으며, `roomId` 또는 `playerId` 쿼리 키가 존재하지 않으면 그 값을 길이가 0인 문자열로 취급한다.
2. WHERE 페이지 URL 쿼리에 앞뒤 공백을 제거한 후 길이가 1자 이상인 `token` 값이 존재하는 경우, THE Character_Sheet_App SHALL 그 값을 Access_Token으로 보존하고 후속 Scenario_Sheet_Schema_Endpoint·Attribute_Proposal_Endpoint·Record_Character_Endpoint·Confirm_Character_Endpoint 요청에 인증 정보로 첨부한다.
3. IF 앞뒤 공백을 제거한 후의 Room_Id 또는 Player_Id 중 하나라도 길이가 0이면, THEN THE Character_Sheet_App SHALL 인계 정보가 유효하지 않다는 한국어 오류 메시지를 표시하고 어떤 백엔드 요청도 시작하지 않으며 Active_Sheet_Schema가 정의한 Narrative_Field 입력 요소(이름·컨셉 포함)·Rated_Trait 평가 편집 요소·Propose_Action·Save_Action·Confirm_Action을 모두 비활성 상태로 표시한다.
4. WHEN 앞뒤 공백을 제거한 후의 Room_Id와 Player_Id가 모두 길이가 1자 이상인 상태로 the Character_Sheet_App가 로드되면, THE Character_Sheet_App SHALL Character_Sheet_View를 초기 작성 상태로 표시하고 Active_Sheet_Schema가 정의한 Narrative_Field 입력 요소(이름·컨셉 포함)·Rated_Trait 평가 편집 요소·Propose_Action·Save_Action·Confirm_Action을 활성 상태로 표시한다.
5. IF 앞뒤 공백을 제거한 후의 `token` 값의 길이가 0이거나 `token` 쿼리 키가 존재하지 않으면, THEN THE Character_Sheet_App SHALL Access_Token 없이 후속 백엔드 요청을 진행한다.

### Requirement 2: 캐릭터 시트 초기 표시

**User Story:** 플레이어로서, 화면에 들어오면 무엇을 입력하고 어떤 항목을 정해야 하는지 한눈에 보고 싶다. 그래야 막힘없이 캐릭터를 만들기 시작할 수 있다.

#### Acceptance Criteria

1. WHEN the Character_Sheet_App가 초기 작성 상태를 표시할 때, THE Character_Sheet_View SHALL Active_Sheet_Schema가 정의한 각 Narrative_Field 입력 요소(이름·컨셉 포함)를 각각 길이가 0인(빈) 값으로 표시하고, 각 Narrative_Field의 목적을 식별하는 공백 제거 후 한 글자 이상인 한국어 안내 텍스트를 함께 표시한다.
2. WHEN the Character_Sheet_App가 초기 작성 상태를 표시할 때, THE Character_Sheet_View SHALL Active_Sheet_Schema가 정의한 각 Rated_Trait에 대한 평가 편집 요소를 해당 Rated_Trait를 식별하는 공백 제거 후 한 글자 이상인 레이블과 함께, 해당 Rated_Trait가 속한 Sheet_Section 안에 표시한다.
3. WHEN the Character_Sheet_App가 초기 작성 상태를 표시할 때, THE Character_Sheet_App SHALL 각 Rated_Trait의 Trait_Level을, 0이 해당 Rated_Trait의 Trait_Ladder 안에 있으면 0으로, 그렇지 않으면 그 Trait_Ladder의 최소 정수로 초기화하여 표시하고 그 Trait_Level에 대응하는 Ladder_Rung_Label을 함께 표시한다.
4. WHEN the Character_Sheet_App가 초기 작성 상태를 표시할 때, THE Character_Sheet_View SHALL Propose_Action, Save_Action, Confirm_Action 요소를 활성 상태로 표시한다.
5. WHEN the Character_Sheet_App가 어떤 Rated_Trait의 Trait_Level을 표시할 때, THE Character_Sheet_App SHALL 그 Trait_Level에 대응하는 Ladder_Rung_Label을 함께 표시하며, Rated_Trait의 Trait_Ladder가 기본 Attribute_Ladder인 경우 그 매핑(-2=끔찍함, -1=빈약함, 0=평범함, +1=양호함, +2=우수함, +3=훌륭함, +4=탁월함)을 사용한다.

### Requirement 3: 이름·컨셉 및 서사 항목 입력

**User Story:** 플레이어로서, 내 캐릭터의 이름·컨셉과 시나리오가 요구하는 서사 항목을 자유롭게 적고 싶다. 그래야 내가 연기할 인물을 분명히 정할 수 있다.

#### Acceptance Criteria

1. WHEN the Player가 Character_Name 입력 요소의 값을 변경하면, THE Character_Sheet_App SHALL 변경된 값을 앞뒤 공백을 포함하여 입력한 그대로 현재 작성 중인 시트의 Character_Name으로 보존하고 Character_Name 입력 요소에 동일하게 표시한다.
2. WHEN the Player가 Character_Concept을 포함한 어떤 Narrative_Field 입력 요소의 값을 변경하면, THE Character_Sheet_App SHALL 변경된 값을 앞뒤 공백을 포함하여 입력한 그대로 그 Narrative_Field의 현재 값으로 보존하고 해당 입력 요소에 동일하게 표시한다.
3. WHEN the Character_Sheet_App가 Character_Name 또는 어떤 Narrative_Field 값을 백엔드로 전송할 때, THE Character_Sheet_App SHALL 각 값의 앞뒤 공백만 제거하고 값 내부의 공백은 보존한 형태로 전송한다.
4. WHEN the Character_Sheet_App가 Character_Name 또는 어떤 Narrative_Field의 텍스트를 화면의 어느 영역(작성 중 표시 및 Confirmed_State 읽기 전용 표시 포함)에든 표시할 때, THE Character_Sheet_App SHALL 그 텍스트를 HTML 또는 스크립트로 해석하지 않고 일반 텍스트로 이스케이프하여 표시한다.
5. THE Character_Sheet_App SHALL Character_Name 입력 요소가 보존하는 값의 길이를 100자 이하로 제한한다.
6. THE Character_Sheet_App SHALL Character_Concept을 포함한 각 Narrative_Field 입력 요소가 보존하는 값의 길이를 2000자 이하로 제한한다.

### Requirement 4: AI 평가 항목 제안

**User Story:** 플레이어로서, 규칙을 몰라도 내 컨셉에 어울리는 능력치·기능 값을 AI가 제안해 주길 원한다. 그래야 빠르게 그럴듯한 캐릭터를 시작할 수 있다.

#### Acceptance Criteria

1. WHEN the Player가 앞뒤 공백을 제거한 후 길이가 1자 이상인 Character_Concept으로 Propose_Action을 수행하면, THE Character_Sheet_App SHALL 앞뒤 공백을 제거한 Character_Concept, Room_Id, Active_Sheet_Schema가 정의한 Rated_Trait의 Trait_Key 목록(그리고 길이가 1자 이상인 Access_Token이 존재하면 그 Access_Token)을 포함하여 Attribute_Proposal_Endpoint에 평가 항목 제안을 요청한다.
2. IF 앞뒤 공백을 제거한 후의 Character_Concept의 길이가 0인 상태에서 Propose_Action이 수행되면, THEN THE Character_Sheet_App SHALL Attribute_Proposal_Endpoint 요청을 보내지 않고 컨셉 입력이 필요하다는 한국어 안내를 표시한다.
3. WHEN Attribute_Proposal_Endpoint가 Active_Sheet_Schema의 모든 Rated_Trait에 대해 각 Rated_Trait의 Trait_Ladder 안의 정수 값을 담은 Proposed_Trait_Values를 성공 응답으로 반환하면, THE Character_Sheet_App SHALL 각 Rated_Trait의 평가 편집 요소 값을 해당 Proposed_Trait_Values 값으로 갱신하고 대응하는 Ladder_Rung_Label도 함께 갱신하여 표시한다.
4. WHEN the Character_Sheet_App가 Proposed_Trait_Values를 적용한 뒤, THE Character_Sheet_App SHALL 그 Trait_Level 값들을 플레이어가 다시 편집할 수 있는 상태로 유지한다.
5. IF Attribute_Proposal_Endpoint가 성공 응답을 반환했으나 그 응답 본문의 Proposed_Trait_Values에 Active_Sheet_Schema의 Rated_Trait 중 하나라도 없거나, 어떤 값이 해당 Rated_Trait의 Trait_Ladder 밖이거나 정수가 아니면, THEN THE Character_Sheet_App SHALL 그 응답을 적용하지 않고 제안을 받지 못했다는 한국어 오류 메시지를 표시하며 모든 Rated_Trait의 기존 Trait_Level과 Ladder_Rung_Label을 변경 없이 유지한다.

### Requirement 5: 평가 항목 표시 및 편집

**User Story:** 플레이어로서, 제안받은 능력치·기능을 내 마음대로 사다리 안에서 올리고 내리고 싶다. 그래야 내가 원하는 캐릭터로 다듬을 수 있다.

#### Acceptance Criteria

1. WHEN the Player가 어떤 Rated_Trait의 평가 편집 요소로 그 Rated_Trait의 Trait_Ladder 안의 정수 값을 지정하면, THE Character_Sheet_App SHALL 200밀리초 이내에 그 Rated_Trait의 Trait_Level만 지정된 값으로 갱신하고 대응하는 Ladder_Rung_Label을 함께 갱신하여 표시하며, 나머지 Rated_Trait의 Trait_Level과 그 Ladder_Rung_Label은 변경하지 않는다.
2. THE Character_Sheet_App SHALL 각 Rated_Trait의 평가 편집 요소가 지정할 수 있는 값을 그 Rated_Trait의 Trait_Ladder의 정수로만 제한한다(기본 Attribute_Ladder의 경우 -2, -1, 0, +1, +2, +3, +4 일곱 개).
3. WHILE 캐릭터가 Confirmed_State가 아닌 동안, THE Character_Sheet_App SHALL Active_Sheet_Schema가 정의한 모든 Rated_Trait의 평가 편집 요소를 활성 상태로 표시한다.
4. WHEN the Character_Sheet_App가 평가 편집 요소의 값을 Save_Action 또는 Confirm_Action으로 백엔드에 전송할 때, THE Character_Sheet_App SHALL 화면에 표시된 각 Trait_Level을 변형 없이 그대로 Rated_Trait_Set으로 전송한다.
5. IF 어떤 Rated_Trait의 평가 편집 요소로 그 Rated_Trait의 Trait_Ladder 밖의 값 또는 정수가 아닌 값이 지정되면, THEN THE Character_Sheet_App SHALL 그 값을 적용하지 않고 해당 Rated_Trait의 직전 Trait_Level과 그 Ladder_Rung_Label을 변경 없이 유지한다.

### Requirement 6: 캐릭터 저장(기록)

**User Story:** 플레이어로서, 작성 중인 캐릭터를 확정 전에 저장해 두고 싶다. 그래야 잠시 멈췄다가도 작업을 이어갈 수 있다.

#### Acceptance Criteria

1. WHEN the Player가 Save_Action을 수행하면, THE Character_Sheet_App SHALL 공백 제거한 Character_Name, 공백 제거한 각 Narrative_Field 값(컨셉 포함), 현재 Rated_Trait_Set과 Room_Id·Player_Id(그리고 존재하면 Access_Token)를 포함하여 Record_Character_Endpoint에 캐릭터 기록을 요청한다.
2. IF 공백 제거 후의 Character_Name이 비어 있는 상태에서 Save_Action이 수행되면, THEN THE Character_Sheet_App SHALL Record_Character_Endpoint 요청을 보내지 않고 이름 입력이 필요하다는 한국어 안내를 표시하며 입력 값을 보존한다.
3. WHEN Record_Character_Endpoint가 성공 응답을 반환하면, THE Character_Sheet_App SHALL 캐릭터가 저장되었음을 알리는 한국어 확인 표시를 제공하고 캐릭터를 확정 전 편집 가능한 상태(Confirmed_State가 아님)로 유지한다.
4. IF Record_Character_Endpoint가 `NAME_TAKEN` 사유로 거부 응답을 반환하면, THEN THE Character_Sheet_App SHALL 그 이름이 방 안에서 이미 사용 중이라는 한국어 오류 메시지를 표시하고 플레이어가 입력한 Narrative_Field 값(이름·컨셉 포함)과 Rated_Trait_Set을 변경 없이 보존하며 Character_Name 입력 요소를 활성 상태로 유지한다.
5. IF Record_Character_Endpoint가 `INVALID_ATTRIBUTES` 사유로 거부 응답을 반환하면, THEN THE Character_Sheet_App SHALL 평가 항목이 사다리 범위를 벗어났다는 한국어 오류 메시지를 표시하고 플레이어가 입력한 Narrative_Field 값(이름·컨셉 포함)과 Rated_Trait_Set을 변경 없이 보존한다.
6. IF Record_Character_Endpoint가 `ALREADY_CONFIRMED` 사유로 거부 응답을 반환하면, THEN THE Character_Sheet_App SHALL 캐릭터가 이미 확정되어 수정할 수 없다는 한국어 오류 메시지를 표시하고 캐릭터를 Confirmed_State로 표시한다.
7. IF Record_Character_Endpoint가 `UNKNOWN_PLAYER` 사유로 거부 응답을 반환하면, THEN THE Character_Sheet_App SHALL 플레이어 정보를 확인할 수 없어 저장에 실패했다는 한국어 오류 메시지를 표시하고 플레이어가 입력한 Narrative_Field 값(이름·컨셉 포함)과 Rated_Trait_Set을 변경 없이 보존한다.
8. IF Record_Character_Endpoint가 위에 열거되지 않은 거부 사유로 거부 응답을 반환하면, THEN THE Character_Sheet_App SHALL 저장에 실패했다는 한국어 오류 메시지를 표시하고 플레이어가 입력한 Narrative_Field 값(이름·컨셉 포함)과 Rated_Trait_Set을 변경 없이 보존한다.

### Requirement 7: 캐릭터 확정(잠금)

**User Story:** 플레이어로서, 캐릭터가 마음에 들면 확정해서 더 이상 바뀌지 않게 하고 싶다. 그래야 세션에 들어갈 준비를 마칠 수 있다.

#### Acceptance Criteria

1. WHEN the Player가 Confirm_Action을 수행하면, THE Character_Sheet_App SHALL 먼저 앞뒤 공백을 제거한 Character_Name·각 Narrative_Field 값(컨셉 포함)과 현재 Rated_Trait_Set을 Room_Id·Player_Id와 함께 Record_Character_Endpoint에 캐릭터 기록으로 요청한다.
2. WHEN 선행 캐릭터 기록이 성공 응답을 반환하면, THE Character_Sheet_App SHALL Room_Id·Player_Id(그리고 길이가 1자 이상인 Access_Token이 존재하면 그 Access_Token)를 포함하여 Confirm_Character_Endpoint에 캐릭터 확정을 요청한다.
3. IF 선행 캐릭터 기록이 `NAME_TAKEN` 또는 `INVALID_ATTRIBUTES` 사유로 거부 응답을 반환하면, THEN THE Character_Sheet_App SHALL Confirm_Character_Endpoint 요청을 보내지 않고 해당 거부 사유에 대응하는 한국어 오류 메시지를 표시하며 플레이어가 입력한 Narrative_Field 값(이름·컨셉 포함)과 Rated_Trait_Set을 보존한다.
4. IF 선행 캐릭터 기록이 `ALREADY_CONFIRMED` 사유로 거부 응답을 반환하면, THEN THE Character_Sheet_App SHALL Confirm_Character_Endpoint 요청을 보내지 않고 캐릭터가 이미 확정되어 수정할 수 없다는 한국어 오류 메시지를 표시하며 캐릭터를 Confirmed_State로 표시한다.
5. IF Confirm_Character_Endpoint가 `NO_CHARACTER` 사유로 거부 응답을 반환하면, THEN THE Character_Sheet_App SHALL 확정할 캐릭터가 없다는 한국어 오류 메시지를 표시하고 캐릭터를 Confirmed_State로 전이시키지 않으며 플레이어가 입력한 값을 보존한다.
6. IF 앞뒤 공백을 제거한 후의 Character_Name의 길이가 0인 상태에서 Confirm_Action이 수행되면, THEN THE Character_Sheet_App SHALL Record_Character_Endpoint와 Confirm_Character_Endpoint 요청을 모두 보내지 않고 이름 입력이 필요하다는 한국어 안내를 표시하며 입력 값을 보존한다.
7. WHEN Confirm_Character_Endpoint가 성공 응답을 반환하면, THE Character_Sheet_App SHALL 캐릭터를 Confirmed_State로 기록하고, Active_Sheet_Schema가 정의한 모든 Narrative_Field 입력 요소(이름·컨셉 포함)와 모든 Rated_Trait의 평가 편집 요소와 Propose_Action·Save_Action을 비활성(읽기 전용) 상태로 표시한다.
8. WHILE 캐릭터가 Confirmed_State인 동안, THE Character_Sheet_App SHALL 확정된 Character_Name·Narrative_Field 값·Rated_Trait_Set을 읽기 전용으로 표시한다.

### Requirement 8: 확정 후 인계

**User Story:** 플레이어로서, 캐릭터를 확정하면 다음 단계로 넘어가고 싶다. 그래야 친구들과 함께 세션을 이어갈 수 있다.

#### Acceptance Criteria

1. WHEN 캐릭터가 Confirmed_State로 전이하면, THE Character_Sheet_View SHALL Next_Screen으로 진입하는 단일 동작 요소를 활성 상태로 표시한다.
2. WHEN the Player가 Next_Screen 진입 동작을 수행하면, THE Character_Sheet_App SHALL Room_Id와 Player_Id를, 그리고 길이가 1자 이상인 Access_Token이 존재하면 그 Access_Token을, 페이지 URL 쿼리 문자열(`roomId`, `playerId`, `token`) 형태의 Handoff_Params로 Next_Screen에 전달한다.
3. WHEN the Player가 Next_Screen 진입 동작을 수행하면, THE Character_Sheet_App SHALL Next_Screen으로의 인계를 1회만 수행하고, 그 이후 Next_Screen 진입 동작 요소를 비활성 상태로 표시하여 반복 인계를 막는다.
4. WHILE 캐릭터가 Confirmed_State가 아닌 동안, THE Character_Sheet_App SHALL Next_Screen 진입 동작 요소를 비활성 상태로 표시하고 인계를 수행하지 않는다.
5. WHILE the Player가 Next_Screen 진입 동작을 수행하지 않은 상태이면, THE Character_Sheet_App SHALL 보유한 Room_Id·Player_Id·Access_Token을 변경 없이 보존한다.

### Requirement 9: 로딩 및 진행 상태 표시

**User Story:** 플레이어로서, 제안·저장·확정이 처리되는 동안 진행 중임을 알고 싶다. 그래야 멈춘 것으로 오해하거나 중복으로 누르지 않는다.

#### Acceptance Criteria

1. WHEN Attribute_Proposal_Endpoint, Record_Character_Endpoint, 또는 Confirm_Character_Endpoint 요청을 전송하면, THE Character_Sheet_App SHALL 전송 시점부터 200밀리초 이내에, 진행 중이 아닌 상태와 시각적으로 구별되는 진행 인디케이터를 표시한다.
2. WHILE 해당 요청이 전송된 뒤 성공·거부·네트워크 오류·타임아웃 중 어느 것으로도 아직 완료되지 않은 동안, THE Character_Sheet_App SHALL 그 요청의 진행 인디케이터를 계속 표시한다.
3. WHILE 어느 한 요청(Attribute_Proposal_Endpoint, Record_Character_Endpoint, 또는 Confirm_Character_Endpoint)의 진행 인디케이터가 표시되는 동안, THE Character_Sheet_App SHALL Attribute_Proposal_Endpoint·Record_Character_Endpoint·Confirm_Character_Endpoint 요청을 새로 트리거하는 모든 동작 요소(Propose_Action·Save_Action·Confirm_Action)를 비활성 상태로 유지하여 중복 요청 및 동시 요청 전송을 막는다.
4. WHEN 해당 요청이 성공 또는 오류로 완료되면, THE Character_Sheet_App SHALL 완료 시점부터 200밀리초 이내에 그 요청의 진행 인디케이터를 해제하고 3번에서 비활성화했던 동작 요소를 다시 활성화한다. 단, Confirm_Character_Endpoint가 성공한 경우에는 Confirmed_State 규칙(Requirement 7.7)에 따라 작성 컨트롤을 비활성 상태로 유지한다.
5. IF Attribute_Proposal_Endpoint, Record_Character_Endpoint, 또는 Confirm_Character_Endpoint 요청이 전송 후 Request_Timeout(10000밀리초) 이내에 응답을 받지 못하면, THEN THE Character_Sheet_App SHALL 진행 인디케이터를 해제하고 요청이 시간 초과되었음을 나타내는 한국어 오류 표시를 제시하며 3번에서 비활성화했던 동작 요소를 다시 활성화한다.

### Requirement 10: 서버·네트워크·타임아웃 오류 처리

**User Story:** 플레이어로서, 서버나 네트워크 문제가 생기면 그 사실을 알고 다시 시도하고 싶다. 그래야 무엇이 잘못됐는지 모른 채 기다리지 않는다.

#### Acceptance Criteria

1. IF 어떤 백엔드 요청(Attribute_Proposal_Endpoint, Record_Character_Endpoint, Confirm_Character_Endpoint)이든 전송 후 Request_Timeout(10000밀리초) 이내에 응답을 반환하지 않으면, THEN THE Character_Sheet_App SHALL 진행 중인 요청을 취소하고 요청이 시간 초과되었음을 알리는, 네트워크 오류 메시지 및 서버 오류 메시지와 구분되는 한국어 메시지를 표시한다.
2. IF 어떤 백엔드 요청이 응답을 수신하지 못하는 네트워크 오류로 완료되지 못하면, THEN THE Character_Sheet_App SHALL 네트워크 연결 문제로 요청이 실패했음을 알리는, 타임아웃 메시지 및 서버 오류 메시지와 구분되는 한국어 오류 메시지를 표시한다.
3. IF 어떤 백엔드 요청이든 HTTP 상태 코드 500 이상 599 이하로 응답하면, THEN THE Character_Sheet_App SHALL 서버 오류가 발생했음을 알리는, 타임아웃 메시지 및 네트워크 오류 메시지와 구분되는 한국어 메시지를 표시한다.
4. IF 어떤 백엔드 요청이 타임아웃·네트워크·서버(HTTP 500 이상 599 이하) 오류 중 하나로 종료되면, THEN THE Character_Sheet_App SHALL 동일한 입력값으로 그 요청을 다시 전송할 수 있는 단일 동작 요소를 활성 상태로 표시한다.
5. IF 어떤 백엔드 요청이 타임아웃·네트워크·서버(HTTP 500 이상 599 이하) 오류 중 하나로 종료되면, THEN THE Character_Sheet_App SHALL 플레이어가 입력한 Narrative_Field 값(이름·컨셉 포함)과 Rated_Trait_Set과 Room_Id·Player_Id·Access_Token을 변경 없이 보존한다.
6. WHEN the Player가 4번의 재시도 동작 요소를 수행하면, THE Character_Sheet_App SHALL 5번에서 보존한 동일한 입력값으로 직전에 실패한 요청을 1회 다시 전송한다.

### Requirement 11: 공유 접근 토큰 전달

**User Story:** 운영자로서, 서버를 공개로 띄울 때 공유 비밀 토큰으로 보호하고 싶다. 그래야 토큰을 가진 플레이어만 캐릭터를 작성할 수 있다.

#### Acceptance Criteria

1. WHILE 길이가 1자 이상인 Access_Token이 존재하는 동안, WHEN Character_Sheet_App이 Scenario_Sheet_Schema_Endpoint, Attribute_Proposal_Endpoint, Record_Character_Endpoint, Confirm_Character_Endpoint 중 하나로 REST 요청을 전송할 때, THE Character_Sheet_App SHALL 해당 요청의 `x-playtest-token` 헤더에 Access_Token 값을 한 글자도 변경하지 않고 그대로 포함한다.
2. IF Access_Token이 존재하지 않거나 그 값의 길이가 0인 경우, THEN THE Character_Sheet_App SHALL Scenario_Sheet_Schema_Endpoint, Attribute_Proposal_Endpoint, Record_Character_Endpoint, Confirm_Character_Endpoint 요청을 `x-playtest-token` 헤더 없이 전송한다.
3. WHILE 길이가 1자 이상인 Access_Token이 존재하는 동안, WHEN Character_Sheet_App이 Next_Screen으로 인계할 때, THE Character_Sheet_App SHALL 해당 Access_Token 값을 한 글자도 변경하지 않고 그대로 함께 전달한다.
4. IF Access_Token이 존재하지 않거나 그 값의 길이가 0인 경우, THEN THE Character_Sheet_App SHALL Next_Screen 인계 시 Access_Token을 포함하지 않는다.
5. IF Attribute_Proposal_Endpoint, Record_Character_Endpoint, 또는 Confirm_Character_Endpoint 요청이 공유 접근 토큰이 유효하지 않아 인증이 거부되었음을 나타내는 응답으로 종료되면, THEN THE Character_Sheet_App SHALL 토큰이 유효하지 않아 요청이 거부되었다는, 타임아웃·네트워크·서버 오류 메시지와 구분되는 한국어 오류 메시지를 표시하고 플레이어가 입력한 Narrative_Field 값(이름·컨셉 포함)과 Rated_Trait_Set을 변경 없이 보존한다.

### Requirement 12: 반응형 레이아웃과 접근성

**User Story:** 플레이어로서, 휴대폰이든 데스크톱이든 키보드든 편하게 캐릭터를 작성하고 싶다. 그래야 어떤 환경에서도 내 캐릭터를 만들 수 있다.

#### Acceptance Criteria

1. WHERE 뷰포트 너비가 320px 이상 767px 이하인 모바일 환경인 경우, THE Character_Sheet_App SHALL Character_Sheet_View의 Narrative_Field 입력, Rated_Trait 편집, 동작 제어 영역을 세로 단일 열로 배치하고, 콘텐츠가 뷰포트 너비를 초과하여 가로 스크롤바가 나타나지 않도록 한다.
2. WHEN 사용자가 Tab 키 또는 Shift+Tab 키를 누르면, THE Character_Sheet_App SHALL 키보드 포커스를 활성(비활성·읽기 전용이 아닌) 상호작용 가능한 요소 사이에서만 DOM 표시 순서와 동일한 순서로 다음 또는 이전 요소로 이동시키고, 비활성 또는 읽기 전용 상태인 요소는 포커스 이동 대상에서 제외한다.
3. WHILE 상호작용 가능한 요소에 키보드 포커스가 위치한 동안, WHEN 사용자가 Enter 또는 Space 키를 누르면, THE Character_Sheet_App SHALL 해당 요소의 기본 동작을 활성화한다.
4. WHILE 키보드 포커스가 상호작용 가능한 요소에 위치한 동안, THE Character_Sheet_App SHALL 해당 요소의 외곽 경계 전체를 둘러싸는, 인접 배경과 최소 3:1 이상의 명도 대비를 갖는 보이는 포커스 표시를 렌더링하여, 포커스를 가진 단일 요소를 식별할 수 있게 한다.
5. THE Character_Sheet_App SHALL 상호작용 가능한 각 요소에 화면 낭독기가 읽을 수 있는, 공백 제거 후 한 글자 이상이며 요소의 역할과 목적을 식별하는 접근성 레이블을 제공한다.
6. WHEN 오류 또는 상태 변경 메시지가 표시되면, THE Character_Sheet_App SHALL 키보드 포커스를 이동시키지 않고 해당 메시지 텍스트를 화면 낭독기가 자동으로 낭독하도록 라이브 영역을 통해 제공한다.
7. WHERE 뷰포트 너비가 768px 이상인 데스크톱 환경인 경우, THE Character_Sheet_App SHALL Character_Sheet_View의 Narrative_Field 입력, Rated_Trait 편집, 동작 제어 영역을 모두 표시하며 콘텐츠가 뷰포트 너비를 초과하여 가로 스크롤바가 나타나지 않도록 한다.

### Requirement 13: 시나리오 적응형 캐릭터 시트 스키마 로드 및 렌더링

**User Story:** 플레이어로서, 우리가 고른 시나리오에 맞춘 캐릭터 시트를 작성하고 싶다. 그래야 그 이야기에 어울리는 항목만 정하면 되고, 시나리오가 바뀌면 시트도 그에 맞게 달라진다.

#### Acceptance Criteria

1. WHEN 앞뒤 공백을 제거한 후의 Room_Id와 Player_Id가 모두 길이가 1자 이상인 상태로 the Character_Sheet_App가 로드되면, THE Character_Sheet_App SHALL Room_Id(그리고 길이가 1자 이상인 Access_Token이 존재하면 그 Access_Token)를 포함하여 방의 선택 Scenario에 대응하는 Scenario_Sheet_Schema를 Scenario_Sheet_Schema_Endpoint에 요청한다.
2. WHEN Scenario_Sheet_Schema_Endpoint가 Sheet_Section 목록과 하나 이상의 Rated_Trait(각 Rated_Trait는 Trait_Key·표시 레이블·Trait_Ladder를 가짐)와 Narrative_Field 정의를 담은 유효한 Scenario_Sheet_Schema를 성공 응답으로 반환하면, THE Character_Sheet_App SHALL 그 Scenario_Sheet_Schema를 Active_Sheet_Schema로 채택한다.
3. WHEN the Character_Sheet_App가 Active_Sheet_Schema를 채택하면, THE Character_Sheet_View SHALL 그 Active_Sheet_Schema가 정의한 Sheet_Section·Narrative_Field 입력 요소·Rated_Trait 평가 편집 요소만을 렌더링하고, 그 스키마에 정의되지 않은 Sheet_Section·Narrative_Field·Rated_Trait는 렌더링하지 않는다.
4. WHEN the Character_Sheet_App가 어떤 Active_Sheet_Schema를 채택하여 렌더링하면, THE Character_Sheet_App SHALL 렌더링된 Sheet_Section 집합·Rated_Trait 평가 편집 요소 집합(Trait_Key 기준)·Narrative_Field 입력 요소 집합(식별자 기준)이 각각 그 Active_Sheet_Schema가 정의한 Sheet_Section·Rated_Trait·Narrative_Field 집합과 개수와 식별자 모두에서 정확히 일치하게 렌더링하여, 서로 다른 두 Active_Sheet_Schema가 서로 다른 구성을 정의하면 그에 대응해 렌더링 결과도 서로 다르게 한다.
5. IF Scenario_Sheet_Schema_Endpoint가 성공 응답을 반환했으나 그 Scenario_Sheet_Schema가 Rated_Trait를 하나도 정의하지 않거나, 어떤 Rated_Trait가 Trait_Key 또는 Trait_Ladder를 갖지 않으면(유효하지 않은 스키마), THEN THE Character_Sheet_App SHALL 그 응답을 채택하지 않고 Default_Sheet_Schema를 Active_Sheet_Schema로 사용한다.
6. IF Scenario_Sheet_Schema_Endpoint 요청이 타임아웃(Request_Timeout 10000밀리초)·네트워크·서버(HTTP 500 이상 599 이하) 오류로 종료되거나 Scenario_Sheet_Schema_Endpoint를 호출할 수 없으면, THEN THE Character_Sheet_App SHALL Default_Sheet_Schema를 Active_Sheet_Schema로 채택하고, 시나리오 맞춤 시트를 불러오지 못해 기본 시트를 사용한다는 한국어 안내를 표시하며 플레이어가 작성을 계속할 수 있게 한다.
7. THE Character_Sheet_App SHALL 어느 시점에서나 정확히 하나의 Active_Sheet_Schema를 보유하며, 그 Active_Sheet_Schema는 채택된 유효한 Scenario_Sheet_Schema이거나 Default_Sheet_Schema 중 하나다.
8. WHERE Active_Sheet_Schema가 Default_Sheet_Schema인 경우, THE Character_Sheet_App SHALL 네 Attribute_Key(Might, Agility, Wits, Spirit)를 Attribute_Ladder `[-2, +4]`의 Rated_Trait로, Character_Name과 Character_Concept을 Narrative_Field로 갖는 구성을 렌더링한다.
9. WHEN the Character_Sheet_App가 Scenario_Sheet_Schema_Endpoint 요청을 전송하면, THE Character_Sheet_App SHALL 전송 시점부터 200밀리초 이내에 진행 중이 아닌 상태와 시각적으로 구별되는 진행 인디케이터를 표시하고, 그 요청이 성공·유효하지 않은 스키마·타임아웃·네트워크·서버 오류 중 어느 것으로 완료되든 완료 시점부터 200밀리초 이내에 그 진행 인디케이터를 해제한다.
