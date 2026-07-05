# 구현 스펙 — 행동에 딸린 대사를 중앙 GM 무대에(인물 대사) + NPC 반응 (2026-07-04)

사용자 확정 요구: 행동과 함께 친 **따옴표 대사**(예: `문을 열며 "누구 있어요?"`)를 사이드
로그가 아니라 **화면 중앙(GM 서사 영역)** 에 `인물 「대사」` 형태로 올려, 마치 NPC들과 대화하듯
보이게 한다. 대사는 **AI 문맥에 반영**되어 관련 NPC가 반응/대답하도록 GM 서술을 유도한다.
대기 중 잡담(OOC)과 행동 로그는 **사이드에 그대로** 남는다.

## 공통 규칙 (엄수)

- 대상 파일만 수정. 무관 파일·기능 변경 금지. **git commit 금지.**
- DOM 텍스트는 `textContent`만(innerHTML 금지). 기존 `textSpan`/`appendText` 재사용.
- 재렌더 컨테이너 내부 등장 애니메이션 금지, `prefers-reduced-motion` 존중.
- `npm run typecheck && npm test` 통과. (eslint는 Codex 샌드박스에서 실패 — 실행 금지, 설계자가 QA에서 직접 돌림.)
- **지시와 코드가 어긋나면 멈추고 보고**(인용한 함수/라인이 실제와 다르면 중단).

---

## 배경(현재 동작, 근거)

- 입력 라우팅 `public/game/app.js` `submit`(439~471) + `parseUtterance`(~425): 입력에서 따옴표
  `"..."`를 뽑아 `says[]`로, 나머지를 `action`으로 나눈다. 현재 `says[]`는 각각
  `buildChatCommand(s)`(458행) → **사이드 채팅**으로 전송된다. `action`은 `buildConfirmCommand` → 확정.
- 전파: 플레이어 채팅은 별도 라이브 이벤트가 아니라 `applyClientCommand`(423~437)의
  `broadcastTurnState`로만 나간다. 클라는 `TURN_STATE`에서 `appendNewChats(chatCount, chatLog)`로
  새 채팅만 흡수한다(`public/game/logic.js` 966~1066).
- 중앙 서사는 `state.narrationEntries`를 `public/game/views/story.js`가 렌더한다(GM 서술 전용).
- AI 문맥: `src/services/turn-state-context.ts` `toContext`(149~)가 `thisRound.chat =
  state.chatLog.map(e => ({...e}))`로 chatLog를 **그대로** 싣는다. 그러나 표준 시나리오의
  `src/ai/ai-gm-coordinator.ts` `buildNarrationPrompt`(1793~)는 `UNTRUSTED_PLAYER_ACTIONS`
  (actions)만 넣고 **chat/대사는 넣지 않는다**(sinks 저녁 프롬프트만 chat 사용, 1531). → 대사가
  NPC 반응으로 이어지려면 narration 프롬프트에 **대사 블록을 실제로 추가**해야 한다.

핵심 설계: 대사를 "in-character 채팅"으로 취급한다 — chatLog에 `inCharacter: true` 플래그를
달아 저장하면 (a) 기존 전파 경로·(b) AI 문맥 주입이 자동으로 따라오고, 클라이언트는 표시만
사이드 대신 **중앙**으로 라우팅한다.

---

## SV. 서버 — in-character 채팅 플래그

### SV-1. 리듀서(round-loop.ts): `SEND_CHAT`에 inCharacter(additive)

`src/core/round-loop.ts`
1. `SendChatCommand`(74~85)에 옵셔널 필드 추가:
   ```ts
   export interface SendChatCommand {
     type: "SEND_CHAT";
     from: PlayerId;
     characterName: string;
     text: string;
     ts: string;
     displayName?: string;
     /** 인물 대사(따옴표로 말한 in-character 발화)면 true. 표시는 중앙 무대, AI 문맥에 반영. */
     inCharacter?: boolean;
   }
   ```
2. `SEND_CHAT` case(325~346)에서 엔트리에 조건부로 실어 준다(기존 가드/문구 유지):
   ```ts
   const entry: ChatEntry = {
     playerId: command.from,
     characterName: command.characterName,
     text: command.text,
     ts: command.ts,
     ...(command.displayName !== undefined ? { displayName: command.displayName } : {}),
     ...(command.inCharacter ? { inCharacter: true } : {}),
   };
   ```

### SV-2. 엔티티/직렬화(turn-state.ts): `ChatEntry.inCharacter`

