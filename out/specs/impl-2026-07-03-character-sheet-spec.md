# 구현 스펙 — 캐릭터 시트 개선 4개 트랙 (2026-07-03)

설계자(Claude)가 토대를 워킹트리에 작성해 두었다. 이 스펙은 그 위의 본 구현을 정의한다. 토대 코드는 수정 금지(버그 발견 시 보고만). 참고: QA 수정 5건(`out/impl-2026-07-03-qa-fixes-spec.md`)이 같은 워킹트리에 미커밋 상태로 존재한다 — 건드리지 말 것.

## 이미 완료된 토대 (건드리지 말 것)

`src/services/sheet-schema.ts`:
- `NarrativeField.visibility?: "public" | "private"` (기본 public). until-it-sinks `goal`(목표·비밀) 필드에 `visibility: "private"` 지정.
- 파일 말미의 뷰어 스코프 projection 계층: `SheetProjectionSource`, `SheetViewAttribute`, `SheetViewNarrative`, `CharacterSheetView`, **`projectSheetForViewer(character, schema, isSelf)`** — 소유자는 전부, 타인은 private 서사 필드가 서버에서 **생략**된(fail-closed) 시트 뷰를 만든다. 능력치는 스키마 라벨/rung 라벨로 현지화되어 나온다.

---

## 트랙 A — 인게임 "살아있는 시트" 열람 (최우선)

**목표**: 플레이 중 로스터에서 캐릭터를 클릭하면 시트 드로어가 열린다. 본인은 전체, 타인은 공개 정보만.

1. **서버 endpoint**: `GET /rooms/:roomId/sheet-views` (src/server.ts). 인증·플레이어 식별은 기존 캐릭터 계열 endpoint(`GET /rooms/:roomId/players/:playerId/cards`, `GET /rooms/:id/readiness`)와 동일한 패턴을 따를 것 — 뷰어 playerId를 같은 방식으로 받는다(쿼리/헤더 중 기존 관례 준수).
   - 방의 확정/기록된 캐릭터 전부에 대해 `projectSheetForViewer(character, sheetSchemaForScenario(resolveScenarioForRoom(roomId)), viewerPlayerId === character.playerId)` 실행.
   - 응답: `{ views: [{ playerId, characterId, view: CharacterSheetView }] }`.
   - 존재하지 않는 방 404, 뷰어가 방 멤버가 아니면 403(기존 관례에 맞춰).
2. **클라이언트** (`public/game/index.html`): 로스터 행(li) 클릭/Enter → 시트 드로어(오른쪽 슬라이드 패널 또는 모달) 오픈.
   - 열 때 `GET /rooms/:roomId/sheet-views` fetch(간단 캐시: 세션 중 1회 + 수동 새로고침 버튼. 시트 본체는 확정 후 불변이므로 충분).
   - 드로어 내용: 이름(+역할 카드 라벨), 컨셉, 능력치(라벨+값+rung 라벨), 서사 필드(라벨+본문), 그리고 **현재 상태**(state.characterStates에서 해당 캐릭터의 조건/장비/자원/개인 시계 — 이미 클라이언트에 있음)를 함께 표시.
   - 본인 시트에는 "내 시트" 뱃지. 닫기: X 버튼 + Esc + 바깥 클릭.
   - XSS: textContent/textSpan 패턴만 사용(innerHTML 금지). 접근성: role="dialog", aria-label, 포커스 이동/복귀.
3. **테스트**: `projectSheetForViewer` 단위 테스트 신설(src/services/sheet-schema.test.ts에 추가) — (a) private 필드가 타인 뷰에서 생략, (b) 본인 뷰에는 포함, (c) 빈 값 필드 생략, (d) name/concept는 서사 목록에서 제외되고 top-level로만, (e) 카드 id → roleLabel 해석(모르는 id는 id 그대로), (f) rungLabels 매핑, (g) 능력치 값 없으면 ladder.min. endpoint 통합 테스트는 기존 server-security/HTTP 테스트 관례가 있으면 그에 맞춰 최소 1건(타인 private 필드 미노출).

