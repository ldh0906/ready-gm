// @ts-check
/**
 * Room_Lobby_App 순수 로직 모듈 (호스트 로비 / 대기실 화면)
 *
 * 이 모듈은 DOM·네트워크·WebSocket·클립보드에 의존하지 않는 순수 함수들만 모은다.
 * 인계 파싱·검증, 토큰 헤더 구성, REST 요청 명세 구성, 초대 토큰 추출, 응답/오류 분류,
 * 시나리오 매칭/기본 선택, 실시간 이벤트 환원, 로스터 렌더, 상태 전이(reduce), 뷰 모델 도출,
 * 게임 화면 인계 페이로드 구성을 담당하며 vitest(node 환경)에서 직접 import 하여 단위/속성 테스트한다.
 *
 * 부수효과(fetch, AbortController 10초 타임아웃, WebSocket connect/재연결, 30초 세션 시작 타임아웃,
 * 클립보드, 네비게이션, DOM 갱신)는 index.html의 스크립트(부수효과 계층)가 담당하고,
 * 본 모듈이 만든 결정을 실행만 한다.
 *
 * 설계 문서: .kiro/specs/room-lobby/design.md
 */

// ---------------------------------------------------------------------------
// 상태 모델 상수 (State Model Constants)
// ---------------------------------------------------------------------------

/**
 * 영역(초대/방정보/시나리오)별 로딩 단계.
 * @typedef {"idle" | "loading" | "loaded" | "error"} AreaPhase
 * - idle: 아직 요청 전(인계 무효 시 포함)
 * - loading: 요청 전송~응답 도착 전. 인디케이터 표시, 재트리거 비활성 (요구사항 8.1, 8.2)
 * - loaded: 성공
 * - error: 복구 가능 오류. 재시도 동작 제공 (요구사항 9.5)
 */

/** 영역 단계 상수. @type {Readonly<Record<string, AreaPhase>>} */
export const AreaPhase = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  LOADED: "loaded",
  ERROR: "error",
});

/**
 * 오류 종류. 사용자에게 보일 한국어 메시지를 결정한다.
 * @typedef {"notfound" | "server" | "network" | "timeout" | "invalid"} ErrorKind
 * - notfound: HTTP 404 (요구사항 2.4 / 4.5)
 * - server: HTTP 5xx (요구사항 9.4)
 * - network: 네트워크 실패 (요구사항 9.3)
 * - timeout: 클라이언트 타임아웃 (요구사항 9.1, 9.2)
 * - invalid: 방 정보 응답이 형식 위반 (요구사항 4.6)
 */

/** 오류 종류 상수. @type {Readonly<Record<string, ErrorKind>>} */
export const ErrorKind = Object.freeze({
  NOTFOUND: "notfound",
  SERVER: "server",
  NETWORK: "network",
  TIMEOUT: "timeout",
  INVALID: "invalid",
});

/**
 * 실시간 연결 상태. (요구사항 6.3, 6.4)
 * @typedef {"connecting" | "open" | "disconnected"} ConnectionStatus
 */

/** 연결 상태 상수. @type {Readonly<Record<string, ConnectionStatus>>} */
export const ConnectionStatus = Object.freeze({
  CONNECTING: "connecting",
  OPEN: "open",
  DISCONNECTED: "disconnected",
});

// ---------------------------------------------------------------------------
// 타임아웃·복사 상수 (Timeout / Copy Constants)
// ---------------------------------------------------------------------------

/** REST 요청 클라이언트 타임아웃(ms). host-entry와 동일한 10초. (요구사항 2.5/4.5/5.1/8.4/9.1) */
export const REQUEST_TIMEOUT_MS = 10000;

/** 세션 시작 타임아웃(ms). 전송 후 30초 내 미전이 시 START_SESSION_TIMEOUT. (요구사항 8.6) */
export const SESSION_START_TIMEOUT_MS = 30000;

/** 복사 성공 확인 메시지 최소 표시 시간(ms). host-entry와 동일. (요구사항 3.3) */
export const COPY_CONFIRM_MS = 3000;

// ---------------------------------------------------------------------------
// 사용자 메시지 상수 (한국어 메시지)
// ---------------------------------------------------------------------------

/** 인계 정보(roomId/hostPlayerId)가 무효일 때의 안내. (요구사항 1.3) */
export const HANDOFF_INVALID_MESSAGE =
  "로비 정보가 올바르지 않습니다. 방을 다시 생성하거나 호스트 링크를 확인해 주세요.";

/**
 * 영역별·종류별 한국어 사용자 메시지. (Error Handling 표 참조)
 *
 * - invite: 초대 링크 재조회 영역 (요구사항 2.4, 2.5)
 * - room: 방 정보 조회 영역 (요구사항 4.5, 4.6)
 * - scenarios: 시나리오 조회 영역 (요구사항 5.5)
 *
 * 종류별로 타임아웃·네트워크·서버 메시지는 서로 구분된다(요구사항 9.2/9.3/9.4).
 * @type {Readonly<Record<"invite" | "room" | "scenarios", Readonly<Record<ErrorKind, string>>>>}
 */
export const ERROR_MESSAGES = Object.freeze({
  invite: Object.freeze({
    notfound: "해당 방을 찾을 수 없습니다. 방이 만료되었거나 삭제되었을 수 있습니다.",
    timeout: "초대 링크 조회가 지연되어 완료되지 못했습니다. 잠시 후 다시 시도해 주세요.",
    network: "네트워크 연결 문제로 초대 링크를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.",
    server: "서버 오류로 초대 링크를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    invalid: "초대 링크를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  }),
  room: Object.freeze({
    notfound: "방 정보를 불러오지 못했습니다. 방이 만료되었거나 삭제되었을 수 있습니다.",
    timeout: "방 정보 조회가 지연되어 완료되지 못했습니다. 잠시 후 다시 시도해 주세요.",
    network: "네트워크 연결 문제로 방 정보를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.",
    server: "서버 오류로 방 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    invalid: "방 정보를 불러오지 못했습니다. 정원과 시나리오 정보를 확인할 수 없습니다.",
  }),
  scenarios: Object.freeze({
    notfound: "시나리오 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    timeout: "시나리오 조회가 지연되어 완료되지 못했습니다. 잠시 후 다시 시도해 주세요.",
    network: "네트워크 연결 문제로 시나리오 정보를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.",
    server: "서버 오류로 시나리오 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    invalid: "시나리오 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  }),
});

/** 시나리오 목록이 비어 있을 때(0개)의 안내. (요구사항 5.6) */
export const SCENARIO_EMPTY_MESSAGE = "표시할 시나리오가 없습니다.";

/** 선택된 시나리오 식별자가 목록의 어떤 시나리오와도 일치하지 않을 때의 안내. (요구사항 5.7) */
export const SCENARIO_UNMATCHED_MESSAGE = "선택된 시나리오를 찾을 수 없습니다.";

