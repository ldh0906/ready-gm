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
 * @typedef {"free_chat" | "ready_check" | "resolving" | "rolling" | "ended"} Phase
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
  ROLLING: "rolling",
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

/** 서사 생성 실패(narration_failed)의 단계별 안내. 침묵 대신 실패와 재시도 방법을 알린다. */
export const NARRATION_FAILED_MESSAGES = {
  opening: "도입부 생성에 실패했습니다. 잠시 후 자동으로 다시 시도됩니다.",
  ending: "마무리 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  resolution: "GM 서사 생성이 반복 실패했습니다. 준비 완료를 다시 눌러 재시도해 주세요.",
  retrying: "GM이 결과를 쓰다 실패해 자동으로 다시 시도합니다. 판정이 다시 나타나면 한 번 더 굴려 주세요.",
};

/**
 * narration_failed의 phase를 한국어 안내로 변환한다(알 수 없는 phase는 일반 안내).
 * @param {unknown} phase
 * @param {boolean=} retrying
 * @returns {string}
 */
export function narrationFailureMessage(phase, retrying = false) {
  if (retrying) return NARRATION_FAILED_MESSAGES.retrying;
  return (
    NARRATION_FAILED_MESSAGES[/** @type {keyof typeof NARRATION_FAILED_MESSAGES} */ (phase)] ||
    "GM 서사 생성에 실패했습니다. 잠시 후 다시 시도해 주세요."
  );
}

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
 * @typedef {Object} ActionHistoryEntry
 * @property {number} round
 * @property {string} playerId
 * @property {"confirmed_action" | "pass" | "auto_pass"} kind
 * @property {string | null} text
 * @property {string=} characterName
 * @property {string=} displayName
 */

