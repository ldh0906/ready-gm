# 구현 스펙 — 글래스모피즘 리스타일 (2026-07-04)

설계자(Claude)가 방향과 토큰을 확정했다. 근거: `.kiro/specs/trpg-session-engine/mockups-glass.html`
(4개 시안 중 **확정**된 글래스모피즘 시안)이 실제 화면에 한 번도 적용되지 않았다 — 이번 작업은
그 시안의 디자인 언어를 실화면에 집행하는 것이다. 배경: `docs/product-north-star.md`(친구들과의
밤 경험), `docs/architecture.md` §3 불변식.

## 절대 규칙 (위반 = 실패)

1. **CSS-only 리스타일이 원칙.** DOM 구조·클래스명·id·이벤트 배선을 바꾸지 않는다.
   JS 파일(`app.js`, `views/*`, `logic.js` 등)은 **한 줄도 수정 금지**.
   허용되는 HTML 수정은 딱 두 가지: ①`<head>`에 폰트/`theme.css` `<link>` 추가
   ②`<style>` 블록 내용물 교체(게임 화면은 `public/game/styles.css` 교체).
2. **셀렉터 보존**: 기존 CSS의 모든 셀렉터를 유지한 채 선언값만 바꾼다(새 셀렉터 추가는 허용,
   삭제는 금지). 각 요소의 display/flex/grid **레이아웃 속성과 스크롤 구조는 그대로** 두고
   색·배경·테두리·그림자·radius·타이포만 바꾼다. 기존 `@media` 반응형 블록의 레이아웃 의도 보존.
3. 모든 페이지 최상단 공통 가드 추가: `[hidden] { display: none !important; }`
   (glass 패널에 display를 세게 주다가 hidden 토글이 깨지는 사고 방지).
4. **backdrop-filter는 최상위 셸에만** (헤더 바, 스토리/사이드 패널 컨테이너, 드로어, 모달,
   카드 컨테이너 수준). 반복 항목(채팅 줄, 태그, 주사위, chip 개별)에는 금지 — 성능.
5. **스토리·사이드바 항목에 entry 애니메이션 금지.** 1초 렌더 티커가 매초 replaceChildren으로
   전부 다시 그리므로, 항목 등장 애니메이션을 달면 매초 전체가 깜빡인다. 허용되는 모션은
   ⑧절 목록뿐. `prefers-reduced-motion: reduce`에서는 모든 모션 제거.
6. git add/commit 금지. `npm run typecheck && npm test` 통과(변경이 CSS뿐이면 test는 그대로
   통과해야 정상 — 실패하면 규칙 1~2 위반을 의심하라). lint는 샌드박스 실패 시 건너뛰고 보고.

## 1. 공유 토큰 파일 — `public/theme.css` (신규)

CSS 커스텀 프로퍼티로 정의하고, 각 페이지 CSS는 이 변수만 참조한다:

```css
:root {
  color-scheme: dark;
  /* 배경 */
  --bg-base: linear-gradient(135deg, #161922, #10131b 70%);
  --bg-tint-1: radial-gradient(circle at 18% 12%, #3a4a7022, transparent 50%);
  --bg-tint-2: radial-gradient(circle at 82% 18%, #4a3f6322, transparent 52%);
  --bg-tint-3: radial-gradient(circle at 50% 95%, #2e4a5522, transparent 55%);
  /* 텍스트 */
  --text: #e8eaf2; --text-2: #aab2e0; --text-3: #8089b5; --text-4: #6f76a0;
  /* 글래스 표면 */
  --glass-bg: rgba(255,255,255,.07); --glass-border: rgba(255,255,255,.18);
  --card-bg: rgba(255,255,255,.06);  --card-border: rgba(255,255,255,.14);
  --inset-bg: rgba(255,255,255,.05); --inset-border: rgba(255,255,255,.10);
  --input-bg: rgba(255,255,255,.08); --input-border: rgba(255,255,255,.20);
  --shadow-shell: 0 24px 70px rgba(0,0,0,.45);
  --blur-shell: 20px; --blur-panel: 12px;
  --r-shell: 22px; --r-card: 16px; --r-input: 12px; --r-pill: 999px;
  /* 액센트 (확정 시안 그대로) */
  --gm: #ffd9a8;      --gm-bg: rgba(255,217,168,.16);  --gm-border: rgba(255,217,168,.45);
  --mint: #9affd0;    --mint-bg: rgba(154,255,208,.14);
  --blue: #8fc2ff;    --blue-bg: rgba(106,169,255,.14);
  --amber: #ffce6b;   --amber-bg: rgba(255,206,107,.14);
  --danger: #ff9a9a;  --danger-bg: rgba(255,110,110,.18); --danger-border: rgba(255,110,110,.5);
  --btn-primary-bg: rgba(255,255,255,.92); --btn-primary-text: #1b1f3a;
}
[hidden] { display: none !important; }
body {
  color: var(--text);
  font-family: "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
  background: var(--bg-tint-1), var(--bg-tint-2), var(--bg-tint-3), var(--bg-base);
  background-attachment: fixed;
}
```