/** 로스터에 플레이어가 0명일 때의 안내. (요구사항 6.6) */
export const ROSTER_EMPTY_MESSAGE = "아직 모인 플레이어가 없습니다.";

/** 실시간 연결이 끊겼을 때의 안내. (요구사항 6.4) */
export const CONNECTION_LOST_MESSAGE = "실시간 연결이 끊겼습니다. 다시 연결을 시도하고 있습니다.";

/** 세션 시작 명령 전송이 실패했을 때의 안내. (요구사항 7.7) */
export const SESSION_START_FAILED_MESSAGE =
  "세션 시작에 실패했습니다. 잠시 후 다시 시도해 주세요.";

/** 서버 동시 세션 한도 초과로 세션을 시작하지 못했을 때의 안내(자체 호스팅 시 한도 상향 가능). */
export const SESSION_START_CAPACITY_MESSAGE =
  "서버가 동시 진행 세션 한도에 도달해 세션을 시작하지 못했습니다. 다른 세션이 끝난 뒤 다시 시도하거나, 서버를 재시작하거나 MAX_CONCURRENT_SESSIONS 설정을 높여 주세요.";

/** 전원이 캐릭터를 확정하지 않아 세션을 시작하지 못했을 때의 안내. */
export const SESSION_START_NOT_CONFIRMED_MESSAGE =
  "모든 플레이어가 캐릭터를 확정해야 세션을 시작할 수 있습니다.";

/** 세션 시작이 30초 내 전이하지 않아 타임아웃됐을 때의 안내. (요구사항 8.6) */
export const SESSION_START_TIMEOUT_MESSAGE =
  "세션 시작이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.";

// ---------------------------------------------------------------------------
// 타입 주석 (JSDoc Typedefs)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Handoff
 * @property {string} roomId
 * @property {string} hostPlayerId
 * @property {string} playerId  입장 플레이어 신원(없으면 빈 문자열). 비어있지 않으면 viewer 식별에 우선한다.
 * @property {string} token  공유 비밀(없으면 빈 문자열)
 * @property {string} ticket  서버 발급 연결 티켓(없으면 빈 문자열). 캐릭터/게임 화면으로 흐른다(auth-hardening).
 */

/**
 * @typedef {Object} RealtimePlayer
 * @property {string} id
 * @property {string} displayName
 * @property {boolean} isHost
 */

/**
 * @typedef {Object} SelectedScenario
 * @property {string | null} scenarioId
 * @property {string | null} title
 * @property {string | null} summary
 */

/**
 * @template T
 * @typedef {Object} AreaState
 * @property {AreaPhase} phase
 * @property {ErrorKind | null} errorKind
 * @property {T | null} data
 */

/**
 * @typedef {Object} LobbyState
 * @property {Handoff} handoff                인계(불변, REST 오류로도 변하지 않음, 요구사항 9.6)
 * @property {boolean} handoffValid
 * @property {AreaState<string>} invite        data = inviteLink (요구사항 2.x)
 * @property {AreaState<{ maxPlayers: number, scenarioId: string }>} room (요구사항 4.x)
 * @property {AreaState<unknown>} scenarios    진행/오류 추적용 (요구사항 5.x)
 * @property {SelectedScenario} selectedScenario
 * @property {string | null} scenarioNotice    빈/불일치 안내 (요구사항 5.6, 5.7)
 * @property {ConnectionStatus} connection
 * @property {RealtimePlayer[]} roster
 * @property {boolean} startCommandSent        정확히 1회 전송 보장 (요구사항 7.4)
 * @property {boolean} sessionStarting         전송~활성 전 인디케이터 (요구사항 8.5)
 * @property {string | null} startError        시작 실패/타임아웃 (요구사항 7.7, 8.6)
 * @property {boolean} handoffDone             게임 화면 인계 1회 보장 (요구사항 7.5, 7.6)
 * @property {boolean} characterSetupDone      캐릭터 시트 화면 이동 1회 보장 (character_setup 이벤트)
 * @property {number | null} copyConfirmedUntil 복사 확인 표시 만료 시각(ms) (요구사항 3.3)
 * @property {boolean} copyFailed              수동 복사 폴백 노출 (요구사항 3.4)
 */

/**
 * @typedef {{ type: string, [key: string]: unknown }} Action
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

/**
 * 새 빈 영역 상태(AreaState)를 만든다.
 * @template T
 * @returns {AreaState<T>}
 */
function emptyArea() {
  return { phase: AreaPhase.IDLE, errorKind: null, data: null };
}

// ---------------------------------------------------------------------------
// 초기 상태 팩토리 (Initial State Factory) — 작업 1.1
// ---------------------------------------------------------------------------

/**
 * 초기 상태를 생성한다. 인계를 받아 `handoffValid`를 함께 계산한다.
 *
 * 설계상 연결은 초기에 아직 열리지 않았으므로 `disconnected`로 둔다(부수효과 계층이
 * 채널을 열기 시작하면 CONNECTION_OPENED/LOST 액션으로 갱신된다).
 *
 * @param {Handoff} handoff 인계 값(roomId/hostPlayerId/token)
 * @returns {LobbyState}
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
    invite: emptyArea(),
    room: emptyArea(),
    scenarios: emptyArea(),
    selectedScenario: { scenarioId: null, title: null, summary: null },
    scenarioNotice: null,
    connection: ConnectionStatus.DISCONNECTED,
    roster: [],
    startCommandSent: false,
    sessionStarting: false,
    startError: null,
    handoffDone: false,
    characterSetupDone: false,
    copyConfirmedUntil: null,
    copyFailed: false,
  };
}

// ---------------------------------------------------------------------------
// 인계 파싱·검증 (Handoff Parse / Validate) — 작업 2.1
// ---------------------------------------------------------------------------

/**
 * 페이지 URL 쿼리 문자열에서 인계 값을 추출한다.
 *
 * 선행 `?`가 있어도 없어도 받아들이며, `roomId`·`hostPlayerId`·`playerId`와 legacy
 * `token`/`ticket` 값을 공백 제거 후 추출한다. 새 navigation URL은 token/ticket을 싣지 않고
 * 같은 탭 credential storage에서 복원한다. (요구사항 1.1, 1.2, 1.5)
 *
 * `playerId`는 초대 입장 플레이어가 자기 신원으로 로비에 들어올 때 전달된다(멀티플레이어 흐름).
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
 * 인계에서 viewer(이 화면을 보는 사람)의 유효 신원을 도출한다.
 *
 * `playerId`가 비어 있지 않으면 그것을, 아니면 `hostPlayerId`를 사용한다. 초대 입장
 * 플레이어는 `playerId`로, 호스트는 `hostPlayerId`로 식별된다(멀티플레이어 흐름).
 *
 * @param {Handoff} handoff
 * @returns {string}
 */