/**
 * @typedef {Object} GameState
 * @property {Handoff} handoff                    인계(불변)
 * @property {boolean} handoffValid
 * @property {ConnectionStatus} connection
 * @property {string | null} deliveryFailedNotice delivery_failed 표시 (요구사항 8.2)
 * @property {string | null} narrationFailedNotice narration_failed 표시(서사 생성 실패)
 * @property {boolean} turnReceived               첫 turn_state 수신 여부 (요구사항 1.4)
 * @property {number | null} roundNumber
 * @property {Phase | null} phase
 * @property {ReadinessEntry[]} readiness          준비 수 도출 원천 (요구사항 5.2, 5.3)
 * @property {ActionHistoryEntry[]} actionHistory  지난 라운드 행동 이력(서버 권위)
 * @property {string | null} readyCheckDeadline    카운트다운 기준 (요구사항 5.4)
 * @property {string | null} rollCheckDeadline     자동 굴림 카운트다운 기준 (QA-3)
 * @property {number} chatCount                    append-new-only 추적 (요구사항 4.1, 4.4)
 * @property {NarrationEntry[]} narrationEntries   MAX_ENTRIES 상한 (요구사항 3.3)
 * @property {ChatEntry[]} chatEntries             표시된 채팅(append-new-only)
 * @property {ActionEntry[]} actionLog             본인 confirm/pass 로컬 에코, MAX_ENTRIES 상한
 * @property {VisibleClock[]} clocks               최근 노출된 Progress Clock 스냅샷(노출 시나리오만)
 * @property {any[]} characterStates               player-visible 캐릭터 상태 스냅샷(turn_state로 갱신)
 * @property {any} blackboard                      player-visible 시나리오 블랙보드(발견한 단서/NPC/위협)
 * @property {string | null} sceneLocation         player-visible 현재 장면 위치(장식 전용)
 * @property {any[]} rollingChecks                 현재 라운드의 pending/rolled 공개 판정 목록
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
    narrationFailedNotice: null,
    turnReceived: false,
    roundNumber: null,
    phase: null,
    // F7: 헤더에 실제로 표시하는 라운드/단계. 보통 roundNumber/phase를 따라가지만,
    // 해석이 끝나 다음 라운드로 넘어간 turn_state가 결과 서사보다 먼저 도착할 때는
    // 서사가 도착할 때까지 이전 값을 유지해 "서사 → 전환" 순서를 지킨다.
    headerRound: null,
    headerPhase: null,
    pendingHeaderAdvance: false,
    readiness: [],
    actionHistory: [],
    readyCheckDeadline: null,
    rollCheckDeadline: null,
    chatCount: 0,
    narrationEntries: [],
    chatEntries: [],
    actionLog: [],
    clocks: [],
    characterStates: [],
    blackboard: null,
    sceneLocation: null,
    rollingChecks: [],
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
 * 선행 `?`(또는 `#`)가 있어도 없어도 받아들이며, `roomId`·`hostPlayerId`·`playerId`와 legacy
 * `token`/`ticket` 값을 공백 제거 후 추출한다. 새 navigation URL은 token/ticket을 싣지 않고
 * 같은 탭 credential storage에서 복원한다. (요구사항 1.1, 1.2, 1.5)
 *
 * @param {string} search 쿼리 문자열(예: "?roomId=r1&hostPlayerId=h1")
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
 * `roomId`를 `encodeURIComponent`로 인코딩해 쿼리에 포함한다. 글로벌 `token`은 반환값에는
 * 보존하지만 WebSocket URL에는 절대 포함하지 않는다. `playerId`가 비어 있지 않으면 `playerId`도 인코딩해 포함한다(비어 있으면
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
      // player-visible 블랙보드 projection도 payload에 실려 올 때만 포함한다.
      if (narration.blackboard != null && typeof narration.blackboard === "object") {
        action.blackboard = narration.blackboard;
      }
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
    case "narration_failed":
      // 서버가 명시한 서사 생성 실패(도입부/마무리/라운드 재시도 소진). 사용자에게
      // 침묵 대신 실패와 재시도 방법을 알린다.
      return {
        type: "NARRATION_FAILED",
        phase: event.phase,
        retryable: event.retryable === true,
        retrying: event.retrying === true,
      };
    case "checks_pending":
      return { type: "CHECKS_PENDING", checks: event.checks };
    case "check_rolled":
      return { type: "CHECK_ROLLED", check: event.check };
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

/**
 * 서버가 turn_state에 실어 보내는 player-visible 캐릭터 상태(Living Character
 * Sheet) 한 건을 렌더링 가능한 안전한 형태로 정규화한다. 서버는 GM 전용
 * 정보(기억/플래그/관계)를 이미 제외하고 보낸다; 여기서는 형태만 방어한다.
 *
 * @param {any} raw
 * @returns {{ characterId: string, name: string,
 *   conditions: Array<{ name: string, severity: number | null }>,
 *   inventory: Array<{ name: string, tags: string[] }>,
 *   resources: Array<{ key: string, value: number }>,
 *   personalClocks: Array<{ name: string, value: number, max: number }> }}
 */
export function describeCharacterState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const conditions = (Array.isArray(source.conditions) ? source.conditions : [])
    .map((c) => ({
      name: trimToString(c ? c.name : ""),
      severity: c && Number.isFinite(Number(c.severity)) ? Math.trunc(Number(c.severity)) : null,
    }))
    .filter((c) => c.name.length > 0);
  const inventory = (Array.isArray(source.inventory) ? source.inventory : [])
    .map((item) => ({
      name: trimToString(item ? item.name : ""),
      tags: (Array.isArray(item && item.tags) ? item.tags : [])
        .map(trimToString)
        .filter((tag) => tag.length > 0),
    }))
    .filter((item) => item.name.length > 0);
  const resourcesRaw =
    source.resources && typeof source.resources === "object" ? source.resources : {};
  const resources = Object.keys(resourcesRaw)
    .map((key) => ({ key: trimToString(key), value: Number(resourcesRaw[key]) }))
    .filter((entry) => entry.key.length > 0 && Number.isFinite(entry.value));
  const personalClocks = (Array.isArray(source.personalClocks) ? source.personalClocks : [])
    .map(describeClock)
    .filter((clock) => clock.name.length > 0 && clock.max > 0);
  return {
    characterId: trimToString(source.characterId),
    name: trimToString(source.name),
    conditions,
    inventory,
    resources,
    personalClocks,
  };
}

// ---------------------------------------------------------------------------
// 블랙보드 뷰 모델 (Blackboard View)
// ---------------------------------------------------------------------------

