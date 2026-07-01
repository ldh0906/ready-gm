---
inclusion: manual
---

# 런북: 시나리오 + 캐릭터 시트 추가

원샷 시나리오를 하나 추가할 때 따르는 고정 절차다. 이 문서를 `#adding-scenarios`로 불러
"시나리오 X 추가 (장르=…, 특수룰=유/무)"라고 지시하면 아래 단계를 그대로 수행한다.
재유도(re-derivation) 없이 토큰을 아끼는 것이 목적이다.

## 0. 먼저 결정할 것 (한 줄 입력)

- **장르 / 카테고리**: 예) "코미디 / 코미디 소동극", "호러·미스터리 / 호러·미스터리".
- **특수룰 여부 (hasSpecialRules)**:
  - **무(無)** → 범용 EZFudge 시트(`UNIVERSAL_SHEET`)를 그대로 쓴다. 시트 작업 없음.
  - **유(有)** → 전용 시트를 새로 만든다(아래 3단계).
- **시스템 이름(system)**: 예) "EZFudge", "D6 다이스 풀", "카드 기반(GM리스)".
- 전용 시트면 **스탯 구성**: 키·라벨·사다리(min,max), 추가 서사 필드(있으면).

## 1. 시나리오 카탈로그에 추가 — `src/services/scenario-service.ts`

`Scenario`는 다음 필드를 모두 채워야 한다(누락 시 빌드 실패):
`id, title, summary, openingSeed, endingCondition, genre, category, hasSpecialRules, system`.

1. 새 `export const SCENARIO_NAME: Scenario = { ... }` 추가. id는 kebab-case.
2. `DEMO_SCENARIO_CATALOG` 배열에 추가한다(로비 콤보박스/플레이테스트에 노출됨).
3. `MVP_SCENARIO_CATALOG`는 건드리지 않는다(단일 시나리오 기본 선택 의미 유지).

## 2. 특수룰 없음 → 여기서 끝

`sheetSchemaForScenario`가 `hasSpecialRules: false`인 시나리오를 `UNIVERSAL_SHEET`로
자동 매핑한다. 프런트엔드/저장 검증 모두 그대로 동작한다. 4단계(테스트)로 간다.

## 3. 특수룰 있음 → 전용 시트 정의 — `src/services/sheet-schema.ts`

시트 JSON 계약(화면이 소비):
```
{
  scenarioId?, genre, category, hasSpecialRules, system,
  sections: [{ id, label }],
  narrativeFields: [{ id, label, guidance, sectionId, maxLength }],  // 반드시 id "name"(maxLength 100) + "concept"(maxLength 2000) 포함
  traits: [{ key, label, sectionId, ladder:{min,max}, rungLabels? }] // 빈 배열 허용(서사 전용 시트)
}
```

단계:
1. 새 `export const XXX_SHEET: SheetSchema = { ... }` 추가.
   - 스탯이 있으면 `traits`에 `{key,label,sectionId:"attributes",ladder,rungLabels?}` 나열.
     - 사다리가 EZFudge 기본 `[-2,4]`가 아니면 `rungLabels`를 제공(없으면 숫자로 표시됨).
   - **무스탯(서사 전용)**이면 `traits: []`, 섹션은 `[{id:"narrative",label:"인물"}]` 정도,
     서사 필드(name, concept, + 역할/태도/목표 등)만 둔다.
   - `narrativeFields`에는 **항상 name(100)·concept(2000)을 포함**한다(프런트 검증 필수).
2. `CUSTOM_SHEETS_BY_SCENARIO_ID`에 `"scenario-id": XXX_SHEET` 매핑 추가.
   - `sheetSchemaForScenario`/`expectedTraitSpecForScenario`는 이 맵을 보고 자동 동작한다.
   - `expectedTraitSpecForScenario`는 첫 trait의 사다리를 공통 사다리로 본다(시트 내 사다리 통일 권장).

## 4. 테스트 — `src/services/sheet-schema.test.ts`

- 새 시트 상수의 traits/narrativeFields 단언 추가(특수룰일 때).
- `sheetSchemaForScenario(NEW_SCENARIO)`가 올바른 시트로 매핑되고 메타데이터가 주입되는지.
- `expectedTraitSpecForScenario`가 기대 keys/ladder를 돌려주는지.
- 무스탯 시트면 `traits === []` 확인.

## 5. 프런트엔드: 변경 불필요(대개)

`public/character/logic.js`의 `validateSchema`/`renderModel`은 이미
**커스텀 스탯 키 + 비기본 사다리 + 무스탯(빈 traits)**을 지원한다. 시트 모양만 맞으면 렌더된다.
(스탯 사다리가 `[-2,4]`가 아니면 `rungLabels`로 라벨이 나오고, 없으면 숫자 표시.)

## 6. AI 제안(proposal) 동작 — `src/server.ts`

- **EZFudge 4스탯(Might/Agility/Wits/Spirit)** 시나리오 → 실제 AI(`engine.coordinator.proposeAttributes`) 호출.
- **그 외(커스텀 스탯/무스탯)** → 결정적 휴리스틱(`proposeAttributes(concept, keys, ladder)`)으로 폴백.
  - 휴리스틱에 새 스탯 키의 테마 키워드를 추가하고 싶으면 `proposeAttributes`의 `bump(...)` 블록에 한 줄 추가.
- 별도 배선은 필요 없다. `expectedTraitSpecForScenario`가 키/사다리를 공급한다.

## 7. 검증 (셸은 명령 첫 글자를 떨어뜨릴 수 있어 `& ` 또는 선행 공백을 붙인다)

1. `& npx vitest run src/services` — 단위/스키마 테스트 통과.
2. `& npm run build` — 타입 통과(영속 매퍼는 Scenario 필드를 라운드트립하므로 새 필드 추가 시 함께 갱신: `migrations/`, `src/persistence/mappers.ts`, `pg-scenario-repository.ts`).
3. 서버 재시작 후(인메모리라 재시작 시 방 데이터 소멸):
   `GET /rooms/:id/sheet-schema`로 시나리오 시트가 나오는지, 저장/확정이 되는지 curl 확인.

## 변경 파일 요약(특수룰 시나리오 1개 추가 기준)
- `src/services/scenario-service.ts` (시나리오 상수 + 카탈로그)
- `src/services/sheet-schema.ts` (전용 시트 + 매핑)  ← 특수룰일 때만
- `src/services/sheet-schema.test.ts` (테스트)
- (선택) `src/server.ts` `proposeAttributes` 휴리스틱 키워드
- 특수룰 없으면 1·4단계만 하면 끝.
