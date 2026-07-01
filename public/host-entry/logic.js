// @ts-check
/**
 * Host_Entry_App 순수 로직 모듈 (랜딩 / 방 생성 화면)
 *
 * 이 모듈은 DOM·네트워크·클립보드에 의존하지 않는 순수 함수들만 모은다.
 * 검증, 상태 전이(reduce), 응답/오류 분류, 요청 구성, 인계 페이로드 구성을 담당하며
 * vitest(node 환경)에서 직접 import 하여 단위/속성 테스트한다.
 *
 * 부수효과(fetch, AbortController 타임아웃, 클립보드, 네비게이션, DOM 갱신)는
 * index.html의 스크립트(부수효과 계층)가 담당하고, 본 모듈이 만든 결정을 실행만 한다.
 *
 * 설계 문서: .kiro/specs/frontend-applications/design.md
 */

// ---------------------------------------------------------------------------
// 상태 모델 상수 (State Model Constants)
// ---------------------------------------------------------------------------

/**
 * 화면의 단계.
 * @typedef {"idle" | "submitting" | "success" | "error"} Phase
 * - idle: 초기. 폼 표시, 패널 숨김 (요구사항 1.2)
 * - submitting: 요청 전송~응답 도착 전. 인디케이터 표시, Submit 비활성 (요구사항 3.1, 3.2)
 * - success: 방 생성 성공. Invite_Panel 표시 (요구사항 4.x)
 * - error: 오류. 메시지 표시, Submit 재활성 (요구사항 3.4, 8.x)
 */

/** 단계 상수. @type {Readonly<Record<string, Phase>>} */
export const Phase = Object.freeze({
  IDLE: "idle",
  SUBMITTING: "submitting",
  SUCCESS: "success",
  ERROR: "error",
});

/**
 * 오류 종류. 사용자에게 보일 한국어 메시지를 결정한다.
 * @typedef {"validation" | "server" | "network" | "timeout"} ErrorKind
 * - validation: HTTP 400. 표시 이름 수정 안내 (요구사항 7.1)
 * - server: HTTP 5xx (요구사항 8.2)
 * - network: 네트워크 실패 (요구사항 8.1)
 * - timeout: 클라이언트 타임아웃 (요구사항 3.5, 8.1)
 */

/** 오류 종류 상수. @type {Readonly<Record<string, ErrorKind>>} */
export const ErrorKind = Object.freeze({
  VALIDATION: "validation",
  SERVER: "server",
  NETWORK: "network",
  TIMEOUT: "timeout",
});

// ---------------------------------------------------------------------------
// 타임아웃·복사 상수 (Timeout / Copy Constants)
// ---------------------------------------------------------------------------

/**
 * 클라이언트 요청 타임아웃(ms). 10초 임계값이 30초보다 엄격하므로
 * 요구사항 3.5/4.4/2.6(10초)과 8.1(30초)을 모두 충족한다.
 */
export const REQUEST_TIMEOUT_MS = 10000;

/** 복사 성공 확인 메시지 최소 표시 시간(ms). (요구사항 5.3) */
export const COPY_CONFIRM_MS = 3000;

// ---------------------------------------------------------------------------
// 타입 주석 (JSDoc Typedefs)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CreateRoomSuccess
 * @property {string} roomId
 * @property {string} inviteToken
 * @property {string} inviteLink
 * @property {string} hostPlayerId
 * @property {string} state
 * @property {number} maxPlayers
 * @property {string=} connectionToken  서버 발급 연결 티켓(auth-hardening). 있으면 로비 인계에 `ticket`으로 실린다.
 */

/**
 * @typedef {Object} HostEntryState
 * @property {Phase} phase
 * @property {string} displayNameInput   원본 입력값 (보존 대상, 요구사항 2.2/7.2/8.1/8.2)
 * @property {string} token              ?token= 값, 빈 문자열이면 토큰 없음 (요구사항 9)
 * @property {string | null} validationMessage 입력 인접 안내 (요구사항 1.3/2.3/7.1)
 * @property {ErrorKind | null} errorKind
 * @property {string | null} errorMessage
 * @property {CreateRoomSuccess | null} success
 * @property {number | null} copyConfirmedUntil 복사 확인 메시지 표시 만료 시각(ms) (요구사항 5.3)
 * @property {boolean} copyFailed        복사 실패 표시(수동 복사 폴백 노출용) (요구사항 5.4)
 * @property {boolean} handoffDone       인계 1회 보장 (요구사항 6.2)
 */

