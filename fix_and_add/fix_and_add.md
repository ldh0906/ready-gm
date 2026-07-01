# 고칠 것 / 추가할 것 (fix & add)

> 최신 항목이 맨 위. 처리하면 항목을 아래로 내리거나 완료 표시.

---

## [열림] 주사위 "직접 굴리기"가 표현일 뿐 — 결과가 이미 확정/공개됨

**날짜:** 2026-07-01
**상태:** 미해결 (Fable 5 사용 가능해지면 작업 예정)

### 증상
- 판정 주인 클라이언트에는 "굴리기" 버튼이 뜨고, 누르기 전까지 자기 주사위는 안 굴러간 것처럼 보인다. (의도대로 동작)
- 그러나 **다른 클라이언트에는 그 주사위 값이 이미 확정되어 그대로 보인다.** (상대가 아직 안 굴렸는데 결과가 노출됨)
- **AI(GM)에게는 두 클라이언트의 주사위 값이 이미 정해진 채로 narration 단계에 넘어가 있다.** 즉 "굴리기"는 순수 연출이고 실제 판정 흐름에는 영향이 없다.

### 근본 원인
현재 설계는 **서버 권한 주사위**다. `AiGmCoordinator.resolveRound`가:
1. AI에게 어떤 판정을 할지(check 선택)만 물어보고,
2. 서버가 `DiceService`로 **모든 주사위를 즉시 굴려** `resolved: CheckRecord[]`를 만든 뒤,
3. 그 확정된 결과를 AI에게 넘겨 narration을 생성하고,
4. narration payload의 `checks`(= `VisibleCheck[]`)로 **모든 클라이언트에 결과를 동시에 브로드캐스트**한다.

따라서 클라이언트의 "굴리기" 버튼(`public/game/index.html`의 `renderCheck(check, manual)`)은 이미 서버가 확정해 보낸 값을 **각 클라이언트에서 애니메이션으로 재생하는 게이팅**일 뿐이다. 주인 클라이언트에서만 버튼 뒤로 미뤄 보여줄 뿐, 값 자체는:
- 다른 클라이언트: 같은 narration payload를 받으므로 바로 최종값이 보임.
- AI: narration 프롬프트가 만들어지는 시점에 이미 결정됨.

### 제대로 고치려면 (설계 변경 필요)
"당사자가 실제로 굴리기 전까지는 값이 확정/노출되지 않는다"를 진짜로 만들려면 **판정을 2단계로 분리**해야 한다:

1. **선언 단계:** AI가 어떤 캐릭터가 어떤 능력치로 어떤 난이도의 판정을 하는지 *제안만* 브로드캐스트 (roll 값 없음). 클라이언트는 "OOO의 은밀함 판정 대기중 — 굴리기" 버튼 표시.
2. **굴림 단계:** 각 당사자가 버튼을 누르면 **그 클라이언트가 서버에 roll 요청**을 보내고, 서버가 그때 `DiceService`로 굴려 결과를 확정하고 모두에게 브로드캐스트.
3. **narration 단계:** 모든 대기중인 판정이 굴려진 뒤에야(또는 타임아웃 자동 굴림 후) AI에게 확정 결과를 넘겨 narration 생성.

### 영향 범위 (건드릴 곳)
- `src/ai/ai-gm-coordinator.ts` `resolveRound` — check 선택과 dice roll을 분리. narration을 roll 완료 이후로 지연.
- `src/realtime/room-orchestrator.ts` — 새 phase(예: `rolling`) 또는 pending-checks 상태 관리, roll 커맨드 수신 → 서버 굴림 → 브로드캐스트 → 전원 완료 시 narration 트리거. 미굴림 당사자 타임아웃 자동 굴림.
- `src/realtime/connection.ts` — 새 서버→클라 이벤트(예: `checks_pending`, `check_rolled`)와 클라→서버 roll 커맨드 프로토콜.
- `src/core/round-loop.ts` / `turn-state.ts` — 판정 대기/굴림 상태를 Turn_State에 반영(reducer 액션 추가).
- `public/game/index.html` — "굴리기" 버튼이 로컬 애니메이션이 아니라 **서버 roll 커맨드**를 전송하도록 변경. 굴리기 전에는 값 표시 안 함(placeholder).

### 주의 / 유지할 것
- 무작위성은 계속 **서버 권한**으로 유지 (클라이언트가 값을 정하지 못하게). 버튼은 "언제 굴릴지"만 트리거하고, 실제 난수는 서버 `DiceService`에서 나온다.
- 미접속/무응답 당사자 때문에 라운드가 멈추지 않도록 ready-check 타임아웃처럼 **자동 굴림 폴백** 필요.
- 현재 통과 중인 테스트 베이스라인(836 passed | 3 skipped) 회귀 없이 진행.

### 현재까지 구현된 부분 (연출 게이팅, 유지 가능)
- `VisibleCheck`에 `characterName` / `attributeLabel` 추가 → 누가 무슨(한국어) 주사위를 굴리는지 표시.
- 속도 스탯 기준 판정/굴림 순서 정렬(`orderChecksBySpeed`).
- 주인 클라이언트의 "굴리기" 버튼 게이팅(현재는 로컬 연출 지연). → 위 2단계 설계로 승격시키면 됨.
