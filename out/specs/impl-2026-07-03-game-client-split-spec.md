# 구현 스펙 — public/game/index.html 모듈 분리 (2026-07-03)

설계자(Claude)가 경계를 확정했다. 이 문서만 보고 구현 가능해야 하며, **지시와 실제 코드가
어긋나면 임의 해석하지 말고 멈춘 뒤 완료 보고에 명시**하라. 배경: `docs/architecture.md` §7.

## 목표와 비목표

- **목표**: `public/game/index.html`(2,087줄 = HTML + `<style>` ~18KB + 인라인
  `<script type="module">` ~52KB)을 외부 CSS/JS 모듈로 분리해 이후 UI 작업의 토대를 만든다.
- **비목표(절대 금지)**: 동작·렌더 결과·타이밍·문구 변경, 리팩토링을 빙자한 로직 개선,
  네이밍 정리, 다른 페이지(ai.html/scenario.html/quickplay 등) 수정. **행동 보존 100%.**

## 단계 구성 — 반드시 순서대로, 각 단계 후 전체 테스트 통과

### Stage A — 외부화 (파일만 분리, 코드 내용 무변경)

1. `<style>` 내용 전체를 `public/game/styles.css`로 **그대로** 이동,
   `<link rel="stylesheet" href="./styles.css">`로 대체.
2. 인라인 `<script type="module">` 내용 전체를 `public/game/app.js`로 **그대로** 이동
   (import 경로 `./logic.js`는 동일 디렉터리라 무변경),
   `<script type="module" src="./app.js"></script>`로 대체.
3. **테스트 하네스 이행** — `public/game/integration.test.js`:
   - 현재: index.html에서 정규식으로 인라인 스크립트를 추출(`scriptMatch`) → 임시 파일로
     복사 → dynamic import. (파일 상단 주석과 :46-60 참조)
   - 변경: 스크립트 소스를 `readFileSync(join(here, "app.js"), "utf8")`로 읽도록 교체.
     **임시 파일 복사 + 신선한 이름 dynamic import 메커니즘은 그대로 유지**한다(테스트별
     fresh 바인딩 보장이 목적이므로). `bodyMarkup` 추출은 index.html에서 그대로 하되,
     `<script ...src=...>` 태그 제거 정규식이 새 형태(`src` 속성)도 제거하는지 확인.
   - `scriptMatch` 부재 시 던지는 가드는 "app.js가 비어 있으면 던진다"로 대체.
4. `public/game/dom-structure.test.js` 등 index.html 원문을 검사하는 테스트가 인라인
   스크립트/스타일 존재를 assert하면, 새 구조(link/src)를 검증하도록 갱신하라(검증 강도
   유지 — assert 삭제 금지).
5. 서버는 `public/`을 정적 서빙하므로 서버 변경 없음. **Stage A 완료 시점에
   `npm run typecheck && npm test` 전부 통과해야 Stage B 착수 가능.**

### Stage B — app.js 내부 모듈 분할 (verbatim 이동 + 명시적 의존성)

새 폴더 `public/game/views/`를 만든다(기존 `dice.js`/`dice-tray.js`는 dice-demo.html 전용
레거시 — 이름 충돌 방지를 위해 반드시 `views/` 하위 사용).

**패턴(전 모듈 공통)**: 각 뷰 모듈은 팩토리 함수 하나를 export 한다:
```js
// views/story.js 예시
export function createStoryView(ctx) {
  const { els, helpers, getState } = ctx;
  // ── 아래로 app.js에서 관련 함수들을 "그대로" 옮긴다 ──
  function renderStory() { /* verbatim */ }
  ...
  return { renderStory, finishTypewriter };
}
```
- `ctx`는 app.js가 조립하는 단일 객체:
  `{ els, helpers, getState, sendCommand, getViewerPlayerId, dispatch }`.
  - `els`: 해당 뷰가 쓰는 DOM 요소 참조 묶음(app.js에서 `$()`로 수집해 전달).
  - `helpers`: `textSpan, appendText, isNearBottom, stickToBottom, prefersReducedMotion,
    frand, fsign` 등 공용 유틸 — `views/dom.js`로 이동해 **일반 export**(팩토리 아님).
  - `getState()`: app.js의 `state` 변수를 읽는 게터(뷰가 state를 직접 재할당하지 못하게).