// ---------------------------------------------------------------------------
// 초기 상태 팩토리 (Initial State Factory)
// ---------------------------------------------------------------------------

/**
 * 초기 상태를 생성한다.
 * @param {string} token ?token= 쿼리 값(없으면 빈 문자열)
 * @returns {HostEntryState}
 */
export function createInitialState(token) {
  return {
    phase: Phase.IDLE,
    displayNameInput: "",
    token,
    validationMessage: null,
    errorKind: null,
    errorMessage: null,
    success: null,
    copyConfirmedUntil: null,
    copyFailed: false,
    handoffDone: false,
  };
}

// ---------------------------------------------------------------------------
// 사용자 메시지 상수 (한국어 메시지)
// ---------------------------------------------------------------------------

/**
 * Display_Name이 비어 있을 때 입력 인접 위치에 표시할 검증 안내.
 * (요구사항 1.3/2.3/10.5)
 */
export const VALIDATION_MESSAGE =
  "표시 이름을 공백을 제외하고 최소 1자 이상 입력해 주세요.";

/**
 * 오류 종류별 한국어 사용자 메시지. (Error Handling 표 참조)
 * - validation: HTTP 400, 입력 인접 안내 (요구사항 7.1)
 * - server: HTTP 5xx (요구사항 8.2)
 * - network: 네트워크 실패 (요구사항 8.1)
 * - timeout: 클라이언트 타임아웃 (요구사항 3.5, 8.1)
 * @type {Readonly<Record<ErrorKind, string>>}
 */
export const ERROR_MESSAGES = Object.freeze({
  validation: "표시 이름은 공백을 제외하고 최소 1자 이상이어야 합니다. 표시 이름을 확인해 주세요.",
  server: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  network: "연결에 문제가 발생했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.",
  timeout: "연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
});

// ---------------------------------------------------------------------------
// 검증 (Validation) — 작업 2.1
// ---------------------------------------------------------------------------

/**
 * 표시 이름을 검증한다.
 *
 * 앞뒤 공백을 제거(`String.prototype.trim`)한 뒤 길이가 1자 이상이면 유효하다.
 * JS의 `trim`은 스페이스·탭·개행은 물론 전각 공백(U+3000) 등 유니코드 공백도
 * 제거하므로, 공백 문자로만 이루어진 입력과 빈 문자열은 모두 무효가 된다.
 * (요구사항 1.3, 2.2, 2.3, 10.5)
 *
 * @param {string} raw 사용자 원본 입력값
 * @returns {{ valid: boolean, trimmed: string }}
 */
export function validateDisplayName(raw) {
  // null/undefined도 안전하게 처리하기 위해 문자열로 강제 변환한다.
  const trimmed = String(raw == null ? "" : raw).trim();
  return { valid: trimmed.length >= 1, trimmed };
}

// ---------------------------------------------------------------------------
// 요청 구성 (Request Building) — 작업 2.2
// ---------------------------------------------------------------------------

/**
 * POST /rooms 요청을 구성한다.
 *
 * 바디의 `displayName`은 트림된 이름과 정확히 일치한다. `content-type` 헤더는
 * 항상 포함하며, `token`이 비어 있지 않으면 `x-playtest-token` 헤더에 값을
 * 그대로 담는다. 토큰이 비어 있으면 해당 헤더를 아예 포함하지 않는다.
 * (요구사항 1.4, 2.2, 9.1, 9.2)
 *
 * @param {string} trimmedName 트림된 표시 이름
 * @param {string} token ?token= 값(없으면 빈 문자열)
 * @returns {{ url: string, method: string, headers: Record<string, string>, body: string }}
 */
export function buildCreateRoomRequest(trimmedName, token) {
  /** @type {Record<string, string>} */
  const headers = { "content-type": "application/json" };
  // 토큰이 비어 있지 않을 때만 인증 헤더를 추가한다(없으면 키 자체가 존재하지 않음).
  if (typeof token === "string" && token.length > 0) {
    headers["x-playtest-token"] = token;
  }
  return {
    url: "/rooms",
    method: "POST",
    headers,
    body: JSON.stringify({ displayName: trimmedName }),
  };
}