폰트: 각 페이지 `<head>`에 Pretendard CDN 링크 추가(실패해도 시스템 폰트로 우아하게 폴백):
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="/theme.css">
```

## 2. 공통 컴포넌트 레시피 (theme.css에 유틸로 두지 말고, 각 페이지의 기존 셀렉터에 "값"으로 적용)

- **글래스 셸**(패널 컨테이너): `background: var(--glass-bg); border: 1px solid var(--glass-border);
  border-radius: var(--r-shell); backdrop-filter: blur(var(--blur-shell)); box-shadow: var(--shadow-shell);`
- **카드**: `--card-bg`/`--card-border`, radius `--r-card` (blur 없음).
- **버튼**: primary = `--btn-primary-*`(흰 바탕·남색 글자, 굵기 600) / secondary = 흰 .12 +
  테두리 .22 / danger = `--danger-*`. hover에 `transform: translateY(-1px)` + 밝기 상승,
  transition 140ms. disabled opacity .4.
- **입력**: `--input-*`, radius `--r-input`, focus 시 `border-color: var(--blue)` +
  `box-shadow: 0 0 0 3px rgba(143,194,255,.15)`.
- **필/태그**: pill radius, 상태색은 `--mint(-bg)`(준비/연결), `--blue(-bg)`(플레이어/패스),
  `--amber(-bg)`(타이머/자동), `--danger(-bg)`(경고/강제).
- **라이브 점**: 8px 원 + `box-shadow: 0 0 10px <색>` 글로우 (mint=연결됨, amber=재연결).

## 3. 게임 화면 — `public/game/styles.css` 전면 교체 (최우선)

기존 셀렉터를 전부 유지하면서 아래 매핑으로 값을 바꾼다:

| 대상(기존 셀렉터) | 처리 |
|---|---|
| `body` | theme.css의 배경/폰트 상속 (페이지 자체 background 제거) |
| `header` | 글래스 셸 상단 바(radius는 하단만 0, 상단 좌우 0 — 풀블리드 바에는 radius 없이 `background: rgba(255,255,255,.06); backdrop-filter: blur(var(--blur-panel)); border-bottom: 1px solid var(--glass-border)`) |
| `header .badge/.conn/.pill` | 글래스 필. `.conn.active`는 mint 글자 + mint 라이브 점(::before 8px 원 + 글로우) |
| `.countdown` | `--amber`, 10초 이하 강조는 기존 로직 클래스 그대로 색만 `--danger` |
| `.clocks-bar/.char-states/.blackboard-bar` | 반투명 인셋 스트립(`--inset-bg`, blur 없음), 구분선 `--card-border` |
| `.clock-gauge .seg.on` | `--amber` 계열 + 글로우 유지, full은 `--danger` 계열 |
| 스토리 패널 컨테이너(`#story` 래퍼/`.story` 등 실제 셀렉터 확인) | 글래스 패널(blur `--blur-panel`) |
| `.gm` (서사 항목) | 확정 시안 `.narration` 레시피: `background: var(--inset-bg); border-left: 3px solid var(--gm); border-radius: 10px; padding: 14px; line-height: 1.75;` `.who`(라벨)는 `--gm` 굵게 12px |
| `.gm.waiting` | 위와 동일하되 텍스트 `--text-2` 이탤릭, 애니메이션 없음 |
| 사이드바(`.sidebar`, `#side`) | 글래스 패널. `.paneHead`는 11px 대문자 자간 .08em `--text-2` (시안 h5 레시피) |
| `.li.chat .name/b` | `--blue` 굵게. `.li.act`는 `--gm` 살짝(왼쪽 2px `--gm-border` 보더). `.li.pass`는 `--text-3`. `.li.round-sep`는 가운데 정렬 11px `--text-4` + 양옆 1px 라인(flex + ::before/::after) |
| 판정 트레이(`.check-bar/.check-group/.check-who/.caption`) | 카드 레시피, `.check-who`는 `--text-2` 12px |
| `.fate-die` | 44~52px 글래스 다이스: `--card-bg` + 1px `--gm-border`, radius 12px. `.rolling`은 테두리 `--gm` + 은은한 글로우, `.settled` 성공 계열 outcome은 기존 캡션 텍스트 색만(주사위 자체는 중립 유지). `.kept`는 mint 테두리, `.dropped`는 opacity .45 |
| `.roll-btn` | primary 버튼(작게, padding 7px 16px) |
| `.roll-countdown` | amber 필, `.mine.warn`은 danger 필 |
| 입력줄(`form`/`input`/전송 버튼) | 입력 레시피 + primary 버튼 |
| 알림(`.notice`, delivery/narration failed) | 시안 `.toast` 레시피: 인셋 카드 + 왼쪽 3px 보더(경고=`--amber`, 실패=`--danger`, ended=`--text-3`) |
| 시트 드로어(`#sheetDrawer`, backdrop) | 드로어 = 글래스 셸(blur `--blur-shell`), backdrop = `rgba(10,12,18,.55)` + blur 4px. 기존 슬라이드 트랜지션 유지 |
| 로스터/멀티플레이 표시 | 시안 `.chip` 레시피(아바타 원형은 기존 마크업이 있을 때만), 상태 태그는 ②절 상태색 |