## 트랙 B — 생성 화면 단계형 위저드

**목표**: `public/character/index.html`(+logic.js)의 긴 단일 페이지를 단계형으로. **DOM 재구성 최소화** — 기존 섹션 카드들을 유지하고 표시/숨김으로 단계를 구현한다(테스트 호환 최우선).

1. 단계 구성(동적): ① 역할 카드(카드 기반 시트일 때만) → ② 캐릭터 시트(서사+능력치) → ③ 제안·확정 → ④ 준비 현황. 해당 없음 단계는 건너뜀.
2. 상단에 진행 표시(예: "2 / 4 · 캐릭터 시트")와 이전/다음 버튼. "다음"은 현재 단계가 유효할 때만 활성(기존 검증 로직 재사용 — 카드 미선택이면 ①에서 막기, 이름 공백이면 ②에서 막기 등).
3. 확정(confirm) 후에는 자동으로 ④로 이동. 기존 요소 id·이벤트 배선은 유지하고, 단계 네비게이션 상태는 logic.js에 순수 함수(현재 단계, 이동 가능 여부 도출)로 추가해 단위 테스트를 붙인다.
4. 기존 `public/character/*.test.js`가 깨지면 새 동작에 맞게 갱신(숨김 상태 때문에 실패하는 테스트는 해당 단계로 이동시키는 헬퍼를 테스트에 추가하는 식으로).

## 트랙 C — AI 서사 초안

**목표**: 컨셉 한 줄로 서사 필드 초안을 채워주는 버튼.

1. **서버**: `POST /rooms/:roomId/players/:playerId/narrative-draft`, body `{ concept: string, selectedCardId?: string }`.
   - 기존 능력치 제안 endpoint(`POST .../proposal`, src/server.ts:1167 부근)의 인증/검증/AI 호출 패턴을 그대로 따른다(같은 CLI 클라이언트, fast 티어/낮은 토큰 예산).
   - 프롬프트: 시나리오 rulesBrief + (카드 기반이면) 선택 카드 premise + 스키마의 서사 필드 목록(id/label/guidance, `name` 제외) + 사용자 concept. 사용자 입력은 기존 untrusted-JSON 블록 관례로 감싼다.
   - 응답 파싱: `{ drafts: { <fieldId>: string } }` — 스키마에 없는 fieldId 무시, 각 값은 해당 필드 maxLength로 절단, 파싱 실패 시 기존 proposal의 실패 응답 관례를 따름(fail-closed).
2. **클라이언트**: 서사 단계에 "AI 초안 받기" 버튼. **빈 필드만** 채운다(이미 입력된 필드는 절대 덮어쓰지 않음). 로딩/실패 표시는 기존 proposal 버튼 UX 재사용.
3. **테스트**: 프롬프트 빌더·응답 파서 단위 테스트(record-replay 관례가 있으면 따름), 빈 필드만 채우는 클라이언트 로직 테스트.

## 트랙 D — 유대(bonds) 필드

1. `src/services/sheet-schema.ts`의 EZFudge 시트와 geese 시트에 공개 서사 필드 추가: `id: "bonds"`, label "유대", guidance "다른 플레이어 캐릭터와의 관계를 한두 줄로 적으세요. (예: ○○와는 옛 전우, ○○를 은근히 경계한다)", maxLength 1000, 해당 서사 섹션 소속. until-it-sinks는 이미 `disposition`이 있으므로 제외.
2. 이 필드는 트랙 A의 시트 뷰와 트랙 C의 초안 대상에 자동 포함된다(별도 작업 불필요 — 확인만).

## 공통 수용 기준

- `npm run typecheck && npm run lint && npm test` 전부 통과.
- 서버 변경은 additive-only. private 서사 필드 값은 **어떤 경로로도 타인에게 전송되지 않아야 한다**(클라이언트에서 숨기는 방식 금지).
- git commit 금지 — QA(Claude)가 검수 후 처리.
- 완료 보고: 파일별 요약, 스펙 이탈과 이유, 남은 리스크.
