# Requirements Document

## Introduction

ready-gm은 친구들과 함께 즐기는 멀티플레이 TRPG 원샷 세션을 AI GM이 진행해 주는 웹 플랫폼입니다. 본 스펙은 **시나리오 엔터티(`Scenario`)에 새 필드가 추가될 때 영속 계층(persistence layer)이 함께 동기화되도록 보장**하는 하나의 횡단 관심사에 집중합니다. 구체적으로는 SQL 마이그레이션, 순수 행<->엔터티 매퍼(row<->entity mapper), Postgres 리포지토리의 INSERT/UPDATE 문이 `Scenario` 인터페이스와 일관되게 유지되도록 만듭니다.

이 문제는 가설이 아니라 **현재 코드베이스에 존재하는 실제 드리프트(drift) 버그**입니다. 두 선행 스펙(`flexible-stat-allocation`, `scenario-character-cards`)이 `Scenario` 인터페이스에 **선택 필드(optional field)** 두 개를 추가했지만, 이 필드들은 아직 영속화되지 않습니다.

### 영속 드리프트의 실제 코드 근거 (확인됨)

- **시나리오 엔터티**(`src/services/scenario-service.ts`): `Scenario` 인터페이스에 `allocation?: AllocationRule`과 `attributeProposalDisabled?: boolean` 두 선택 필드가 추가되어 있다. 두 필드 모두 선택(optional)이며, 작성자 데이터(authored data)는 부분적·무효일 수 있으므로 **신뢰할 수 없는 입력(untrusted input)** 으로 취급한다.
- **순수 매퍼**(`src/persistence/mappers.ts`): `scenarioToRow(scenario)`는 9개 컬럼(`id`, `title`, `summary`, `opening_seed`, `ending_condition`, `genre`, `category`, `has_special_rules`, `system`)만 반환하고, `rowToScenario(row)`는 그 9개만 읽는다. `allocation`과 `attributeProposalDisabled` 어느 것도 매핑하지 않는다. 따라서 Postgres를 거치는 라운드 트립(round-trip)이 이 두 필드를 **조용히 누락(silently drop)** 한다.
- **마이그레이션**(`migrations/0003_scenario_metadata.sql`): `genre`/`category`/`has_special_rules`/`system` 컬럼을 추가했다. `allocation`이나 `attribute_proposal_disabled`에 해당하는 컬럼은 **없다**.
- **Postgres 리포지토리**(`src/persistence/pg-scenario-repository.ts`): `saveScenario`의 INSERT가 동일한 9개 컬럼을 나열하고 `ON CONFLICT DO UPDATE`로 갱신한다. 두 새 필드가 빠져 있다.
- **매퍼 테스트**(`src/persistence/mappers.test.ts`): 시나리오 매핑에 대한 기존 라운드 트립 테스트가 존재한다.

본 스펙은 이 드리프트를 **가산적(additive)** 으로 해소합니다. 기존 9개 컬럼의 동작과 기존 매퍼 테스트를 깨지 않으면서, 두 새 필드를 마이그레이션·매퍼·리포지토리 세 곳에 모두 반영하고, **앞으로 새 필드가 한 곳에만 추가되고 다른 곳에 빠졌을 때 시끄럽게(loudly) 실패하는 회귀 가드(regression guard)** 를 세웁니다.

## 범위 밖 / 가정 (Assumptions)