export function effectiveViewerId(handoff) {
  if (!handoff) return "";
  const playerId = trimToString(handoff.playerId);
  if (playerId.length >= 1) return playerId;
  return trimToString(handoff.hostPlayerId);
}

/**
 * 인계의 유효성을 판정한다.
 *
 * 트림된 `roomId`가 비어 있지 않고, viewer의 유효 신원(`playerId` 우선, 없으면
 * `hostPlayerId`)이 비어 있지 않을 때에만 true. 호스트뿐 아니라 `playerId`만 가진
 * 입장 플레이어도 유효하다. (요구사항 1.3)
 *
 * @param {Handoff} handoff
 * @returns {boolean}
 */
export function isHandoffValid(handoff) {
  if (!handoff) return false;
  return trimToString(handoff.roomId).length >= 1 && effectiveViewerId(handoff).length >= 1;
}

// ---------------------------------------------------------------------------
// 토큰 헤더 구성 (Auth Header Builder) — 작업 2.1
// ---------------------------------------------------------------------------

/**
 * 접근 토큰으로 인증 헤더를 구성한다.
 *
 * 토큰이 비어 있지 않으면 `{ "x-playtest-token": token }`(값 무변형), 아니면 `{}`.
 * (요구사항 1.2, 1.5, 10.1, 10.2)
 *
 * @param {string} token
 * @returns {Record<string, string>}
 */
export function buildAuthHeaders(token) {
  if (isNonEmptyString(token)) {
    return { "x-playtest-token": token };
  }
  return {};
}

/**
 * 연결 티켓으로 인증 헤더를 구성한다.
 * @param {string} ticket
 * @returns {Record<string, string>}
 */
export function buildTicketHeaders(ticket) {
  if (isNonEmptyString(ticket)) {
    return { "x-connection-ticket": ticket };
  }
  return {};
}

// ---------------------------------------------------------------------------
// REST 요청 빌더 (Request Building) — 작업 2.2
// ---------------------------------------------------------------------------

/**
 * `GET /rooms/:id/invite` 요청 명세를 구성한다. (요구사항 2.1, 10.1, 10.2)
 * @param {string} roomId
 * @param {string} token
 * @param {string=} ticket
 * @returns {{ url: string, method: string, headers: Record<string, string> }}
 */
export function buildInviteRequest(roomId, token, ticket) {
  return {
    url: "/rooms/" + encodeURIComponent(roomId) + "/invite",
    method: "GET",
    headers: { ...buildAuthHeaders(token), ...buildTicketHeaders(ticket) },
  };
}

/**
 * `GET /rooms/:token` (초대 토큰으로 방 정보 해석) 요청 명세를 구성한다.
 * (요구사항 4.2, 10.1, 10.2)
 * @param {string} inviteToken
 * @param {string} token
 * @returns {{ url: string, method: string, headers: Record<string, string> }}
 */
export function buildRoomResolveRequest(inviteToken, token) {
  return {
    url: "/rooms/" + encodeURIComponent(inviteToken),
    method: "GET",
    headers: buildAuthHeaders(token),
  };
}

/**
 * `GET /scenarios` 요청 명세를 구성한다. (요구사항 5.1, 10.1, 10.2)
 * @param {string} token
 * @returns {{ url: string, method: string, headers: Record<string, string> }}
 */
export function buildScenariosRequest(token) {
  return {
    url: "/scenarios",
    method: "GET",
    headers: buildAuthHeaders(token),
  };
}

// ---------------------------------------------------------------------------
// 초대 토큰 추출 (Invite Token Extraction) — 작업 2.7
// ---------------------------------------------------------------------------

/**
 * 초대 링크에서 초대 토큰(마지막 경로 세그먼트)을 추출한다.
 *
 * 질의(`?`)와 프래그먼트(`#`)를 제거한 뒤, 끝의 슬래시들을 제거하고, 마지막 `/` 뒤
 * 세그먼트를 취한다. 세그먼트를 만들 수 없으면 `""`를 반환하여 방 정보 조회가 생략되게 한다.
 * (요구사항 4.1, 4.4)
 *
 * @param {string} inviteLink
 * @returns {string}
 */