// ---------------------------------------------------------------------------
// 응답·결과 분류 (Response / Outcome Classification) — 작업 2.4
// ---------------------------------------------------------------------------

/**
 * HTTP 응답을 분류한다.
 *
 * - 상태가 정확히 200/201이거나 `ok === true`인 2xx면 "success"
 * - 상태가 정확히 400이면 "validation"
 * - 상태가 500 이상이면 "server"
 * - 그 외 비-2xx는 "unknown"
 * (요구사항 7.1, 8.2)
 *
 * @param {{ ok: boolean, status: number }} response
 * @returns {"success" | "validation" | "server" | "unknown"}
 */
export function classifyResponse(response) {
  const ok = !!(response && response.ok);
  const status = response ? response.status : 0;
  // 2xx 성공: 200/201을 우선 인정하고, ok 플래그가 참인 임의 2xx도 성공으로 본다.
  if (status === 200 || status === 201 || (ok && status >= 200 && status <= 299)) {
    return "success";
  }
  if (status === 400) return "validation";
  if (status >= 500) return "server";
  return "unknown";
}

/**
 * 요청 결과(응답/네트워크오류/타임아웃)를 단일 결과 타입으로 환원한다.
 *
 * 시그니처: `classifyOutcome({ kind, response? })`
 * - `kind: "response"` → `response`를 `classifyResponse`로 분류한다.
 *     - "success"    → "success"
 *     - "validation" → "validation"
 *     - "server"     → "server"
 *     - "unknown"    → "server" (보수적 처리, design Error Handling 표)
 * - `kind: "network"` → "network"
 * - `kind: "timeout"` → "timeout"
 * (요구사항 7.1, 8.1, 8.2, 3.5)
 *
 * @param {{ kind: "response" | "network" | "timeout", response?: { ok: boolean, status: number } }} outcome
 * @returns {ErrorKind | "success"}
 */
export function classifyOutcome(outcome) {
  const kind = outcome ? outcome.kind : undefined;
  if (kind === "network") return "network";
  if (kind === "timeout") return "timeout";
  if (kind === "response") {
    const classified = classifyResponse(outcome.response || { ok: false, status: 0 });
    if (classified === "success") return "success";
    if (classified === "validation") return "validation";
    // server 및 unknown(기타 비-2xx)은 모두 server로 보수적으로 환원한다.
    return "server";
  }
  // 알 수 없는 결과 종류도 보수적으로 server 오류로 환원한다.
  return "server";
}

// ---------------------------------------------------------------------------
// 진입 가능 여부 · 인계 (Enter / Handoff) — 작업 2.6
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
 * 방 진입 가능 여부를 판단한다.
 *
 * `success`가 null이 아니고 `roomId`·`hostPlayerId`가 모두 비어 있지 않은
 * 문자열일 때에만 true. (요구사항 6.1, 6.3)
 *
 * @param {CreateRoomSuccess | null} success
 * @returns {boolean}
 */
export function canEnterRoom(success) {
  if (!success) return false;
  return isNonEmptyString(success.roomId) && isNonEmptyString(success.hostPlayerId);
}

/**
 * 로비 인계 페이로드를 구성한다.
 *
 * `success`의 `roomId`·`hostPlayerId`를 담고, `token`이 비어 있지 않으면
 * `token`도 함께 포함한다. 서버가 발급한 연결 티켓(`success.connectionToken`)이
 * 비어 있지 않으면 `ticket`으로 함께 실어 로비→캐릭터/게임 화면까지 흐르게 한다
 * (auth-hardening). (요구사항 6.2, 6.3, 9.3)
 *
 * @param {CreateRoomSuccess | null} success
 * @param {string} token
 * @returns {{ roomId: string, hostPlayerId: string, token?: string, ticket?: string }}
 */
export function buildHandoff(success, token) {
  /** @type {{ roomId: string, hostPlayerId: string, token?: string, ticket?: string }} */
  const handoff = {
    roomId: success ? success.roomId : "",
    hostPlayerId: success ? success.hostPlayerId : "",
  };
  if (isNonEmptyString(token)) {
    handoff.token = token;
  }
  // 서버 발급 연결 티켓이 있으면 ticket으로 인계한다(없으면 키 자체를 생략).
  if (success && isNonEmptyString(success.connectionToken)) {
    handoff.ticket = success.connectionToken;
  }
  return handoff;
}

