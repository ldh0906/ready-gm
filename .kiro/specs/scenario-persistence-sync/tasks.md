# Implementation Plan: 시나리오 추가 영속 매퍼 동기화 (scenario-persistence-sync)

## Overview

이 계획은 `Scenario` 엔터티에 추가된 두 선택 필드(`allocation?: AllocationRule`, `attributeProposalDisabled?: boolean`)를 영속 계층 세 곳 — SQL 마이그레이션, 순수 매퍼, Postgres 리포지토리 — 에 가산적으로 반영해 라운드 트립이 더 이상 두 필드를 누락하지 않게 한다. 동시에 세 위치의 컬럼 정렬을 단일 `SCENARIO_INSERT_COLUMNS` 상수로 묶고 arity 회귀 가드로 보호한다.

작업은 다음 네 곳을 변경한다.
- **마이그레이션**(`migrations/0004_scenario_allocation.sql`): `0003` 스타일의 멱등 `ADD COLUMN IF NOT EXISTS`로 `allocation jsonb`(nullable)과 `attribute_proposal_disabled boolean NOT NULL DEFAULT false`를 추가한다.
- **순수 매퍼**(`src/persistence/mappers.ts`): `scenarioToRow`/`rowToScenario`가 두 필드를 verbatim·부재 보존으로 라운드 트립하도록 확장하고, Column_Ordering_Convention 주석을 남긴다.
- **리포지토리**(`src/persistence/pg-scenario-repository.ts`): `SCENARIO_INSERT_COLUMNS` 상수를 export 하고, `saveScenario`의 INSERT + `ON CONFLICT DO UPDATE`에 두 컬럼/파라미터(`$10::jsonb`, `$11`)를 추가한다.
- **테스트**(`src/persistence/mappers.test.ts`): 라운드 트립 속성·arity 가드·예제 테스트를 추가하되 기존 테스트를 보존한다.

설계의 Correctness Property 1~2는 각각 **정확히 하나의** 속성 기반 테스트(`fast-check`)가 되며, 최소 100회 반복(`numRuns: 100`)으로 실행하고 다음 태그를 주석으로 단다: `Feature: scenario-persistence-sync, Property {N}: {속성 텍스트}`. 마이그레이션 DDL·리포지토리 SQL 텍스트·`::jsonb` 캐스트·주석 규약·기존 동작 보존은 예제·통합 테스트로 다룬다.

구현 언어/스택은 설계가 명시한 TypeScript(`src/persistence`)와 SQL(`migrations`)이므로 별도 언어 선택은 필요하지 않다. 변경은 전부 가산적이며 기존 9개 컬럼 동작과 다른 엔터티 매핑·프론트엔드(`public/*`)는 손대지 않는다. Windows cmd 셸이 명령 첫 글자를 누락하므로 모든 빌드/테스트 명령은 `& ` 접두사를 붙인다.

## Tasks

- [x] 1. 마이그레이션 추가 (`migrations/0004_scenario_allocation.sql`)
  - [x] 1.1 멱등 ADD COLUMN 마이그레이션 작성
    - `0003_scenario_metadata.sql`의 헤더 주석·요구사항 주석 스타일을 따라 `migrations/0004_scenario_allocation.sql`을 새로 만든다
    - `ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS allocation JSONB, ADD COLUMN IF NOT EXISTS attribute_proposal_disabled BOOLEAN NOT NULL DEFAULT false;`를 작성한다(`allocation`은 NULL 허용·기본값 없음, `attribute_proposal_disabled`는 NOT NULL DEFAULT false)
    - 기존 9개 컬럼을 DROP/ALTER 하지 않는다(가산적)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 1.2 마이그레이션 텍스트 예제 테스트 작성
    - `0004` 파일이 두 컬럼을 올바른 타입/제약으로 `ADD COLUMN IF NOT EXISTS` 하고, 기존 9개 컬럼에 대한 DROP/ALTER가 없음을 단언하는 예제 테스트를 작성한다
    - (선택) 실제 Postgres가 가용하면 2회 적용 멱등성과 `information_schema.columns` 타입/nullability를 확인하는 통합 테스트를 추가한다
    - _Requirements: 1.1, 1.2, 1.4_