`src/core/turn-state.ts`
1. `ChatEntry`(65~76)에 `inCharacter?: boolean;` 추가(설명: 인물 대사 여부; 표시/AI 문맥용).
2. `toPlain`의 chatLog 매핑(266~274)과 chatHistory 매핑(325~331) **양쪽**에 조건부 운반 추가:
   ```ts
   ...(entry.inCharacter ? { inCharacter: true } : {}),
   ```
   (present일 때만 실어 레거시 JSON 왕복 불변.)

### SV-3. 오케스트레이터(room-orchestrator.ts): say → in-character

`src/realtime/room-orchestrator.ts`
1. `OrchestratorCommand`의 `SEND_CHAT`(124행)에 옵셔널 `inCharacter?: boolean` 추가:
   ```ts
   | { type: "SEND_CHAT"; from: PlayerId; text: string; inCharacter?: boolean }
   ```
2. `toReducerCommand`의 `SEND_CHAT` 분기(560~571)에서 그대로 전달:
   ```ts
   return {
     type: "SEND_CHAT",
     from: command.from,
     characterName: this.characterNameFor(roomId, command.from) ?? command.from,
     text: command.text,
     ts: this.nowIso(),
     ...(displayName !== undefined ? { displayName } : {}),
     ...(command.inCharacter ? { inCharacter: true } : {}),
   };
   ```

### SV-4. 인바운드 파싱(server.ts): `say` 메시지

`src/server.ts` 메시지 파서의 `case "chat"`(1817~1826) **바로 아래**에 `case "say"`를 추가한다.
`chat`와 **동일한 경계 검증**을 쓰되 orchestrator 커맨드에 `inCharacter: true`만 더한다:
```ts
case "say":
  if (typeof msg.text !== "string") return null;
  {
    const text = readBoundedText(msg.text, { /* chat과 동일한 field/maxLength/required */ });
    return text.ok
      ? { type: "SEND_CHAT", from: playerId, text: text.value, inCharacter: true }
      : null;
  }
```
(같은 파일의 커맨드 로깅(1676 부근)은 `command.type === "SEND_CHAT"`이면 이미 text를 남기므로 변경 불필요 — 확인만.)

### SV-5. AI narration 프롬프트(ai-gm-coordinator.ts): 대사 블록 + NPC 반응 지시

`src/ai/ai-gm-coordinator.ts` `buildNarrationPrompt`(1793~1790대). `UNTRUSTED_PLAYER_ACTIONS`
블록(1858 부근)을 만들기 직전에 **대사 블록**을 만들어 user 프롬프트에 이어 붙인다:
```ts
const dialogueLines = ctx.thisRound.chat
  .filter((c) => c.inCharacter === true)
  .map((c) => ({ speaker: c.characterName, text: c.text }));
const dialogueBlock =
  dialogueLines.length > 0
    ? "PLAYER_DIALOGUE (플레이어 인물들이 이번 장면에서 실제로 소리 내어 말한 대사입니다. " +
      "관련 NPC가 이 대사에 자연스럽게 반응하거나 대답하도록 서술에 반영하세요. 대사 자체를 " +
      "그대로 되풀이하지는 마세요.)\n" +
      formatUntrustedJsonBlock("UNTRUSTED_PLAYER_DIALOGUE", dialogueLines)
    : "";
```
그리고 반환하는 user 문자열에 `formatUntrustedJsonBlock("UNTRUSTED_PLAYER_ACTIONS", ...)` **앞**에
`dialogueBlock`을 삽입한다. (대사가 없으면 빈 문자열이라 프롬프트 불변.)
- `ctx.thisRound.chat` 항목이 `inCharacter`를 갖도록 하려면 `ChatEntry`(SV-2)에 필드가 있어야
  하며, `toContext`가 이미 `{...entry}`로 실으므로 자동 전달된다(추가 배선 불필요 — 확인만).
- **범위 한정**: decision 프롬프트(1785 `UNTRUSTED_PLAYER_ACTION_CONTEXT`)에는 이번 증분에서
  대사를 추가하지 않는다(narration만). 여기 손대지 말 것.

---

## CL. 클라이언트 — 대사를 중앙 무대로

### CL-1. 커맨드 빌더(logic.js): `buildSayCommand`

`public/game/logic.js` — `buildChatCommand`(750~) 옆에 추가:
```js
/**
 * 인물 대사(in-character) 전송 명령. 트림 후 비면 null. 서버가 chatLog에 inCharacter로 저장하고
 * 클라이언트는 중앙 무대에 표시한다.
 * @param {string} text
 * @returns {{ type: "say", text: string } | null}
 */
export function buildSayCommand(text) {
  const trimmed = trimToString(text);
  if (trimmed.length === 0) return null;
  return { type: "say", text: trimmed };
}
```