// ---------------------------------------------------------------------------
// 상태 리듀서 (Reducer) — 작업 3.1
// ---------------------------------------------------------------------------

/**
 * 단방향 상태 전이 리듀서. 입력 상태를 변형하지 않고 항상 새 객체를 반환한다.
 * 알 수 없는 액션 타입은 상태를 그대로 반환한다.
 *
 * 처리 액션:
 * - INPUT_CHANGED: 입력값 갱신, 검증/검증오류 메시지 제거 (요구사항 7.3, 2.2)
 * - SUBMIT: 검증 후 submitting 전이 또는 검증 안내 (요구사항 1.3/2.3/2.4/3.2/8.4/10.5)
 * - REQUEST_SUCCEEDED: success 단계, 페이로드 저장 (요구사항 2.5)
 * - REQUEST_FAILED: error 단계, 입력·토큰 보존 (요구사항 2.6/3.4/4.4/7.2/8.x)
 * - COPY_SUCCEEDED: copyConfirmedUntil 설정 (요구사항 5.3)
 * - COPY_FAILED: 복사 실패 표시 (요구사항 5.4)
 * - ENTER_ROOM: 1회 인계 표시 (요구사항 6.2/6.4)
 *
 * @param {HostEntryState} state
 * @param {{ type: string, [key: string]: unknown }} action
 * @returns {HostEntryState}
 */
export function reduce(state, action) {
  const type = action ? action.type : undefined;

  switch (type) {
    case "INPUT_CHANGED": {
      // 입력값을 갱신하고, 검증 안내가 떠 있으면 제거한다. 활성 오류가
      // validation이면 오류 종류·메시지도 함께 제거한다(요구사항 7.3).
      const clearValidationError = state.errorKind === ErrorKind.VALIDATION;
      return {
        ...state,
        displayNameInput: /** @type {string} */ (action.value),
        validationMessage: null,
        errorKind: clearValidationError ? null : state.errorKind,
        errorMessage: clearValidationError ? null : state.errorMessage,
      };
    }

    case "SUBMIT": {
      // 이미 처리 중이면 멱등하게 무변화(중복 요청 방지, 요구사항 3.2/8.4).
      if (state.phase === Phase.SUBMITTING) {
        return state;
      }
      const { valid } = validateDisplayName(state.displayNameInput);
      if (!valid) {
        // 무효: phase 불변, 요청 미발송, 입력 인접 안내만 설정(요구사항 1.3/2.3/10.5).
        return {
          ...state,
          validationMessage: VALIDATION_MESSAGE,
        };
      }
      // 유효: submitting으로 전이하고 검증·오류 필드를 모두 클리어(요구사항 2.4/3.2).
      return {
        ...state,
        phase: Phase.SUBMITTING,
        validationMessage: null,
        errorKind: null,
        errorMessage: null,
      };
    }

    case "REQUEST_SUCCEEDED": {
      // 성공 페이로드 전체를 보존하고 success 단계로 전이(요구사항 2.5).
      return {
        ...state,
        phase: Phase.SUCCESS,
        success: /** @type {CreateRoomSuccess} */ (action.payload),
        validationMessage: null,
        errorKind: null,
        errorMessage: null,
      };
    }

    case "REQUEST_FAILED": {
      // 회복 가능한 error 단계로 전이. 입력·토큰을 보존하고 success/패널은 두지 않는다
      // (요구사항 2.6/3.4/4.4/7.2/8.1/8.2/8.3). 오류 종류에 맞는 한국어 메시지를 매핑.
      const kind = /** @type {ErrorKind} */ (action.kind);
      return {
        ...state,
        phase: Phase.ERROR,
        errorKind: kind,
        errorMessage: ERROR_MESSAGES[kind] || ERROR_MESSAGES.server,
        success: null,
        // displayNameInput, token은 스프레드로 그대로 보존된다.
      };
    }

    case "COPY_SUCCEEDED": {
      // 복사 확인 메시지를 최소 3초간 표시하기 위한 만료 시각 설정(요구사항 5.3).
      const now = /** @type {number} */ (action.now);
      return {
        ...state,
        copyConfirmedUntil: now + COPY_CONFIRM_MS,
        copyFailed: false,
      };
    }

    case "COPY_FAILED": {
      // 복사 실패 표시 상태. UI가 수동 복사 폴백을 노출하도록 플래그를 세운다(요구사항 5.4).
      return {
        ...state,
        copyFailed: true,
        copyConfirmedUntil: null,
      };
    }

    case "ENTER_ROOM": {
      // 아직 인계하지 않았고 진입 가능할 때만 1회 인계 표시(요구사항 6.2/6.4).
      if (state.handoffDone === false && canEnterRoom(state.success)) {
        return { ...state, handoffDone: true };
      }
      return state;
    }

    default:
      // 알 수 없는 액션은 상태를 그대로 반환한다.
      return state;
  }
}