- [x] 2. 리포지토리 컬럼 목록 상수와 saveScenario 확장 (`src/persistence/pg-scenario-repository.ts`)
  - [x] 2.1 `SCENARIO_INSERT_COLUMNS` 상수 export 와 INSERT/ON CONFLICT 확장
    - 정렬된 컬럼 목록 상수 `export const SCENARIO_INSERT_COLUMNS = [...9개..., "allocation", "attribute_proposal_disabled"] as const;`를 추가한다(기존 9개 순서 보존 + 새 두 컬럼 tail)
    - `saveScenario`의 INSERT 컬럼 목록에 `allocation`, `attribute_proposal_disabled`를 추가하고 `VALUES`에 `$10::jsonb, $11`을 추가한다(`scenarioToRow` 출력과 위치 정렬)
    - `ON CONFLICT (id) DO UPDATE SET`에 `allocation = EXCLUDED.allocation`, `attribute_proposal_disabled = EXCLUDED.attribute_proposal_disabled`를 추가한다
    - 기존 9개 컬럼 동작과 `listScenarios`·`getScenario`·`getSelection`·`setSelection`을 변경하지 않는다
    - Column_Ordering_Convention 요약 주석을 `saveScenario` 위에 남긴다
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2_

  - [ ]* 2.2 리포지토리 SQL 예제 테스트 작성
    - `saveScenario`가 만드는 INSERT SQL에 `allocation`·`attribute_proposal_disabled` 컬럼, `$10::jsonb` 캐스트, `ON CONFLICT DO UPDATE`의 두 `EXCLUDED` 갱신이 포함됨을 단언한다
    - `SCENARIO_INSERT_COLUMNS`의 처음 9개가 기존 9개 컬럼과 정확히 일치하고 마지막 두 개가 새 컬럼임을 단언한다
    - _Requirements: 4.1, 4.2, 4.3, 5.2_

- [x] 3. 매퍼 라운드 트립 확장 (`src/persistence/mappers.ts`)
  - [x] 3.1 `scenarioToRow`·`rowToScenario`에 두 필드 추가
    - `scenarioToRow`: 기존 9개 값 뒤에 인덱스 9(`allocation` 있으면 `toJsonParam(scenario.allocation)`, 부재하면 `null`)와 인덱스 10(`scenario.attributeProposalDisabled === true`)를 가산적으로 추가한다
    - `rowToScenario`: `allocation` 컬럼이 `null`/`undefined`가 아니면 `parseJsonColumn`으로 복원해 부여하고 그 외에는 키를 생략한다. `attribute_proposal_disabled`가 `true`이면 `attributeProposalDisabled: true`를 부여하고 그 외에는 키를 생략한다
    - 매퍼는 `allocation` 구조를 검증하지 않고 예외를 던지지 않는다(verbatim)
    - `scenarioToRow`·`rowToScenario` 위에 Scenario_Column_List 정렬표(Column_Ordering_Convention) 주석을 남긴다
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 5.1, 5.3_

  - [ ]* 3.2 Property 1 속성 테스트 작성
    - **Property 1: 시나리오 매핑 라운드 트립 항등 (verbatim · 부재 보존)**
    - Scenario 생성기(두 필드 유무 모든 조합 + `allocation`에 유효·부분·무효 JSON)와 `rowFromColumns` 헬퍼(문자열·객체 두 jsonb 경로)로, `rowToScenario(rowFromColumns(scenarioToRow(s)))`가 예외 없이 9개 기존 필드 동등·`allocation` deep-equal/부재 보존·`attributeProposalDisabled` true 보존/false·부재 키 생략을 만족함을 검증
    - 태그 주석: `Feature: scenario-persistence-sync, Property 1: 시나리오 매핑 라운드 트립 항등 (verbatim · 부재 보존)`, `numRuns: 100`
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 6.1**

  - [ ]* 3.3 Property 2 속성 테스트 작성 (arity 가드)
    - **Property 2: 컬럼/파라미터 arity 정렬 불변식**
    - 임의 Scenario 생성기로 `scenarioToRow(s).length === SCENARIO_INSERT_COLUMNS.length`가 항상 성립하고, `SCENARIO_INSERT_COLUMNS`의 처음 9개가 기존 컬럼·순서와 같고 마지막 두 개가 `allocation`·`attribute_proposal_disabled`임을 검증
    - 태그 주석: `Feature: scenario-persistence-sync, Property 2: 컬럼/파라미터 arity 정렬 불변식`, `numRuns: 100`
    - **Validates: Requirements 4.4, 5.3**

  - [ ]* 3.4 기존 보존·신규 예제 테스트 작성
    - 기존 `the-sunless-crypt`(두 필드 부재) 시나리오 라운드 트립이 두 필드 모두 부재로 구조 동등함을 예제로 검증(요구사항 6.1, 6.2)
    - 기존 9개 컬럼 INSERT 형태와 `Room`·`Player`·`Character` 등 다른 매핑이 변경되지 않았음을 기존 테스트가 그대로 통과함으로 확인(요구사항 4.5, 6.2, 6.3)
    - `allocation` 명시값(유효 `AllocationRule`)·무효 부분 JSON이 verbatim 보존되고, `attributeProposalDisabled: true`/명시적 `false`가 각각 true 보존/키 생략됨을 예제로 검증(요구사항 2.5, 3.2, 3.4)
    - _Requirements: 2.5, 3.2, 3.4, 4.5, 6.1, 6.2, 6.3_

