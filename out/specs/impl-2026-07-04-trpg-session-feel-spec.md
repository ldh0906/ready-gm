# 구현 스펙 — 세션 화면 TRPG화: 주사위 의식·책자화·장르 무드·파티 레일·장면 카드 (2026-07-04)

설계자(Claude)가 사용자와 범위를 확정했다(긴장 계기판/시계 연출은 이번 범위 제외).
배경: `docs/product-north-star.md` §3 원칙, `docs/architecture.md` §3 불변식, 글래스 토큰은
`public/theme.css`. **지시와 실제 코드가 어긋나면 임의 해석하지 말고 멈춘 뒤 보고에 명시하라.**

## 공통 규칙

- 대상: `public/game/`(app.js, views/*, index.html, styles.css), `public/theme.css`,
  그리고 T-E에 한해 `src/realtime/engine.ts`·타입·`public/game/logic.js`. **그 외 파일 수정 금지.**
  `logic.js`는 T-E의 TURN_STATE 운반 외 수정 금지.
- DOM은 textContent/textSpan만(innerHTML 금지). 기존 클래스·id·배선 유지, 추가는 허용.
- 1초 렌더 티커가 스토리/사이드/로스터를 매초 replaceChildren 한다 — **재렌더되는 컨테이너
  안의 요소에 등장 애니메이션 금지.** 연출이 필요한 요소는 재렌더 밖(body 직속)에서 자체
  수명주기로 관리하라(주사위 의식 오버레이가 이 방식).
- `prefers-reduced-motion: reduce`에서 모든 연출은 즉시 정착(셔플·스팅어·트랜지션 생략).
- git add/commit 금지. `npm run typecheck && npm test` 통과. lint는 샌드박스 실패 시 건너뛰고
  보고. 완료 보고: 파일별 요약 / 지시 이탈과 사유 / 추가 테스트 목록 / 남은 리스크.

## T-A 주사위 의식 (Roll Ritual) — `views/checks.js`, `styles.css`, `index.html`

**의도**: 본인 판정 결과가 도착하는 순간을 세션의 하이라이트로 만든다.

1. **트리거**: `check_rolled` 수신 시(`app.js`의 기존 `checksView.animateRolledCheck(parsed.check)`
   호출 경로 그대로) — `check.playerId === viewerPlayerId`이고 `check.autoRolled !== true`인
   경우에만 의식 오버레이를 띄운다. 타인 판정·자동 굴림은 현재 인라인 연출 유지.
2. **오버레이**: `index.html`에 정적 마크업 추가(재렌더 컨테이너 밖, body 직속):
   `<div id="rollRitual" class="roll-ritual" hidden><div class="ritual-stage"></div></div>`.
   스타일: fixed inset 0, `rgba(10,12,18,.72)` + `backdrop-filter: blur(4px)`, 중앙 정렬.
   stage 내용은 checks.js가 조립: 캐릭터명·능력치 라벨(기존 `attributeLabel`/ATTR_LABELS),
   두 배 크기 운명 주사위(약 96px, 기존 `.fate-die` 확대 변형 `.fate-die.ritual`), 캡션.
3. **연출 순서**: 기존 `shuffleDiceFaces` 재사용(2000ms 감속) → 정착 → **스팅어 600ms**:
   - Success/Partial: 민트 링 플래시(`box-shadow` 확장 트랜지션 1회)
   - Critical Success: 앰버 글로우 버스트(그림자 확산 + 살짝 scale 1.06)
   - Failure: 주사위만 6px 좌우 셰이크 1회(120ms) + 붉은 테두리 — 화면 전체 셰이크 금지
   → 결과 텍스트(기존 캡션 포맷 `난이도 X · 결과 Y`)를 크게 표시 → **900ms 후 자동 닫힘**.
   오버레이 클릭 또는 Esc로 즉시 닫힘. 닫힐 때 트레이의 해당 판정은 기존 정착 상태로 보인다
   (트레이 갱신은 기존 `animateRolledCheck` 흐름이 이미 처리 — 의식과 병행 실행하되 트레이
   쪽은 인라인 셔플을 생략하고 즉시 정착시켜 이중 연출을 피한다).
4. **동시 다건**: 본인 판정이 2건 이상 연달아 도착하면 큐로 순차 재생(동시 2장 금지).
5. **재렌더 간섭 금지**: 오버레이는 render()가 절대 만지지 않는다. 진행 중 checkId는 기존
   `animatingCheckIds`에 등록해 트레이 보존 규칙을 재사용.
6. **A11y**: 오버레이 `role="status"` `aria-live="polite"`, 결과 텍스트 낭독. 포커스 강탈 금지.
   reduced-motion: 오버레이 자체를 띄우지 않는다(인라인 즉시 정착만).
7. **테스트**: happy-dom — (a) 본인 check_rolled → #rollRitual 표시 + 결과 텍스트 포함,
   (b) 타인/autoRolled → 표시 안 됨, (c) Esc/클릭 닫힘, (d) reduced-motion(happyDOM은 기존
   `prefersReducedMotion()`가 true) 경로에선 오버레이 생략 — 주의: happy-dom에서 (a)~(c)를
   검증하려면 `prefersReducedMotion` 주입이 필요하다. 기존 `window.__game*` 주입 관례를 따라
   `window.__gameForceMotion = true`일 때 reduced-motion 판정을 무시하는 테스트 훅을
   `views/dom.js`의 `prefersReducedMotion`에 추가하라(프로덕션 동작 무영향).

## T-B 서사 책자화 (Storybook) — `views/story.js`, `styles.css`, `index.html`

1. **폰트**: `index.html` head에 추가(실패 시 Pretendard 폴백):
   `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600&display=swap">`
   서사 본문(`.gm`)만 `font-family: "Noto Serif KR", "Pretendard Variable", serif;` —
   채팅·UI는 기존 폰트 유지.
2. **kind별 격 부여** (마크업 변경 없이 기존 `div.gm.<kind>` + `.who` 셀렉터로):
   - `.gm.opening`: 장(章) 표지 — 위아래 이중 괘선(::before/::after, `--gm-border`), 가운데
     정렬 제목 줄은 기존 `.who`를 확대(14px, 자간 .12em, "제 1 장 · 서막" 형태로 바꾸지
     말 것 — 텍스트는 JS 소관이므로 손대지 않는다. 시각만 표지답게), 본문 line-height 1.9.
   - `.gm.resolution`: 본문 — serif, line-height 1.85, 문단 여백 확대, 시작 장식 `◈`
     (::before, `--gm` 60% 투명).
   - `.gm.closing`: 에필로그 카드 — 카드 프레임 강화(이중 보더), 상단 중앙 `❦`(::before).
   - `.gm.waiting`: serif 이탤릭 `--text-2`, 연출 없음(기존 결정 유지).
3. **장르 무드와 연동**: 표지·장식 색은 토큰만 사용(무드 클래스가 토큰을 덮어써서 자동 반영).
4. **테스트**: 렌더 스모크에서 kind 클래스별 요소 존재만 확인(스타일 검증 불필요, 회귀 없음
   확인이 목적).

## T-C 장르 무드 (Genre Mood) — `app.js`, `theme.css`, `styles.css`

1. **데이터**: app.js 부트 시 `GET /rooms/{roomId}/sheet-schema` 1회 호출(시트 드로어의
   `sheetFetchHeaders`와 동일한 헤더 구성 — 드로어 코드를 리팩토링하지 말고 app.js에 동일
   패턴으로 작성). 응답의 `genre`(문자열)와 `scenarioTitle`을 모듈 변수에 보관.
2. **매핑**: genre 문자열 부분 일치로 `document.body.classList.add(...)`:
   `호러`·`미스터리` 포함 → `mood-horror` / `코미디` 포함 → `mood-comedy` / 그 외 →
   `mood-fantasy`. fetch 실패 시 클래스 없음(현재 룩 그대로) — 실패가 화면을 깨면 안 된다.
3. **무드 정의**(`theme.css`에 body.mood-* 로 토큰 오버라이드만):
   - `mood-comedy`: 배경 틴트를 따뜻하게(라디얼 색을 `#70563a22`/`#63523f22`/`#554a2e22`),
     `--gm` 계열 그대로.
   - `mood-horror`: 차갑고 어둡게(`#2e3a5522`/`#3f2e4a22`/`#1e2a3522` + `--bg-base`를
     `linear-gradient(135deg,#12141c,#0b0d13 70%)`), `--text-2`를 살짝 회청색으로, body::after
     로 고정 비네트(`radial-gradient(ellipse at center, transparent 55%, rgba(5,7,12,.55))`,
     `pointer-events:none`, z-index 낮게 — 오버레이·드로어를 가리지 않게 주의).
   - `mood-fantasy`: 현재 기본 틴트 유지(별도 정의 불필요, 클래스만 존재).
4. **범위**: 게임 화면만(body 클래스는 game/app.js만 부여). 다른 페이지 무변경.
5. **테스트**: genre→클래스 매핑은 순수 함수로 분리해(`views/dom.js` 또는 app.js 내 export
   불가하므로 **`logic.js` 수정 금지 원칙 유지를 위해** `views/dom.js`에 `moodClassForGenre(genre)`
   순수 함수로 두고) 단위 테스트. fetch 실패 스모크 1건.

## T-D 파티 레일 (Party Rail) — `views/panels.js`(renderRoster 부분), `styles.css`

1. **코인 아바타**: 로스터 각 li 앞에 코인 추가 — `Array.from(이름)[0]`(서로게이트 안전)을
   textContent로 갖는 32px 원형 span(`.roster-coin`). 배경색은 playerId 결정적 해시 →
   `hsl(h, 42%, 30%)` + 1px `--card-border`. 해시 함수는 `views/dom.js`에 순수 함수
   `hueForId(id)`로 추가(간단한 문자코드 합 mod 360이면 충분).
2. **상태 표현**: 기존 로스터가 표시하는 상태 텍스트·구조는 전부 보존(테스트 보호)하고
   시각만 추가: 본인 li에 `--blue` 링, 행동 확정자는 코인에 민트 체크 배지(::after "✓"),
   연결 끊김은 코인 채도 제거(filter: grayscale + opacity .6).
   판정 대기 중(🎲) 배지는 rolling 단계에서 해당 플레이어에게 pending check가 있을 때 —
   이 판별에 필요한 데이터가 renderRoster 스코프에 이미 없으면 **무리하게 배선을 늘리지
   말고 생략**하라(보고에 명시).
3. **클릭→시트 드로어** 기존 배선 불변.
4. **테스트**: 기존 roster 테스트 무변경 통과 + 코인 존재/이니셜/본인 링 스모크 1건.
   `hueForId` 단위 테스트(결정성).

## T-E 장면 카드 (Scene Stage) — 서버 최소 추가 + 클라

**한계 공지(구현하지 말 것)**: 현재 엔진은 장면 전환을 갱신하지 않으므로 이 카드는 세션 내내
시드된 장면을 보여준다. 장면 전환 delta는 이번 범위 밖 — 만들지 마라.

1. **서버** `src/realtime/engine.ts` `decorateState`: 기존 characterStates/blackboard 장식과
   같은 패턴으로, `persistence.sceneStore.get(roomId)`의 `scene.location`(비어 있지 않은
   문자열일 때만)을 `sceneLocation`으로 부착. 타입은 기존 blackboard 장식 필드가 선언된
   위치와 같은 곳에 `sceneLocation?: string`으로 추가(직렬화 `toPlain`에는 **넣지 않는다** —
   장식 전용. blackboard가 이미 그 패턴인지 확인하고 동일하게).
   **노출 범위 엄수**: `location`만. sceneGoal/availableClues/presentNpcs 등 다른 scene
   필드는 어떤 형태로도 클라이언트에 보내지 않는다.
2. **클라** `logic.js`: TURN_STATE reducer에서 `sceneLocation` 운반(문자열 아니면 null) —
   이 한 곳 외 logic.js 수정 금지. `index.html`: `.story` 섹션의 paneHead 아래에
   `<div id="sceneCard" class="scene-card" hidden></div>` 추가. `views/story.js`의
   renderStory 시작부에서 채움: sceneLocation 있으면 `🕯 {sceneLocation}` + (T-C에서 확보한)
   scenarioTitle을 작은 보조 텍스트로, 없으면 hidden 유지. textContent만 사용.
3. **스타일**: 인셋 카드(`--inset-bg`), serif 소제목, 무드 토큰 연동.
4. **테스트**: engine.test.ts — decorate에 sceneLocation 부착(+빈 문자열/부재 시 생략),
  직렬화 왕복에 sceneLocation 불포함. logic.js TURN_STATE 운반. story 렌더 스모크(카드
  표시/숨김).

## 착수 순서

T-B → T-C → T-E → T-D → T-A (의식이 가장 크고 위험하므로 마지막; 각 항목 완료마다
`npm test` 확인). T-A가 막히면 나머지만 완성하고 보고해도 된다.