- 옮긴 함수 **본문은 한 글자도 바꾸지 않는 것이 기본**이다. 허용되는 유일한 수정:
  ①모듈 스코프 변수 참조를 `ctx`/게터 경유로 바꾸는 것 ②`state` → `getState()`.
  이 두 종류 외의 diff가 생기면 지시 위반이다.
- 뷰 모듈 간 직접 import 금지(공용은 views/dom.js와 logic.js만). 순환 의존 금지.

**분할 경계** (app.js에 남는 것: 상태 `state`+`dispatch`, 채널 연결/재연결, sendCommand,
입력 파싱·전송 배선, `render()` 오케스트레이션, 1초 티커, 부트스트랩):

| 새 모듈 | 옮길 것 (index.html 기준 현재 함수들) |
|---|---|
| `views/dom.js` | `$` 제외 공용 유틸: `textSpan`, `appendText`, `isNearBottom`, `stickToBottom`, `prefersReducedMotion`, `frand`, `fsign`, 상수 `STICK_THRESHOLD_PX` |
| `views/story.js` | `narrationKey`, typewriter 일체(`stopTypewriter`/`scheduleTypewriter`/`finishTypewriter`/관련 모듈 변수), `renderStory`, `newStoryBtn` 배선 |
| `views/checks.js` | 판정 트레이 일체: `renderRollingChecks`, `renderRollCountdown`, `pendingViewerChecks`, `renderSettledDice`, `renderPendingDice`, `shuffleDiceFaces`, `animateRolledCheck`, `renderCheck`, `maybeAnimateChecks`, `animatedServerCheckIds`/`animatingCheckIds`/`lastCheckSig` |
| `views/side.js` | `renderSide` (채팅+행동 로그+라운드 구분선) |
| `views/sheet-drawer.js` | 시트 드로어 일체(`openSheetDrawer`, `loadSheetViews`, 캐시, 포커스 관리, backdrop/Esc 배선) |
| `views/panels.js` | `renderClocks`, `renderCharacterStates`, `renderBlackboard`, 로스터/단계·차례 표시(`rosterModel` 소비부) |

- `render()`는 app.js에 남아 각 뷰의 render 함수를 기존 순서 그대로 호출한다.
- 이벤트 배선 중 뷰 내부 DOM에 닫힌 것(예: 주사위 굴리기 버튼 클릭)은 뷰로 함께 이동,
  전역 입력(채팅 입력창, 폼 submit)은 app.js에 남는다.
- `sendCommand`가 필요한 뷰(checks, sheet-drawer)는 `ctx.sendCommand`를 쓴다.

### 테스트 (Stage B)

- 기존 테스트 전부 무변경 통과가 원칙. integration.test.js는 Stage A에서 app.js를 읽으므로
  Stage B에서 손댈 필요가 없어야 한다(있다면 보고).
- 신규 스모크 1건: happy-dom에서 app.js 로드 후 ①`turn_state` 주입 → 스토리/사이드바/
  로스터가 그려짐 ②`checks_pending`+`check_rolled` 주입 → 트레이 렌더 — 기존
  integration.test.js의 loadPage 헬퍼를 재사용해 작성.

## 수용 기준 (공통 규칙은 `out/qa/qa-2026-07-03-e2e-playtest.md` 작업 지시서와 동일)

- `npm run typecheck && npm test` 통과 (Stage A 후, Stage B 후 각각).
- index.html은 마크업 + link/script 태그만 남는다(인라인 JS/CSS 0줄).
- 명시된 파일 외 수정 금지: 특히 `logic.js`는 **한 줄도 건드리지 않는다**.
- innerHTML 금지 유지. git add/commit 금지.
- 완료 보고: ①파일별 변경 요약(모듈별 이동 함수 목록) ②verbatim 원칙에서 벗어난 diff와
  사유(§Stage B의 허용 2종 외) ③테스트 결과 ④남은 리스크.
