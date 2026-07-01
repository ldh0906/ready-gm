// @ts-check
/**
 * Join_App 순수 로직 모듈 (초대 입장 화면)
 *
 * 이 모듈은 DOM·네트워크에 의존하지 않는 순수 함수들만 모은다.
 * 초대 토큰 추출, 인증 헤더 구성, 입장 요청 빌더, 응답 분류, 빈 이름 차단,
 * 입장 응답 검증, 로비 인계 쿼리 구성을 담당하며 vitest(node 환경)에서 직접
 * import 하여 단위/속성 테스트한다.
 *
 * 부수효과(fetch, AbortController 10초 타임아웃, 네비게이션, DOM 갱신)는
 * index.html의 스크립트(부수효과 계층)가 담당하고, 본 모듈이 만든 결정을 실행만 한다.
 *
 * host-entry/lobby 화면의 관례(순수 로직 분리, 방어적 헬퍼, 한국어 메시지 상수)를 미러한다.
 *
 * 설계 문서: .kiro/steering/multiplayer-session-flow.md (단계 1)
 */

// ---------------------------------------------------------------------------
// 타임아웃 상수 (Timeout Constants)
// ---------------------------------------------------------------------------

/** REST 요청 클라이언트 타임아웃(ms). host-entry/lobby와 동일한 10초. */
export const REQUEST_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// 사용자 메시지 상수 (한국어 메시지)
// ---------------------------------------------------------------------------

/** 초대 링크(경로의 토큰)가 비어 있거나 형식이 올바르지 않을 때의 안내. */
export const INVALID_LINK_MESSAGE =
  "초대 링크가 올바르지 않습니다. 호스트에게 새 초대 링크를 요청해 주세요.";

/** 표시 이름이 비어 있을 때(공백 포함) 입력 인접 위치에 표시할 검증 안내. */
export const BLANK_NAME_MESSAGE =
  "표시 이름을 공백을 제외하고 최소 1자 이상 입력해 주세요.";

/**
 * 입장 결과 종류별 한국어 사용자 메시지.
 *
 * /join 엔드포인트의 응답을 매핑한다.
 * - notfound: HTTP 404, 알 수 없는 방(만료/삭제)
 * - full: HTTP 409, 방 정원 초과 또는 로비 단계가 아님
 * - auth: HTTP 401/403, 토큰 누락·불일치
 * - timeout: 클라이언트 타임아웃
 * - network: 네트워크 실패
 * - server: HTTP 5xx 등 기타 서버 오류
 * @type {Readonly<Record<"notfound" | "full" | "auth" | "timeout" | "network" | "server", string>>}
 */
export const OUTCOME_MESSAGES = Object.freeze({
  notfound: "해당 방을 찾을 수 없습니다. 방이 만료되었거나 삭제되었을 수 있습니다.",
  full: "방에 입장할 수 없습니다. 정원이 가득 찼거나 이미 시작된 방일 수 있습니다.",
  auth: "이 방에 입장할 권한이 없습니다. 초대 링크를 다시 확인해 주세요.",
  timeout: "입장 요청이 지연되어 완료되지 못했습니다. 잠시 후 다시 시도해 주세요.",
  network: "네트워크 연결 문제로 입장하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.",
  server: "서버 오류로 입장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
});

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
// 초대 토큰 추출 (Invite Token Extraction)
// ---------------------------------------------------------------------------

/**
 * `/join/<token>` 경로(또는 전체 URL)에서 초대 토큰을 추출한다.
 *
 * lobby의 extractInviteToken 접근을 미러하되, 토큰이 `/join/` 뒤의 경로 세그먼트인
 * 점에 맞춘다. 질의(`?`)·프래그먼트(`#`)를 제거하고, 끝의 슬래시들을 제거한 뒤,
 * `/join/` 다음 세그먼트를 취해 `decodeURIComponent`한다. `/join/` 세그먼트가 없거나
 * 토큰을 만들 수 없으면 `""`를 반환하여 입장이 비활성화되게 한다.
 *
 * @param {string} pathnameOrUrl 페이지 경로(예: "/join/abc") 또는 전체 URL
 * @returns {string}
 */