/**
 * player-visible 시나리오 블랙보드 projection을 안전하게 정규화한다. 서버가
 * 숨겨진 secret/미발견 clue를 이미 제외한 스냅샷만 보내므로 여기서는 형태만
 * 방어한다: 발견한 단서(conclusion), 보이는 NPC(이름/역할/위치), 활성 위협.
 *
 * @param {any} raw
 * @returns {{ clues: Array<{ id: string, conclusion: string }>,
 *   npcs: Array<{ name: string, role: string, location: string }>,
 *   threats: Array<{ name: string, status: string }> }}
 */
export function describeBlackboard(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const clues = (Array.isArray(source.clues) ? source.clues : [])
    .map((clue) => {
      const group = trimToString(clue ? clue.redundantPathGroup : "");
      return {
        id: trimToString(clue ? clue.id : ""),
        conclusion: trimToString(clue ? clue.conclusion : ""),
        ...(group.length > 0 ? { redundantPathGroup: group } : {}),
      };
    })
    .filter((clue) => clue.conclusion.length > 0);
  const npcs = (Array.isArray(source.npcs) ? source.npcs : [])
    .map((npc) => ({
      name: trimToString(npc ? npc.name : ""),
      role: trimToString(npc ? npc.role : ""),
      location: trimToString(npc ? npc.location : ""),
    }))
    .filter((npc) => npc.name.length > 0);
  const threats = (Array.isArray(source.activeThreats) ? source.activeThreats : [])
    .map((threat) => ({
      name: trimToString(threat ? threat.name : ""),
      status: trimToString(threat ? threat.status : ""),
    }))
    .filter((threat) => threat.name.length > 0);
  return { clues, npcs, threats };
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

/**
 * 대기 중 GM 진행 표시(P-2). "GM이 서술을 쓰는 중" 한 줄 대신 지금 GM이 무슨
 * 단계에 있는지 알려 주는 문구를 상태에서 파생한다(신규 서버 이벤트 없음).
 *
 * - resolving + pending 판정 없음(rollingChecks 빔) → 상황을 읽고 판정을 고르는 중
 * - rolling + pending 판정 있음 → 판정 UI가 주인공이므로 대기 표시를 숨긴다(null)
 * - resolving/rolling + 모든 판정이 rolled → 결과 서술을 쓰는 중
 *
 * 반환값의 `key`는 문구가 바뀐 시점을 감지해 경과 시간 카운터를 리셋하는 데 쓴다.
 * 티커에 의존하지 않는 순수 함수이므로 단위 테스트가 가능하다.
 *
 * @param {string} phase
 * @param {Array<{status?: string}>} rollingChecks
 * @returns {{ key: string, text: string } | null}
 */
export function waitingIndicator(phase, rollingChecks) {
  if (phase !== Phase.RESOLVING && phase !== Phase.ROLLING) return null;
  const checks = Array.isArray(rollingChecks) ? rollingChecks : [];
  if (checks.length === 0) {
    // 아직 판정이 선언되지 않음: resolving에서만 "판정을 고르는 중"을 보여 준다.
    // (rolling인데 판정이 비어 있는 순간은 과도기이므로 표시하지 않는다.)
    if (phase === Phase.RESOLVING) {
      return { key: "declaring", text: "GM이 상황을 읽고 판정을 고르는 중" };
    }
    return null;
  }
  const allRolled = checks.every((c) => c && c.status === "rolled");
  if (allRolled) {
    return { key: "narrating", text: "GM이 결과 서술을 쓰는 중" };
  }
  // 아직 굴리지 않은 판정이 남음 → 판정 트레이 UI가 주인공. 대기 표시 숨김.
  return null;
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

/**
 * 서버 권위 판정 굴림 명령을 만든다. 클라이언트는 값이 아니라 checkId만 보낸다.
 * @param {string} checkId
 * @returns {{ type: "roll_check", checkId: string } | null}
 */
export function buildRollCheckCommand(checkId) {
  const trimmed = trimToString(checkId);
  if (trimmed.length === 0) return null;
  return { type: "roll_check", checkId: trimmed };
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
  return phase === Phase.RESOLVING || phase === Phase.ROLLING || phase === Phase.ENDED;
}

/**
 * 채팅(테이블 잡담) 전송 가능 여부를 판단한다(순수 함수, P-1).
 *
 * 행동 확정(CONFIRM/PASS/REVISE)과 별개의 게이트다: isInputLocked()는 resolving/
 * rolling에서 행동 컨트롤을 잠그지만, 결과를 기다리는 동안 친구들이 떠들 수 있어야
 * 하므로 채팅은 종료 전 모든 단계에서 허용한다. 연결이 열려 있고, 인계가 유효하며,
 * 첫 turn_state를 받았고, 세션이 끝나지 않았을 때만 true.
 *
 * @param {{ handoffValid?: boolean, turnReceived?: boolean, ended?: boolean, connection?: string }} state
 * @returns {boolean}
 */
export function canSendChat(state) {
  if (!state) return false;
  return (
    state.handoffValid === true &&
    state.turnReceived === true &&
    state.ended !== true &&
    state.connection === ConnectionStatus.OPEN
  );
}

/**
 * 지금이 "채팅만 가능한" 대기 단계(resolving/rolling)인지 판단한다(P-1).
 * 이 모드에서는 입력 전량을 채팅으로 보내고 행동 확정은 잠근다.
 *
 * @param {{ phase?: string | null }} state
 * @returns {boolean}
 */
export function isChatOnlyPhase(state) {
  if (!state) return false;
  return state.phase === Phase.RESOLVING || state.phase === Phase.ROLLING;
}

/**
 * 순차 굴림의 현재 차례 판정 = rollingChecks의 첫 미굴림 항목. 없으면 null.
 * @param {{ rollingChecks?: Array<{status?: string}> }} state
 * @returns {object | null}
 */
export function activeRollingCheck(state) {
  const checks = state && Array.isArray(state.rollingChecks) ? state.rollingChecks : [];
  for (const check of checks) {
    if (check && check.status !== "rolled") return check;
  }
  return null;
}

/**
 * 본인 판정의 "굴리기" 버튼을 누를 수 있는지 판단한다(순수 함수).
 *
 * 채팅/행동 입력과 별도의 가드다: isInputLocked()는 rolling 단계에서 채팅 입력을
 * 잠그지만, 굴림 자체는 rolling 단계에서만 가능한 동작이므로 전역 입력 잠금과
 * 무관하게 허용해야 한다(QA: rolling 중 굴리기 버튼이 항상 비활성이던 회귀 수정).
 *
 * @param {{ handoffValid?: boolean, turnReceived?: boolean, ended?: boolean, connection?: string, phase?: string | null }} state
 * @returns {boolean}
 */
export function canRollCheck(state) {
  if (!state) return false;
  return (
    state.handoffValid === true &&
    state.turnReceived === true &&
    state.ended !== true &&
    state.connection === ConnectionStatus.OPEN &&
    state.phase === Phase.ROLLING
  );
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
      const newOoc = newChats.filter((c) => !(c && c.inCharacter));
      const newIc = newChats.filter((c) => c && c.inCharacter);
      let chatEntries = state.chatEntries;
      // 재연결/재동기화 시 지난 라운드 채팅 이력을 시드한다(F8). 표시된 채팅이 아직
      // 없을 때(=새 클라이언트/재접속)에만 시드해, 라이브로 이미 누적한 화면과의
      // 중복을 막는다. 라운드가 넘어가도 접속 유지 중인 클라이언트는 로컬 누적을 보존한다.
      if (
        chatEntries.length === 0 &&
        Array.isArray(turnState.chatHistory) &&
        turnState.chatHistory.length > 0
      ) {
        chatEntries = turnState.chatHistory.filter((c) => !(c && c.inCharacter)).slice(-MAX_ENTRIES);
      }
      if (newOoc.length > 0) {
        chatEntries = chatEntries.concat(newOoc);
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
      const roundNumber = turnState.roundNumber != null ? turnState.roundNumber : state.roundNumber;
      if (newIc.length > 0) {
        const dialogueEntries = newIc.map((c) => ({
          kind: "dialogue",
          roundNumber,
          speaker: typeof c.characterName === "string" ? c.characterName : "",
          displayName: c.displayName,
          text: typeof c.text === "string" ? c.text : String(c.text),
        }));
        narrationEntries = narrationEntries.concat(dialogueEntries);
        if (narrationEntries.length > MAX_ENTRIES) {
          narrationEntries = narrationEntries.slice(narrationEntries.length - MAX_ENTRIES);
        }
      }
      const rollingChecks = Array.isArray(turnState.rollingChecks)
        ? turnState.rollingChecks
        : phase === Phase.ROLLING
          ? state.rollingChecks
          : [];
      // F7: 이 turn_state가 "해석 완료 → 다음 라운드/종료" 전환이면(직전 단계가
      // resolving/rolling), 결과 서사가 도착할 때까지 헤더를 이전 라운드/단계에 붙들어
      // 둔다. 그 외에는 헤더를 실제 값으로 동기화한다(재연결·정상 진행 포함).
      const wasResolving = state.phase === Phase.RESOLVING || state.phase === Phase.ROLLING;
      const roundAdvanced =
        roundNumber != null && state.roundNumber != null && roundNumber > state.roundNumber;
      const holdHeader = wasResolving && (roundAdvanced || phase === Phase.ENDED);
      const headerRound = holdHeader
        ? state.headerRound != null
          ? state.headerRound
          : state.roundNumber
        : roundNumber;
      const headerPhase = holdHeader
        ? state.headerPhase != null
          ? state.headerPhase
          : state.phase
        : phase;
      return {
        ...state,
        turnReceived: true,
        roundNumber,
        phase,
        headerRound,
        headerPhase,
        pendingHeaderAdvance: holdHeader,
        readiness: Array.isArray(turnState.readiness) ? turnState.readiness : state.readiness,
        actionHistory: Array.isArray(turnState.actionHistory) ? turnState.actionHistory : [],
        readyCheckDeadline:
          turnState.readyCheckDeadline !== undefined
            ? turnState.readyCheckDeadline
            : state.readyCheckDeadline,
        rollCheckDeadline:
          turnState.rollCheckDeadline !== undefined
            ? turnState.rollCheckDeadline
            : phase === Phase.ROLLING
              ? state.rollCheckDeadline
              : null,
        chatCount: nextCount,
        chatEntries,
        narrationEntries,
        ended,
        // player-visible 캐릭터 상태: turn_state가 실어 보낼 때만 갱신(재연결 재동기화 포함).
        characterStates: Array.isArray(turnState.characterStates)
          ? turnState.characterStates
          : state.characterStates,
        // player-visible 블랙보드(발견 단서/NPC/위협): 서버가 숨김 정보를 이미
        // 제외한 projection만 싣는다. 실려 올 때만 갱신(재연결 재동기화 포함).
        blackboard:
          turnState.blackboard != null && typeof turnState.blackboard === "object"
            ? turnState.blackboard
            : state.blackboard,
        sceneLocation:
          typeof turnState.sceneLocation === "string" && turnState.sceneLocation.length > 0
            ? turnState.sceneLocation
            : null,
        rollingChecks,
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
      // 라운드 해석이 실어 보낸 player-visible 블랙보드도 있으면 갱신한다.
      const blackboard =
        action.blackboard != null && typeof action.blackboard === "object"
          ? action.blackboard
          : state.blackboard;
      // 서사가 실제로 도착했으므로 이전의 서사 생성 실패 안내는 지운다.
      // F7: 유예해 둔 헤더 전환을 지금(서사 도착) 실제 라운드/단계로 반영한다.
      return {
        ...state,
        narrationEntries,
        clocks,
        blackboard,
        ended,
        narrationFailedNotice: null,
        headerRound: state.roundNumber,
        headerPhase: state.phase,
        pendingHeaderAdvance: false,
      };
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

    // -- 서사 생성 실패 (narration_failed) ------------------------------------
    // 도입부/마무리/라운드 재시도 소진 실패를 사용자에게 표면화한다. 다음 서사가
    // 실제로 도착하면(NARRATION) 안내를 지운다.
    case "NARRATION_FAILED": {
      return { ...state, narrationFailedNotice: narrationFailureMessage(action.phase, action.retrying === true) };
    }

    case "CHECKS_PENDING": {
      return {
        ...state,
        rollingChecks: Array.isArray(action.checks) ? action.checks : [],
        narrationFailedNotice: null,
      };
    }

    case "CHECK_ROLLED": {
      const check = action.check || {};
      const existing = Array.isArray(state.rollingChecks) ? state.rollingChecks : [];
      let found = false;
      const rollingChecks = existing.map((entry) => {
        if (!entry || entry.checkId !== check.checkId) return entry;
        found = true;
        return { ...entry, ...check, status: "rolled" };
      });
      return {
        ...state,
        rollingChecks: found ? rollingChecks : rollingChecks.concat([{ ...check, status: "rolled" }]),
      };
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

/**
 * 지난 라운드 행동 이력과 현재 라운드 readiness 기반 행동 로그를 병합한다.
 *
 * 서버가 확정한 `actionHistory`는 라운드 전환 뒤에도 유지되고, 현재 라운드의 아직
 * 전환되지 않은 행동은 기존 `actionLogModel`로 도출해 같은 표시 모델로 이어 붙인다.
 * 이름 폴백은 `actionLogModel`과 같은 규칙을 따른다. 예외를 던지지 않는다.
 *
 * @param {{ actionHistory?: any, readiness?: any, chatLog?: ChatEntry[], roundNumber?: any }} turnState
 * @returns {Array<{ round: number, playerId: string, characterName: string, displayName: string, kind: "confirm" | "pass" | "check", text?: string | null, auto?: boolean, attribute?: string, difficulty?: string, roll?: number, outcome?: string }>}
 */
export function actionHistoryModel(turnState) {
  const ts = turnState || {};
  const history = Array.isArray(ts.actionHistory) ? ts.actionHistory : [];
  const chatLog = Array.isArray(ts.chatLog) ? ts.chatLog : [];
  const out = [];
  for (const entry of history) {
    const item = entry || {};
    const rawKind = item.kind;
    if (
      rawKind !== "confirmed_action" &&
      rawKind !== "pass" &&
      rawKind !== "auto_pass" &&
      rawKind !== "check_result"
    ) {
      continue;
    }
    const playerId = item.playerId;
    const intendedDisplay = item.displayName != null ? trimToString(item.displayName) : "";
    const displayName =
      intendedDisplay.length > 0 ? intendedDisplay : latestChatDisplayName(playerId, chatLog);
    const characterName = characterNameFor(playerId, item, chatLog);
    const isConfirm = rawKind === "confirmed_action";
    if (rawKind === "check_result") {
      out.push({
        round: Number.isFinite(Number(item.round)) ? Number(item.round) : 0,
        playerId,
        characterName,
        displayName,
        kind: "check",
        attribute: item.attribute != null ? String(item.attribute) : "",
        difficulty: item.difficulty != null ? String(item.difficulty) : "",
        roll: Number.isFinite(Number(item.roll)) ? Number(item.roll) : 0,
        outcome: item.outcome != null ? String(item.outcome) : "",
      });
      continue;
    }
    out.push({
      round: Number.isFinite(Number(item.round)) ? Number(item.round) : 0,
      playerId,
      characterName,
      displayName,
      kind: isConfirm ? "confirm" : "pass",
      text: isConfirm ? (item.text != null ? String(item.text) : "") : null,
      auto: rawKind === "auto_pass",
    });
  }
  const currentRound = Number.isFinite(Number(ts.roundNumber)) ? Number(ts.roundNumber) : 0;
  for (const entry of actionLogModel(ts)) {
    out.push({ round: currentRound, ...entry });
  }
  const rollingChecks = Array.isArray(ts.rollingChecks) ? ts.rollingChecks : [];
  for (const check of rollingChecks) {
    if (!check || check.status !== "rolled") continue;
    const playerId = check.playerId;
    const readinessEntry = (Array.isArray(ts.readiness) ? ts.readiness : []).find((entry) => entry && entry.playerId === playerId);
    out.push({
      round: currentRound,
      playerId,
      characterName: check.characterName || characterNameFor(playerId, readinessEntry, chatLog),
      displayName: readinessEntry && readinessEntry.displayName != null ? trimToString(readinessEntry.displayName) : latestChatDisplayName(playerId, chatLog),
      kind: "check",
      attribute: check.attribute != null ? String(check.attribute) : "",
      difficulty: check.difficulty != null ? String(check.difficulty) : "",
      roll: Number.isFinite(Number(check.roll)) ? Number(check.roll) : 0,
      outcome: check.outcome != null ? String(check.outcome) : "",
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