- **프론트엔드는 손대지 않는다**: `public/*`(정적 프론트엔드)는 본 스펙의 대상이 아니다. 본 스펙은 영속/서버 계층(`src/persistence/*`, `migrations/*`)만 변경한다.
- **매퍼는 순수하다(purity)**: 매퍼는 `pg` 의존성이 없고 도메인 규칙(예: `allocation`이 유효한 `AllocationRule`인지)을 검증하지 않는다. 정규화(normalization)는 다른 계층(`normalizeAllocationRule`)이 담당한다. 매퍼는 들어온 값을 변형 없이(verbatim) 저장·복원한다.
- **무작위는 본 스펙과 무관하다**: 본 스펙은 결정적(deterministic) 매핑/스키마만 다룬다.
- **마이그레이션 적용 엔진은 기존 그대로**: 마이그레이션 파일을 적용하는 러너 자체는 본 스펙 범위 밖이며, 마이그레이션 SQL은 `0003`의 스타일을 따라 멱등(idempotent)하게 작성한다.
- **`allocation` 컬럼 형태**: `allocation`은 `jsonb`로 저장하며 부재 시 `NULL`을 저장한다. 매퍼는 기존 `toJsonParam`/`parseJsonColumn` 헬퍼를 재사용한다.
- **`attribute_proposal_disabled` 컬럼 형태**: 불리언이며 `NOT NULL DEFAULT false`이다. 선택 필드의 인메모리 동작과 일관되게, 부재(`undefined`)와 `false`는 같은 의미(기본값)로 취급한다.

## Glossary

- **Scenario_Persistence_Sync**: 본 스펙이 정의하는, `Scenario` 엔터티와 영속 계층(마이그레이션·매퍼·리포지토리) 사이의 동기화를 보장하는 시스템.
- **Scenario**: 사전 작성된 원샷 어드벤처 엔터티(`src/services/scenario-service.ts`의 `Scenario` 인터페이스). 9개 기존 필드와 2개 신규 선택 필드(`allocation?`, `attributeProposalDisabled?`)를 갖는다.
- **Allocation_Rule**: 능력치 배분 규칙을 표현하는 판별 유니온(`AllocationRule`, `src/services/sheet-schema.ts`). `Scenario.allocation`의 타입. 작성자 데이터는 부분적·무효일 수 있다.
- **Attribute_Proposal_Disabled**: `Scenario.attributeProposalDisabled` 선택 불리언. `true`이면 AI 능력치 제안을 비활성화하는 입력. 부재 또는 `false`는 같은 기본 동작을 뜻한다.
- **Scenario_Mapper**: `src/persistence/mappers.ts`의 `scenarioToRow`(엔터티→정렬된 컬럼 값 배열)와 `rowToScenario`(DB 행→엔터티) 한 쌍의 순수 함수.
- **scenarioToRow**: `Scenario`를 INSERT/UPDATE용 정렬된 파라미터 배열로 변환하는 순수 함수.
- **rowToScenario**: DB 행(`QueryResultRow`)을 `Scenario` 엔터티로 복원하는 순수 함수.
- **Pg_Scenario_Repository**: `src/persistence/pg-scenario-repository.ts`의 `PgScenarioRepository`. `saveScenario`의 INSERT + `ON CONFLICT DO UPDATE`로 시나리오 카탈로그를 업서트(upsert)한다.
- **Scenario_Migration**: 시나리오 테이블 스키마를 변경하는 SQL 마이그레이션. 본 스펙은 `migrations/0004_scenario_allocation.sql`을 추가한다.
- **Scenario_Column_List**: `scenarios` 테이블에서 한 시나리오 행을 구성하는 컬럼들의 정렬된 목록. `scenarioToRow` 출력 순서·마이그레이션 컬럼 추가 순서·리포지토리 INSERT 컬럼 순서가 모두 이 정렬에 정렬(aligned)되어야 한다.
- **Column_Ordering_Convention**: `Scenario_Column_List`의 정렬 규칙. 기존 9개 컬럼을 그대로 두고 새 컬럼을 끝(tail)에 가산적으로 추가하며, 세 위치(`scenarioToRow`·마이그레이션·리포지토리 INSERT)가 동일한 순서를 유지한다.
- **Round_Trip**: 한 `Scenario`를 `scenarioToRow`로 컬럼 값 배열로 변환하고, 그 값들을 컬럼명에 결합해 행을 만든 뒤 `rowToScenario`로 다시 엔터티로 복원하는 과정.
- **Column_Param_Arity_Guard**: `scenarioToRow`가 산출하는 값 개수가 리포지토리 INSERT가 기록하는 컬럼 개수와 같은지 단언하는 회귀 테스트.
- **toJsonParam / parseJsonColumn**: `mappers.ts`의 기존 JSON 직렬화/역직렬화 헬퍼.

## Requirements