export function extractInviteToken(inviteLink) {
  let s = String(inviteLink == null ? "" : inviteLink);
  // 질의/프래그먼트 제거(둘 중 먼저 나오는 위치에서 자른다).
  const queryIdx = s.search(/[?#]/);
  if (queryIdx >= 0) {
    s = s.slice(0, queryIdx);
  }
  // 끝의 슬래시들을 제거한다.
  s = s.replace(/\/+$/, "");
  if (s.length === 0) {
    return "";
  }
  // 마지막 "/" 뒤 세그먼트를 취한다. "/"가 없으면 문자열 전체가 세그먼트다.
  const lastSlash = s.lastIndexOf("/");
  const segment = lastSlash >= 0 ? s.slice(lastSlash + 1) : s;
  return segment;
}

// ---------------------------------------------------------------------------
// 방 정보 검증 (Room Info Validation) — 작업 2.7
// ---------------------------------------------------------------------------

/**
 * 방 정보 응답 본문을 검증한다.
 *
 * `maxPlayers`가 1 이상의 정수이고 `scenarioId`가 비어 있지 않은 문자열일 때에만
 * `{ ok: true, maxPlayers, scenarioId }`를 반환한다. 그 외(누락·0·음수·비정수·빈 식별자)는
 * `{ ok: false }`. (요구사항 4.3, 4.6)
 *
 * @param {unknown} body
 * @returns {{ ok: true, maxPlayers: number, scenarioId: string } | { ok: false }}
 */
export function validateRoomInfo(body) {
  if (!body || typeof body !== "object") {
    return { ok: false };
  }
  const maxPlayers = /** @type {{ maxPlayers?: unknown }} */ (body).maxPlayers;
  const scenarioId = /** @type {{ scenarioId?: unknown }} */ (body).scenarioId;
  if (
    typeof maxPlayers === "number" &&
    Number.isInteger(maxPlayers) &&
    maxPlayers >= 1 &&
    isNonEmptyString(scenarioId)
  ) {
    return { ok: true, maxPlayers, scenarioId: /** @type {string} */ (scenarioId) };
  }
  return { ok: false };
}

// ---------------------------------------------------------------------------
// 응답·결과 분류 (Response / Outcome Classification) — 작업 2.5
// ---------------------------------------------------------------------------

/**
 * HTTP 응답을 분류한다.
 *
 * - 200/201이거나 `ok === true`인 2xx면 "success"
 * - 정확히 404면 "notfound"
 * - 500 이상이면 "server"
 * - 그 외 비-2xx는 "unknown"
 * (요구사항 2.4, 4.5, 9.4)
 *
 * @param {{ ok: boolean, status: number }} response
 * @returns {"success" | "notfound" | "server" | "unknown"}
 */
export function classifyResponse(response) {
  const ok = !!(response && response.ok);
  const status = response ? response.status : 0;
  if (status === 200 || status === 201 || (ok && status >= 200 && status <= 299)) {
    return "success";
  }
  if (status === 404) return "notfound";
  if (status >= 500) return "server";
  return "unknown";
}

/**
 * 요청 결과(응답/네트워크오류/타임아웃)를 단일 결과 타입으로 환원한다.
 *
 * 시그니처: `classifyOutcome({ kind, response? })`
 * - `kind: "network"` → "network"
 * - `kind: "timeout"` → "timeout"
 * - `kind: "response"` → `classifyResponse`로 분류
 *     - "success"  → "success"
 *     - "notfound" → "notfound"
 *     - "server"   → "server"
 *     - "unknown"  → "server" (보수적 처리, design Error Handling 표)
 * (요구사항 2.4, 2.5, 4.5, 9.1, 9.2, 9.3, 9.4)
 *
 * @param {{ kind: "response" | "network" | "timeout", response?: { ok: boolean, status: number } }} outcome
 * @returns {"success" | ErrorKind}
 */
export function classifyOutcome(outcome) {
  const kind = outcome ? outcome.kind : undefined;
  if (kind === "network") return ErrorKind.NETWORK;
  if (kind === "timeout") return ErrorKind.TIMEOUT;
  if (kind === "response") {
    const classified = classifyResponse(outcome.response || { ok: false, status: 0 });
    if (classified === "success") return "success";
    if (classified === "notfound") return ErrorKind.NOTFOUND;
    // server 및 unknown(기타 비-2xx)은 모두 server로 보수적으로 환원한다.
    return ErrorKind.SERVER;
  }
  // 알 수 없는 결과 종류도 보수적으로 server 오류로 환원한다.
  return ErrorKind.SERVER;
}

// ---------------------------------------------------------------------------
// 시나리오 매칭/기본 선택 (Scenario Matching) — 작업 3.1
// ---------------------------------------------------------------------------

/**
 * 시나리오 목록과 선택 식별자로 표시할 시나리오를 결정한다.
 *
 * - matched: 식별자가 목록의 한 `id`와 일치 → 그 `title`·`summary`
 * - default: 목록이 정확히 1개이고 식별자가 미확정(null/빈) → 그 단일 시나리오
 * - empty: 목록이 비어 있음(0개)
 * - unmatched: 비어 있지 않은 식별자가 어떤 `id`와도 일치하지 않음
 * (요구사항 5.2, 5.3, 5.6, 5.7)
 *
 * @param {{ id: string, title: string, summary: string }[]} scenarios
 * @param {string | null | undefined} selectedScenarioId
 * @returns {{ kind: "matched" | "default" | "empty" | "unmatched", scenario?: { title: string, summary: string } }}
 */
export function selectScenario(scenarios, selectedScenarioId) {
  const list = Array.isArray(scenarios) ? scenarios : [];
  // 빈 목록은 식별자 유무와 무관하게 empty다(요구사항 5.6).
  if (list.length === 0) {
    return { kind: "empty" };
  }
  const hasId = isNonEmptyString(selectedScenarioId);
  if (hasId) {
    const found = list.find((s) => s && s.id === selectedScenarioId);
    if (found) {
      return { kind: "matched", scenario: { title: found.title, summary: found.summary } };
    }
    // 비어 있지 않은 식별자가 어떤 시나리오와도 일치하지 않음(요구사항 5.7).
    return { kind: "unmatched" };
  }
  // 식별자 미확정 + 목록 정확히 1개 → 기본 선택(요구사항 5.3).
  if (list.length === 1) {
    const only = list[0];
    return { kind: "default", scenario: { title: only.title, summary: only.summary } };
  }
  // 식별자 미확정 + 목록 다수 → 어느 것을 표시할지 확정할 수 없으므로 unmatched로 둔다.
  return { kind: "unmatched" };
}

// ---------------------------------------------------------------------------
// 시나리오 메타데이터 세그먼트 (Scenario Metadata Segments)
// ---------------------------------------------------------------------------

/**
 * 시나리오의 메타데이터 세그먼트 배열을 만든다.
 *
 * 비어 있지 않은 값만 `["장르: …", "구성요소: …", "시스템: …", "형식: …"]` 순서로
 * 담아 반환한다. 콤보박스 옵션의 메타 서브박스와 선택 시나리오 상세 줄이 함께 재사용한다.
 * 순수 함수이며 어떤 입력에도 throw 하지 않는다(비객체 → `[]`).
 *
 * @param {{ genre?: unknown, category?: unknown, system?: unknown, form?: unknown } | null | undefined} scenario
 * @returns {string[]}
 */
export function scenarioMetaSegments(scenario) {
  if (!scenario || typeof scenario !== "object") return [];
  const ne = (v) => typeof v === "string" && v.trim().length > 0;
  const segs = [];
  const s = /** @type {Record<string, unknown>} */ (scenario);
  if (ne(s.genre)) segs.push(`장르: ${s.genre}`);
  if (ne(s.category)) segs.push(`구성요소: ${s.category}`);
  if (ne(s.system)) segs.push(`시스템: ${s.system}`);
  if (ne(s.form)) segs.push(`형식: ${s.form}`);
  return segs;
}

// ---------------------------------------------------------------------------
// 장르 분류 / 그룹화 (Genre Taxonomy / Grouping)
// ---------------------------------------------------------------------------

/**
 * 정규 장르 분류표(순서 있음). 비슷한 장르가 목록에서 인접하도록 그룹 순서를 고정한다.
 * 각 그룹은 그룹 머리글에 한 번 표시되는 공유 한국어 설명(`description`)을 가진다.
 *
 * @type {ReadonlyArray<{ id: string, label: string, description: string, keywords: ReadonlyArray<string> }>}
 */
export const GENRE_GROUPS = Object.freeze([
  Object.freeze({
    id: "fantasy",
    label: "판타지·모험",
    description: "검과 마법, 던전과 모험이 중심인 활극.",
    keywords: Object.freeze(["판타지", "던전", "모험", "액션"]),
  }),
  Object.freeze({
    id: "mystery",
    label: "호러·미스터리",
    description: "불안과 수수께끼 속에서 단서를 좇는 이야기.",
    keywords: Object.freeze(["호러", "미스터리", "공포", "추리", "수사", "조사", "스릴러"]),
  }),
  Object.freeze({
    id: "comedy",
    label: "코미디",
    description: "가볍고 유쾌한 소동극.",
    keywords: Object.freeze(["코미디", "소동", "개그", "유머"]),
  }),
]);

/**
 * 어떤 그룹에도 속하지 않는 시나리오가 모이는 암묵적 폴백 그룹.
 * @type {Readonly<{ id: string, label: string, description: string }>}
 */
export const GENRE_OTHER_GROUP = Object.freeze({
  id: "other",
  label: "기타",
  description: "그 밖의 장르.",
});

/**
 * 시나리오의 장르 그룹 id를 판정한다.
 *
 * `genre`·`category` 문자열 어디에서든 그룹 키워드가 부분 문자열로 처음 등장하는
 * `GENRE_GROUPS` 그룹의 id를 반환한다(그룹 순서대로 평가). 어떤 키워드와도 일치하지
 * 않으면 `"other"`. 순수 함수이며 어떤 입력에도 throw 하지 않는다.
 *
 * @param {{ genre?: unknown, category?: unknown } | null | undefined} scenario
 * @returns {string}
 */
export function scenarioGenreGroupId(scenario) {
  if (!scenario || typeof scenario !== "object") return GENRE_OTHER_GROUP.id;
  const s = /** @type {Record<string, unknown>} */ (scenario);
  const genre = typeof s.genre === "string" ? s.genre : "";
  const category = typeof s.category === "string" ? s.category : "";
  const haystack = `${genre}\n${category}`;
  for (const group of GENRE_GROUPS) {
    for (const keyword of group.keywords) {
      if (keyword && haystack.indexOf(keyword) >= 0) {
        return group.id;
      }
    }
  }
  return GENRE_OTHER_GROUP.id;
}

/**
 * 시나리오 목록을 정규 장르 그룹으로 묶는다.
 *
 * 반환: `[{ id, label, description, scenarios }]` 순서 배열.
 * - 그룹 순서는 `GENRE_GROUPS` 순서, 그다음 `other`가 마지막.
 * - 시나리오가 1개 이상인 그룹만 포함(빈 그룹 생략).
 * - 각 그룹 내부는 입력(카탈로그) 순서를 안정적으로 보존한다.
 * 비배열 입력 → `[]`. 순수 함수이며 throw 하지 않는다.
 *
 * @template {{ genre?: unknown, category?: unknown }} S
 * @param {S[]} scenarios
 * @returns {Array<{ id: string, label: string, description: string, scenarios: S[] }>}
 */
export function groupScenariosByGenre(scenarios) {
  if (!Array.isArray(scenarios)) return [];
  /** @type {Map<string, S[]>} */
  const buckets = new Map();
  for (const scenario of scenarios) {
    const groupId = scenarioGenreGroupId(scenario);
    let bucket = buckets.get(groupId);
    if (!bucket) {
      bucket = [];
      buckets.set(groupId, bucket);
    }
    bucket.push(scenario);
  }
  const ordered = [];
  for (const group of GENRE_GROUPS) {
    const items = buckets.get(group.id);
    if (items && items.length > 0) {
      ordered.push({
        id: group.id,
        label: group.label,
        description: group.description,
        scenarios: items,
      });
    }
  }
  const otherItems = buckets.get(GENRE_OTHER_GROUP.id);
  if (otherItems && otherItems.length > 0) {
    ordered.push({
      id: GENRE_OTHER_GROUP.id,
      label: GENRE_OTHER_GROUP.label,
      description: GENRE_OTHER_GROUP.description,
      scenarios: otherItems,
    });
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// 실시간 이벤트 → 액션 환원 (Event To Action) — 작업 3.3
// ---------------------------------------------------------------------------

/**
 * 서버 → 클라이언트 실시간 이벤트(ServerEvent)를 순수 액션으로 환원한다.
 *
 * 입력 이벤트는 `type` 필드를 가진다(`src/realtime/connection.ts`의 ServerEvent).
 * - `player_list_updated` ({ players }) → PLAYER_LIST_UPDATED
 * - `scenario_set` ({ scenarioId, title, summary }) → SCENARIO_SET
 * - `turn_state` ({ state: { roundNumber, roomState? } }) → TURN_STATE
 * - `connection-open` → CONNECTION_OPENED / `connection-lost` → CONNECTION_LOST
 * 관심 없는 이벤트(`chat_message`/`narration`/`readiness_updated`/`delivery_failed`)는 null.
 * (요구사항 5.4, 6.2, 6.3, 6.4, 7.5)
 *
 * @param {{ type: string, [key: string]: any }} event
 * @returns {Action | null}
 */
export function eventToAction(event) {
  const type = event ? event.type : undefined;
  switch (type) {
    case "player_list_updated":
      return { type: "PLAYER_LIST_UPDATED", players: Array.isArray(event.players) ? event.players : [] };
    case "scenario_set":
      return {
        type: "SCENARIO_SET",
        scenarioId: event.scenarioId,
        title: event.title,
        summary: event.summary,
      };
    case "turn_state": {
      const state = event.state || {};
      return {
        type: "TURN_STATE",
        roundNumber: state.roundNumber,
        roomState: state.roomState,
      };
    }
    case "connection-open":
      return { type: "CONNECTION_OPENED" };
    case "connection-lost":
      return { type: "CONNECTION_LOST" };
    // 호스트 시작 → 서버가 전원에게 브로드캐스트. 각자 캐릭터 시트로 이동(멀티플레이어 흐름).
    case "character_setup":
      return { type: "CHARACTER_SETUP" };
    // 로비가 무시하는 이벤트.
    case "chat_message":
    case "narration":
    case "readiness_updated":
    case "delivery_failed":
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 로스터 렌더 (Roster Markup) — 작업 3.4
// ---------------------------------------------------------------------------

/**
 * HTML 특수문자를 이스케이프한다. public/index.html·host-entry의 esc() 패턴을 따른다.
 * @param {unknown} value
 * @returns {string}
 */
function esc(value) {
  return String(value).replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]),
  );
}

/**
 * 플레이어 로스터 마크업 문자열을 렌더한다.
 *
 * 각 플레이어의 `displayName`(이스케이프)과 호스트 표시를 포함하고, 현재 인원 수와
 * Max_Players를 함께 표시한다. 0명일 때는 "아직 모인 플레이어가 없음" 안내를 포함한다.
 * (요구사항 6.2, 6.5, 6.6)
 *
 * @param {RealtimePlayer[]} roster
 * @param {number | null | undefined} maxPlayers
 * @returns {string}
 */
export function renderRoster(roster, maxPlayers) {
  const list = Array.isArray(roster) ? roster : [];
  const count = list.length;
  // 정원은 정수일 때만 보여주고, 알 수 없으면 "?"로 둔다.
  const maxText =
    typeof maxPlayers === "number" && Number.isInteger(maxPlayers) ? String(maxPlayers) : "?";
  const lines = [];
  lines.push('<div class="roster">');
  lines.push(`  <p class="roster-count">현재 인원: ${count} / ${esc(maxText)}명</p>`);
  if (count === 0) {
    // 빈 목록 안내(요구사항 6.6).
    lines.push(`  <p class="roster-empty">${ROSTER_EMPTY_MESSAGE}</p>`);
  } else {
    lines.push('  <ul class="roster-list">');
    for (const player of list) {
      const name = esc(player ? player.displayName : "");
      // 호스트 표시(요구사항 6.2).
      const hostMark = player && player.isHost ? ' <span class="host-mark">(호스트)</span>' : "";
      lines.push(`    <li class="roster-player">${name}${hostMark}</li>`);
    }
    lines.push("  </ul>");
  }
  lines.push("</div>");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 세션 시작 활성·활성 감지·게임 인계 (Session helpers) — 작업 3.5
// ---------------------------------------------------------------------------

/**
 * 세션 시작 활성 여부를 판단한다.
 *
 * 연결이 활성(`open`)이고 Selected_Scenario가 확정(scenarioId 또는 title 존재)되었으며
 * 로스터에 1명 이상이 있을 때에만 true. (요구사항 7.2, 7.3)
 *
 * @param {LobbyState} state
 * @returns {boolean}
 */
export function computeStartEnabled(state) {
  if (!state) return false;
  const connected = state.connection === ConnectionStatus.OPEN;
  const sel = state.selectedScenario || { scenarioId: null, title: null, summary: null };
  const scenarioConfirmed = isNonEmptyString(sel.scenarioId) || isNonEmptyString(sel.title);
  const hasPlayers = Array.isArray(state.roster) && state.roster.length >= 1;
  return connected && scenarioConfirmed && hasPlayers;
}

/**
 * viewer가 이 로비의 호스트인지 판정한다(호스트 전용 세션 시작 게이트).
 *
 * viewer 신원 = `effectiveViewerId(state.handoff)`(playerId 우선, 없으면 hostPlayerId).
 * 다음 중 하나라도 참이면 호스트로 본다:
 *  (a) 서버 권위: 로스터(state.roster)에 `id === viewerId && isHost === true`인 항목이 있다.
 *  (b) 인계 휴리스틱: `state.handoff.hostPlayerId`가 비어있지 않고 viewer 신원과 일치한다
 *      (로스터 도착 전 URL만으로 호스트를 즉시 인식하게 한다).
 * 그 외(예: playerId만 가진 입장 플레이어)는 false. null-safe.
 *
 * @param {LobbyState} state
 * @returns {boolean}
 */
export function isViewerHost(state) {
  if (!state) return false;
  const handoff = state.handoff || null;
  const viewerId = effectiveViewerId(handoff);
  if (viewerId.length === 0) return false;
  // (a) 서버 권위: 로스터의 isHost 플래그.
  const roster = Array.isArray(state.roster) ? state.roster : [];
  for (const player of roster) {
    if (player && player.id === viewerId && player.isHost === true) {
      return true;
    }
  }
  // (b) 인계 휴리스틱: hostPlayerId가 비어있지 않고 viewer 신원과 일치.
  const hostPlayerId = handoff ? trimToString(handoff.hostPlayerId) : "";
  if (hostPlayerId.length >= 1 && viewerId === hostPlayerId) {
    return true;
  }
  return false;
}

/**
 * 방이 세션 진행 단계(Session_Active_State)로 전이했는지 감지한다.
 *
 * `roundNumber >= 1`이거나 방 상태가 `in_session`이면 true. (요구사항 7.5, 7.6)
 *
 * @param {{ roundNumber?: number, roomState?: string }} turnState
 * @returns {boolean}
 */
export function detectSessionActive(turnState) {
  if (!turnState) return false;
  const roundNumber = turnState.roundNumber;
  if (typeof roundNumber === "number" && roundNumber >= 1) {
    return true;
  }
  return turnState.roomState === "in_session";
}

/**
 * 게임 화면 인계 페이로드를 구성한다.
 *
 * `roomId`·`hostPlayerId`를 담는다.
 * viewer의 유효 신원(`effectiveViewerId`)이 비어 있지 않으면 `playerId`로 포함해
 * 게임 화면이 합류 플레이어의 본인 신원을 표시하게 한다.
 * (요구사항 10.3, 10.4)
 *
 * @param {Handoff} handoff
 * @returns {{ roomId: string, hostPlayerId: string, playerId?: string }}
 */
export function buildGameHandoff(handoff) {
  /** @type {{ roomId: string, hostPlayerId: string, playerId?: string }} */
  const payload = {
    roomId: handoff ? handoff.roomId : "",
    hostPlayerId: handoff ? handoff.hostPlayerId : "",
  };
  // viewer 유효 신원(playerId 우선, 없으면 hostPlayerId)을 게임 화면에 전달한다.
  const viewerId = effectiveViewerId(handoff);
  if (isNonEmptyString(viewerId)) {
    payload.playerId = viewerId;
  }
  return payload;
}

/**
 * 캐릭터 시트 화면(`/character/`) 인계 쿼리 문자열을 구성한다.
 *
 * `?roomId=…&playerId=…` 형태로, 토큰·티켓은 URL에 포함하지 않는다.
 * `playerId`는 viewer의 유효 신원(`playerId` 우선, 없으면 `hostPlayerId`)이며, 각 값은 URL 인코딩된다.
 * `ticket`은 서버 발급 연결 티켓(auth-hardening)으로 캐릭터 화면이 player-acting REST 요청에 실어 보낸다.
 * `character_setup` 이벤트 수신 시 각 클라이언트가 자기 캐릭터 시트로 이동하는 데 쓴다.
 *
 * @param {Handoff} handoff
 * @returns {string} 선행 "?"를 포함한 쿼리 문자열(예: "?roomId=r1&playerId=p1")
 */
export function buildCharacterSearch(handoff) {
  const roomId = handoff ? trimToString(handoff.roomId) : "";
  const playerId = effectiveViewerId(handoff);
  const params = new URLSearchParams();
  params.set("roomId", roomId);
  params.set("playerId", playerId);
  return "?" + params.toString();
}

// ---------------------------------------------------------------------------
// 상태 리듀서 (Reducer) — 작업 4.1
// ---------------------------------------------------------------------------

/**
 * 단방향 상태 전이 리듀서. 입력 상태를 변형하지 않고 항상 새 객체를 반환한다.
 * 단, 변화가 없는(no-op) 액션은 동일 참조를 그대로 반환한다.
 *
 * 모든 *_FAILED는 인계 식별자·토큰을 보존하며(요구사항 9.6), 각 오류 종류·영역에
 * 대응하는 한국어 메시지를 매핑한다(렌더 시 computeVisibility/뷰가 사용).
 *
 * @param {LobbyState} state
 * @param {Action} action
 * @returns {LobbyState}
 */
export function reduce(state, action) {
  const type = action ? action.type : undefined;

  switch (type) {
    // -- 인계 (요구사항 1.x) --------------------------------------------------
    case "HANDOFF_PARSED": {
      // handoff 저장 + handoffValid 갱신. 무효면 모든 영역은 idle 유지(요청·연결 미시작).
      const handoff = /** @type {Handoff} */ (action.handoff) || {
        roomId: "",
        hostPlayerId: "",
        playerId: "",
        token: "",
        ticket: "",
      };
      return {
        ...state,
        handoff,
        handoffValid: isHandoffValid(handoff),
      };
    }

    // -- 초대 링크 (요구사항 2.x) --------------------------------------------
    case "INVITE_STARTED": {
      return {
        ...state,
        invite: { phase: AreaPhase.LOADING, errorKind: null, data: state.invite.data },
      };
    }

    case "INVITE_SUCCEEDED": {
      return {
        ...state,
        invite: {
          phase: AreaPhase.LOADED,
          errorKind: null,
          data: /** @type {string} */ (action.inviteLink),
        },
      };
    }

    case "INVITE_FAILED": {
      // 인계 식별자·토큰 불변(스프레드로 보존). 영역만 error로 전이(요구사항 9.5/9.6).
      const kind = /** @type {ErrorKind} */ (action.kind);
      return {
        ...state,
        invite: { phase: AreaPhase.ERROR, errorKind: kind, data: state.invite.data },
      };
    }

    // -- 방 정보 (요구사항 4.x) ----------------------------------------------
    case "ROOM_STARTED": {
      return {
        ...state,
        room: { phase: AreaPhase.LOADING, errorKind: null, data: state.room.data },
      };
    }

    case "ROOM_SUCCEEDED": {
      // maxPlayers·scenarioId 보존(요구사항 4.3).
      const maxPlayers = /** @type {number} */ (action.maxPlayers);
      const scenarioId = /** @type {string} */ (action.scenarioId);
      return {
        ...state,
        room: {
          phase: AreaPhase.LOADED,
          errorKind: null,
          data: { maxPlayers, scenarioId },
        },
      };
    }

    case "ROOM_INVALID": {
      // 형식 위반(요구사항 4.6). 정원·시나리오 미표시 + invalid 오류.
      return {
        ...state,
        room: { phase: AreaPhase.ERROR, errorKind: ErrorKind.INVALID, data: null },
      };
    }

    case "ROOM_FAILED": {
      const kind = /** @type {ErrorKind} */ (action.kind);
      return {
        ...state,
        room: { phase: AreaPhase.ERROR, errorKind: kind, data: state.room.data },
      };
    }

    // -- 시나리오 (요구사항 5.x) ---------------------------------------------
    case "SCENARIOS_STARTED": {
      return {
        ...state,
        scenarios: { phase: AreaPhase.LOADING, errorKind: null, data: state.scenarios.data },
      };
    }

    case "SCENARIOS_SUCCEEDED": {
      // selectScenario 결과로 selectedScenario/scenarioNotice 갱신(요구사항 5.2/5.3/5.6/5.7).
      const scenarios = /** @type {{ id: string, title: string, summary: string }[]} */ (
        action.scenarios
      );
      // 이미 선택된 시나리오(로컬 선택 또는 scenario_set 브로드캐스트로 동기화된 값)가 있으면
      // 그것을 우선한다. 없을 때에만 방 생성 시의 원래 scenarioId로 폴백한다. 이렇게 하면
      // "시나리오 재조회"가 현재 선택을 방의 초기값으로 되돌려 화면 간 불일치를 만드는 일을 막는다.
      const selectedId = isNonEmptyString(state.selectedScenario.scenarioId)
        ? state.selectedScenario.scenarioId
        : state.room.data
          ? state.room.data.scenarioId
          : state.selectedScenario.scenarioId;
      const result = selectScenario(scenarios, selectedId);
      /** @type {SelectedScenario} */
      let selectedScenario = state.selectedScenario;
      /** @type {string | null} */
      let scenarioNotice = null;
      if (result.kind === "matched" || result.kind === "default") {
        selectedScenario = {
          // 기본 선택 시 식별자가 미확정일 수 있으므로 기존 식별자를 유지한다.
          scenarioId: selectedId != null ? selectedId : state.selectedScenario.scenarioId,
          title: result.scenario.title,
          summary: result.scenario.summary,
        };
      } else if (result.kind === "empty") {
        scenarioNotice = SCENARIO_EMPTY_MESSAGE;
      } else if (result.kind === "unmatched") {
        scenarioNotice = SCENARIO_UNMATCHED_MESSAGE;
      }
      return {
        ...state,
        scenarios: { phase: AreaPhase.LOADED, errorKind: null, data: scenarios },
        selectedScenario,
        scenarioNotice,
      };
    }

    case "SCENARIOS_FAILED": {
      // 실패해도 기존 selectedScenario 보존(요구사항 5.5).
      const kind = /** @type {ErrorKind} */ (action.kind);
      return {
        ...state,
        scenarios: { phase: AreaPhase.ERROR, errorKind: kind, data: state.scenarios.data },
        // selectedScenario, scenarioNotice는 스프레드로 그대로 보존.
      };
    }

    // -- 실시간 이벤트 (요구사항 5.4, 6.x, 7.5) ------------------------------
    case "PLAYER_LIST_UPDATED": {
      // 로스터를 이벤트 목록으로 완전 교체(요구사항 6.2).
      const players = /** @type {RealtimePlayer[]} */ (
        Array.isArray(action.players) ? action.players : []
      );
      return { ...state, roster: players };
    }

    case "SCENARIO_SET": {
      // 표시 시나리오를 이벤트의 title/summary로 갱신(요구사항 5.4).
      return {
        ...state,
        selectedScenario: {
          scenarioId: /** @type {string} */ (action.scenarioId),
          title: /** @type {string} */ (action.title),
          summary: /** @type {string} */ (action.summary),
        },
        // 새 시나리오가 확정되었으므로 빈/불일치 안내는 해제한다.
        scenarioNotice: null,
      };
    }

    case "TURN_STATE": {
      // Session_Active 감지 시 인계 1회(요구사항 7.5/7.6).
      const active = detectSessionActive({
        roundNumber: /** @type {number} */ (action.roundNumber),
        roomState: /** @type {string} */ (action.roomState),
      });
      if (active && state.handoffDone === false) {
        return { ...state, handoffDone: true, sessionStarting: false };
      }
      // 비활성이거나 이미 인계됨 → 무변화.
      return state;
    }

    case "CHARACTER_SETUP": {
      // 호스트 시작 브로드캐스트 → 캐릭터 시트 화면으로 1회 이동(handoffDone 패턴 미러).
      if (state.characterSetupDone === false) {
        return { ...state, characterSetupDone: true };
      }
      // 이미 이동함 → 무변화(동일 참조).
      return state;
    }

    case "CONNECTION_OPENED": {
      if (state.connection === ConnectionStatus.OPEN) return state;
      return { ...state, connection: ConnectionStatus.OPEN };
    }

    case "CONNECTION_LOST": {
      if (state.connection === ConnectionStatus.DISCONNECTED) return state;
      return { ...state, connection: ConnectionStatus.DISCONNECTED };
    }

    // -- 세션 시작 (요구사항 7.x, 8.5/8.6) -----------------------------------
    case "START_SESSION": {
      // 아직 전송하지 않았고 활성 조건을 충족할 때만 정확히 1회 전이(요구사항 7.4).
      if (state.startCommandSent === false && computeStartEnabled(state)) {
        return { ...state, startCommandSent: true, sessionStarting: true, startError: null };
      }
      return state;
    }

    case "START_SESSION_FAILED": {
      // 재시도 가능 상태로 복귀(요구사항 7.7). 구체적 사유 메시지가 있으면 그것을, 없으면 일반 안내.
      return {
        ...state,
        sessionStarting: false,
        startCommandSent: false,
        startError: isNonEmptyString(action.message)
          ? /** @type {string} */ (action.message)
          : SESSION_START_FAILED_MESSAGE,
      };
    }

    case "START_SESSION_TIMEOUT": {
      // 30초 미전이 → 재시도 가능 상태로 복귀(요구사항 8.6).
      return {
        ...state,
        sessionStarting: false,
        startCommandSent: false,
        startError: SESSION_START_TIMEOUT_MESSAGE,
      };
    }

    // -- 복사 (요구사항 3.x) -------------------------------------------------
    case "COPY_SUCCEEDED": {
      const now = /** @type {number} */ (action.now);
      return {
        ...state,
        copyConfirmedUntil: now + COPY_CONFIRM_MS,
        copyFailed: false,
      };
    }

    case "COPY_FAILED": {
      return {
        ...state,
        copyFailed: true,
        copyConfirmedUntil: null,
      };
    }

    default:
      // 알 수 없는 액션은 상태를 그대로 반환한다(no-op, 동일 참조).
      return state;
  }
}

// ---------------------------------------------------------------------------
// 뷰 모델 가시성 (View Model Visibility) — 작업 5.1
// ---------------------------------------------------------------------------

/**
 * 상태로부터 가시성을 도출한다. 모든 가시성은 상태의 함수다.
 *
 * - 각 REST 영역의 로딩 인디케이터는 `phase === "loading"`일 때만 표시하고, 그때 동일
 *   영역의 재트리거 컨트롤(`*RetriggerDisabled`)을 비활성화한다(요구사항 8.1/8.2/8.3).
 * - 실시간 연결 활성 표시(`connectionActive`)는 `connection === "open"`일 때만(요구사항 6.3).
 * - 세션 시작 인디케이터(`sessionStarting`)는 `sessionStarting`일 때만(요구사항 8.5).
 * - 데이터 적재 전(인계 직후)이거나 인계 무효면 사용자 조작 컨트롤을 비활성으로 둔다(요구사항 1.4).
 *
 * @param {LobbyState} state
 * @returns {{
 *   handoffValid: boolean,
 *   inviteLoading: boolean,
 *   inviteRetriggerDisabled: boolean,
 *   roomLoading: boolean,
 *   roomRetriggerDisabled: boolean,
 *   scenariosLoading: boolean,
 *   scenariosRetriggerDisabled: boolean,
 *   connectionActive: boolean,
 *   sessionStarting: boolean,
 *   isHost: boolean,
 *   startEnabled: boolean,
 *   controlsDisabled: boolean,
 *   copyDisabled: boolean
 * }}
 */
export function computeVisibility(state) {
  const handoffValid = !!(state && state.handoffValid);
  const inviteLoading = !!(state && state.invite.phase === AreaPhase.LOADING);
  const roomLoading = !!(state && state.room.phase === AreaPhase.LOADING);
  const scenariosLoading = !!(state && state.scenarios.phase === AreaPhase.LOADING);
  // 인계가 유효하고 초대 링크가 적재 완료됐을 때만 데이터 의존 컨트롤(복사 등)을 활성화한다.
  const inviteLoaded = !!(state && state.invite.phase === AreaPhase.LOADED);
  // 인계 무효이면 모든 사용자 조작을 비활성으로 둔다(요구사항 1.4).
  const controlsDisabled = !handoffValid;
  // viewer가 호스트인지(서버 권위 로스터 isHost 또는 인계 휴리스틱). 비호스트는
  // 절대 세션 시작 컨트롤을 갖지 못한다(멀티플레이어 흐름: 호스트만 시작).
  const isHost = isViewerHost(state);
  return {
    handoffValid,
    // 영역별 로딩 인디케이터 + 재트리거 비활성(로딩 중일 때만).
    inviteLoading,
    inviteRetriggerDisabled: controlsDisabled || inviteLoading,
    roomLoading,
    roomRetriggerDisabled: controlsDisabled || roomLoading,
    scenariosLoading,
    scenariosRetriggerDisabled: controlsDisabled || scenariosLoading,
    // 실시간 연결 활성 표시(요구사항 6.3).
    connectionActive: !!(state && state.connection === ConnectionStatus.OPEN),
    // 세션 시작 인디케이터(요구사항 8.5).
    sessionStarting: !!(state && state.sessionStarting),
    // viewer가 호스트인지(시작 컨트롤 노출/배지 표시 구동).
    isHost,
    // 세션 시작 버튼 활성 여부(요구사항 7.2/7.3) — 호스트만, 시작 진행 중이면 비활성.
    startEnabled: handoffValid && isHost && !state.sessionStarting && computeStartEnabled(state),
    // 데이터 적재 전/인계 무효 시 사용자 조작 비활성(요구사항 1.4).
    controlsDisabled,
    // 복사 버튼은 인계 유효 + 초대 링크 적재 완료 시에만 활성(요구사항 3.1 기반 노출 제어).
    copyDisabled: controlsDisabled || !inviteLoaded,
  };
}

// ---------------------------------------------------------------------------
// 클립보드 복사 어댑터 (Clipboard) — 작업 6.1
// ---------------------------------------------------------------------------

/**
 * 초대 링크를 주입받은 클립보드 어댑터로 복사한다. (host-entry 패턴 재사용)
 *
 * `inviteLink` 전체 문자열을 `clipboard.writeText`로 기록하고, 성공 시 true,
 * 실패(거부/예외/어댑터 없음)시 false를 반환한다. 어댑터가 동기·비동기 어느 쪽이든
 * `await`로 안전하게 처리하며, 던지거나 reject 해도 false로 환원한다.
 * (요구사항 3.2, 3.4)
 *
 * @param {string} inviteLink
 * @param {{ writeText?: (text: string) => unknown } | null | undefined} clipboard
 * @returns {Promise<boolean>}
 */
export async function copyInviteLink(inviteLink, clipboard) {
  if (!clipboard || typeof clipboard.writeText !== "function") {
    return false;
  }
  try {
    await clipboard.writeText(inviteLink);
    return true;
  } catch {
    return false;
  }
}