// ---------------------------------------------------------------------------
// 뷰 모델 (View Model) — 작업 4.1
// ---------------------------------------------------------------------------

/**
 * 상태로부터 가시성을 도출한다. 모든 가시성은 phase의 함수다.
 *
 * - indicator: phase === "submitting"일 때만 true (요구사항 3.1)
 * - panel: phase === "success"일 때만 true (요구사항 4.3)
 * - submitDisabled: phase가 "submitting" 또는 "success"이면 true, 그 외 false
 *   (요구사항 1.2, 3.3, 4.3)
 *
 * @param {HostEntryState} state
 * @returns {{ indicator: boolean, panel: boolean, submitDisabled: boolean }}
 */
export function computeVisibility(state) {
  const phase = state ? state.phase : Phase.IDLE;
  return {
    indicator: phase === Phase.SUBMITTING,
    panel: phase === Phase.SUCCESS,
    submitDisabled: phase === Phase.SUBMITTING || phase === Phase.SUCCESS,
  };
}

// ---------------------------------------------------------------------------
// Invite_Panel 렌더 (Markup) — 작업 4.3
// ---------------------------------------------------------------------------

/**
 * HTML 특수문자를 이스케이프한다. public/index.html의 esc() 패턴을 따른다.
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
 * Invite_Panel 마크업 문자열을 렌더한다.
 *
 * 보간 값은 마크업이 깨지지 않도록 이스케이프하지만, `inviteLink` 전체 문자열과
 * `maxPlayers` 값은 출력에 그대로(이스케이프된 형태로) 포함된다(요구사항 4.1, 4.2).
 *
 * @param {CreateRoomSuccess} success
 * @returns {string}
 */
export function renderInvitePanel(success) {
  const inviteLink = success ? success.inviteLink : "";
  const maxPlayers = success ? success.maxPlayers : "";
  return [
    '<div class="invite-panel">',
    `  <p class="invite-link">초대 링크: <span class="link-text">${esc(inviteLink)}</span></p>`,
    `  <p class="max-players">최대 인원: ${esc(maxPlayers)}명</p>`,
    "</div>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 클립보드 복사 어댑터 (Clipboard) — 작업 5.1
// ---------------------------------------------------------------------------

/**
 * 초대 링크를 주입받은 클립보드 어댑터로 복사한다.
 *
 * `inviteLink` 전체 문자열을 `clipboard.writeText`로 기록하고, 성공 시 true,
 * 실패(거부/예외/어댑터 없음)시 false를 반환한다. 어댑터가 동기·비동기 어느 쪽이든
 * `await`로 안전하게 처리하며, 던지거나 reject 해도 false로 환원한다(요구사항 5.2, 5.4).
 *
 * @param {string} inviteLink
 * @param {{ writeText?: (text: string) => unknown } | null | undefined} clipboard 주입 가능한 클립보드 어댑터
 * @returns {Promise<boolean>}
 */
export async function copyInviteLink(inviteLink, clipboard) {
  // 어댑터나 writeText가 없으면 복사 불가로 간주한다.
  if (!clipboard || typeof clipboard.writeText !== "function") {
    return false;
  }
  try {
    await clipboard.writeText(inviteLink);
    return true;
  } catch {
    // 거부·예외는 실패로 환원해 UI가 수동 복사 폴백을 노출하도록 한다.
    return false;
  }
}
