// @ts-check
/**
 * Game_Play_App 순수 로직 모듈 (게임 플레이 / 세션 진행 화면)
 *
 * 이 모듈은 DOM·네트워크·WebSocket·타이머에 의존하지 않는 순수 함수들만 모은다.
 * 인계 파싱·검증, 연결 토큰 전달 명세 구성, 실시간 이벤트(ServerEvent) 환원,
 * GM 서사 추가·상한, 채팅 append-new-only, 준비 수·카운트다운 도출, 입력 명령 빌더,
 * 입력 잠금 술어, 본인 행동 로컬 에코, 상태 전이(reduce), 뷰 모델 가시성 도출을 담당하며
 * vitest(node 환경)에서 직접 import 하여 단위/속성 테스트한다.
 *
 * 부수효과(주입 가능한 connect(roomId, token) WebSocket 어댑터·재연결, 명령 send,
 * 1초 카운트다운 타이머, MAX_ENTRIES DOM 상한, 입력 잠금/종료 처리, 본인 행동 로컬 에코)는
 * index.html의 스크립트(부수효과 계층)가 담당하고, 본 모듈이 만든 결정을 실행만 한다.
 *
 * 설계 문서: .kiro/specs/game-play/design.md
 */

// ---------------------------------------------------------------------------
// 상태 모델 상수 (State Model Constants)
// ---------------------------------------------------------------------------

/**
 * 라운드 루프 단계. (src/core/types.ts의 Phase와 동일)
 * @typedef {"free_chat" | "ready_check" | "resolving" | "ended"} Phase
 * - free_chat: 자유 대화 단계
 * - ready_check: 준비 체크 단계(카운트다운 표시)
 * - resolving: GM 판정/서술 중(입력 잠금 + busy 표시)
 * - ended: 세션 종료(입력 잠금)
 */

/** 라운드 루프 단계 상수. @type {Readonly<Record<string, Phase>>} */
export const Phase = Object.freeze({
  FREE_CHAT: "free_chat",
  READY_CHECK: "ready_check",
  RESOLVING: "resolving",
  ENDED: "ended",
});

/**
 * 실시간 연결 상태. (요구사항 2.4, 2.5, 8.x)
 * @typedef {"connecting" | "open" | "disconnected"} ConnectionStatus
 */

/** 연결 상태 상수. @type {Readonly<Record<string, ConnectionStatus>>} */
export const ConnectionStatus = Object.freeze({
  CONNECTING: "connecting",
  OPEN: "open",
  DISCONNECTED: "disconnected",
});

/**
 * GM 서사 종류. (요구사항 3.x, 9.1)
 * @typedef {"opening" | "resolution" | "closing"} NarrationKind
 */

/** GM 서사 종류 상수. @type {Readonly<Record<string, NarrationKind>>} */
export const NarrationKind = Object.freeze({
  OPENING: "opening",
  RESOLUTION: "resolution",
  CLOSING: "closing",
});

// ---------------------------------------------------------------------------
// 상한 상수 (Limit Constants)
// ---------------------------------------------------------------------------

/** GM 서사 패널·행동 로그·채팅 표시 항목 수 상한. 기존 public/index.html과 동일. (요구사항 3.3) */
export const MAX_ENTRIES = 250;

// ---------------------------------------------------------------------------
// 사용자 메시지 상수 (한국어 메시지)
// ---------------------------------------------------------------------------

/** 인계 정보(roomId/hostPlayerId)가 무효일 때의 안내. (요구사항 1.3, 1.4) */
export const HANDOFF_INVALID_MESSAGE =
  "게임 정보가 올바르지 않습니다. 로비로 돌아가 다시 시도해 주세요.";

/** 아직 실시간 채널에 연결되지 않았을 때의 안내. (요구사항 2.5) */
export const DISCONNECTED_MESSAGE = "아직 연결되지 않았습니다. 연결을 시도하고 있습니다.";

/** 실시간 연결이 끊겼을 때의 안내. (요구사항 2.5, 8.1) */
export const CONNECTION_LOST_MESSAGE = "실시간 연결이 끊겼습니다. 다시 연결을 시도하고 있습니다.";

/** 명령 전달이 실패했을 때(delivery_failed)의 안내. (요구사항 8.2) */
export const DELIVERY_FAILED_MESSAGE = "전송에 실패해 재시도하고 있습니다.";

/** 세션이 종료되었을 때의 안내. (요구사항 9.3) */
export const SESSION_ENDED_MESSAGE = "세션이 종료되었습니다. 함께해 주셔서 감사합니다.";

// ---------------------------------------------------------------------------
// 타입 주석 (JSDoc Typedefs)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Handoff
 * @property {string} roomId
 * @property {string} hostPlayerId
 * @property {string} playerId  관전자(본인) 식별자(없으면 빈 문자열). 비어 있으면 hostPlayerId로 대체.
 * @property {string} token  공유 비밀(없으면 빈 문자열)
 * @property {string} ticket  서버 발급 연결 티켓(없으면 빈 문자열). /ws 연결의 ?ticket= 으로 보낸다(auth-hardening).
 */

/**
 * @typedef {Object} NarrationEntry
 * @property {NarrationKind} kind
 * @property {number} roundNumber
 * @property {string} text
 */

/**
 * @typedef {Object} ChatEntry
 * @property {string} playerId
 * @property {string} characterName
 * @property {string} text
 * @property {string} ts
 * @property {string=} displayName  방 합류 표시 이름. 있으면 `characterName(displayName)`로 귀속 표시한다(없거나 characterName과 같으면 characterName만).
 */

/**
 * @typedef {Object} ActionEntry
 * @property {"confirm" | "pass"} kind
 * @property {string} playerId
 * @property {string | null} text
 */

/**
 * @typedef {Object} ReadinessEntry
 * @property {string} playerId
 * @property {"ready" | "not_ready"} status
 * @property {string | null} actionKind
 * @property {string | null} actionText
 */