export function extractInviteToken(pathnameOrUrl) {
  let s = String(pathnameOrUrl == null ? "" : pathnameOrUrl);
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
  // "/join/" 다음의 세그먼트를 토큰으로 본다. 마지막 "join" 경로 구분점을 찾는다.
  const segments = s.split("/");
  const joinIdx = segments.lastIndexOf("join");
  // "join" 세그먼트가 없거나, 그 뒤에 세그먼트가 없으면 토큰 없음.
  if (joinIdx < 0 || joinIdx + 1 >= segments.length) {
    return "";
  }
  const rawToken = segments[joinIdx + 1];
  if (!isNonEmptyString(rawToken)) {
    return "";
  }
  try {
    return decodeURIComponent(rawToken);
  } catch {
    // 잘못된 퍼센트 인코딩은 원본 세그먼트를 그대로 반환한다(방어적).
    return rawToken;
  }
}

// ---------------------------------------------------------------------------
// 토큰 헤더 구성 (Auth Header Builder)
// ---------------------------------------------------------------------------

/**
 * 접근 토큰으로 인증 헤더를 구성한다.
 *
 * 토큰이 비어 있지 않으면 `{ "x-playtest-token": token }`(값 무변형), 아니면 `{}`.
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

// ---------------------------------------------------------------------------
// 빈 이름 차단 (Blank Name Guard)
// ---------------------------------------------------------------------------

/**
 * 표시 이름이 비어 있는지(공백만 있는지) 판단한다.
 *
 * 앞뒤 공백을 제거한 뒤 길이가 1자 미만이면 true. JS의 trim은 전각 공백(U+3000)
 * 등 유니코드 공백도 제거하므로 공백 문자로만 이루어진 입력은 모두 비어 있다고 본다.
 *
 * @param {string} name 사용자 원본 입력값
 * @returns {boolean}
 */
export function isBlankName(name) {
  return trimToString(name).length < 1;
}

// ---------------------------------------------------------------------------
// 입장 요청 빌더 (Join Request Building)
// ---------------------------------------------------------------------------

/**
 * `POST /rooms/:token/join` 요청 명세를 구성한다.
 *
 * URL의 초대 토큰은 `encodeURIComponent`로 인코딩한다. 바디의 `displayName`은
 * 트림된 이름과 정확히 일치한다. `content-type` 헤더는 항상 포함하며, 접근 토큰이
 * 비어 있지 않으면 `x-playtest-token` 헤더에 값을 그대로 담는다.
 *
 * @param {string} inviteToken 경로의 초대 토큰(원본, 비인코딩)
 * @param {string} displayName 사용자 원본 입력값(트림 전)
 * @param {string} token ?token= 접근 토큰(없으면 빈 문자열)
 * @returns {{ url: string, method: string, headers: Record<string, string>, body: string }}
 */
export function buildJoinRequest(inviteToken, displayName, token) {
  /** @type {Record<string, string>} */
  const headers = { "content-type": "application/json" };
  const auth = buildAuthHeaders(token);
  for (const key of Object.keys(auth)) {
    headers[key] = auth[key];
  }
  return {
    url: "/rooms/" + encodeURIComponent(inviteToken) + "/join",
    method: "POST",
    headers,
    body: JSON.stringify({ displayName: trimToString(displayName) }),
  };
}

// ---------------------------------------------------------------------------
// 응답·결과 분류 (Response / Outcome Classification)
// ---------------------------------------------------------------------------

/**
 * 요청 결과(응답/네트워크오류/타임아웃)를 단일 결과 타입으로 환원한다.
 *
 * 시그니처: `classifyOutcome({ kind, response? })`
 * - `kind: "network"` → "network"
 * - `kind: "timeout"` → "timeout"
 * - `kind: "response"` → 상태 코드로 분류
 *     - 2xx                 → "success"
 *     - 404                 → "notfound" (알 수 없는 방)
 *     - 409                 → "full" (정원 초과 / 로비 아님)
 *     - 401, 403            → "auth"
 *     - 5xx                 → "server"
 *     - 그 외(기타 4xx 등)  → "server" (보수적 처리)
 *
 * @param {{ kind: "response" | "network" | "timeout", response?: { ok?: boolean, status?: number } }} outcome
 * @returns {"success" | "notfound" | "full" | "auth" | "timeout" | "network" | "server"}
 */