### Requirement 1: allocation·attribute_proposal_disabled 컬럼을 추가하는 멱등 마이그레이션

**User Story:** 운영자로서, 시나리오 테이블에 `allocation`과 `attribute_proposal_disabled` 컬럼을 안전하게 추가하고 싶다. 그래야 새 시나리오 필드를 손실 없이 저장할 수 있다.

#### Acceptance Criteria

1. THE Scenario_Persistence_Sync SHALL `migrations/0004_scenario_allocation.sql` 마이그레이션 파일을 제공하여 `scenarios` 테이블에 `jsonb`이며 NULL을 허용하는 `allocation` 컬럼과, 불리언이며 `NOT NULL DEFAULT false`인 `attribute_proposal_disabled` 컬럼을 추가한다.
2. THE Scenario_Migration SHALL `ADD COLUMN IF NOT EXISTS`를 사용하여 동일한 마이그레이션을 두 번 이상 적용해도 오류 없이 동일한 스키마 상태에 도달하게 한다(멱등성).
3. THE Scenario_Migration SHALL 기존 `0003_scenario_metadata.sql`의 헤더 주석·`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 형식·요구사항 주석 스타일을 따른다.
4. THE Scenario_Migration SHALL `scenarios` 테이블의 기존 9개 컬럼(`id`, `title`, `summary`, `opening_seed`, `ending_condition`, `genre`, `category`, `has_special_rules`, `system`)의 정의를 변경하지 않는다.

### Requirement 2: 매퍼의 allocation 필드 라운드 트립

**User Story:** 개발자로서, 시나리오의 `allocation` 필드가 Postgres를 거쳐도 변형 없이 보존되길 바란다. 그래야 시나리오별 배분 규칙이 영속화 과정에서 사라지지 않는다.

#### Acceptance Criteria

1. WHEN a Scenario에 `allocation` 필드가 존재하면, THE scenarioToRow SHALL 그 `allocation` 값을 `toJsonParam`으로 직렬화한 `jsonb` 파라미터를 `Scenario_Column_List`의 `allocation` 위치에 포함시킨다.
2. IF a Scenario에 `allocation` 필드가 부재하면(`undefined`), THEN THE scenarioToRow SHALL `allocation` 위치에 `null`을 포함시킨다.
3. WHEN a row의 `allocation` 컬럼이 비어 있지 않은 값을 담으면, THE rowToScenario SHALL `parseJsonColumn`으로 그 값을 복원하여 복원된 Scenario의 `allocation` 필드에 변형 없이(verbatim) 부여한다.
4. IF a row의 `allocation` 컬럼이 `null`이면, THEN THE rowToScenario SHALL 복원된 Scenario에서 `allocation` 키를 부여하지 않는다(부재 유지).
5. THE Scenario_Mapper SHALL `allocation` 값의 구조가 유효한 `Allocation_Rule`인지 검증하지 않고, 부분적이거나 무효한 값도 변형 없이 저장·복원한다.

### Requirement 3: 매퍼의 attribute_proposal_disabled 필드 라운드 트립

**User Story:** 개발자로서, 시나리오의 `attributeProposalDisabled` 플래그가 Postgres를 거쳐도 의미가 보존되길 바란다. 그래야 능력치 제안 비활성화 설정이 손실되지 않는다.

#### Acceptance Criteria

1. WHEN a Scenario의 `attributeProposalDisabled` 필드가 `true`이면, THE scenarioToRow SHALL `Scenario_Column_List`의 `attribute_proposal_disabled` 위치에 불리언 `true`를 포함시킨다.
2. IF a Scenario의 `attributeProposalDisabled` 필드가 부재(`undefined`)하거나 `false`이면, THEN THE scenarioToRow SHALL `attribute_proposal_disabled` 위치에 불리언 `false`를 포함시킨다.
3. WHEN a row의 `attribute_proposal_disabled` 컬럼이 `true`이면, THE rowToScenario SHALL 복원된 Scenario의 `attributeProposalDisabled` 필드를 `true`로 부여한다.
4. IF a row의 `attribute_proposal_disabled` 컬럼이 `false`이면, THEN THE rowToScenario SHALL 복원된 Scenario에서 `attributeProposalDisabled` 키를 부여하지 않는다(부재 유지).

### Requirement 4: 리포지토리 saveScenario의 두 신규 컬럼 반영

**User Story:** 개발자로서, 시나리오를 저장할 때 두 신규 필드가 INSERT와 UPDATE 모두에 기록되길 바란다. 그래야 업서트가 시나리오의 모든 필드를 영속화한다.

#### Acceptance Criteria

1. THE Pg_Scenario_Repository SHALL `saveScenario`의 INSERT 컬럼 목록에 `allocation`과 `attribute_proposal_disabled`를 포함시키고, 그 위치 파라미터를 `scenarioToRow` 출력의 대응 위치와 정렬한다.
2. THE Pg_Scenario_Repository SHALL `saveScenario`의 `ON CONFLICT (id) DO UPDATE SET` 절에 `allocation = EXCLUDED.allocation`과 `attribute_proposal_disabled = EXCLUDED.attribute_proposal_disabled`를 포함시킨다.
3. THE Pg_Scenario_Repository SHALL `allocation` 파라미터를 `::jsonb`로 캐스트하여 `jsonb` 컬럼에 저장한다.
4. THE Pg_Scenario_Repository SHALL `saveScenario`가 기록하는 컬럼 개수를 `scenarioToRow`가 산출하는 값 개수와 정확히 같게 유지한다.
5. THE Pg_Scenario_Repository SHALL 기존 9개 컬럼의 INSERT·UPDATE 동작과 `listScenarios`·`getScenario`·`getSelection`·`setSelection`의 동작을 변경하지 않는다.

### Requirement 5: 컬럼/파라미터 정렬 규약과 회귀 가드

**User Story:** 개발자로서, 앞으로 어떤 개발자가 `Scenario`에 새 필드를 추가하고 세 위치 중 한 곳만 갱신해도 테스트가 시끄럽게 실패하길 바란다. 그래야 영속 드리프트가 조용히 재발하지 않는다.

#### Acceptance Criteria

1. THE Scenario_Persistence_Sync SHALL `scenarioToRow` 출력 순서, `Scenario_Migration`의 컬럼 추가 순서, `Pg_Scenario_Repository` INSERT 컬럼 순서가 동일한 `Scenario_Column_List` 정렬을 따르도록 하는 Column_Ordering_Convention을 코드 주석으로 명시한다.
2. THE Column_Ordering_Convention SHALL 기존 9개 컬럼의 순서를 보존하고 새 컬럼을 목록 끝(tail)에 가산적으로 추가하는 규칙을 정의한다.
3. THE Column_Param_Arity_Guard SHALL `scenarioToRow`가 산출하는 값 개수가 `Pg_Scenario_Repository`의 `saveScenario` INSERT가 기록하는 컬럼 개수와 같은지 단언하는 회귀 테스트로 제공된다.
4. IF a future field가 `scenarioToRow`에만 추가되고 `Pg_Scenario_Repository` INSERT 컬럼 목록에는 추가되지 않으면(또는 그 반대이면), THEN THE Column_Param_Arity_Guard SHALL 실패한다.

### Requirement 6: 기존 동작 보존과 가산성

**User Story:** 운영자로서, 이 변경이 기존 시나리오 저장/조회 동작을 깨지 않길 바란다. 그래야 안전하게 배포할 수 있다.

#### Acceptance Criteria

1. WHEN `allocation`과 `attributeProposalDisabled`가 모두 부재한 기존 형태의 Scenario에 대해 Round_Trip을 수행하면, THE Scenario_Mapper SHALL 두 필드가 모두 부재한 구조적으로 동등한 Scenario를 복원한다.
2. THE Scenario_Persistence_Sync SHALL 기존 `mappers.test.ts`의 시나리오 매핑 라운드 트립 테스트를 깨지 않고 통과시킨다.
3. THE Scenario_Mapper SHALL `Room`·`Player`·`Character`·`SessionSummary`·`TurnState`·`QaEvent`의 매핑 동작을 변경하지 않는다.