## 4~7. 나머지 화면 (게임 화면 완료·검증 후 착수)

각 페이지 인라인 `<style>` 내용물을 같은 토큰·레시피로 교체(구조·셀렉터 보존 규칙 동일):
- **4. `public/character/index.html`**: 위저드 바(진행 표시 = 글래스 필 + `--blue` 진행),
  섹션 카드 = 카드 레시피, 능력치 사다리 컨트롤 = 입력 레시피, 역할 카드 선택 = 시안
  `.scenario` 레시피(선택 시 `--blue` 테두리 + `--blue-bg`), 확정 버튼 = primary.
- **5. `public/lobby/index.html`**: 로비 = 글래스 셸(narrow 680px 중앙), 참가자 목록 = chip
  레시피(호스트 왕관 `--gm`), 시나리오 선택 = `.scenario` 레시피, 시작 버튼 = primary.
- **6. `public/join/index.html` + `public/index.html` + `public/host-entry/`**: 중앙 480px
  글래스 카드 1장 + 입력/버튼 레시피. 첫인상 화면이므로 배경 티닝이 제대로 보여야 한다.
- **7. `public/quickplay/index.html`**: 게임 화면과 동일 매핑(공유 클래스가 많음).

## 8. 모션 (허용 목록 — 이것 외 금지)

- 버튼/chip/scenario hover·active 트랜지션(140ms), 입력 focus 링.
- 라이브 점 글로우는 **정적**(pulse 금지 — 1초 재렌더와 간섭).
- 시트 드로어 슬라이드(기존 유지), 모달/드로어 backdrop fade 160ms.
- `.fate-die.rolling` 글로우는 CSS transition만(키프레임 루프 금지 — JS 셔플이 이미 모션).
- `@media (prefers-reduced-motion: reduce)`: transition/transform 전부 제거.

## 수용 기준

- `npm run typecheck && npm test` 통과 (JS diff 0줄 — `git diff --stat`으로 확인해 보고에 첨부).
- 변경 파일은 `public/theme.css`(신규) + 각 페이지 html의 `<head>` 링크/`<style>` 내용물 +
  `public/game/styles.css`만이어야 한다.
- 모든 페이지 GET 200 + 콘솔 에러 없음(브라우저 검증은 QA가 수행).
- 완료 보고: ①페이지별 적용 요약 ②스펙의 셀렉터 매핑에서 실제 클래스명이 달라 조정한 부분
  목록(중요 — 3절 표는 대표명이며 실제 셀렉터는 코드가 정답) ③남은 리스크.