export function classifyOutcome(outcome) {
  const kind = outcome ? outcome.kind : undefined;
  if (kind === "network") return "network";
  if (kind === "timeout") return "timeout";
  if (kind === "response") {
    const response = outcome.response || {};
    const status = typeof response.status === "number" ? response.status : 0;
    const ok = !!response.ok;
    if (status >= 200 && status <= 299) return "success";
    if (ok && status === 0) return "success"; // status 미상이나 ok면 성공으로 본다.
    if (status === 404) return "notfound";
    if (status === 409) return "full";
    if (status === 401 || status === 403) return "auth";
    if (status >= 500) return "server";
    // 기타 비-2xx(400 등)는 보수적으로 server로 환원한다.
    return "server";
  }
  // 알 수 없는 결과 종류도 보수적으로 server 오류로 환원한다.
  return "server";
}

// ---------------------------------------------------------------------------
// 입장 응답 검증 (Join Response Validation)
// ---------------------------------------------------------------------------

/**
 * 입장 응답 본문을 검증한다.
 *
 * `roomId`와 `playerId`가 모두 비어 있지 않은 문자열일 때에만
 * `{ ok: true, roomId, playerId, displayName, connectionToken }`를 반환한다. `displayName`은
 * 문자열이면 그대로, 아니면 빈 문자열로 둔다. 서버 발급 연결 티켓(`connectionToken`)도
 * 문자열이면 그대로, 아니면 빈 문자열로 둔다(auth-hardening). 그 외는 `{ ok: false }`.
 *
 * @param {unknown} body
 * @returns {{ ok: true, roomId: string, playerId: string, displayName: string, connectionToken: string } | { ok: false }}
 */
export function validateJoinResponse(body) {
  if (!body || typeof body !== "object") {
    return { ok: false };
  }
  const roomId = /** @type {{ roomId?: unknown }} */ (body).roomId;
  const playerId = /** @type {{ playerId?: unknown }} */ (body).playerId;
  const displayName = /** @type {{ displayName?: unknown }} */ (body).displayName;
  const connectionToken = /** @type {{ connectionToken?: unknown }} */ (body).connectionToken;
  if (isNonEmptyString(roomId) && isNonEmptyString(playerId)) {
    return {
      ok: true,
      roomId: /** @type {string} */ (roomId),
      playerId: /** @type {string} */ (playerId),
      displayName: isNonEmptyString(displayName) ? /** @type {string} */ (displayName) : "",
      connectionToken: isNonEmptyString(connectionToken)
        ? /** @type {string} */ (connectionToken)
        : "",
    };
  }
  return { ok: false };
}

// ---------------------------------------------------------------------------
// 로비 인계 쿼리 구성 (Lobby Handoff Search)
// ---------------------------------------------------------------------------

/**
 * 로비 화면으로의 인계 쿼리 문자열을 구성한다.
 *
 * `?roomId=…&playerId=…&token=…&ticket=…` 형식이며, 모든 값은 URL 인코딩된다. 토큰과
 * 연결 티켓(auth-hardening)은 각각 비어 있지 않을 때만 포함한다.
 *
 * 주의: 로비는 현재 인계에서 `hostPlayerId`를 읽지만, 입장한 플레이어는 호스트가
 * 아니다. 단계 1에서는 `playerId`만 전달하고 `hostPlayerId`는 설정하지 않는다(후속
 * 단계에서 로비가 비-호스트 신원을 받도록 배선).
 *
 * @param {{ roomId: string, playerId: string, token: string, ticket?: string }} payload
 * @returns {string} 선행 "?"를 포함한 쿼리 문자열
 */
export function buildLobbySearch(payload) {
  const roomId = payload ? String(payload.roomId == null ? "" : payload.roomId) : "";
  const playerId = payload ? String(payload.playerId == null ? "" : payload.playerId) : "";
  const token = payload ? String(payload.token == null ? "" : payload.token) : "";
  const ticket = payload ? String(payload.ticket == null ? "" : payload.ticket) : "";
  const params = new URLSearchParams();
  params.set("roomId", roomId);
  params.set("playerId", playerId);
  // 토큰은 비어 있지 않을 때만 포함한다.
  if (token.length > 0) {
    params.set("token", token);
  }
  // 서버 발급 연결 티켓은 비어 있지 않을 때만 포함한다(auth-hardening).
  if (ticket.length > 0) {
    params.set("ticket", ticket);
  }
  return "?" + params.toString();
}