### CL-2. 입력 라우팅(app.js): 따옴표 대사 → say

`public/game/app.js`
1. import에 `buildSayCommand` 추가(18~25 블록).
2. `submit`의 says 루프(456~460)에서 `buildChatCommand`를 `buildSayCommand`로 교체:
   ```js
   for (const s of says) {
     if (!perm.canChat) break;
     const c = buildSayCommand(s);
     if (c) sendCommand(c);
   }
   ```
   나머지(권한 게이트 `perm.canChat`, action→confirm 경로, 로컬 에코)는 **그대로**.
   - 결과: `문을 열며 "누구 있어요?"` → say("누구 있어요?")는 중앙 대사, confirm("문을 열며")은
     행동 로그. 따옴표만 친 순수 대사(예: `"안녕하세요"`)는 confirm 없이 대사만 나간다.
   - resolving/rolling 중 입력은 기존대로 전량 `buildChatCommand`(OOC) — 손대지 말 것(442~448).

### CL-3. 표시 라우팅(logic.js `TURN_STATE`): IC는 중앙, OOC는 사이드

`public/game/logic.js` `TURN_STATE` case(966~1066). `appendNewChats` 직후(970 부근) 새 채팅을
IC/OOC로 나누고, 사이드(chatEntries)와 중앙(narrationEntries)에 각각 라우팅한다.

```js
const { entries: newChats, nextCount } = appendNewChats(state.chatCount, chatLog);
const newOoc = newChats.filter((c) => !(c && c.inCharacter));
const newIc = newChats.filter((c) => c && c.inCharacter);

// --- 사이드(OOC 잡담만) ---
let chatEntries = state.chatEntries;
if (
  chatEntries.length === 0 &&
  Array.isArray(turnState.chatHistory) &&
  turnState.chatHistory.length > 0
) {
  // 재연결 시드: 사이드에는 OOC만.
  chatEntries = turnState.chatHistory.filter((c) => !(c && c.inCharacter)).slice(-MAX_ENTRIES);
}
if (newOoc.length > 0) {
  chatEntries = chatEntries.concat(newOoc);
  if (chatEntries.length > MAX_ENTRIES) chatEntries = chatEntries.slice(chatEntries.length - MAX_ENTRIES);
}
```

`narrationEntries` 시드(990~996) 뒤에 IC 대사를 중앙에 이어 붙인다(roundNumber는 이 case에서
파생하는 `roundNumber` 재사용):
```js
let narrationEntries = state.narrationEntries;
if (narrationEntries.length === 0 && Array.isArray(turnState.narrativeContext)) {
  narrationEntries = narrativeContextToEntries(turnState.narrativeContext);
  if (narrationEntries.length > MAX_ENTRIES) narrationEntries = narrationEntries.slice(narrationEntries.length - MAX_ENTRIES);
}
if (newIc.length > 0) {
  const dialogueEntries = newIc.map((c) => ({
    kind: "dialogue",
    roundNumber,
    speaker: typeof c.characterName === "string" ? c.characterName : "",
    displayName: c.displayName,
    text: typeof c.text === "string" ? c.text : String(c.text),
  }));
  narrationEntries = narrationEntries.concat(dialogueEntries);
  if (narrationEntries.length > MAX_ENTRIES) narrationEntries = narrationEntries.slice(narrationEntries.length - MAX_ENTRIES);
}
```
- `chatCount`는 그대로 `nextCount`(= chatLog 전체 길이). IC/OOC 모두 세어야 diff 정합 유지.
- 재연결(첫 turn_state, chatCount=0): appendNewChats가 현재 라운드 chatLog 전체를 돌려주므로
  현재 라운드 IC는 중앙으로, OOC는 사이드로 자연히 시드된다. 지난 라운드 IC(chatHistory)는
  중앙에 복원하지 않는다(장면성 유지 — 범위 밖).
- `CHAT_MESSAGE` 라이브 case(1069~1075)는 현재 서버가 방출하지 않는 휴면 경로다. 손대지 않는다
  (혹시 방출되면 사이드로 가지만, 서버는 in-character를 chatLog로만 보낸다).

### CL-4. 중앙 렌더(story.js): 대사 줄

`public/game/views/story.js`
1. `narrationKey`(13~15)에 speaker를 포함해 대사끼리 키 충돌을 막는다:
   ```js
   function narrationKey(entry) {
     return `${entry.roundNumber ?? ""}|${entry.kind || ""}|${entry.speaker ?? ""}|${String(entry.text)}`;
   }
   ```