- [x] 4. 최종 체크포인트 - 빌드·테스트 통과 확인
  - `& npm run build`로 `src/` 타입체크/컴파일이 통과하는지 확인한다
  - `& npx vitest run src/persistence/`로 영속 계층 테스트(라운드 트립·arity·예제)가 통과하는지 확인하고, 이어서 `& npx vitest run`으로 전체 스위트(기존 매퍼·다른 엔터티 테스트 포함)가 회귀 없이 통과하는지 확인한다
  - 모든 테스트가 통과하는지 확인하고, 의문이 생기면 사용자에게 질문한다

## Notes

- `*`로 표시된 하위 작업은 선택 사항(테스트)이며 빠른 MVP를 위해 건너뛸 수 있다. 핵심 구현 작업(1.1, 2.1, 3.1)은 표시되지 않으며 반드시 구현한다.
- Correctness Property 1~2는 각각 정확히 하나의 속성 기반 테스트로 구현되며, 구현 직후 가까운 위치(`src/persistence/mappers.test.ts`)에 배치해 오류를 조기에 잡는다.
- 모든 속성 테스트는 `numRuns: 100` 이상으로 실행하고 `Feature: scenario-persistence-sync, Property {N}: {텍스트}` 태그를 주석으로 단다.
- 마이그레이션 멱등성(1.2)·SQL 텍스트(4.1·4.2·4.3)·주석 규약(5.1)·기존 동작 보존(4.5·6.2·6.3) 등 속성으로 다루지 않는 요구사항은 예제·통합 테스트(1.2, 2.2, 3.4)로 검증한다.
- 변경은 전부 가산적(additive)이다 — 기존 9개 컬럼의 정의·순서·동작과 기존 `mappers.test.ts`를 깨지 않는다. 프론트엔드 `public/*`는 손대지 않는다.
- `arity 가드`(Property 2)는 미래에 누군가 `Scenario`에 필드를 추가하고 `scenarioToRow`·`SCENARIO_INSERT_COLUMNS` 중 한 곳만 갱신하면 시끄럽게 실패하게 만드는 회귀 보호다(요구사항 5.4).
- Windows cmd 셸은 명령 첫 글자를 누락하므로 모든 명령에 `& ` 접두사를 붙인다(예: `& npm run build`, `& npx vitest run src/persistence/`).
- 각 작업은 추적성을 위해 구체적인 요구사항 절을 참조한다.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 3, "tasks": ["4"] }
  ]
}
```