/**
 * @typedef {Object} GameState
 * @property {Handoff} handoff                    인계(불변)
 * @property {boolean} handoffValid
 * @property {ConnectionStatus} connection
 * @property {string | null} deliveryFailedNotice delivery_failed 표시 (요구사항 8.2)
 * @property {boolean} turnReceived               첫 turn_state 수신 여부 (요구사항 1.4)
 * @property {number | null} roundNumber
 * @property {Phase | null} phase
 * @property {ReadinessEntry[]} readiness          준비 수 도출 원천 (요구사항 5.2, 5.3)
 * @property {string | null} readyCheckDeadline    카운트다운 기준 (요구사항 5.4)
 * @property {number} chatCount                    append-new-only 추적 (요구사항 4.1, 4.4)
 * @property {NarrationEntry[]} narrationEntries   MAX_ENTRIES 상한 (요구사항 3.3)
 * @property {ChatEntry[]} chatEntries             표시된 채팅(append-new-only)
 * @property {ActionEntry[]} actionLog             본인 confirm/pass 로컬 에코, MAX_ENTRIES 상한
 * @property {VisibleClock[]} clocks               최근 노출된 Progress Clock 스냅샷(노출 시나리오만)
 * @property {boolean} ended                       Session_Ended (요구사항 9.1)
 * @property {string | null} [activePlayerId]      [intended] 활성 플레이어(없으면 null) (요구사항 2.3)
 * @property {string[]} [turnOrder]                [intended] 턴 순서(없으면 []) (요구사항 2.4)
 */

/**
 * @typedef {Object} VisibleClock
 * @property {string} name
 * @property {number} value
 * @property {number} max
 */

/**
 * @typedef {{ type: string, [key: string]: any }} Action
 */

// ---------------------------------------------------------------------------
// 공용 보조 (Internal Helpers)
// ---------------------------------------------------------------------------

/**
 * 빈 문자열 여부를 안전하게 판단한다(문자열이 아니거나 길이 0이면 비어 있음).
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * 임의 값을 안전하게 트림된 문자열로 변환한다(null/undefined → "").
 * @param {unknown} value
 * @returns {string}
 */
function trimToString(value) {
  return String(value == null ? "" : value).trim();
}

// ---------------------------------------------------------------------------
// 초기 상태 팩토리 (Initial State Factory) — 작업 1.1
// ---------------------------------------------------------------------------

/**
 * 초기 상태를 생성한다. 인계를 받아 `handoffValid`를 함께 계산한다.
 *
 * 설계상 연결은 초기에 아직 열리지 않았으므로 `disconnected`로 둔다(부수효과 계층이
 * 채널을 열기 시작하면 CONNECTION_OPENED/LOST 액션으로 갱신된다). 첫 turn_state 전에는
 * `turnReceived`가 false라 입력이 비활성으로 유지된다(요구사항 1.4).
 *
 * @param {Handoff} handoff 인계 값(roomId/hostPlayerId/token)
 * @returns {GameState}
 */
export function createInitialState(handoff) {
  /** @type {Handoff} */
  const safeHandoff = {
    roomId: handoff ? String(handoff.roomId == null ? "" : handoff.roomId) : "",
    hostPlayerId: handoff ? String(handoff.hostPlayerId == null ? "" : handoff.hostPlayerId) : "",
    playerId: handoff ? String(handoff.playerId == null ? "" : handoff.playerId) : "",
    token: handoff ? String(handoff.token == null ? "" : handoff.token) : "",
    ticket: handoff ? String(handoff.ticket == null ? "" : handoff.ticket) : "",
  };
  return {
    handoff: safeHandoff,
    handoffValid: isHandoffValid(safeHandoff),
    connection: ConnectionStatus.DISCONNECTED,
    deliveryFailedNotice: null,
    turnReceived: false,
    roundNumber: null,
    phase: null,
    readiness: [],
    readyCheckDeadline: null,
    chatCount: 0,
    narrationEntries: [],
    chatEntries: [],
    actionLog: [],
    clocks: [],
    ended: false,
    // [intended] 턴 메타: turn_state 최상위 필드. 없으면 기본값 유지(단계 기반 폴백). (요구사항 2.3, 2.4, 7.2, 7.4)
    activePlayerId: null,
    turnOrder: [],
  };
}

// ---------------------------------------------------------------------------
// 인계 파싱·검증 (Handoff Parse / Validate) — 작업 2.1
// ---------------------------------------------------------------------------

/**
 * 페이지 URL 쿼리 문자열에서 인계 값을 추출한다.
 *
 * 선행 `?`(또는 `#`)가 있어도 없어도 받아들이며, `roomId`·`hostPlayerId`·`playerId`·`token`·`ticket`을
 * 공백 제거 후 추출한다. 토큰·티켓은 트림 후 비어 있으면 `""`로 둔다. `playerId`는 관전자(본인)
 * 식별자로, 캐릭터 화면 인계(`?roomId&playerId&token&ticket`)에서 실린다. `ticket`은 서버 발급
 * 연결 티켓(auth-hardening)이다. (요구사항 1.1, 1.2, 1.5)
 *
 * @param {string} search 쿼리 문자열(예: "?roomId=r1&hostPlayerId=h1&token=t")
 * @returns {Handoff}
 */