2. `renderStory`의 엔트리 루프(93~108)에서 `kind === "dialogue"`를 **타자기 없이** 별도 렌더한다.
   GM 서술 텍스트노드/타자기 경로로 내려가지 않게 분기 후 다음 엔트리로 넘어간다:
   ```js
   for (const entry of entries) {
     if (entry.kind === "dialogue") {
       const div = document.createElement("div");
       div.className = "line say";
       const speaker = typeof entry.speaker === "string" && entry.speaker.trim() ? entry.speaker.trim() : "누군가";
       div.append(textSpan("who say", speaker), document.createTextNode(` 「${entry.text}」`));
       frag.appendChild(div);
       continue;
     }
     // ↓ 기존 GM 서술 렌더(div.className = "gm " + kind, [GM · label], 타자기) 그대로
     ...
   }
   ```
   대사는 `activeTypewriter`를 만들지 않는다(즉시 표시). GM 서술의 타자기 로직은 그대로 두되,
   최신 엔트리가 대사면 위 `continue`로 인해 타자기가 시작되지 않는다(추가 가드 불필요).
3. 대기 표시(`waitingIndicator`)·DOM 상한 로직은 그대로.

### CL-5. 스타일(styles.css): `.line.say`

- `.line.say`: GM 서술(`.gm`)과 구분되는 인물 대사 줄. speaker(`.who.say`)는 강조색(민트/골드
  계열, 기존 토큰 재사용), 본문 `「대사」`는 약간 들여쓴 대화체. 기존 폰트/여백 토큰과 조화.
  과한 신규 색 도입 금지, `theme.css`/`styles.css`의 기존 변수 사용. 등장 애니메이션 없음.

### CL-6. 사이드(side.js)

변경 없음(IC 대사는 chatEntries로 들어오지 않으므로 사이드엔 OOC 잡담 + 행동 로그만 남는다).
**확인만** — side.js가 chatEntries만 순회하는지 재확인하고 그대로 둔다.

---

## 테스트 (필수)

- `src/core/turn-state.test.ts`: `inCharacter: true`인 chatLog/chatHistory 엔트리가 직렬화 왕복에서
  보존되고, 없으면 키가 붙지 않는다.
- `src/core/round-loop.test.ts`: `SEND_CHAT`에 `inCharacter: true`를 주면 chatLog 엔트리에
  `inCharacter: true`가 실린다(주지 않으면 부재).
- `src/ai/ai-gm-coordinator.test.ts`(프롬프트 텍스트 검증 테스트): `thisRound.chat`에 inCharacter
  대사가 있으면 narration user 프롬프트에 `UNTRUSTED_PLAYER_DIALOGUE`와 "NPC가 … 반응" 지시
  문구가 포함되고, 없으면 두 문구 모두 미포함.
- `public/game/`(happy-dom, 신규 `dialogue-center.test.js` 권장):
  ① `TURN_STATE`에 chatLog=[IC 대사, OOC 잡담] → `narrationEntries`에 `kind:"dialogue"`(speaker/text)
     1건 추가, `chatEntries`에는 OOC 1건만.
  ② 재연결: chatEntries 빈 상태 + chatHistory=[IC, OOC] → 사이드엔 OOC만 시드, IC는 사이드에 없음.
  ③ story 렌더: dialogue 엔트리가 `.line.say` + `누군가/이름` + `「대사」`로 렌더되고 `[GM · …]`
     라벨이 없으며 즉시 전체 텍스트가 보인다(타자기 미동작).
- `public/game/integration.test.js`(선택, 기존 주입 관례): ready 단계에서 `문을 열며 "누구 있어요?"`
  전송 시 `say`("누구 있어요?")와 `confirm`("문을 열며")가 각각 나간다.

## 착수 순서

SV-1 → SV-2 → SV-3 → SV-4 → SV-5 → (서버/AI 테스트) → CL-1 → CL-2 → CL-3 → CL-4 → CL-5 →
CL-6 확인 → (클라 테스트). 각 묶음 후 `npm run typecheck && npm test`.

## 수용 기준

- `npm run typecheck && npm test` 전부 통과.
- 따옴표 대사는 중앙 GM 무대에 `이름 「대사」`로 표시되고 사이드 로그에는 나타나지 않는다.
- 대기 중 잡담(OOC)과 행동 로그는 사이드에 그대로.
- narration 프롬프트에 대사가 실려 GM이 NPC 반응으로 이어 서술할 수 있다(프롬프트 테스트로 검증).
- 직렬화 왕복 불변, 무관 파일 변경·커밋 없음. 지시와 코드가 어긋난 지점은 보고.