export function parseHandoff(search) {
  const raw = String(search == null ? "" : search);
  // 선행 "?"(또는 "#")를 제거한 뒤 URLSearchParams로 파싱한다.
  const query = raw.replace(/^[?#]/, "");
  const params = new URLSearchParams(query);
  return {
    roomId: trimToString(params.get("roomId")),
    hostPlayerId: trimToString(params.get("hostPlayerId")),
    playerId: trimToString(params.get("playerId")),
    token: trimToString(params.get("token")),
    ticket: trimToString(params.get("ticket")),
  };
}

/**
 * 인계의 유효성을 판정한다.
 *
 * 트림된 `roomId`가 비어 있지 않고, 관전자(본인) 식별자(`playerId` 우선, 없으면 `hostPlayerId`)가
 * 비어 있지 않을 때에만 true. 캐릭터 화면 인계로 합류한 비-호스트 플레이어는 `hostPlayerId` 없이
 * 자신의 `playerId`만 가지므로, 호스트뿐 아니라 그들도 유효한 인계로 인정한다. 실제 소켓 식별은
 * 서버 발급 연결 티켓(auth-hardening)으로 이뤄진다. (요구사항 1.3)
 *
 * @param {Handoff} handoff
 * @returns {boolean}
 */
export function isHandoffValid(handoff) {
  if (!handoff) return false;
  return (
    trimToString(handoff.roomId).length >= 1 &&
    effectivePlayerId(handoff).length >= 1
  );
}

/**
 * 관전자(본인) 식별자를 도출한다.
 *
 * 인계의 `playerId`가 (트림 후) 비어 있지 않으면 그 값을, 비어 있으면 `hostPlayerId`(트림)를,
 * 둘 다 비어 있으면 `""`를 반환한다. 즉 캐릭터 화면 인계로 합류한 비-호스트 플레이어는
 * 자신의 `playerId`로, 로비 호스트 인계는 `hostPlayerId`로 연결한다. null-safe + 트림. (요구사항 1.x)
 *
 * @param {Handoff} handoff
 * @returns {string}
 */
export function effectivePlayerId(handoff) {
  if (!handoff) return "";
  const playerId = trimToString(handoff.playerId);
  if (playerId.length >= 1) return playerId;
  return trimToString(handoff.hostPlayerId);
}

// ---------------------------------------------------------------------------
// 연결 토큰 전달 (Connect Spec Builder) — 작업 2.3
// ---------------------------------------------------------------------------

/**
 * 연결 파라미터를 구성한다.
 *
 * `roomId`를 `encodeURIComponent`로 인코딩해 쿼리에 포함하고, 토큰이 비어 있지 않으면
 * `token`도 `encodeURIComponent`로 인코딩해 포함한다. 토큰이 비어 있으면 쿼리에 `token`을
 * 포함하지 않는다. `playerId`가 비어 있지 않으면 `playerId`도 인코딩해 포함한다(비어 있으면
 * 생략) — 서버 `/ws`가 룸에 속한 해당 플레이어로 소켓을 귀속한다(아니면 호스트로 폴백).
 * `ticket`이 비어 있지 않으면 `ticket`도 인코딩해 포함한다(비어 있으면 생략) — 서버 `/ws`는
 * 이 연결 티켓으로만 신원을 도출한다(auth-hardening). 반환의 `token`·`playerId`·`ticket` 필드는
 * (있으면) 원래 값, 없으면 `""`. (요구사항 1.2, 1.5, 10.1, 10.2, 10.3)
 *
 * @param {string} roomId
 * @param {string} token
 * @param {string} [playerId] 관전자(본인) 식별자(effectivePlayerId 결과). 비어 있으면 생략.
 * @param {string} [ticket] 서버 발급 연결 티켓. 비어 있으면 생략.
 * @returns {{ roomId: string, token: string, playerId: string, ticket: string, query: string }}
 */
export function buildConnectParams(roomId, token, playerId, ticket) {
  const safeRoomId = String(roomId == null ? "" : roomId);
  const safeToken = String(token == null ? "" : token);
  const safePlayerId = String(playerId == null ? "" : playerId);
  const safeTicket = String(ticket == null ? "" : ticket);
  const params = new URLSearchParams();
  params.set("roomId", safeRoomId);
  if (isNonEmptyString(safeToken)) {
    params.set("token", safeToken);
  }
  if (isNonEmptyString(safePlayerId)) {
    params.set("playerId", safePlayerId);
  }
  // 서버 발급 연결 티켓이 있으면 /ws 쿼리에 포함한다(auth-hardening: /ws는 ticket으로만 신원 도출).
  if (isNonEmptyString(safeTicket)) {
    params.set("ticket", safeTicket);
  }
  return {
    roomId: safeRoomId,
    token: safeToken,
    playerId: safePlayerId,
    ticket: safeTicket,
    query: params.toString(),
  };
}

// ---------------------------------------------------------------------------
// 실시간 이벤트 → 액션 환원 (Event To Action) — 작업 2.5
// ---------------------------------------------------------------------------

/**
 * 서버 → 클라이언트 실시간 이벤트(ServerEvent)를 순수 액션으로 환원한다.
 *
 * 입력 이벤트는 `type` 필드를 가진다(`src/realtime/connection.ts`의 ServerEvent).
 * - `turn_state` ({ state }) → TURN_STATE { state }
 * - `chat_message` ({ message }) → CHAT_MESSAGE { message }
 * - `narration` ({ narration: { kind, roundNumber, text } }) → NARRATION { kind, roundNumber, text }
 * - `readiness_updated` ({ readiness }) → READINESS_UPDATED { readiness }
 * - `scenario_set` ({ scenarioId, title, summary }) → SCENARIO_SET { … }
 * - `delivery_failed` ({ failedType, detail }) → DELIVERY_FAILED { failedType, detail }
 * - 합성 `connection-open`/`connection-lost` → CONNECTION_OPENED / CONNECTION_LOST (배선 계층용)
 * 관심 없는 이벤트(`player_list_updated`)와 알 수 없는 `type`은 null(게임 화면 무시).
 * (요구사항 2.2, 3.1, 4.2, 5.2, 8.2)
 *
 * @param {{ type: string, [key: string]: any }} event
 * @returns {Action | null}
 */
export function eventToAction(event) {
  const type = event ? event.type : undefined;
  switch (type) {
    case "turn_state":
      return { type: "TURN_STATE", state: event.state };
    case "chat_message":
      return { type: "CHAT_MESSAGE", message: event.message };
    case "narration": {
      const narration = event.narration || {};
      /** @type {Action} */
      const action = {
        type: "NARRATION",
        kind: narration.kind,
        roundNumber: narration.roundNumber,
        text: narration.text,
      };
      // 노출 시나리오의 payload에만 실리는 clock 스냅샷은 있을 때만 포함한다
      // (없을 때 액션 형태를 동일하게 유지 → 기존 환원 계약 보존).
      if (Array.isArray(narration.clocks)) action.clocks = narration.clocks;
      return action;
    }
    case "readiness_updated":
      return { type: "READINESS_UPDATED", readiness: event.readiness };
    case "scenario_set":
      return {
        type: "SCENARIO_SET",
        scenarioId: event.scenarioId,
        title: event.title,
        summary: event.summary,
      };
    case "delivery_failed":
      return { type: "DELIVERY_FAILED", failedType: event.failedType, detail: event.detail };
    // 배선 계층이 주입하는 합성 연결 이벤트(room-lobby와 동형).
    case "connection-open":
      return { type: "CONNECTION_OPENED" };
    case "connection-lost":
      return { type: "CONNECTION_LOST" };
    // 게임 화면이 무시하는 이벤트.
    case "player_list_updated":
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// GM 서사 뷰 모델 (Narration View) — 작업 3.1
// ---------------------------------------------------------------------------

/**
 * HTML 특수문자를 이스케이프한다. public/index.html·host-entry의 esc() 패턴을 따른다.
 * (요구사항 3.4, 4.3)
 * @param {unknown} value
 * @returns {string}
 */
export function esc(value) {
  return String(value).replace(
    /[&<>]/g,
    (c) => /** @type {Record<string, string>} */ ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
}

/**
 * GM 서사 항목을 끝에 추가하고 길이가 MAX_ENTRIES를 넘으면 앞에서 잘라 상한을 유지한다.
 * 입력 배열을 변형하지 않고 새 배열을 반환한다(불변). (요구사항 3.1, 3.3)
 *
 * @param {NarrationEntry[]} entries
 * @param {NarrationEntry} entry
 * @returns {NarrationEntry[]}
 */
export function appendNarration(entries, entry) {
  const list = Array.isArray(entries) ? entries : [];
  const next = list.concat([entry]);
  if (next.length > MAX_ENTRIES) {
    // 가장 오래된 것부터 제거해 상한(<= MAX_ENTRIES)을 유지한다.
    return next.slice(next.length - MAX_ENTRIES);
  }
  return next;
}

/**
 * Narrative_Context(`{ round, text }` 목록)를 표시용 서사 항목으로 순서 보존 변환한다.
 * 재동기화 시 기록 순서대로 반영하기 위함이다. (요구사항 3.2)
 *
 * @param {{ round: number, text: string }[]} narrativeContext
 * @returns {NarrationEntry[]}
 */
export function narrativeContextToEntries(narrativeContext) {
  const list = Array.isArray(narrativeContext) ? narrativeContext : [];
  return list.map((item) => ({
    kind: NarrationKind.RESOLUTION,
    roundNumber: item ? item.round : 0,
    text: item ? item.text : "",
  }));
}

// ---------------------------------------------------------------------------
// Progress Clock 뷰 모델 (Clock View)
// ---------------------------------------------------------------------------

/**
 * 노출용 Progress Clock 한 개를 안전하게 정규화한다. `max`는 1 이상 정수로,
 * `value`는 `[0, max]`로 클램프한다. 잘못된 페이로드(음수/초과/비수)도 깨지지 않게 한다.
 *
 * @param {{ name?: unknown, value?: unknown, max?: unknown }} clock
 * @returns {VisibleClock}
 */
export function describeClock(clock) {
  const rawMax = clock ? Number(clock.max) : 0;
  const max = Number.isFinite(rawMax) && rawMax > 0 ? Math.trunc(rawMax) : 0;
  const rawValue = clock ? Number(clock.value) : 0;
  const value = Number.isFinite(rawValue) ? Math.max(0, Math.min(max, Math.trunc(rawValue))) : 0;
  return { name: trimToString(clock ? clock.name : ""), value, max };
}

// ---------------------------------------------------------------------------
// 채팅 뷰 모델 (Chat View, append-new-only) — 작업 3.3
// ---------------------------------------------------------------------------

/**
 * Chat_Log에서 직전 표시 수를 초과하는 새 항목만 추려 반환한다.
 *
 * `chatLog.length >= prevCount`이면 인덱스 `prevCount` 이후 항목만 새 항목으로,
 * `chatLog.length < prevCount`(라운드 전환으로 축소)이면 `prevCount`를 0으로 보고 전체를
 * 새 항목으로 반환한다. 어느 경우든 `nextCount === chatLog.length`. (요구사항 4.1, 4.4)
 *
 * @param {number} prevCount
 * @param {ChatEntry[]} chatLog
 * @returns {{ entries: ChatEntry[], nextCount: number }}
 */
export function appendNewChats(prevCount, chatLog) {
  const list = Array.isArray(chatLog) ? chatLog : [];
  const prev = typeof prevCount === "number" && prevCount > 0 ? prevCount : 0;
  // 축소(라운드 전환) 시 prevCount를 0으로 보고 전부를 새 항목으로 본다.
  const start = list.length >= prev ? prev : 0;
  return {
    entries: list.slice(start),
    nextCount: list.length,
  };
}

// ---------------------------------------------------------------------------
// 헤더/상태 뷰 모델 (Header View) — 작업 3.5
// ---------------------------------------------------------------------------

/**
 * readiness 배열에서 준비 수를 도출한다.
 * `ready = status === "ready" 개수`, `total = 배열 길이`. (요구사항 5.2, 5.3)
 *
 * @param {ReadinessEntry[]} readiness
 * @returns {{ ready: number, total: number }}
 */
export function computeReadyCount(readiness) {
  const list = Array.isArray(readiness) ? readiness : [];
  let ready = 0;
  for (const entry of list) {
    if (entry && entry.status === "ready") ready += 1;
  }
  return { ready, total: list.length };
}

/**
 * Ready_Check_Deadline 기준 남은 시간(ms)을 도출한다.
 *
 * `deadlineIso`가 null/무효이면 null, 아니면 `max(0, deadlineMs - nowMs)`(마감 경과 시 0).
 * (요구사항 5.4)
 *
 * @param {string | null} deadlineIso
 * @param {number} nowMs
 * @returns {number | null}
 */
export function computeCountdownMs(deadlineIso, nowMs) {
  if (deadlineIso == null) return null;
  const deadlineMs = Date.parse(deadlineIso);
  if (Number.isNaN(deadlineMs)) return null;
  return Math.max(0, deadlineMs - nowMs);
}

/**
 * busy 표시 여부를 판단한다. `phase === "resolving"`일 때만 true. (요구사항 5.4, 5.5)
 *
 * @param {string} phase
 * @returns {boolean}
 */
export function computeBusy(phase) {
  return phase === Phase.RESOLVING;
}

// ---------------------------------------------------------------------------
// 입력 명령 빌더 (Command Builders) — 작업 3.8
// ---------------------------------------------------------------------------

/**
 * 말하기 명령을 만든다. 트림 후 비어 있으면 null. (요구사항 6.1, 6.5)
 * @param {string} text
 * @returns {{ type: "chat", text: string } | null}
 */
export function buildChatCommand(text) {
  const trimmed = trimToString(text);
  if (trimmed.length === 0) return null;
  return { type: "chat", text: trimmed };
}

/**
 * 행동 확정 명령을 만든다. 트림 후 비어 있으면 null. (요구사항 6.2, 6.5)
 * @param {string} action
 * @returns {{ type: "confirm", action: string } | null}
 */
export function buildConfirmCommand(action) {
  const trimmed = trimToString(action);
  if (trimmed.length === 0) return null;
  return { type: "confirm", action: trimmed };
}

/**
 * 패스 명령을 만든다. 항상 유효(입력 불필요). (요구사항 6.3)
 * @returns {{ type: "pass" }}
 */
export function buildPassCommand() {
  return { type: "pass" };
}

/**
 * 행동 수정 명령을 만든다. 트림 후 비어 있으면 null. (요구사항 6.4, 6.5)
 * @param {string} action
 * @returns {{ type: "revise", action: string } | null}
 */
export function buildReviseCommand(action) {
  const trimmed = trimToString(action);
  if (trimmed.length === 0) return null;
  return { type: "revise", action: trimmed };
}

// ---------------------------------------------------------------------------
// 입력 잠금·세션 종료 감지 (Input Lock / Session End) — 작업 3.10
// ---------------------------------------------------------------------------

/**
 * 입력 잠금 여부를 판단한다. `phase`가 `resolving` 또는 `ended`일 때만 true.
 * (요구사항 7.1, 7.2, 7.3)
 *
 * @param {string} phase
 * @returns {boolean}
 */
export function isInputLocked(phase) {
  return phase === Phase.RESOLVING || phase === Phase.ENDED;
}

/**
 * 세션 종료 여부를 감지한다. `phase === "ended"` 또는 `narrationKind === "closing"`이면 true.
 * (요구사항 9.1)
 *
 * @param {{ phase?: string, narrationKind?: string }} input
 * @returns {boolean}
 */
export function detectSessionEnded(input) {
  if (!input) return false;
  return input.phase === Phase.ENDED || input.narrationKind === NarrationKind.CLOSING;
}

// ---------------------------------------------------------------------------
// 본인 행동 로컬 에코 (Local Echo) — 작업 3.12
// ---------------------------------------------------------------------------

/**
 * 행동 로그 항목을 끝에 추가하고 길이가 MAX_ENTRIES를 넘으면 앞에서 잘라 상한을 유지한다.
 * 입력 배열을 변형하지 않고 새 배열을 반환한다(불변). (요구사항 6.2, 6.3)
 *
 * @param {ActionEntry[]} log
 * @param {ActionEntry} entry
 * @returns {ActionEntry[]}
 */
export function appendActionLog(log, entry) {
  const list = Array.isArray(log) ? log : [];
  const next = list.concat([entry]);
  if (next.length > MAX_ENTRIES) {
    return next.slice(next.length - MAX_ENTRIES);
  }
  return next;
}

/**
 * 본인 확정 행동 로컬 에코 항목을 만든다. (요구사항 6.2)
 * @param {string} playerId
 * @param {string} action
 * @returns {ActionEntry}
 */
export function makeConfirmEcho(playerId, action) {
  return { kind: "confirm", playerId, text: action };
}

/**
 * 본인 패스 로컬 에코 항목을 만든다. (요구사항 6.3)
 * @param {string} playerId
 * @returns {ActionEntry}
 */
export function makePassEcho(playerId) {
  return { kind: "pass", playerId, text: null };
}

// ---------------------------------------------------------------------------
// 상태 리듀서 (Reducer) — 작업 4.1
// ---------------------------------------------------------------------------

/**
 * 단방향 상태 전이 리듀서. 입력 상태를 변형하지 않고 항상 새 객체를 반환한다.
 * 단, 변화가 없는(no-op) 액션은 동일 참조를 그대로 반환한다.
 *
 * 실시간 이벤트와 사용자 입력 로컬 에코를 단일 통로로 흡수한다. 명령 전송·입력 필드 비우기는
 * 부수효과 계층의 책임이며, reduce는 로컬 에코·표시 상태만 다룬다.
 *
 * @param {GameState} state
 * @param {Action} action
 * @returns {GameState}
 */
export function reduce(state, action) {
  const type = action ? action.type : undefined;

  switch (type) {
    // -- 인계 (요구사항 1.x) --------------------------------------------------
    case "HANDOFF_PARSED": {
      const handoff = /** @type {Handoff} */ (action.handoff) || {
        roomId: "",
        hostPlayerId: "",
        playerId: "",
        token: "",
        ticket: "",
      };
      // handoff 저장 + handoffValid 갱신. 무효면 연결을 시작하지 않으므로 disconnected 유지.
      return {
        ...state,
        handoff,
        handoffValid: isHandoffValid(handoff),
      };
    }

    // -- 연결 상태 (요구사항 2.4, 2.5, 8.x) ----------------------------------
    case "CONNECTION_OPENED": {
      if (state.connection === ConnectionStatus.OPEN) return state;
      return { ...state, connection: ConnectionStatus.OPEN };
    }

    case "CONNECTION_LOST": {
      if (state.connection === ConnectionStatus.DISCONNECTED) return state;
      return { ...state, connection: ConnectionStatus.DISCONNECTED };
    }

    // -- Turn_State 적용 (요구사항 2.2, 3.2, 4.1, 4.4, 5.x, 9.1) -------------
    case "TURN_STATE": {
      const turnState = action.state || {};
      // append-new-only로 새 채팅만 추가하고 chatCount 갱신(요구사항 4.1/4.4).
      const chatLog = Array.isArray(turnState.chatLog) ? turnState.chatLog : [];
      const { entries: newChats, nextCount } = appendNewChats(state.chatCount, chatLog);
      let chatEntries = state.chatEntries;
      if (newChats.length > 0) {
        chatEntries = state.chatEntries.concat(newChats);
        if (chatEntries.length > MAX_ENTRIES) {
          chatEntries = chatEntries.slice(chatEntries.length - MAX_ENTRIES);
        }
      }
      // 재동기화 시 Narrative_Context를 순서대로 반영(요구사항 3.2). 결정적 동작을 위해
      // 서사 패널이 비어 있을 때에만 시드한다(라이브 narration이 이미 채웠으면 보존).
      let narrationEntries = state.narrationEntries;
      if (narrationEntries.length === 0 && Array.isArray(turnState.narrativeContext)) {
        narrationEntries = narrativeContextToEntries(turnState.narrativeContext);
        if (narrationEntries.length > MAX_ENTRIES) {
          narrationEntries = narrationEntries.slice(narrationEntries.length - MAX_ENTRIES);
        }
      }
      const phase = turnState.phase != null ? turnState.phase : state.phase;
      const ended = state.ended || detectSessionEnded({ phase });
      return {
        ...state,
        turnReceived: true,
        roundNumber: turnState.roundNumber != null ? turnState.roundNumber : state.roundNumber,
        phase,
        readiness: Array.isArray(turnState.readiness) ? turnState.readiness : state.readiness,
        readyCheckDeadline:
          turnState.readyCheckDeadline !== undefined
            ? turnState.readyCheckDeadline
            : state.readyCheckDeadline,
        chatCount: nextCount,
        chatEntries,
        narrationEntries,
        ended,
        // [intended] 턴 메타 선택적 흡수: 값이 없으면 기존 상태 보존(요구사항 2.3, 2.4, 7.2, 7.4).
        activePlayerId:
          turnState.activePlayerId !== undefined ? turnState.activePlayerId : state.activePlayerId,
        turnOrder: Array.isArray(turnState.turnOrder) ? turnState.turnOrder : state.turnOrder,
      };
    }

    // -- 라이브 채팅 (요구사항 4.2) ------------------------------------------
    case "CHAT_MESSAGE": {
      let chatEntries = state.chatEntries.concat([/** @type {ChatEntry} */ (action.message)]);
      if (chatEntries.length > MAX_ENTRIES) {
        chatEntries = chatEntries.slice(chatEntries.length - MAX_ENTRIES);
      }
      return { ...state, chatEntries, chatCount: state.chatCount + 1 };
    }

    // -- GM 서사 (요구사항 3.1, 3.3, 9.1) ------------------------------------
    case "NARRATION": {
      /** @type {NarrationEntry} */
      const entry = {
        kind: /** @type {NarrationKind} */ (action.kind),
        roundNumber: /** @type {number} */ (action.roundNumber),
        text: /** @type {string} */ (action.text),
      };
      const narrationEntries = appendNarration(state.narrationEntries, entry);
      const ended = state.ended || action.kind === NarrationKind.CLOSING;
      // 노출 시나리오의 narration payload는 clock 스냅샷을 함께 싣는다(있으면 갱신).
      const clocks = Array.isArray(action.clocks) ? action.clocks : state.clocks;
      return { ...state, narrationEntries, clocks, ended };
    }

    // -- 준비 갱신 (요구사항 5.2, 5.3) ---------------------------------------
    case "READINESS_UPDATED": {
      return {
        ...state,
        readiness: Array.isArray(action.readiness) ? action.readiness : [],
      };
    }

    // -- 시나리오 표시(선택, 게임 진행 영향 없음) ----------------------------
    case "SCENARIO_SET": {
      return {
        ...state,
        scenario: {
          scenarioId: action.scenarioId,
          title: action.title,
          summary: action.summary,
        },
      };
    }

    // -- 전달 실패 (요구사항 8.2) --------------------------------------------
    case "DELIVERY_FAILED": {
      return { ...state, deliveryFailedNotice: DELIVERY_FAILED_MESSAGE };
    }

    // -- 본인 행동 로컬 에코 (요구사항 6.2, 6.3) -----------------------------
    case "CONFIRM_ACTION": {
      const entry = makeConfirmEcho(
        /** @type {string} */ (action.playerId),
        /** @type {string} */ (action.action),
      );
      return { ...state, actionLog: appendActionLog(state.actionLog, entry) };
    }

    case "PASS": {
      const entry = makePassEcho(/** @type {string} */ (action.playerId));
      return { ...state, actionLog: appendActionLog(state.actionLog, entry) };
    }

    // -- 상태 무변화(명령 전송만) (요구사항 6.4) -----------------------------
    case "REVISE":
    case "SEND_CHAT":
      return state;

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// 뷰 모델 가시성 (Visibility) — 작업 5.1
// ---------------------------------------------------------------------------

/**
 * 화면 가시성을 상태의 함수로 도출한다(순수 함수).
 *
 * - `connectionActive`: `connection === "open"`일 때만 true (요구사항 2.4)
 * - `busy`: `phase === "resolving"`일 때만 true (요구사항 5.5)
 * - `inputDisabled`: 인계 무효, 첫 turn_state 미수신, 종료, 입력 잠금, 미연결 중 하나라도 참이면 true
 *   (요구사항 1.4, 7.1, 9.2)
 * - `ended`: 세션 종료 여부 (요구사항 9.2)
 * - `disconnected`: `connection !== "open"` (요구사항 2.5, 8.1)
 * - `deliveryFailedNotice`: 전달 실패 안내 (요구사항 8.2)
 * - `ready`: 준비 수 (요구사항 5.2, 5.3)
 *
 * @param {GameState} state
 * @returns {{
 *   handoffValid: boolean,
 *   connectionActive: boolean,
 *   busy: boolean,
 *   inputDisabled: boolean,
 *   ended: boolean,
 *   disconnected: boolean,
 *   deliveryFailedNotice: string | null,
 *   ready: { ready: number, total: number },
 * }}
 */
export function computeVisibility(state) {
  const connectionActive = state.connection === ConnectionStatus.OPEN;
  const busy = state.phase === Phase.RESOLVING;
  // GM 오프닝이 아직 도착하지 않았으면(첫 turn_state는 받았지만 서사가 비어 있음) 우리 턴이
  // 아니므로 입력을 잠근다(요구사항: 오프닝~우리 턴까지 보내기/패스/수정 비활성).
  const narrationEntries = Array.isArray(state.narrationEntries) ? state.narrationEntries : [];
  const openingPending =
    state.turnReceived === true && state.ended !== true && narrationEntries.length === 0;
  const inputDisabled =
    !state.handoffValid ||
    state.turnReceived === false ||
    state.ended === true ||
    isInputLocked(/** @type {string} */ (state.phase)) ||
    !connectionActive ||
    openingPending;
  return {
    handoffValid: state.handoffValid,
    connectionActive,
    busy,
    inputDisabled,
    ended: state.ended,
    disconnected: !connectionActive,
    deliveryFailedNotice: state.deliveryFailedNotice,
    ready: computeReadyCount(state.readiness),
  };
}

// ---------------------------------------------------------------------------
// 멀티플레이 파생 셀렉터 (Multiplayer Derivation Selectors)
//   multiplayer-game-ux 스펙: 기존 game-play 위 가산 계층. 모두 순수 함수이며
//   기존 reducer/state/visibility/command 경로를 변경하지 않는다.
//   설계 문서: .kiro/specs/multiplayer-game-ux/design.md
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} RosterEntry
 * @property {string} playerId
 * @property {string} characterName
 * @property {string} displayName                  방 합류 표시 이름(없으면 "")
 * @property {"connected" | "disconnected" | "unknown"} connectionStatus
 * @property {"ready" | "not_ready"} status
 * @property {string | null} actionKind
 * @property {boolean} hasActed                    actionKind != null
 * @property {boolean} isSelf                      playerId === viewerPlayerId
 */

/**
 * @typedef {Object} SelfStatus
 * @property {"ready" | "not_ready" | null} status
 * @property {string | null} actionKind
 * @property {string | null} actionText
 * @property {boolean} hasActed
 * @property {boolean} spectator                   본인 readiness 항목 없음
 */

/**
 * @typedef {Object} PhaseModel
 * @property {Phase | null} phase
 * @property {string | null} activePlayerId
 * @property {string[]} turnOrder
 * @property {string[]} actablePlayerIds
 * @property {boolean} isTurnBased
 */

/**
 * @typedef {Object} ActionPermission
 * @property {boolean} canChat
 * @property {boolean} canConfirm
 * @property {boolean} canPass
 * @property {boolean} canRevise
 * @property {boolean} locked
 * @property {boolean} spectator
 */

// ---------------------------------------------------------------------------
// 1. 캐릭터 이름 폴백 도출 (Character Name Fallback) — 작업 1.1
// ---------------------------------------------------------------------------

/**
 * 한 `playerId`의 가장 최근 채팅 항목의 트림된 `characterName`을 도출한다.
 *
 * `chatLog`가 배열이 아니면 `""`. 배열이면 끝에서부터 훑어 `playerId`가 일치하는 첫 항목의
 * 트림된 `characterName`을 반환하고, 그 값이 (트림 후) 비어 있으면 `""`. (요구사항 1.2)
 *
 * @param {string} playerId
 * @param {ChatEntry[]} chatLog
 * @returns {string}
 */
export function latestChatCharacterName(playerId, chatLog) {
  if (!Array.isArray(chatLog)) return "";
  for (let i = chatLog.length - 1; i >= 0; i -= 1) {
    const entry = chatLog[i];
    if (entry && entry.playerId === playerId) {
      return trimToString(entry.characterName);
    }
  }
  return "";
}

/**
 * 한 `playerId`의 가장 최근 채팅 항목의 트림된 `displayName`(방 합류 이름)을 도출한다.
 * 없으면 `""`. 로스터의 "캐릭터이름(합류이름)" 표시 폴백에 쓴다.
 *
 * @param {string} playerId
 * @param {ChatEntry[]} chatLog
 * @returns {string}
 */
export function latestChatDisplayName(playerId, chatLog) {
  if (!Array.isArray(chatLog)) return "";
  for (let i = chatLog.length - 1; i >= 0; i -= 1) {
    const entry = chatLog[i];
    if (entry && entry.playerId === playerId) {
      return trimToString(entry.displayName);
    }
  }
  return "";
}

/**
 * 표시용 Character_Name을 결정적 폴백 순서로 도출한다.
 *
 * (a) intended `readinessEntry.characterName`이 트림 후 비어 있지 않으면 그 값,
 * (b) 아니면 해당 `playerId`의 가장 최근 `chatLog.characterName`(트림 후 비어 있지 않으면),
 * (c) 그것도 없으면 `playerId` 자체. 예외를 던지지 않는다. (요구사항 1.2)
 *
 * @param {string} playerId
 * @param {ReadinessEntry & { characterName?: string } | null | undefined} readinessEntry
 * @param {ChatEntry[]} chatLog
 * @returns {string}
 */
export function characterNameFor(playerId, readinessEntry, chatLog) {
  const intended = readinessEntry ? trimToString(readinessEntry.characterName) : "";
  if (intended.length > 0) return intended;
  const fromChat = latestChatCharacterName(playerId, chatLog);
  if (fromChat.length > 0) return fromChat;
  return playerId;
}

// ---------------------------------------------------------------------------
// 2. 참가자 로스터 도출 (Roster Model) — 작업 2.1
// ---------------------------------------------------------------------------

/**
 * `turnState.readiness` 항목 하나당 Roster_Entry 하나를 순서 보존으로 도출한다.
 *
 * `readiness`가 배열이 아니면 `[]`. 각 행의 `connectionStatus`는 intended 값이
 * `"connected"`/`"disconnected"`이면 그 값, 아니면 `"unknown"`. `hasActed = actionKind != null`,
 * `isSelf = playerId === viewerPlayerId`. (요구사항 1.1, 1.4, 1.5, 4.2, 5.2, 5.4)
 *
 * @param {{ readiness?: any, chatLog?: ChatEntry[] }} turnState
 * @param {string} viewerPlayerId
 * @returns {RosterEntry[]}
 */
export function rosterModel(turnState, viewerPlayerId) {
  const ts = turnState || {};
  const readiness = Array.isArray(ts.readiness) ? ts.readiness : [];
  const chatLog = Array.isArray(ts.chatLog) ? ts.chatLog : [];
  return readiness.map((entry) => {
    const item = entry || {};
    const playerId = item.playerId;
    const connectionStatus =
      item.connectionStatus === "connected" || item.connectionStatus === "disconnected"
        ? item.connectionStatus
        : "unknown";
    const actionKind = item.actionKind != null ? item.actionKind : null;
    // 방 합류 표시 이름: readiness에 실린 값 우선(게이트웨이가 주입), 없으면 최근 채팅에서 폴백.
    const intendedDisplay = item.displayName != null ? trimToString(item.displayName) : "";
    const displayName =
      intendedDisplay.length > 0 ? intendedDisplay : latestChatDisplayName(playerId, chatLog);
    return {
      playerId,
      characterName: characterNameFor(playerId, item, chatLog),
      displayName,
      connectionStatus,
      status: item.status,
      actionKind,
      hasActed: actionKind != null,
      isSelf: playerId === viewerPlayerId,
    };
  });
}

/**
 * 현재 라운드 행동 로그를 `readiness`에서 도출한다(서버 권위 → 전원 동기화).
 *
 * 각 readiness 항목 중 `actionKind`가 있는 것만 포함한다: `confirmed_action`은 확정 행동
 * (텍스트 포함), `pass`/`auto_pass`는 패스(자동 여부 구분). 이름은 항목의 `characterName`/
 * `displayName`(게이트웨이 주입) 우선, 없으면 최근 채팅에서 폴백한다. readiness가 라운드마다
 * 초기화되므로 이 로그는 "이번 라운드" 행동을 보여준다. 예외를 던지지 않는다.
 *
 * @param {{ readiness?: any, chatLog?: ChatEntry[] }} turnState
 * @returns {Array<{ playerId: string, characterName: string, displayName: string, kind: "confirm" | "pass", text: string | null, auto: boolean }>}
 */
export function actionLogModel(turnState) {
  const ts = turnState || {};
  const readiness = Array.isArray(ts.readiness) ? ts.readiness : [];
  const chatLog = Array.isArray(ts.chatLog) ? ts.chatLog : [];
  const out = [];
  for (const entry of readiness) {
    const item = entry || {};
    const kind = item.actionKind;
    if (kind == null) continue;
    const isConfirm = kind === "confirmed_action";
    const intendedDisplay = item.displayName != null ? trimToString(item.displayName) : "";
    const displayName =
      intendedDisplay.length > 0 ? intendedDisplay : latestChatDisplayName(item.playerId, chatLog);
    out.push({
      playerId: item.playerId,
      characterName: characterNameFor(item.playerId, item, chatLog),
      displayName,
      kind: isConfirm ? "confirm" : "pass",
      text: isConfirm ? (item.actionText != null ? String(item.actionText) : "") : null,
      auto: kind === "auto_pass",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. 단계·차례 모델 (Phase / Turn Model) — 작업 3.1
// ---------------------------------------------------------------------------

/**
 * 현재 단계에서 행동할 수 있는 활성 플레이어 집합을 도출한다.
 *
 * 의도된 턴 기반: `activePlayerId`가 (truthy) 존재하면 그 플레이어만 행동 가능.
 * 단계 기반 폴백: `phase`가 `free_chat`/`ready_check`이면 `status !== "ready"`인 `playerId`,
 * `resolving`/`ended`(및 알 수 없는 값)이면 빈 집합. 예외를 던지지 않는다. (요구사항 2.2, 2.3, 2.5)
 *
 * @param {{ phase?: any, readiness?: any, activePlayerId?: any }} turnState
 * @returns {string[]}
 */
export function actablePlayers(turnState) {
  const ts = turnState || {};
  // 의도된 턴 기반: 활성 플레이어가 지정되면 그 한 명만 행동 가능.
  if (ts.activePlayerId) {
    return [ts.activePlayerId];
  }
  // 단계 기반 폴백.
  const readiness = Array.isArray(ts.readiness) ? ts.readiness : [];
  if (ts.phase === Phase.FREE_CHAT || ts.phase === Phase.READY_CHECK) {
    return readiness
      .filter((entry) => entry && entry.status !== "ready")
      .map((entry) => entry.playerId);
  }
  return [];
}

/**
 * 단계·차례 모델을 도출한다.
 *
 * `phase`를 그대로 식별하고, intended `activePlayerId`(없으면 null)·`turnOrder`(배열 아니면 [])를
 * 반영하며, `actablePlayerIds`는 `actablePlayers`로, `isTurnBased`는 `activePlayerId` 또는
 * `turnOrder` 존재 여부로 도출한다. 예외를 던지지 않는다. (요구사항 2.1~2.5)
 *
 * @param {{ phase?: any, readiness?: any, activePlayerId?: any, turnOrder?: any }} turnState
 * @param {string} viewerPlayerId
 * @returns {PhaseModel}
 */
export function currentPhaseModel(turnState, viewerPlayerId) {
  const ts = turnState || {};
  const phase = ts.phase != null ? ts.phase : null;
  const activePlayerId = ts.activePlayerId != null ? ts.activePlayerId : null;
  const turnOrder = Array.isArray(ts.turnOrder) ? ts.turnOrder : [];
  const actablePlayerIds = actablePlayers(ts);
  return {
    phase,
    activePlayerId,
    turnOrder,
    actablePlayerIds,
    isTurnBased: !!(activePlayerId || turnOrder.length),
  };
}

// ---------------------------------------------------------------------------
// 4. 단계별 행동 제출 권한 (Action Permission) — 작업 4.1
// ---------------------------------------------------------------------------

/**
 * 본인(Viewer_Player_Id)이 지금 보낼 수 있는 명령 집합을 도출한다.
 *
 * `locked = isInputLocked(phase)`(재사용). 잠금이면 네 권한 모두 false. 자유 단계
 * (free_chat/ready_check 등 비잠금)에서는 기본 허용하되, 관전(본인 readiness 항목 없음)이면
 * `canConfirm`/`canPass` false, intended `activePlayerId`가 존재하고 본인과 다르면
 * `canConfirm`/`canPass` false(말하기·수정은 허용). (요구사항 3.1, 3.2, 3.3, 3.5, 7.4)
 *
 * @param {{ phase?: any, readiness?: any, activePlayerId?: any }} turnState
 * @param {string} viewerPlayerId
 * @returns {ActionPermission}
 */
export function actionPermission(turnState, viewerPlayerId) {
  const ts = turnState || {};
  const phase = ts.phase;
  const locked = isInputLocked(/** @type {string} */ (phase));
  const readiness = Array.isArray(ts.readiness) ? ts.readiness : [];
  const spectator = !readiness.some((entry) => entry && entry.playerId === viewerPlayerId);
  if (locked) {
    return {
      canChat: false,
      canConfirm: false,
      canPass: false,
      canRevise: false,
      locked: true,
      spectator,
    };
  }
  let canConfirm = true;
  let canPass = true;
  if (spectator) {
    canConfirm = false;
    canPass = false;
  }
  if (ts.activePlayerId && ts.activePlayerId !== viewerPlayerId) {
    canConfirm = false;
    canPass = false;
  }
  return {
    canChat: true,
    canConfirm,
    canPass,
    canRevise: true,
    locked: false,
    spectator,
  };
}

// ---------------------------------------------------------------------------
// 5. 준비 집계·본인 상태 (Ready Tally / Self Status) — 작업 5.1
// ---------------------------------------------------------------------------

/**
 * 준비 X/전체를 도출한다. 기존 `computeReadyCount`에 위임한다(`0 <= ready <= total`).
 * (요구사항 5.1, 4.4, 5.4)
 *
 * @param {ReadinessEntry[]} readiness
 * @returns {{ ready: number, total: number }}
 */
export function readyTally(readiness) {
  return computeReadyCount(readiness);
}

/**
 * 본인(Viewer_Player_Id)의 Self_Status를 도출한다.
 *
 * `readiness`가 배열이 아니거나 본인 항목이 없으면 관전(spectator) 상태. 본인 항목이 있으면
 * `{ status, actionKind, actionText, hasActed: actionKind != null, spectator: false }`.
 * (요구사항 6.1, 6.2, 6.4, 7.3)
 *
 * @param {ReadinessEntry[]} readiness
 * @param {string} viewerPlayerId
 * @returns {SelfStatus}
 */
export function selfStatus(readiness, viewerPlayerId) {
  const list = Array.isArray(readiness) ? readiness : [];
  const self = list.find((entry) => entry && entry.playerId === viewerPlayerId);
  if (!self) {
    return { status: null, actionKind: null, actionText: null, hasActed: false, spectator: true };
  }
  const actionKind = self.actionKind != null ? self.actionKind : null;
  return {
    status: self.status,
    actionKind,
    actionText: self.actionText != null ? self.actionText : null,
    hasActed: actionKind != null,
    spectator: false,
  };
}
