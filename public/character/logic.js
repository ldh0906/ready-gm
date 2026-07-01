// @ts-check
/**
 * Character_Sheet_App 순수 로직 모듈 (시나리오 적응형 캐릭터 시트 작성 화면)
 *
 * 이 모듈은 DOM·네트워크·타이머·네비게이션에 의존하지 않는 순수 함수들만 모은다.
 * 인계 파싱·검증, 토큰 헤더 구성, REST 요청 명세 구성, 스키마 검증·채택(Active_Sheet_Schema 결정),
 * 렌더 모델 도출, 사다리 검증·초기값·등급 레이블, 서사 입력 보존·길이 제한·이스케이프,
 * 응답/오류·저장/확정 결과 분류, 상태 전이(reduce), 뷰 모델 도출, Next_Screen 인계 페이로드 구성을
 * 담당하며 vitest(node 환경)에서 직접 import 하여 단위/속성 테스트한다.
 *
 * 부수효과(fetch, AbortController 10초 타임아웃, 진행 인디케이터 200ms 타이밍, 확정 2단계 순차 전송,
 * Next_Screen 네비게이션, DOM 갱신)는 index.html의 스크립트(부수효과 계층)가 담당하고,
 * 본 모듈이 만든 결정·명세를 실행만 한다.
 *
 * 설계 문서: .kiro/specs/character-sheet/design.md
 *
 * 본 파일은 작업 1.1 스캐폴드다. 상수·타입 주석·초기 상태 팩토리는 채워져 있고,
 * 이후 작업(2~6)에서 채울 순수 함수는 `NOT_IMPLEMENTED`를 던지는 export 스텁으로 선언되어 있다.
 * 스텁은 호출되기 전까지 던지지 않으므로 모듈은 부작용 없이 import 가능하다.
 */

// ---------------------------------------------------------------------------
// 상태 모델 상수 (State Model Constants)
// ---------------------------------------------------------------------------

/**
 * 각 요청 영역(스키마/제안/기록/확정)의 로딩 단계.
 * @typedef {"idle" | "loading" | "loaded" | "error"} AreaPhase
 * - idle: 아직 요청 전(인계 무효 시 포함)
 * - loading: 요청 전송~응답 도착 전. 진행 인디케이터 표시, 동작 비활성 (요구사항 9.1, 9.3)
 * - loaded: 성공
 * - error: 복구 가능 오류. 재시도 동작 제공 (요구사항 10.4)
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
 * @typedef {"server" | "network" | "timeout" | "auth" | "invalid"} ErrorKind
 * - server: HTTP 5xx (요구사항 10.3)
 * - network: 네트워크 실패 (요구사항 10.2)
 * - timeout: 클라이언트 타임아웃 10초 (요구사항 9.5, 10.1)
 * - auth: 토큰 인증 거부 401/403 (요구사항 11.5)
 * - invalid: 응답 본문 형식 위반(제안 검증 실패 등) (요구사항 4.5)
 */

/** 오류 종류 상수. @type {Readonly<Record<string, ErrorKind>>} */
export const ErrorKind = Object.freeze({
  SERVER: "server",
  NETWORK: "network",
  TIMEOUT: "timeout",
  AUTH: "auth",
  INVALID: "invalid",
});

/**
 * Record_Character_Endpoint 거부 사유. CharacterService 결과 코드를 따른다.
 * @typedef {"NAME_TAKEN" | "INVALID_ATTRIBUTES" | "INVALID_ALLOCATION" | "INVALID_CARD" | "CARD_TAKEN" | "ALREADY_CONFIRMED" | "UNKNOWN_PLAYER" | "OTHER"} RecordRejection
 * - NAME_TAKEN: 방 안에서 이름 중복 (요구사항 6.4)
 * - INVALID_ATTRIBUTES: 평가 항목이 사다리 밖 (요구사항 6.5)
 * - INVALID_ALLOCATION: 사다리 경계는 만족하지만 배분 규칙(총합·고정값 다중집합 등)을 위반함
 *   (flexible-stat-allocation 요구사항 8.3 — 신규 거부 사유, 작업 1.2 스캐폴드)
 * - INVALID_CARD: Card_Based_Sheet에서 카드 미선택 또는 Character_Card_List에 없는 Card_Id
 *   (scenario-character-cards 요구사항 6.2 — 신규 거부 사유, 작업 1.2 스캐폴드)
 * - CARD_TAKEN: 확정 시 선택한 역할 카드를 다른 플레이어가 이미 확정해 점유함
 *   (scenario-character-cards — 신규 거부 사유, 카드 다시 고르기 유도)
 * - ALREADY_CONFIRMED: 이미 확정됨 (요구사항 6.6)
 * - UNKNOWN_PLAYER: 플레이어 정보 확인 불가 (요구사항 6.7)
 * - OTHER: 열거되지 않은 기타 거부 사유 (요구사항 6.8)
 */

/** 거부 사유 상수. @type {Readonly<Record<string, RecordRejection>>} */
export const RecordRejection = Object.freeze({
  NAME_TAKEN: "NAME_TAKEN",
  INVALID_ATTRIBUTES: "INVALID_ATTRIBUTES",
  // 신규 거부 사유(flexible-stat-allocation): 사다리 경계는 통과했으나 배분 제약 위반. (요구사항 8.3)
  INVALID_ALLOCATION: "INVALID_ALLOCATION",
  // 신규 거부 사유(scenario-character-cards): Card_Based_Sheet에서 카드 미선택 또는 목록에 없는 Card_Id. (요구사항 6.2)
  INVALID_CARD: "INVALID_CARD",
  // 신규 거부 사유(scenario-character-cards): 확정 시 선택한 역할 카드를 다른 플레이어가 이미 점유함.
  CARD_TAKEN: "CARD_TAKEN",
  ALREADY_CONFIRMED: "ALREADY_CONFIRMED",
  UNKNOWN_PLAYER: "UNKNOWN_PLAYER",
  OTHER: "OTHER",
});

/**
 * 직전에 전송해 실패한 요청 종류(동일 입력 재시도용, 요구사항 10.6).
 * @typedef {"schema" | "proposal" | "record" | "confirm" | null} LastRequest
 */

/** 요청 종류 상수. @type {Readonly<Record<string, Exclude<LastRequest, null>>>} */
export const LastRequest = Object.freeze({
  SCHEMA: "schema",
  PROPOSAL: "proposal",
  RECORD: "record",
  CONFIRM: "confirm",
});

// ---------------------------------------------------------------------------
// 타임아웃·사다리·길이 상수 (Timeout / Ladder / Length Constants)
// ---------------------------------------------------------------------------

/** REST 요청 클라이언트 타임아웃(ms). host-entry·room-lobby와 동일한 10초. (요구사항 9.5, 10.1) */
export const REQUEST_TIMEOUT_MS = 10000;

/**
 * 기본 EZFudge 능력치 사다리(Attribute_Ladder). 정수 포함 구간 `[-2, +4]`.
 * Default_Sheet_Schema의 Trait_Ladder이자 Trait_Ladder 미지정 시 기본값. (요구사항 13.8, 13.5)
 * @type {Readonly<{ min: number, max: number }>}
 */
export const DEFAULT_ATTRIBUTE_LADDER = Object.freeze({ min: -2, max: 4 });

/**
 * 기본 Attribute_Ladder의 Ladder_Rung_Label 고정 매핑. (요구사항 2.5)
 * -2=끔찍함, -1=빈약함, 0=평범함, +1=양호함, +2=우수함, +3=훌륭함, +4=탁월함.
 * @type {Readonly<Record<string, string>>}
 */
export const DEFAULT_RUNG_LABELS = Object.freeze({
  "-2": "끔찍함",
  "-1": "빈약함",
  "0": "평범함",
  "1": "양호함",
  "2": "우수함",
  "3": "훌륭함",
  "4": "탁월함",
});

/** Character_Name 보존 값의 최대 길이(자). (요구사항 3.5) */
export const NAME_MAX_LENGTH = 100;

/** Character_Name 외 Narrative_Field 보존 값의 최대 길이(자). (요구사항 3.6) */
export const NARRATIVE_MAX_LENGTH = 2000;

// ---------------------------------------------------------------------------
// 사용자 메시지 상수 (한국어 메시지)
// ---------------------------------------------------------------------------

/** 인계 정보(roomId/playerId)가 무효일 때의 안내. (요구사항 1.3) */
export const HANDOFF_INVALID_MESSAGE =
  "캐릭터 작성 정보가 올바르지 않습니다. 방 링크를 다시 확인하거나 호스트에게 새 링크를 요청해 주세요.";

/** 컨셉이 비어 있는 상태에서 Propose_Action을 시도했을 때의 안내. (요구사항 4.2) */
export const BLANK_CONCEPT_MESSAGE = "AI 제안을 받으려면 먼저 캐릭터 컨셉을 입력해 주세요.";

/** 이름이 비어 있는 상태에서 Save_Action 또는 Confirm_Action을 시도했을 때의 안내. (요구사항 6.2, 7.6) */
export const BLANK_NAME_MESSAGE = "캐릭터 이름을 공백을 제외하고 최소 1자 이상 입력해 주세요.";

/** 캐릭터 기록(저장) 성공 확인 안내. (요구사항 6.3) */
export const SAVE_CONFIRMED_MESSAGE = "캐릭터가 저장되었습니다. 계속 편집할 수 있습니다.";

/** 캐릭터 확정(잠금) 성공 안내. (요구사항 7.7) */
export const CONFIRMED_MESSAGE = "캐릭터가 확정되었습니다. 다음 단계로 진행할 수 있습니다.";

/**
 * Record_Character_Endpoint 거부 사유별 한국어 메시지. (요구사항 6.4~6.8)
 * @type {Readonly<Record<RecordRejection, string>>}
 */
export const RECORD_REJECTION_MESSAGES = Object.freeze({
  NAME_TAKEN: "그 이름은 이미 방 안에서 사용 중입니다. 다른 이름을 입력해 주세요.",
  INVALID_ATTRIBUTES: "평가 항목 값이 사다리 범위를 벗어났습니다. 값을 다시 확인해 주세요.",
  // 배분 규칙(총합 강제·고정값 다중집합 등) 미충족 안내. (flexible-stat-allocation 요구사항 8.7, 9.1, 9.2)
  INVALID_ALLOCATION:
    "능력치 배분 규칙을 충족하지 못했습니다. 배분 점수 총합 또는 고정값 일대일 배정을 다시 확인해 주세요.",
  // 카드 미선택·목록에 없는 Card_Id 안내. CARD_REQUIRED_MESSAGE와 동일 문구를 공유한다. (요구사항 5.1, 6.2, 6.4)
  INVALID_CARD: "역할 카드를 먼저 선택해 주세요.",
  // 선택한 역할 카드를 다른 플레이어가 이미 확정해 점유함 → 다른 카드를 고르도록 유도한다.
  CARD_TAKEN: "이미 다른 플레이어가 선택한 역할 카드입니다. 다른 카드를 골라 주세요.",
  ALREADY_CONFIRMED: "캐릭터가 이미 확정되어 더 이상 수정할 수 없습니다.",
  UNKNOWN_PLAYER: "플레이어 정보를 확인할 수 없어 저장에 실패했습니다.",
  OTHER: "캐릭터 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.",
});

/** Confirm_Character_Endpoint가 NO_CHARACTER로 거부했을 때의 안내. (요구사항 7.5) */
export const NO_CHARACTER_MESSAGE =
  "확정할 캐릭터가 없습니다. 먼저 캐릭터를 저장한 뒤 다시 시도해 주세요.";

/** AI 제안 응답이 형식 위반(검증 실패)일 때의 안내. (요구사항 4.5) */
export const PROPOSAL_INVALID_MESSAGE =
  "AI 평가 항목 제안을 받지 못했습니다. 기존 값을 유지합니다. 잠시 후 다시 시도해 주세요.";

/**
 * 전송 오류 종류별 한국어 사용자 메시지. 타임아웃·네트워크·서버·인증 거부는 서로 구분된다.
 * (요구사항 9.5, 10.1, 10.2, 10.3, 11.5)
 * @type {Readonly<Record<ErrorKind, string>>}
 */
export const ERROR_MESSAGES = Object.freeze({
  timeout: "요청이 시간 초과되었습니다. 잠시 후 다시 시도해 주세요.",
  network: "네트워크 연결 문제로 요청이 실패했습니다. 연결을 확인하고 다시 시도해 주세요.",
  server: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  auth: "공유 접근 토큰이 유효하지 않아 요청이 거부되었습니다. 토큰을 확인해 주세요.",
  invalid: "응답 형식이 올바르지 않아 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
});

/** 시나리오 맞춤 시트를 불러오지 못해 기본 시트로 폴백했을 때의 안내. (요구사항 13.6) */
export const SCHEMA_FALLBACK_MESSAGE =
  "시나리오 맞춤 시트를 불러오지 못해 기본 시트를 사용합니다. 계속 작성할 수 있습니다.";

/**
 * 호스트가 "세션 시작"을 눌렀으나 서버가 세션을 시작하지 못했을 때(예: 동시 세션 용량 초과)의
 * 안내. 이 경우 호스트는 로비 화면으로 되돌아가 잠시 후 다시 시도한다. (멀티플레이어 흐름)
 */
export const SESSION_START_FAILED_MESSAGE =
  "세션을 시작하지 못했습니다. 잠시 후 로비에서 다시 시도해 주세요.";

// ---------------------------------------------------------------------------
// 카드 기반 작성(scenario-character-cards) 신규 한국어 메시지 상수 — 작업 1.2 스캐폴드
// ---------------------------------------------------------------------------
// 이후 작업(8.x reduce의 INVALID_CARD 분기·사전 게이트, 9.x 부수효과 배선)에서 사용한다.
// 본 작업(1.2)에서는 상수만 선언한다.

/**
 * Card_Based_Sheet에서 역할 카드를 고르지 않고 Save_Action·Confirm_Action을 시도했을 때의
 * 프론트엔드 사전 검증 안내. 백엔드 INVALID_CARD 응답 메시지(RECORD_REJECTION_MESSAGES.INVALID_CARD)와
 * 동일 문구를 공유해 사용자가 "역할 카드를 먼저 선택" 동일 안내를 받게 한다. (요구사항 5.1, 6.4)
 */
export const CARD_REQUIRED_MESSAGE = "역할 카드를 먼저 선택해 주세요.";

// ---------------------------------------------------------------------------
// 배분 규칙(flexible-stat-allocation) 신규 한국어 메시지 상수 — 작업 1.2 스캐폴드
// ---------------------------------------------------------------------------
// 이후 작업(7.x DICE_ROLL 굴림, 3.x 규칙 검증·폴백, 10.x 거부 사유 매핑)에서 부수효과 계층과
// reduce가 사용한다. 본 작업(1.2)에서는 상수만 선언한다.

/**
 * 시트 스키마에 실린 배분 규칙(Allocation_Rule)이 무효라 LADDER_SELECT 기본 규칙으로
 * 폴백했을 때의 안내. (flexible-stat-allocation 요구사항 7.4)
 */
export const ALLOCATION_RULE_FALLBACK_MESSAGE =
  "시나리오의 능력치 배분 규칙을 불러오지 못해 기본 배분 방식으로 작성을 이어갑니다.";

/**
 * DICE_ROLL 굴림 요청이 타임아웃·네트워크·서버 오류로 종료됐을 때의 안내. 기존 Trait_Level을
 * 변경 없이 유지하며 무작위는 클라이언트에서 생성하지 않는다. (flexible-stat-allocation 요구사항 5.7)
 */
export const ROLL_FAILED_MESSAGE =
  "주사위 굴림에 실패했습니다. 기존 능력치 값을 유지합니다. 잠시 후 다시 시도해 주세요.";

/**
 * DICE_ROLL 굴림이 성공 응답을 반환했으나 응답 본문이 일부 Rated_Trait의 정수 Trait_Level을
 * 담지 못했을 때(누락·비정수)의 안내. 응답을 적용하지 않고 기존 값을 유지한다.
 * (flexible-stat-allocation 요구사항 5.8)
 */
export const ROLL_INVALID_RESPONSE_MESSAGE =
  "주사위 굴림 결과를 받지 못했습니다. 기존 능력치 값을 유지합니다. 잠시 후 다시 시도해 주세요.";

// ---------------------------------------------------------------------------
// 준비 현황 · 호스트 세션 시작 메시지 상수 (Readiness / Host-Start Constants)
// ---------------------------------------------------------------------------
// 이 영역은 기존 상태 기계(reduce/computeVisibility)와 독립적으로 index.html의 부수효과
// 계층이 폴링·렌더에 사용하는 ADDITIVE 관심사다. 아래 순수 헬퍼는 DOM·네트워크·타이머에
// 의존하지 않으며, 기존 build* 헬퍼(buildAuthHeaders 등)를 재사용한다.

/** 비호스트 플레이어가 호스트의 세션 시작을 기다릴 때 표시하는 안내. */
export const WAITING_FOR_HOST_MESSAGE = "호스트가 세션을 시작하기를 기다리고 있어요…";

/** 모든 플레이어가 확정되지 않아 세션을 시작할 수 없을 때의 안내. */
export const NOT_ALL_CONFIRMED_MESSAGE =
  "아직 모든 플레이어가 캐릭터를 확정하지 않았어요. 모두 확정되면 세션을 시작할 수 있어요.";

/** 세션 시작 요청이 실패했을 때의 일반 안내. */
export const START_FAILED_MESSAGE =
  "세션 시작에 실패했습니다. 잠시 후 다시 시도해 주세요.";

// ---------------------------------------------------------------------------
// 타입 주석 (JSDoc Typedefs)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Handoff
 * @property {string} roomId
 * @property {string} playerId
 * @property {string} token  공유 비밀(없으면 빈 문자열)
 * @property {string} ticket  서버 발급 연결 티켓(없으면 빈 문자열). player-acting REST 요청의 x-connection-ticket 헤더로 보낸다(auth-hardening).
 */

/**
 * @typedef {Object} TraitLadder
 * @property {number} min  포함 하한(정수)
 * @property {number} max  포함 상한(정수)
 */

/**
 * @typedef {Object} SheetSection
 * @property {string} id     섹션 식별자 (요구사항 13.4 집합 일치 기준)
 * @property {string} label  표시 레이블(비어 있지 않음)
 */

/**
 * @typedef {Object} NarrativeField
 * @property {string} id         식별자("name", "concept" 또는 시나리오별 키) (요구사항 13.4)
 * @property {string} label      표시 레이블
 * @property {string} guidance   목적 안내 텍스트 (요구사항 2.1)
 * @property {string} sectionId  소속 섹션
 * @property {number} maxLength  name=100, 그 외=2000 (요구사항 3.5, 3.6)
 */

/**
 * @typedef {Object} RatedTrait
 * @property {string} key                          Trait_Key (요구사항 13.4)
 * @property {string} label                        표시 레이블 (요구사항 2.2)
 * @property {string} sectionId                    소속 섹션
 * @property {TraitLadder} ladder                  Trait_Ladder, 미지정 시 [-2,4]로 정규화 (요구사항 13.5)
 * @property {Record<string, string>=} rungLabels  비기본 사다리의 등급 레이블 (요구사항 2.5)
 */

/**
 * 한 Card_Based_Sheet가 싣는, 선택 가능한 미리 정의된 역할 카드(Character_Card).
 * (scenario-character-cards 요구사항 3.1) — 작업 1.2 스캐폴드.
 * @typedef {Object} CharacterCard
 * @property {string} id                  Card_Id: 트림 후 1자 이상, 한 목록 내 고유 (요구사항 3.1, 3.2)
 * @property {string} roleLabel           Card_Role_Label: 트림 후 1자 이상 표시 이름 (요구사항 3.1)
 * @property {string} premise             Card_Premise: 역할 전제·설명 텍스트 (요구사항 3.1)
 * @property {string=} backstoryGuidance  Card_Backstory_Guidance: 선택적 배경 작성 안내
 */

/**
 * 카드 선택 검증 결과(Frontend_Card_Validator 산출). 유효이거나, 카드 미선택·목록에 없는
 * Card_Id이면 INVALID_CARD 사유로 무효. (scenario-character-cards 요구사항 6.2) — 작업 1.2 스캐폴드.
 * @typedef {{ ok: true } | { ok: false, reason: "INVALID_CARD" }} CardSelectionValidation
 */

/**
 * Active_Sheet_Schema는 채택된 유효 Scenario_Sheet_Schema 또는 Default_Sheet_Schema 중 하나다.
 * 두 경우 동일 형태를 갖는다. (요구사항 13.7)
 * @typedef {Object} SheetSchema
 * @property {SheetSection[]} sections           시트 구획 (요구사항 13.3)
 * @property {NarrativeField[]} narrativeFields  이름·컨셉을 항상 포함 (요구사항 13.8)
 * @property {RatedTrait[]} traits               0개 이상(서사 전용 시트는 빈 배열) (요구사항 13.2)
 * @property {AllocationRule=} allocation        정확히 하나의 배분 규칙(flexible-stat-allocation 요구사항 1.1·7). 누락 시 LADDER_SELECT로 정규화.
 * @property {boolean=} attributeProposalSupported  능력치 제안 지원 여부(scenario-character-cards 요구사항 1.1·7.4). 누락 시 traits.length > 0으로 도출.
 * @property {CharacterCard[]=} characterCards   1개 이상이면 Card_Based_Sheet, 없음/빈 배열이면 아님 (scenario-character-cards 요구사항 3.4)
 */

/**
 * 화면 전체 상태. 모든 렌더링은 이 상태의 함수다.
 * @typedef {Object} CharacterSheetState
 * @property {Handoff} handoff                       인계(불변, 어떤 오류로도 변하지 않음, 요구사항 10.5)
 * @property {boolean} handoffValid
 * @property {AreaPhase} schemaArea                  스키마 요청 진행/오류 추적 (요구사항 13.9)
 * @property {ErrorKind | null} schemaErrorKind
 * @property {SheetSchema} activeSchema              항상 정확히 하나 존재 (요구사항 13.7)
 * @property {boolean} usingDefaultSchema            폴백 안내 표시용 (요구사항 13.6)
 * @property {Record<string, string>} narrativeValues  fieldId → 보존된 값(앞뒤 공백 포함)
 * @property {Record<string, number>} traitValues      traitKey → Trait_Level
 * @property {AreaPhase} proposal                    (요구사항 9.x)
 * @property {AreaPhase} record                      (요구사항 9.x)
 * @property {AreaPhase} confirm                     (요구사항 9.x)
 * @property {ErrorKind | null} errorKind            마지막 전송 오류 종류(재시도 메시지 결정)
 * @property {string | null} notice                  안내/확인/거부 메시지
 * @property {LastRequest} lastRequest               재시도 대상 (요구사항 10.6)
 * @property {boolean} confirmed                     Confirmed_State (요구사항 7.7, 7.8)
 * @property {boolean} nextHandoffDone               Next_Screen 인계 1회 보장 (요구사항 8.3)
 * @property {string | null} selectedCardId          Selected_Card의 Card_Id, 미선택이면 null (scenario-character-cards 요구사항 4.3) — 작업 1.2 스캐폴드
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
 * 임의 값을 안전한 문자열로 변환한다(null/undefined → "").
 * @param {unknown} value
 * @returns {string}
 */
function toStringSafe(value) {
  return String(value == null ? "" : value);
}

/**
 * 값의 앞뒤 공백만 제거하고 내부 공백은 보존하는 모듈 내부 헬퍼.
 *
 * REST 요청 빌더(작업 2.2)와 export `trimForSend`(작업 4.1)가 공유하는 단일 트림 규칙이다.
 * 빌더가 작업 4.1에서 구현될 export `trimForSend` 스텁에 의존하지 않도록 분리했다. 작업 4.1의
 * `trimForSend`는 이 헬퍼에 위임하면 된다. 문자열이 아니면 안전하게 빈 문자열로 정규화한 뒤 트림한다.
 * (요구사항 3.3)
 * @param {unknown} value
 * @returns {string}
 */
function trimEnds(value) {
  return toStringSafe(value).trim();
}

/**
 * 인계 유효성을 내부적으로 판정한다(트림된 roomId·playerId가 모두 비어 있지 않음).
 * createInitialState가 작업 2.1의 export 스텁에 의존하지 않도록 분리한 헬퍼다.
 * 작업 2.1에서 export `isHandoffValid`가 동일 규칙으로 구현된다.
 * @param {Handoff} handoff
 * @returns {boolean}
 */
function computeHandoffValid(handoff) {
  if (!handoff) return false;
  return (
    toStringSafe(handoff.roomId).trim().length >= 1 &&
    toStringSafe(handoff.playerId).trim().length >= 1
  );
}

/**
 * Default_Sheet_Schema를 구성한다.
 *
 * 네 Attribute_Key(Might·Agility·Wits·Spirit)를 기본 Attribute_Ladder `[-2, +4]`의
 * Rated_Trait로, Character_Name(maxLength 100)·Character_Concept(maxLength 2000)을
 * Narrative_Field로, `narrative`·`attributes` 두 Sheet_Section을 갖는다.
 * (요구사항 13.8) — createInitialState의 activeSchema 초기값으로 쓰인다.
 *
 * 주: 내부 빌더다. export `defaultSheetSchema`는 작업 3.1에서 구현된다.
 * @returns {SheetSchema}
 */
function buildDefaultSheetSchema() {
  /** @type {TraitLadder} */
  const ladder = { min: DEFAULT_ATTRIBUTE_LADDER.min, max: DEFAULT_ATTRIBUTE_LADDER.max };
  /** @type {RatedTrait[]} */
  const traits = [
    { key: "Might", label: "힘(Might)", sectionId: "attributes", ladder: { ...ladder } },
    { key: "Agility", label: "민첩(Agility)", sectionId: "attributes", ladder: { ...ladder } },
    { key: "Wits", label: "지력(Wits)", sectionId: "attributes", ladder: { ...ladder } },
    { key: "Spirit", label: "의지(Spirit)", sectionId: "attributes", ladder: { ...ladder } },
  ];
  return {
    sections: [
      { id: "narrative", label: "서사" },
      { id: "attributes", label: "능력치" },
    ],
    narrativeFields: [
      {
        id: "name",
        label: "이름",
        guidance: "캐릭터의 이름을 입력해 주세요.",
        sectionId: "narrative",
        maxLength: NAME_MAX_LENGTH,
      },
      {
        id: "concept",
        label: "컨셉",
        guidance: "캐릭터의 컨셉을 한두 문장으로 설명해 주세요. AI 평가 항목 제안의 입력이 됩니다.",
        sectionId: "narrative",
        maxLength: NARRATIVE_MAX_LENGTH,
      },
    ],
    traits,
    // flexible-stat-allocation: Default_Sheet_Schema는 LADDER_SELECT 배분 규칙을 싣는다(기존 동작 보존). (요구사항 7.3)
    allocation: { mode: "LADDER_SELECT" },
    // scenario-character-cards: Default_Sheet_Schema는 네 평가 항목을 가지므로 능력치 제안을 지원하고(true),
    // 카드 기반이 아니다(빈 characterCards). (요구사항 7.3, Glossary Default_Sheet_Schema)
    attributeProposalSupported: true,
    characterCards: [],
  };
}

/**
 * Trait_Ladder를 정규화한다. 유효한 `{ min, max }`(둘 다 정수이고 min ≤ max)이면 그 값을
 * 복제해 반환하고, 누락·형식 위반이면 기본 Attribute_Ladder `[-2, +4]`로 정규화한다.
 * (요구사항 13.5 — 누락된 Trait_Ladder 기본값 보정)
 * @param {unknown} ladder
 * @returns {TraitLadder}
 */
function normalizeLadder(ladder) {
  if (
    ladder &&
    typeof ladder === "object" &&
    Number.isInteger(/** @type {any} */ (ladder).min) &&
    Number.isInteger(/** @type {any} */ (ladder).max) &&
    /** @type {any} */ (ladder).min <= /** @type {any} */ (ladder).max
  ) {
    return { min: /** @type {any} */ (ladder).min, max: /** @type {any} */ (ladder).max };
  }
  return { min: DEFAULT_ATTRIBUTE_LADDER.min, max: DEFAULT_ATTRIBUTE_LADDER.max };
}

// ---------------------------------------------------------------------------
// 초기 상태 팩토리 (Initial State Factory) — 작업 1.1
// ---------------------------------------------------------------------------

/**
 * 초기 상태를 생성한다. 인계를 받아 `handoffValid`를 함께 계산하고, activeSchema를
 * Default_Sheet_Schema로 둔다(정확히 하나의 Active_Sheet_Schema 불변식, 요구사항 13.7).
 *
 * 각 요청 영역(schema/proposal/record/confirm)은 아직 요청 전이므로 `idle`이다.
 * narrativeValues·traitValues는 빈 맵으로 시작하며, 스키마 채택 시 reduce가 각 Rated_Trait의
 * 초기 Trait_Level로 재구성한다(작업 5.1).
 *
 * @param {Handoff} handoff 인계 값(roomId/playerId/token)
 * @returns {CharacterSheetState}
 */
export function createInitialState(handoff) {
  /** @type {Handoff} */
  const safeHandoff = {
    roomId: handoff ? toStringSafe(handoff.roomId) : "",
    playerId: handoff ? toStringSafe(handoff.playerId) : "",
    token: handoff ? toStringSafe(handoff.token) : "",
    ticket: handoff ? toStringSafe(handoff.ticket) : "",
  };
  return {
    handoff: safeHandoff,
    handoffValid: computeHandoffValid(safeHandoff),
    schemaArea: AreaPhase.IDLE,
    schemaErrorKind: null,
    activeSchema: buildDefaultSheetSchema(),
    usingDefaultSchema: false,
    narrativeValues: {},
    traitValues: {},
    proposal: AreaPhase.IDLE,
    record: AreaPhase.IDLE,
    confirm: AreaPhase.IDLE,
    errorKind: null,
    notice: null,
    lastRequest: null,
    confirmed: false,
    nextHandoffDone: false,
    // scenario-character-cards: Card_Based_Sheet의 Selected_Card. 초기에는 미선택(null). (요구사항 4.3) — 작업 1.2 스캐폴드
    selectedCardId: null,
  };
}

// ---------------------------------------------------------------------------
// 순수 함수 스텁 (Pure Function Stubs) — 이후 작업에서 구현
// ---------------------------------------------------------------------------
//
// 아래 함수들은 작업 2~6에서 채워진다. 지금은 호출 시 명확히 실패하는 스텁이며,
// 모듈 import 자체에는 부작용이 없다(스텁은 호출될 때만 던진다).

// -- 인계 파싱·검증 · 토큰 헤더 (작업 2.1) ----------------------------------

/**
 * 페이지 URL 쿼리에서 인계 값(roomId/playerId/token)을 공백 제거 후 추출한다.
 *
 * 선행 `?`(또는 `#`)가 있어도 없어도 받아들이며, `roomId`·`playerId`·`token`·`ticket`을 앞뒤 공백
 * 제거 후 추출한다. 키가 존재하지 않으면 빈 문자열로 취급하고, 토큰·티켓은 트림 후 비어 있으면
 * `""`로 둔다. `ticket`은 서버 발급 연결 티켓(auth-hardening)이다. (요구사항 1.1, 1.2, 1.5)
 *
 * @param {string} search 쿼리 문자열(예: "?roomId=r1&playerId=p1&token=t")
 * @returns {Handoff}
 */
export function parseHandoff(search) {
  const raw = toStringSafe(search);
  // 선행 "?"(또는 "#")를 제거한 뒤 URLSearchParams로 파싱한다.
  const query = raw.replace(/^[?#]/, "");
  const params = new URLSearchParams(query);
  return {
    roomId: toStringSafe(params.get("roomId")).trim(),
    playerId: toStringSafe(params.get("playerId")).trim(),
    token: toStringSafe(params.get("token")).trim(),
    ticket: toStringSafe(params.get("ticket")).trim(),
  };
}

/**
 * 인계의 유효성을 판정한다.
 *
 * 트림된 `roomId`와 `playerId`가 모두 비어 있지 않을 때에만 true. (요구사항 1.3)
 *
 * @param {Handoff} handoff
 * @returns {boolean}
 */
export function isHandoffValid(handoff) {
  if (!handoff) return false;
  return (
    toStringSafe(handoff.roomId).trim().length >= 1 &&
    toStringSafe(handoff.playerId).trim().length >= 1
  );
}

/**
 * 접근 토큰으로 인증 헤더를 구성한다.
 *
 * 토큰이 비어 있지 않으면 `{ "x-playtest-token": token }`(값 무변형), 아니면 `{}`.
 * (요구사항 11.1, 11.2)
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
 * 서버 발급 연결 티켓으로 player-acting 헤더를 구성한다(auth-hardening).
 *
 * 티켓이 비어 있지 않으면 `{ "x-connection-ticket": ticket }`(값 무변형), 아니면 `{}`.
 * `x-playtest-token`(buildAuthHeaders)과는 독립적이며, 두 헤더는 서로를 대체하지 않는다.
 *
 * @param {string} ticket
 * @returns {Record<string, string>}
 */
export function buildTicketHeaders(ticket) {
  if (isNonEmptyString(ticket)) {
    return { "x-connection-ticket": ticket };
  }
  return {};
}

// -- REST 요청 빌더 (작업 2.2) ----------------------------------------------

/**
 * `GET /rooms/{encodeURIComponent(roomId)}/sheet-schema` 요청 명세. (요구사항 13.1)
 * @param {string} roomId
 * @param {string} token
 * @returns {{ url: string, method: string, headers: Record<string, string> }}
 */
export function buildSchemaRequest(roomId, token) {
  return {
    url: "/rooms/" + encodeURIComponent(toStringSafe(roomId)) + "/sheet-schema",
    method: "GET",
    headers: buildAuthHeaders(token),
  };
}

/**
 * `GET /rooms/{encodeURIComponent(roomId)}/players/{encodeURIComponent(playerId)}/cards` 요청 명세.
 *
 * 카드 기반 시나리오에서 플레이어에게 분배된 3장의 손패(Card_Hand)를 조회한다. 토큰이 비어 있지
 * 않을 때에만 x-playtest-token 헤더를 싣는다(buildSchemaRequest와 동일한 루프백 게이트 패턴).
 * 연결 티켓은 필요 없다.
 * @param {string} roomId
 * @param {string} playerId
 * @param {string} token
 * @returns {{ url: string, method: string, headers: Record<string, string> }}
 */
export function buildCardsRequest(roomId, playerId, token) {
  return {
    url:
      "/rooms/" +
      encodeURIComponent(toStringSafe(roomId)) +
      "/players/" +
      encodeURIComponent(toStringSafe(playerId)) +
      "/cards",
    method: "GET",
    headers: buildAuthHeaders(token),
  };
}

/**
 * `POST /rooms/{roomId}/players/{playerId}/proposal` 요청 명세. (요구사항 4.1)
 * @param {string} roomId
 * @param {string} playerId
 * @param {string} concept
 * @param {string[]} traitKeys
 * @param {string} token
 * @param {string=} ticket  서버 발급 연결 티켓(선택). 비어 있지 않으면 x-connection-ticket 헤더로 보낸다(auth-hardening).
 * @returns {{ url: string, method: string, headers: Record<string, string>, body: string }}
 */
export function buildProposalRequest(roomId, playerId, concept, traitKeys, token, ticket) {
  /** @type {Record<string, string>} */
  const headers = {
    "content-type": "application/json",
    ...buildAuthHeaders(token),
    ...buildTicketHeaders(ticket),
  };
  return {
    url:
      "/rooms/" +
      encodeURIComponent(toStringSafe(roomId)) +
      "/players/" +
      encodeURIComponent(toStringSafe(playerId)) +
      "/proposal",
    method: "POST",
    headers,
    body: JSON.stringify({ concept: trimEnds(concept), traitKeys: traitKeys }),
  };
}

/**
 * `POST /rooms/{roomId}/players/{playerId}/character` 요청 명세. (요구사항 6.1, 7.1)
 * @param {Handoff} handoff
 * @param {string} name
 * @param {Record<string, string>} narrative
 * @param {Record<string, number>} ratedTraitSet
 * @param {string=} selectedCardId  Card_Based_Sheet의 Selected_Card Card_Id(선택). 트림 후 1자 이상이면 본문에 포함. (요구사항 4.5)
 * @returns {{ url: string, method: string, headers: Record<string, string>, body: string }}
 */
// [scenario-character-cards 확장 · 작업 8.1] 정확히 하나의 Selected_Card가 있으면(트림 후 1자 이상)
// 요청 본문에 그 Card_Id를 포함한다. 4-인자 기존 호출자는 영향받지 않는다(본문에서 selectedCardId 생략).
// 서사 값은 앞뒤 공백만 제거하고 내부 공백은 보존한다. (요구사항 4.5)
export function buildRecordRequest(handoff, name, narrative, ratedTraitSet, selectedCardId) {
  const safeHandoff = handoff || { roomId: "", playerId: "", token: "" };
  // 서사 필드 맵의 각 값은 앞뒤 공백만 제거하고 내부 공백은 보존해 전송한다. (요구사항 3.3)
  /** @type {Record<string, string>} */
  const trimmedNarrative = {};
  const narrativeMap = narrative || {};
  for (const key of Object.keys(narrativeMap)) {
    trimmedNarrative[key] = trimEnds(narrativeMap[key]);
  }
  /** @type {Record<string, string>} */
  const headers = {
    "content-type": "application/json",
    ...buildAuthHeaders(safeHandoff.token),
    ...buildTicketHeaders(safeHandoff.ticket),
  };
  /** @type {Record<string, unknown>} */
  const requestBody = {
    name: trimEnds(name),
    narrative: trimmedNarrative,
    attributes: ratedTraitSet,
  };
  // 정확히 하나의 Selected_Card가 있을 때(트림 후 1자 이상)에만 Card_Id를 본문에 포함한다.
  // 누락·빈 문자열·공백뿐이면 생략해 기존 4-인자 호출자의 본문과 동일하게 유지한다. (요구사항 4.5)
  if (typeof selectedCardId === "string" && selectedCardId.trim().length >= 1) {
    requestBody.selectedCardId = selectedCardId.trim();
  }
  return {
    url:
      "/rooms/" +
      encodeURIComponent(toStringSafe(safeHandoff.roomId)) +
      "/players/" +
      encodeURIComponent(toStringSafe(safeHandoff.playerId)) +
      "/character",
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  };
}

/**
 * `POST /rooms/{roomId}/players/{playerId}/character/confirm` 요청 명세. (요구사항 7.2)
 * @param {Handoff} handoff
 * @returns {{ url: string, method: string, headers: Record<string, string>, body: string }}
 */
export function buildConfirmRequest(handoff) {
  const safeHandoff = handoff || { roomId: "", playerId: "", token: "" };
  /** @type {Record<string, string>} */
  const headers = {
    "content-type": "application/json",
    ...buildAuthHeaders(safeHandoff.token),
    ...buildTicketHeaders(safeHandoff.ticket),
  };
  return {
    url:
      "/rooms/" +
      encodeURIComponent(toStringSafe(safeHandoff.roomId)) +
      "/players/" +
      encodeURIComponent(toStringSafe(safeHandoff.playerId)) +
      "/character/confirm",
    method: "POST",
    headers,
    body: JSON.stringify({}),
  };
}

// -- 응답·결과 분류 (작업 2.5) ----------------------------------------------

/**
 * 요청 결과(응답/네트워크오류/타임아웃)를 단일 결과 타입으로 환원한다.
 *
 * 시그니처: `classifyOutcome({ kind, response? })`
 * - `kind: "network"` → `network` (요구사항 10.2)
 * - `kind: "timeout"` → `timeout` (요구사항 9.5, 10.1)
 * - `kind: "response"` → HTTP 상태로 분류
 *     - HTTP 401·403 → `auth` (요구사항 11.5)
 *     - HTTP 500~599 → `server` (요구사항 10.3)
 *     - HTTP 2xx → "success"
 *     - 그 외 비-2xx는 보수적으로 `server`로 환원한다(design Error Handling 표).
 * 이렇게 환원된 `timeout`·`network`·`server`·`auth`는 서로 구별되는 종류여서
 * 서로 다른 한국어 메시지로 매핑된다. (요구사항 9.5, 10.1, 10.2, 10.3, 11.5)
 *
 * @param {{ kind: "response" | "network" | "timeout", response?: { ok: boolean, status: number } }} outcome
 * @returns {"success" | ErrorKind}
 */
export function classifyOutcome(outcome) {
  const kind = outcome ? outcome.kind : undefined;
  if (kind === "network") return ErrorKind.NETWORK;
  if (kind === "timeout") return ErrorKind.TIMEOUT;
  if (kind === "response") {
    const response = outcome.response || { ok: false, status: 0 };
    const status = response.status;
    if (status === 401 || status === 403) return ErrorKind.AUTH;
    if (status >= 500 && status <= 599) return ErrorKind.SERVER;
    if (status >= 200 && status <= 299) return "success";
    // 그 외 비-2xx(400·404·409 등)는 보수적으로 server 오류로 환원한다.
    return ErrorKind.SERVER;
  }
  // 알 수 없는 결과 종류도 보수적으로 server 오류로 환원한다.
  return ErrorKind.SERVER;
}

/**
 * 기록 요청 결과(성공/거부 사유/전송 오류)를 단일 결과로 환원한다.
 *
 * `CharacterService`는 `{ ok: false, reason, message }` 판별 유니온을 반환하며, 의도된
 * Record_Character_Endpoint는 이 거부 결과를 HTTP 200 본문으로 그대로 노출하거나 HTTP 4xx로
 * 매핑할 수 있다. 따라서 **본문의 `reason` 필드를 우선 분류**하고(NAME_TAKEN/INVALID_ATTRIBUTES/
 * ALREADY_CONFIRMED/UNKNOWN_PLAYER, 그 외는 OTHER), 본문에 거부 사유가 없으면 전송/HTTP 오류를
 * `classifyOutcome`로 환원한다. 2xx 정상 본문(거부 사유 없음)은 "success"다.
 * (요구사항 6.3, 6.4, 6.5, 6.6, 6.7, 6.8)
 *
 * @param {{ kind: "response" | "network" | "timeout", response?: { ok: boolean, status: number }, body?: unknown }} outcome
 * @returns {"success" | RecordRejection | ErrorKind}
 */
// [flexible-stat-allocation 확장 대상 · 작업 10.1] 본문 reason "INVALID_ALLOCATION" 분기를 추가한다. (요구사항 8.3)
// [scenario-character-cards 확장 대상 · 작업 8.1] 본문 reason "INVALID_CARD" 분기를 추가한다. (요구사항 6.2, 6.4)
export function classifyRecordResult(outcome) {
  const safe = outcome || { kind: "response" };
  const body = safe.body;
  // 본문의 reason 필드를 우선 분류한다(서비스 거부가 HTTP 200 또는 4xx 본문으로 노출될 수 있음).
  if (body && typeof body === "object" && isNonEmptyString(/** @type {any} */ (body).reason)) {
    const reason = /** @type {string} */ (/** @type {any} */ (body).reason);
    if (reason === RecordRejection.NAME_TAKEN) return RecordRejection.NAME_TAKEN;
    if (reason === RecordRejection.INVALID_ATTRIBUTES) return RecordRejection.INVALID_ATTRIBUTES;
    // flexible-stat-allocation: 사다리 경계는 통과했으나 배분 제약(총합·고정값 다중집합)을 위반함. (요구사항 8.3, 8.7)
    if (reason === RecordRejection.INVALID_ALLOCATION) return RecordRejection.INVALID_ALLOCATION;
    // scenario-character-cards: Card_Based_Sheet에서 카드 미선택 또는 목록에 없는 Card_Id. (요구사항 6.2, 6.4)
    if (reason === RecordRejection.INVALID_CARD) return RecordRejection.INVALID_CARD;
    if (reason === RecordRejection.ALREADY_CONFIRMED) return RecordRejection.ALREADY_CONFIRMED;
    if (reason === RecordRejection.UNKNOWN_PLAYER) return RecordRejection.UNKNOWN_PLAYER;
    // 열거되지 않은 기타 거부 사유 (요구사항 6.8)
    return RecordRejection.OTHER;
  }
  // 거부 사유가 없으면 전송/HTTP 오류는 classifyOutcome으로 환원하고, 2xx 정상 본문은 "success".
  return classifyOutcome(safe);
}

// -- 스키마 엔진 (작업 3.1) --------------------------------------------------

/**
 * 결정적 Default_Sheet_Schema를 반환한다.
 *
 * 네 Attribute_Key(Might·Agility·Wits·Spirit)를 기본 Attribute_Ladder `[-2, +4]`의 Rated_Trait로,
 * Character_Name(maxLength 100)·Character_Concept(maxLength 2000)을 Narrative_Field로,
 * `narrative`·`attributes` 두 Sheet_Section을 갖는다. 내부 빌더 `buildDefaultSheetSchema`에
 * 위임하며, 호출마다 새 객체를 만들어 호출자가 변형해도 다른 호출에 영향이 없다(결정적·불변).
 * (요구사항 13.8)
 * @returns {SheetSchema}
 */
// [flexible-stat-allocation 확장 대상 · 작업 3.1] Default_Sheet_Schema에 allocation: { mode: "LADDER_SELECT" }를 포함시킨다.
// [scenario-character-cards 확장 대상 · 작업 4.1] Default_Sheet_Schema에 attributeProposalSupported: true와 characterCards: [](카드 기반 아님)를 포함시킨다. (요구사항 7.3)
export function defaultSheetSchema() {
  return buildDefaultSheetSchema();
}

/**
 * 스키마 응답 본문을 검증하고 정규화한다.
 *
 * 유효 조건: 본문이 객체이고, `traits`가 배열(빈 배열 허용 — 서사 전용 시트)이며 존재하는 각
 * Rated_Trait가 비어 있지 않은 Trait_Key를 가지고, `narrativeFields`가 이름(`name`)·컨셉(`concept`)
 * Narrative_Field를 모두 포함해야 한다. 누락·형식 위반 Trait_Ladder는 기본 `[-2, +4]`로 정규화한다.
 * 통과 시 정규화된 `{ ok: true, schema }`, 아니면 `{ ok: false }`. (요구사항 13.2, 13.5)
 * @param {unknown} body
 * @returns {{ ok: true, schema: SheetSchema } | { ok: false }}
 */
// [flexible-stat-allocation 확장 대상 · 작업 3.1] validateAllocationRule(body.allocation, traits)로 배분 규칙을 검증해
// 규칙이 무효이면 스키마를 채택하지 않게 확장한다. (요구사항 7.1, 7.2)
// [scenario-character-cards 확장 대상 · 작업 4.1] validateCardList(body.characterCards)로 카드 목록을 검증해
// 무효이면 스키마를 채택하지 않게 하고, attributeProposalSupported를 정규화/도출한다. (요구사항 7.1, 7.4)
export function validateSchema(body) {
  if (!body || typeof body !== "object") return { ok: false };
  const b = /** @type {any} */ (body);

  // traits는 배열이어야 한다. 단, 서사 전용(narrative-only) 시트는 빈 배열을 허용한다.
  // 각 Rated_Trait가 존재하면 비어 있지 않은 Trait_Key를 가져야 한다. (요구사항 13.2, 13.5)
  if (!Array.isArray(b.traits)) return { ok: false };
  /** @type {RatedTrait[]} */
  const traits = [];
  for (const t of b.traits) {
    if (!t || typeof t !== "object" || !isNonEmptyString(t.key)) return { ok: false };
    /** @type {RatedTrait} */
    const normalized = {
      key: t.key,
      // 레이블이 비어 있으면 Trait_Key로 보정해 렌더 시 비어 있지 않은 레이블을 보장한다. (요구사항 2.2)
      label: isNonEmptyString(t.label) ? t.label : t.key,
      sectionId: isNonEmptyString(t.sectionId) ? t.sectionId : "attributes",
      ladder: normalizeLadder(t.ladder),
    };
    if (t.rungLabels && typeof t.rungLabels === "object") {
      normalized.rungLabels = t.rungLabels;
    }
    traits.push(normalized);
  }

  // 이름·컨셉 Narrative_Field를 포함해야 한다. (요구사항 13.2)
  if (!Array.isArray(b.narrativeFields)) return { ok: false };
  const fieldIds = new Set(
    b.narrativeFields
      .filter((f) => f && typeof f === "object" && isNonEmptyString(f.id))
      .map((f) => /** @type {any} */ (f).id)
  );
  if (!fieldIds.has("name") || !fieldIds.has("concept")) return { ok: false };

  /** @type {SheetSchema} */
  const schema = {
    sections: Array.isArray(b.sections) ? b.sections : [],
    narrativeFields: b.narrativeFields,
    traits,
  };

  // flexible-stat-allocation: Allocation_Rule을 검증·정규화한다. (요구사항 7.1, 7.2)
  // 하위호환: allocation이 아예 없으면(기존 무-allocation character-sheet 스키마 응답) LADDER_SELECT로
  // 정규화해 채택한다(기존 동작 보존). allocation이 존재하지만 무효이면 스키마를 채택하지 않는다.
  if (b.allocation === undefined || b.allocation === null) {
    schema.allocation = { mode: "LADDER_SELECT" };
  } else {
    const ruleResult = validateAllocationRule(b.allocation, traits);
    if (!ruleResult.ok) return { ok: false };
    schema.allocation = ruleResult.rule;
  }

  // scenario-character-cards: Character_Card_List를 검증·정규화한다. (요구사항 7.1, 7.2)
  // 없거나 빈 배열이면 카드 기반 아님(빈 목록)으로 정규화하고, 1개 이상이며 모든 원소가 트림 후
  // 1자 이상 id·roleLabel을 갖고 모든 id가 고유할 때에만 유효. 무효이면 스키마를 채택하지 않는다.
  const cardResult = validateCardList(b.characterCards);
  if (!cardResult.ok) return { ok: false };
  if (cardResult.cards.length >= 1) {
    schema.characterCards = cardResult.cards;
  }

  // scenario-character-cards: Attribute_Proposal_Supported를 정규화/도출한다. (요구사항 7.4)
  // 응답에 불리언이 있으면 그 값을 쓰고, 없으면 Rated_Trait_Count(traits.length) > 0으로 도출한다.
  schema.attributeProposalSupported =
    typeof b.attributeProposalSupported === "boolean"
      ? b.attributeProposalSupported
      : traits.length > 0;

  return { ok: true, schema };
}

/**
 * 스키마 요청 결과로 채택할 Active_Sheet_Schema 하나를 결정한다.
 *
 * 성공(2xx) 응답이면서 본문이 유효하면 정규화된 채택 스키마를 반환하고, 성공이지만 무효이거나
 * 어떤 전송 오류(network/timeout/server/auth)로 종료되면 `defaultSheetSchema()`를 반환한다.
 * 어느 경우에도 항상 정확히 하나의 유효한 `SheetSchema`를 반환한다. (요구사항 13.5, 13.6, 13.7)
 * @param {{ kind: "response" | "network" | "timeout", response?: { ok: boolean, status: number }, body?: unknown }} outcome
 * @returns {SheetSchema}
 */
// [flexible-stat-allocation 확장 대상 · 작업 3.1] 규칙 무효도 폴백 경로로 흡수해 항상 정확히 하나의
// 유효 Active_Sheet_Schema + 유효 Allocation_Rule을 반환하게 확장한다. (요구사항 7.2, 7.3)
// [scenario-character-cards 확장 대상 · 작업 4.1] 카드 목록 무효도 폴백 경로로 흡수해 항상 카드 기반이 아닌
// Default_Sheet_Schema(+SCHEMA_FALLBACK 안내)를 채택하게 한다. (요구사항 7.2, 7.3)
export function selectActiveSchema(outcome) {
  if (classifyOutcome(outcome) === "success") {
    const validated = validateSchema(outcome ? outcome.body : undefined);
    if (validated.ok) return validated.schema;
  }
  return defaultSheetSchema();
}

// -- 렌더 모델 · 이스케이프 (작업 3.4) --------------------------------------

/**
 * `[min, max]` 정수 포함 구간의 모든 정수를 오름차순 배열로 만든다.
 *
 * Rated_Trait 편집 요소의 선택 가능 값을 그 Trait_Ladder의 정수 집합으로 제한하기 위한
 * 내부 헬퍼다(요구사항 5.2). 입력이 정수 `{ min, max }`가 아니거나 `max < min`이면 빈 배열을
 * 반환한다(렌더는 실패하지 않는다).
 * @param {TraitLadder} ladder
 * @returns {number[]}
 */
function ladderOptions(ladder) {
  if (
    !ladder ||
    !Number.isInteger(ladder.min) ||
    !Number.isInteger(ladder.max) ||
    ladder.max < ladder.min
  ) {
    return [];
  }
  /** @type {number[]} */
  const options = [];
  for (let level = ladder.min; level <= ladder.max; level += 1) {
    options.push(level);
  }
  return options;
}

/**
 * 현재 작성 값에서 한 Rated_Trait의 표시 Trait_Level을 결정한다.
 *
 * 보존된 값이 그 Trait_Ladder 안의 정수이면 그 값을, 아니면 0이 사다리 안이면 0, 그렇지 않으면
 * 사다리의 최소 정수를 쓴다(요구사항 2.3의 초기값 규칙과 동일한 기본값). 사다리 엔진(작업 3.7)에
 * 의존하지 않도록 동일 규칙을 인라인한다.
 * @param {Record<string, number> | undefined} traitValues
 * @param {RatedTrait} trait
 * @returns {number}
 */
function displayedLevel(traitValues, trait) {
  const ladder = trait.ladder;
  const current = traitValues ? traitValues[trait.key] : undefined;
  if (
    typeof current === "number" &&
    Number.isInteger(current) &&
    current >= ladder.min &&
    current <= ladder.max
  ) {
    return current;
  }
  if (0 >= ladder.min && 0 <= ladder.max) return 0;
  return ladder.min;
}

/**
 * Active_Sheet_Schema와 작성 값으로 렌더 모델을 도출한다.
 *
 * 스키마가 정의한 Sheet_Section만, 각 섹션 안에 그 섹션에 소속된 Narrative_Field 입력과
 * Rated_Trait 편집을 스키마 정의 순서대로 배치한 렌더 모델을 반환한다. 스키마에 정의되지 않은
 * Sheet_Section·Narrative_Field·Rated_Trait는 렌더되지 않는다(요구사항 13.3, 2.1, 2.2).
 *
 * 각 Rated_Trait 편집 요소의 선택 가능 값(`options`)은 그 Trait_Ladder의 정수 집합
 * `[min..max]`로 제한한다(요구사항 5.2). 모든 텍스트(섹션·필드·항목 레이블, 안내, 보존된 서사
 * 값)는 `esc`로 이스케이프해 HTML로 해석되지 않게 한다(요구사항 3.4). 레이블·안내가 비어 있으면
 * 비어 있지 않은 식별자로 보정해 요구사항 2.1·2.2를 만족시킨다.
 *
 * @param {SheetSchema} schema
 * @param {{ narrativeValues?: Record<string, string>, traitValues?: Record<string, number> }=} values
 * @returns {{ sections: Array<{ id: string, label: string, narrativeFields: Array<{ id: string, label: string, guidance: string, maxLength: number, value: string }>, traits: Array<{ key: string, label: string, ladder: TraitLadder, level: number, options: number[] }> }> }}
 */
// [scenario-character-cards 확장 대상 · 작업 7.1] 소속 Narrative_Field·Rated_Trait가 모두 0개인
// Sheet_Section을 결과에서 제외하고(요구사항 2.4), Rated_Trait_Count === 0이면 평가 편집 요소를
// 산출하지 않으며 Backstory_Field 입력 요소는 산출하도록 확장한다. (요구사항 2.3, 4.2)
export function renderModel(schema, values) {
  const safeSchema = schema || { sections: [], narrativeFields: [], traits: [] };
  const sectionsDef = Array.isArray(safeSchema.sections) ? safeSchema.sections : [];
  const fieldsDef = Array.isArray(safeSchema.narrativeFields) ? safeSchema.narrativeFields : [];
  const traitsDef = Array.isArray(safeSchema.traits) ? safeSchema.traits : [];
  const narrativeValues = (values && values.narrativeValues) || {};
  const traitValues = (values && values.traitValues) || {};

  const sections = sectionsDef
    .map((section) => {
      const sectionId = section.id;
      return {
        id: sectionId,
        // 레이블이 비어 있으면 섹션 식별자로 보정해 비어 있지 않은 레이블을 보장한다.
        label: esc(isNonEmptyString(section.label) ? section.label : sectionId),
        narrativeFields: fieldsDef
          .filter((field) => field.sectionId === sectionId)
          .map((field) => ({
            id: field.id,
            label: esc(isNonEmptyString(field.label) ? field.label : field.id),
            // 안내 텍스트는 비어 있으면 레이블/식별자로 보정한다(요구사항 2.1).
            guidance: esc(
              isNonEmptyString(field.guidance)
                ? field.guidance
                : isNonEmptyString(field.label)
                  ? field.label
                  : field.id
            ),
            maxLength: field.maxLength,
            // 보존된 서사 값(앞뒤 공백 포함)을 이스케이프해 그대로 표시한다(요구사항 3.1, 3.2, 3.4).
            value: esc(toStringSafe(narrativeValues[field.id])),
          })),
        // Rated_Trait_Count === 0이면 traitsDef가 비어 있어 어떤 평가 편집 요소도 산출하지 않는다.
        // (요구사항 2.3) Backstory_Field 등 Narrative_Field 입력 요소는 위에서 그대로 산출한다(요구사항 4.2).
        traits: traitsDef
          .filter((trait) => trait.sectionId === sectionId)
          .map((trait) => ({
            key: trait.key,
            label: esc(isNonEmptyString(trait.label) ? trait.label : trait.key),
            ladder: { min: trait.ladder.min, max: trait.ladder.max },
            level: displayedLevel(traitValues, trait),
            // 선택 가능 값을 Trait_Ladder의 정수 집합으로만 제한한다(요구사항 5.2).
            options: ladderOptions(trait.ladder),
          })),
      };
    })
    // [scenario-character-cards 작업 7.1] 소속 Narrative_Field와 Rated_Trait가 모두 0개인
    // Sheet_Section은 결과에서 제외하고, 비어 있지 않은 섹션은 스키마 정의 순서대로 보존한다. (요구사항 2.4)
    .filter((section) => section.narrativeFields.length > 0 || section.traits.length > 0);

  return { sections };
}

/**
 * 스키마가 정의한 Trait_Key 식별자 배열을 정의 순서대로 반환한다(집합 일치 검증용). (요구사항 13.4)
 * @param {SheetSchema} schema
 * @returns {string[]}
 */
export function renderedTraitKeys(schema) {
  if (!schema || !Array.isArray(schema.traits)) return [];
  return schema.traits.map((trait) => trait.key);
}

/**
 * 스키마가 정의한 Narrative_Field 식별자 배열을 정의 순서대로 반환한다(집합 일치 검증용). (요구사항 13.4)
 * @param {SheetSchema} schema
 * @returns {string[]}
 */
export function renderedFieldIds(schema) {
  if (!schema || !Array.isArray(schema.narrativeFields)) return [];
  return schema.narrativeFields.map((field) => field.id);
}

/**
 * 스키마가 정의한 Sheet_Section 식별자 배열을 정의 순서대로 반환한다(집합 일치 검증용). (요구사항 13.4)
 * @param {SheetSchema} schema
 * @returns {string[]}
 */
export function renderedSectionIds(schema) {
  if (!schema || !Array.isArray(schema.sections)) return [];
  return schema.sections.map((section) => section.id);
}

/**
 * HTML 특수문자(`&`·`<`·`>`)를 엔티티로 이스케이프한다. host-entry의 esc() 패턴을 그대로 따른다.
 *
 * 텍스트를 HTML 또는 스크립트로 해석하지 않고 일반 텍스트로 표시하기 위한 것이며, 이스케이프된
 * 출력을 디코드하면 원래 문자열과 같다(텍스트 의미 보존). null/undefined는 빈 문자열로 환원한다.
 * (요구사항 3.4)
 * @param {unknown} value
 * @returns {string}
 */
export function esc(value) {
  return toStringSafe(value).replace(
    /[&<>]/g,
    (c) => /** @type {Record<string, string>} */ ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]
  );
}

// -- 사다리 엔진 (작업 3.7) --------------------------------------------------

/**
 * level이 ladder 안의 정수인지 판정한다. (요구사항 5.1, 5.5)
 * @param {number} level
 * @param {TraitLadder} ladder
 * @returns {boolean}
 */
export function isValidLevel(level, ladder) {
  if (!ladder || typeof ladder !== "object") return false;
  return (
    Number.isInteger(level) &&
    ladder.min <= level &&
    level <= ladder.max
  );
}

/**
 * 초기 Trait_Level을 결정한다: 0이 사다리 안이면 0, 아니면 최소 정수. (요구사항 2.3)
 * @param {TraitLadder} ladder
 * @returns {number}
 */
export function initialLevel(ladder) {
  if (0 >= ladder.min && 0 <= ladder.max) return 0;
  return ladder.min;
}

/**
 * Trait_Level에 대응하는 Ladder_Rung_Label을 반환한다.
 *
 * Rated_Trait의 Trait_Ladder가 기본 Attribute_Ladder `[-2, +4]`이면 `DEFAULT_RUNG_LABELS`의
 * 고정 매핑(-2=끔찍함 … +4=탁월함)을 사용하고, 기본 사다리가 아니면 스키마가 제공한 등급
 * 레이블(`trait.rungLabels`)을 사용한다. 해당 등급 레이블이 없으면 Trait_Level의 문자열 표현으로
 * 안전하게 폴백한다. (요구사항 2.5)
 * @param {number} level
 * @param {RatedTrait} trait
 * @returns {string}
 */
export function rungLabel(level, trait) {
  const ladder = trait ? trait.ladder : undefined;
  const isDefaultLadder =
    !!ladder &&
    ladder.min === DEFAULT_ATTRIBUTE_LADDER.min &&
    ladder.max === DEFAULT_ATTRIBUTE_LADDER.max;
  const key = String(level);
  if (isDefaultLadder) {
    const label = DEFAULT_RUNG_LABELS[key];
    return isNonEmptyString(label) ? label : key;
  }
  const rungLabels = trait ? trait.rungLabels : undefined;
  if (rungLabels && typeof rungLabels === "object") {
    const label = rungLabels[key];
    if (isNonEmptyString(label)) return label;
  }
  return key;
}

// -- 서사 입력 보존·전송 정규화 (작업 4.1) ----------------------------------

/**
 * 입력을 앞뒤 공백 포함 그대로 보존하되 길이만 제한한다. (요구사항 3.5, 3.6)
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
export function clampFieldValue(value, maxLength) {
  // 입력을 앞뒤 공백 포함 그대로 보존한다(트림하지 않음). 문자열이 아니면 안전하게 정규화한다.
  const text = toStringSafe(value);
  // maxLength가 음이 아닌 정수이면 그 길이로만 잘라 보존하고, 그 외에는 잘라내지 않는다.
  if (Number.isInteger(maxLength) && maxLength >= 0 && text.length > maxLength) {
    return text.slice(0, maxLength);
  }
  return text;
}

/**
 * 앞뒤 공백만 제거하고 내부 공백은 보존한다. (요구사항 3.3)
 *
 * REST 요청 빌더와 공유하는 단일 트림 규칙인 모듈 내부 헬퍼 `trimEnds`에 위임한다.
 * @param {string} value
 * @returns {string}
 */
export function trimForSend(value) {
  return trimEnds(value);
}

// -- 평가 편집 (작업 4.3) ----------------------------------------------------

/**
 * 지정 값이 유효하면 그 Trait_Key만 갱신한 새 맵, 무효면 입력 맵 그대로. (요구사항 5.1, 5.5)
 * @param {Record<string, number>} values
 * @param {SheetSchema} schema
 * @param {string} traitKey
 * @param {number} level
 * @returns {Record<string, number>}
 */
// [flexible-stat-allocation · 작업 8.1 완료] DICE_ROLL(Forced_Random=false) 편집 등 배분 편집 맥락에서
// 이 함수를 그대로 재사용한다. 지정 값이 그 Trait_Ladder 안 정수이면 해당 Trait_Key만 갱신하고,
// 사다리 밖·비정수이면 입력 맵(직전 Trait_Level)을 변경 없이 그대로 반환한다(코드 변경 불필요). (요구사항 5.9)
export function setTraitLevel(values, schema, traitKey, level) {
  // 입력 맵이 없으면 안전하게 빈 맵으로 정규화한다(무효 시 이 맵을 그대로 돌려준다).
  const safeValues = values && typeof values === "object" ? values : {};
  const traits = schema && Array.isArray(schema.traits) ? schema.traits : [];
  // 지정된 Trait_Key의 Rated_Trait를 찾아 그 Trait_Ladder로 유효성을 판정한다.
  const trait = traits.find((t) => t && t.key === traitKey);
  // 스키마에 없는 Trait_Key이거나 지정 값이 사다리 밖·비정수이면 입력 맵을 그대로 반환한다. (요구사항 5.5)
  if (!trait || !isValidLevel(level, trait.ladder)) {
    return safeValues;
  }
  // 유효하면 그 Trait_Key만 갱신한 새 맵을 반환한다(순수: 입력 맵 비변형). (요구사항 5.1)
  return { ...safeValues, [traitKey]: level };
}

/**
 * 스키마 정의 Trait_Key 한 벌의 Trait_Level을 변형 없이 그대로 모은다. (요구사항 5.4)
 * @param {Record<string, number>} values
 * @param {SheetSchema} schema
 * @returns {Record<string, number>}
 */
export function collectRatedTraitSet(values, schema) {
  const traits = schema && Array.isArray(schema.traits) ? schema.traits : [];
  /** @type {Record<string, number>} */
  const ratedTraitSet = {};
  for (const trait of traits) {
    if (!trait || !isNonEmptyString(trait.key)) continue;
    // 각 Trait_Key에 대해 화면에 표시되는 Trait_Level(renderModel과 동일한 displayedLevel 규칙)을
    // 변형 없이 그대로 담는다. (요구사항 5.4)
    ratedTraitSet[trait.key] = displayedLevel(values, trait);
  }
  return ratedTraitSet;
}

// -- 제안 검증 (작업 4.6) ----------------------------------------------------

/**
 * AI 평가 항목 제안 응답 본문을 검증한다.
 *
 * 의도된 Attribute_Proposal_Endpoint는 성공 시 `{ values: Record<traitKey, number> }`
 * 형태의 Proposed_Trait_Values를 반환한다(design "백엔드 계약 매핑"). 본문이 객체이고
 * `values` 맵이 Active_Sheet_Schema가 정의한 **모든** Rated_Trait에 대한 값을 담으며 각 값이
 * 해당 Rated_Trait의 Trait_Ladder 안의 정수일 때에만 `{ ok: true, values }`를 반환한다.
 * 이때 `values`는 스키마가 정의한 Trait_Key만 담은 정규화된 맵으로, 스키마 외 추가 키는 버린다.
 * Rated_Trait 중 하나라도 누락되거나 어떤 값이 사다리 밖이거나 정수가 아니면 `{ ok: false }`다.
 * (요구사항 4.3, 4.5)
 * @param {unknown} body
 * @param {SheetSchema} schema
 * @returns {{ ok: true, values: Record<string, number> } | { ok: false }}
 */
export function validateProposal(body, schema) {
  if (!body || typeof body !== "object") return { ok: false };
  const proposed = /** @type {any} */ (body).values;
  if (!proposed || typeof proposed !== "object") return { ok: false };

  const traits = schema && Array.isArray(schema.traits) ? schema.traits : [];
  // 스키마가 Rated_Trait를 하나도 정의하지 않으면 검증할 대상이 없으므로 거부한다.
  if (traits.length < 1) return { ok: false };

  /** @type {Record<string, number>} */
  const values = {};
  for (const trait of traits) {
    if (!trait || !isNonEmptyString(trait.key)) return { ok: false };
    const level = proposed[trait.key];
    // 모든 Rated_Trait에 대한 값이 있고 각 값이 해당 Trait_Ladder 안 정수일 때만 통과한다. (요구사항 4.5)
    if (!isValidLevel(level, trait.ladder)) return { ok: false };
    values[trait.key] = level;
  }
  return { ok: true, values };
}

// -- 확정 단계 결정 (작업 4.7) ----------------------------------------------

/**
 * 선행 기록 결과로 확정 다음 단계를 결정한다. (요구사항 7.2, 7.3, 7.4)
 * @param {"success" | RecordRejection} recordResult
 * @returns {"send-confirm" | "blocked-rejection" | "blocked-already-confirmed"}
 */
export function decideConfirmStep(recordResult) {
  // 선행 기록이 성공해야만 확정을 전송한다. (요구사항 7.2)
  if (recordResult === "success") return "send-confirm";
  // 이미 확정된 경우 확정 요청 없이 Confirmed_State로 표시한다. (요구사항 7.4)
  if (recordResult === RecordRejection.ALREADY_CONFIRMED) return "blocked-already-confirmed";
  // NAME_TAKEN·INVALID_ATTRIBUTES를 비롯한 그 외 모든 거부는 확정을 보내지 않는다. (요구사항 7.3)
  return "blocked-rejection";
}

// -- Next_Screen 인계 (작업 4.8) --------------------------------------------

/**
 * Next_Screen 인계 페이로드(식별자 + 있으면 토큰/티켓)를 구성한다. (요구사항 8.2, 11.3, 11.4)
 * @param {Handoff} handoff
 * @returns {{ roomId: string, playerId: string, token?: string, ticket?: string }}
 */
export function buildNextHandoff(handoff) {
  const safeHandoff = handoff || { roomId: "", playerId: "", token: "", ticket: "" };
  /** @type {{ roomId: string, playerId: string, token?: string, ticket?: string }} */
  const next = {
    roomId: toStringSafe(safeHandoff.roomId),
    playerId: toStringSafe(safeHandoff.playerId),
  };
  // 토큰은 비어 있지 않을 때만, 한 글자도 변형하지 않고 포함한다. (요구사항 11.3, 11.4)
  if (isNonEmptyString(safeHandoff.token)) {
    next.token = safeHandoff.token;
  }
  // 서버 발급 연결 티켓도 비어 있지 않을 때만, 변형 없이 포함한다(auth-hardening).
  if (isNonEmptyString(safeHandoff.ticket)) {
    next.ticket = safeHandoff.ticket;
  }
  return next;
}

/**
 * `?roomId=…&playerId=…&token=…&ticket=…`(토큰·티켓은 있을 때만) 쿼리 문자열을 구성한다. (요구사항 8.2)
 *
 * `buildNextHandoff`로 인계 페이로드를 구성한 뒤 `URLSearchParams`로 각 값을 URL 인코딩한다.
 * 토큰·티켓은 각각 비어 있지 않을 때만 쿼리에 포함한다(변형 없이). 선행 `?`를 붙여 반환한다.
 * @param {Handoff} handoff
 * @returns {string}
 */
export function buildNextSearch(handoff) {
  const next = buildNextHandoff(handoff);
  const params = new URLSearchParams();
  params.set("roomId", next.roomId);
  params.set("playerId", next.playerId);
  if (isNonEmptyString(next.token)) {
    params.set("token", next.token);
  }
  // 서버 발급 연결 티켓은 비어 있지 않을 때만 포함한다(auth-hardening).
  if (isNonEmptyString(next.ticket)) {
    params.set("ticket", next.ticket);
  }
  return "?" + params.toString();
}

// -- 상태 리듀서 · 재시도 (작업 5.1, 5.2) -----------------------------------

/**
 * Active_Sheet_Schema가 정의한 각 Rated_Trait의 초기 Trait_Level로 traitValues를 재구성한다.
 *
 * 스키마 채택(SCHEMA_RESOLVED) 시 traitValues 키 집합을 activeSchema.traits 키 집합과 일치시키고
 * 각 값을 `initialLevel`(0이 사다리 안이면 0, 아니면 사다리 최소 정수)로 둔다(요구사항 2.3).
 * @param {SheetSchema} schema
 * @returns {Record<string, number>}
 */
function buildInitialTraitValues(schema) {
  const traits = schema && Array.isArray(schema.traits) ? schema.traits : [];
  /** @type {Record<string, number>} */
  const values = {};
  for (const trait of traits) {
    if (!trait || !isNonEmptyString(trait.key)) continue;
    values[trait.key] = initialLevel(trait.ladder);
  }
  return values;
}

/**
 * 한 Narrative_Field의 보존 길이 한도를 Active_Sheet_Schema에서 찾는다.
 *
 * 스키마에 그 식별자의 Narrative_Field가 있으면 그 `maxLength`를, 없으면 이름은
 * `NAME_MAX_LENGTH`, 그 외는 `NARRATIVE_MAX_LENGTH`로 폴백한다(요구사항 3.5, 3.6).
 * @param {SheetSchema} schema
 * @param {string} fieldId
 * @returns {number}
 */
function fieldMaxLength(schema, fieldId) {
  const fields = schema && Array.isArray(schema.narrativeFields) ? schema.narrativeFields : [];
  const field = fields.find((f) => f && f.id === fieldId);
  if (field && Number.isInteger(field.maxLength)) return field.maxLength;
  return fieldId === "name" ? NAME_MAX_LENGTH : NARRATIVE_MAX_LENGTH;
}

/**
 * 복구 가능한 전송 오류(*_FAILED)에 대한 공통 전이를 적용한다.
 *
 * 해당 요청 영역을 `error`로, `errorKind`·`lastRequest`를 설정하고 오류 종류별 한국어 메시지를
 * notice로 둔다. 입력 상태를 spread 하므로 인계 식별자·토큰·서사 값·Rated_Trait_Set이 모두
 * 변경 없이 보존된다(요구사항 10.5). auth는 ERROR_MESSAGES.auth 로 별도 메시지를 갖는다(11.5).
 * @param {CharacterSheetState} state
 * @param {"proposal" | "record" | "confirm"} area
 * @param {ErrorKind} kind
 * @param {Exclude<LastRequest, null>} lastRequest
 * @returns {CharacterSheetState}
 */
function applyTransmissionFailure(state, area, kind, lastRequest) {
  return {
    ...state,
    [area]: AreaPhase.ERROR,
    errorKind: kind,
    lastRequest,
    notice: ERROR_MESSAGES[kind] || null,
  };
}

/**
 * 단방향 상태 전이 리듀서. 입력 상태를 변형하지 않고 새 상태를 반환한다. (설계 Action Model)
 *
 * 모든 분기는 `{ ...state, ... }` 형태로 새 객체를 만들어 입력 상태(특히 인계 식별자·토큰·
 * 플레이어 입력)를 보존한다. 알 수 없는 action 타입은 상태를 변경 없이 반환한다.
 * @param {CharacterSheetState} state
 * @param {Action} action
 * @returns {CharacterSheetState}
 */
// [flexible-stat-allocation 확장 대상 · 작업 9.7, 10.1] 굴림 성공/실패/무효 응답 액션과 INVALID_ALLOCATION·
// INVALID_ATTRIBUTES 거부 시 입력 보존을 추가하고, 확정 상태의 편집·굴림 시도에 Trait_Level을 유지한다.
// (요구사항 5.7, 5.8, 8.7, 9.1, 9.2, 9.4, 10.2)
// [scenario-character-cards 확장 대상 · 작업 8.1] CARD_SELECTED 액션(selectCard 전이, 확정 시 무시)과
// record/confirm 결과의 INVALID_CARD 분기(CARD_REQUIRED_MESSAGE 설정·입력/selectedCardId 보존·확정 미전이)를
// 추가한다. (요구사항 4.3, 5.1, 6.4, 8.2)
export function reduce(state, action) {
  if (!state || !action || typeof action.type !== "string") return state;

  switch (action.type) {
    // -- 인계 (요구사항 1.3, 1.4) --------------------------------------------
    case "HANDOFF_PARSED": {
      /** @type {Handoff} */
      const raw = /** @type {any} */ (action).handoff || { roomId: "", playerId: "", token: "" };
      /** @type {Handoff} */
      const handoff = {
        roomId: toStringSafe(raw.roomId),
        playerId: toStringSafe(raw.playerId),
        token: toStringSafe(raw.token),
      };
      const valid = isHandoffValid(handoff);
      // 무효이면 안내를 표시한다. HANDOFF_PARSED는 어떤 요청 영역도 loading으로 진입시키지
      // 않으므로 무효 시 어떤 백엔드 요청도 시작되지 않는다(요구사항 1.3).
      return {
        ...state,
        handoff,
        handoffValid: valid,
        notice: valid ? state.notice : HANDOFF_INVALID_MESSAGE,
      };
    }

    // -- 요청 시작(진행 인디케이터) (요구사항 9.1) ----------------------------
    // 인계가 무효이면 어떤 요청 영역도 loading으로 진입하지 않는다(요구사항 1.3).
    case "SCHEMA_STARTED": {
      if (!state.handoffValid) return state;
      return { ...state, schemaArea: AreaPhase.LOADING, schemaErrorKind: null };
    }
    case "PROPOSAL_STARTED": {
      if (!state.handoffValid) return state;
      return { ...state, proposal: AreaPhase.LOADING, errorKind: null, notice: null };
    }
    case "RECORD_STARTED": {
      if (!state.handoffValid) return state;
      return { ...state, record: AreaPhase.LOADING, errorKind: null, notice: null };
    }
    case "CONFIRM_STARTED": {
      if (!state.handoffValid) return state;
      return { ...state, confirm: AreaPhase.LOADING, errorKind: null, notice: null };
    }

    // -- 스키마 채택/폴백 (요구사항 13.2, 13.5, 13.6, 13.7) -------------------
    case "SCHEMA_RESOLVED": {
      const outcome = /** @type {any} */ (action).outcome;
      const validated =
        classifyOutcome(outcome) === "success"
          ? validateSchema(outcome ? outcome.body : undefined)
          : { ok: false };
      const adopted = validated.ok;
      const activeSchema = adopted
        ? /** @type {{ ok: true, schema: SheetSchema }} */ (validated).schema
        : defaultSheetSchema();
      return {
        ...state,
        schemaArea: AreaPhase.LOADED,
        schemaErrorKind: adopted
          ? null
          : classifyOutcome(outcome) === "success"
            ? ErrorKind.INVALID
            : /** @type {ErrorKind} */ (classifyOutcome(outcome)),
        activeSchema,
        usingDefaultSchema: !adopted,
        // 각 Rated_Trait의 초기 Trait_Level로 traitValues를 재구성한다(요구사항 2.3).
        traitValues: buildInitialTraitValues(activeSchema),
        // 무효/오류로 기본 시트를 쓸 때만 폴백 안내를 표시한다(요구사항 13.6).
        notice: adopted ? state.notice : SCHEMA_FALLBACK_MESSAGE,
      };
    }

    // -- 스키마 전송 오류(폴백) (요구사항 13.6) ------------------------------
    // 설계상 스키마 오류는 주로 SCHEMA_RESOLVED(오류 outcome)로 흡수되지만, 부수효과 계층이
    // 별도 SCHEMA_FAILED를 디스패치하는 경우에도 기본 시트로 폴백하고 안내를 표시한다.
    case "SCHEMA_FAILED": {
      const kind = /** @type {ErrorKind} */ (/** @type {any} */ (action).kind);
      const activeSchema = defaultSheetSchema();
      return {
        ...state,
        schemaArea: AreaPhase.ERROR,
        schemaErrorKind: kind,
        activeSchema,
        usingDefaultSchema: true,
        traitValues: buildInitialTraitValues(activeSchema),
        lastRequest: LastRequest.SCHEMA,
        notice: SCHEMA_FALLBACK_MESSAGE,
      };
    }

    // -- 서사 입력 보존·길이 제한 (요구사항 3.1, 3.2, 3.5, 3.6) --------------
    case "NARRATIVE_CHANGED": {
      const fieldId = toStringSafe(/** @type {any} */ (action).fieldId);
      const value = /** @type {any} */ (action).value;
      const clamped = clampFieldValue(value, fieldMaxLength(state.activeSchema, fieldId));
      return {
        ...state,
        narrativeValues: { ...state.narrativeValues, [fieldId]: clamped },
      };
    }

    // -- 평가 편집(해당 항목만 갱신, 무효 거부) (요구사항 5.1, 5.5) -----------
    case "TRAIT_CHANGED": {
      const traitKey = toStringSafe(/** @type {any} */ (action).traitKey);
      const level = /** @type {number} */ (/** @type {any} */ (action).level);
      const nextValues = setTraitLevel(state.traitValues, state.activeSchema, traitKey, level);
      // setTraitLevel은 무효 값이면 입력 맵을 그대로 반환하므로 그때는 상태 변화가 없다.
      if (nextValues === state.traitValues) return state;
      return { ...state, traitValues: nextValues };
    }

    // -- 카드 단일 선택 (scenario-character-cards 요구사항 4.3, 8.2) ----------
    case "CARD_SELECTED": {
      // selectCard가 카드 기반·비확정 전이를 적용한다. 확정 상태 또는 카드 기반 아님이면 무변화.
      return selectCard(state, /** @type {any} */ (action).cardId);
    }

    // -- 분배된 손패 채택 (scenario-character-cards: 서버가 분배한 3장으로 교체) ----
    // 카드 기반 시트일 때만 activeSchema.characterCards를 분배 손패로 교체한다(NEW 객체로 만들어
    // 렌더 diff renderedSchema !== state.activeSchema가 카드를 다시 그리게 한다). selectedCardId가
    // 새 손패에 없으면 null로 비운다(점유로 빠진 카드의 낡은 선택 제거). 카드 기반이 아니면 무변화.
    case "CARD_HAND_RESOLVED": {
      if (!isCardBasedSheet(state.activeSchema)) return state;
      const cards = Array.isArray(/** @type {any} */ (action).cards)
        ? /** @type {any} */ (action).cards
        : [];
      const newSchema = { ...state.activeSchema, characterCards: cards };
      /** @type {Set<string>} */
      const handIds = new Set();
      for (const card of cards) {
        if (card && typeof card === "object" && typeof /** @type {any} */ (card).id === "string") {
          handIds.add(/** @type {any} */ (card).id.trim());
        }
      }
      const trimmedSelected =
        typeof state.selectedCardId === "string" ? state.selectedCardId.trim() : null;
      const keepSelection =
        trimmedSelected !== null && trimmedSelected.length >= 1 && handIds.has(trimmedSelected);
      return {
        ...state,
        activeSchema: newSchema,
        selectedCardId: keepSelection ? state.selectedCardId : null,
      };
    }

    // -- AI 제안 (요구사항 4.2, 4.3, 4.4, 4.5) -------------------------------
    case "PROPOSAL_BLANK_CONCEPT": {
      // 요청을 보내지 않고 컨셉 입력 안내만 표시한다(요구사항 4.2).
      return { ...state, notice: BLANK_CONCEPT_MESSAGE };
    }
    case "PROPOSAL_SUCCEEDED": {
      const body = /** @type {any} */ (action).body;
      const validated = validateProposal(body, state.activeSchema);
      if (validated.ok) {
        // 모든 Rated_Trait의 Trait_Level을 제안 값으로 갱신하고 편집 가능 상태로 유지한다(4.3, 4.4).
        return {
          ...state,
          proposal: AreaPhase.LOADED,
          traitValues: {
            ...state.traitValues,
            .../** @type {{ ok: true, values: Record<string, number> }} */ (validated).values,
          },
          errorKind: null,
          notice: null,
        };
      }
      // 형식 위반이면 적용하지 않고 기존 Trait_Level을 유지하며 안내를 표시한다(4.5).
      return {
        ...state,
        proposal: AreaPhase.LOADED,
        notice: PROPOSAL_INVALID_MESSAGE,
      };
    }
    case "PROPOSAL_FAILED": {
      return applyTransmissionFailure(
        state,
        "proposal",
        /** @type {ErrorKind} */ (/** @type {any} */ (action).kind),
        LastRequest.PROPOSAL
      );
    }

    // -- 저장(기록) (요구사항 6.2~6.8) ---------------------------------------
    case "SAVE_BLANK_NAME": {
      // 요청을 보내지 않고 이름 입력 안내만 표시한다. 입력은 spread로 보존된다(요구사항 6.2).
      return { ...state, notice: BLANK_NAME_MESSAGE };
    }
    case "RECORD_RESULT": {
      const result = /** @type {"success" | RecordRejection} */ (/** @type {any} */ (action).result);
      if (result === "success") {
        // 저장 확인 + 비확정(편집 가능) 유지(요구사항 6.3).
        return {
          ...state,
          record: AreaPhase.LOADED,
          errorKind: null,
          notice: SAVE_CONFIRMED_MESSAGE,
        };
      }
      // 거부 사유별 메시지 + 입력 보존(요구사항 6.4~6.8). ALREADY_CONFIRMED만 Confirmed_State.
      const rejection = RECORD_REJECTION_MESSAGES[result] ? result : RecordRejection.OTHER;
      return {
        ...state,
        record: AreaPhase.LOADED,
        errorKind: null,
        notice: RECORD_REJECTION_MESSAGES[rejection],
        confirmed: rejection === RecordRejection.ALREADY_CONFIRMED ? true : state.confirmed,
      };
    }
    case "RECORD_FAILED": {
      return applyTransmissionFailure(
        state,
        "record",
        /** @type {ErrorKind} */ (/** @type {any} */ (action).kind),
        LastRequest.RECORD
      );
    }

    // -- 확정: 선행 기록 결과 (요구사항 7.3, 7.4) ----------------------------
    case "CONFIRM_BLANK_NAME": {
      // 기록·확정 요청을 모두 보내지 않고 이름 입력 안내만 표시한다(요구사항 7.6).
      return { ...state, notice: BLANK_NAME_MESSAGE };
    }
    case "CONFIRM_RECORD_RESULT": {
      const result = /** @type {"success" | RecordRejection} */ (/** @type {any} */ (action).result);
      if (result === "success") {
        // 선행 기록 성공 → 부수효과 계층이 이어서 확정을 전송한다(요구사항 7.2).
        return { ...state, record: AreaPhase.LOADED, errorKind: null };
      }
      if (result === RecordRejection.ALREADY_CONFIRMED) {
        // 확정 미전송 + Confirmed_State 표시(요구사항 7.4).
        return {
          ...state,
          record: AreaPhase.LOADED,
          errorKind: null,
          notice: RECORD_REJECTION_MESSAGES.ALREADY_CONFIRMED,
          confirmed: true,
        };
      }
      // NAME_TAKEN/INVALID_ATTRIBUTES 및 기타 거부 → 확정 미전송 + 메시지 + 입력 보존(요구사항 7.3).
      const rejection = RECORD_REJECTION_MESSAGES[result] ? result : RecordRejection.OTHER;
      return {
        ...state,
        record: AreaPhase.LOADED,
        errorKind: null,
        notice: RECORD_REJECTION_MESSAGES[rejection],
      };
    }

    // -- 확정 결과 (요구사항 7.5, 7.7) ---------------------------------------
    case "CONFIRM_RESULT": {
      const result = /** @type {"success" | "NO_CHARACTER" | "CARD_TAKEN"} */ (/** @type {any} */ (action).result);
      if (result === "success") {
        // Confirmed_State로 전이(요구사항 7.7).
        return {
          ...state,
          confirm: AreaPhase.LOADED,
          confirmed: true,
          errorKind: null,
          notice: CONFIRMED_MESSAGE,
        };
      }
      // CARD_TAKEN → 선택한 역할 카드를 다른 플레이어가 점유함. 비확정 유지 + 입력 보존 +
      // CARD_TAKEN 안내(ERROR 유형). NO_CHARACTER와 동일하게 confirmed는 불변. (scenario-character-cards)
      if (result === RecordRejection.CARD_TAKEN) {
        return {
          ...state,
          confirm: AreaPhase.LOADED,
          errorKind: null,
          notice: RECORD_REJECTION_MESSAGES.CARD_TAKEN,
        };
      }
      // NO_CHARACTER → confirmed 불변 + 안내 + 입력 보존(요구사항 7.5).
      return {
        ...state,
        confirm: AreaPhase.LOADED,
        errorKind: null,
        notice: NO_CHARACTER_MESSAGE,
      };
    }
    case "CONFIRM_FAILED": {
      return applyTransmissionFailure(
        state,
        "confirm",
        /** @type {ErrorKind} */ (/** @type {any} */ (action).kind),
        LastRequest.CONFIRM
      );
    }

    // -- Next_Screen 인계(1회) (요구사항 8.3, 8.4) ---------------------------
    case "NEXT_HANDOFF": {
      // confirmed이고 아직 인계하지 않았을 때만 1회 인계 표시(요구사항 8.3). 그 외 무변화(8.4).
      if (state.confirmed === true && state.nextHandoffDone === false) {
        return { ...state, nextHandoffDone: true };
      }
      return state;
    }

    // -- DICE_ROLL 서버 측 굴림 결과 (요구사항 5.7, 5.8, 10.2) ----------------
    // 굴림 성공 응답: validateRollResponse로 검증해 유효할 때만 Trait_Level을 적용한다.
    // forcedRandom 여부에 따른 후속 편집 잠금은 computeVisibility/allocationEditModel이 도출한다.
    case "ROLL_SUCCEEDED": {
      // 확정 상태에서는 모드와 무관하게 모든 Trait_Level을 변경하지 않는다(잠금 보존). (요구사항 10.2)
      if (state.confirmed === true) return state;
      const body = /** @type {any} */ (action).body;
      const validated = validateRollResponse(body, state.activeSchema);
      if (validated.ok) {
        // 유효 응답이면 모든 Rated_Trait의 Trait_Level을 굴림 값으로 적용한다.
        return {
          ...state,
          traitValues: {
            ...state.traitValues,
            .../** @type {{ ok: true, values: RatedTraitSet }} */ (validated).values,
          },
          errorKind: null,
          notice: null,
        };
      }
      // 누락·비정수 응답이면 적용하지 않고 기존 Trait_Level을 유지하며 한국어 안내를 표시한다. (요구사항 5.8)
      return { ...state, notice: ROLL_INVALID_RESPONSE_MESSAGE };
    }
    // 굴림 성공 응답이지만 본문이 무효(누락·비정수)임을 부수효과 계층이 직접 분류한 경우. (요구사항 5.8)
    case "ROLL_INVALID_RESPONSE": {
      // 모든 기존 Trait_Level을 변경 없이 유지하고 한국어 안내만 설정한다.
      return { ...state, notice: ROLL_INVALID_RESPONSE_MESSAGE };
    }
    // 굴림 요청이 타임아웃·네트워크·서버 오류로 종료된 경우. (요구사항 5.7)
    case "ROLL_FAILED": {
      // 무작위를 클라이언트에서 만들지 않으며, 모든 기존 Trait_Level을 변경 없이 유지하고 안내만 설정한다.
      return { ...state, notice: ROLL_FAILED_MESSAGE };
    }

    default:
      return state;
  }
}

/**
 * 보존된 입력으로 직전 실패 요청 명세를 1회 재구성한다.
 *
 * `state.lastRequest`(요구사항 10.6 재시도 대상)가 가리키는 직전 실패 요청을, 어떤 오류로도
 * 변하지 않은 보존 입력(인계 식별자·토큰, narrativeValues, traitValues, Active_Sheet_Schema)으로
 * 그대로 다시 `build*Request`에 넣어 동일 요청 명세를 1회 재구성한다(요구사항 10.5, 10.6).
 *
 * - `schema`   → `buildSchemaRequest(roomId, token)`
 * - `proposal` → `buildProposalRequest(roomId, playerId, concept, traitKeys, token)`
 *                컨셉은 보존된 `narrativeValues.concept`, Trait_Key 목록은 Active_Sheet_Schema의
 *                `renderedTraitKeys`에서 도출한다.
 * - `record`   → `buildRecordRequest(handoff, name, narrative, ratedTraitSet)`
 *                이름은 보존된 `narrativeValues.name`, 서사 맵은 `narrativeValues` 전체,
 *                Rated_Trait_Set은 `collectRatedTraitSet`로 모은다.
 * - `confirm`  → `buildConfirmRequest(handoff)`
 *
 * `lastRequest`가 `null`(재시도할 직전 실패 요청 없음)이면 `null`을 반환한다.
 * @param {CharacterSheetState} state
 * @returns {{ url: string, method: string, headers: Record<string, string>, body?: string } | null}
 */
export function nextRequestForRetry(state) {
  if (!state || state.lastRequest == null) return null;

  const handoff = state.handoff || { roomId: "", playerId: "", token: "" };
  const narrativeValues = state.narrativeValues || {};

  switch (state.lastRequest) {
    case LastRequest.SCHEMA:
      return buildSchemaRequest(handoff.roomId, handoff.token);

    case LastRequest.PROPOSAL:
      return buildProposalRequest(
        handoff.roomId,
        handoff.playerId,
        toStringSafe(narrativeValues.concept),
        renderedTraitKeys(state.activeSchema),
        handoff.token
      );

    case LastRequest.RECORD:
      return buildRecordRequest(
        handoff,
        toStringSafe(narrativeValues.name),
        narrativeValues,
        collectRatedTraitSet(state.traitValues, state.activeSchema),
        // 카드 기반 시트의 Selected_Card Card_Id를 재시도 요청에도 보존해 포함한다(없으면 생략). (요구사항 4.5)
        typeof state.selectedCardId === "string" ? state.selectedCardId : undefined
      );

    case LastRequest.CONFIRM:
      return buildConfirmRequest(handoff);

    default:
      return null;
  }
}

// -- 뷰 모델 가시성 (작업 6.1) ----------------------------------------------

/**
 * 상태로부터 뷰 가시성 플래그를 도출한다. 모든 가시성은 상태의 함수다(단일 진실 원천).
 *
 * 규칙:
 * - 인계가 무효이면 모든 작성 컨트롤(Narrative_Field 입력·Rated_Trait 편집)과
 *   Propose/Save/Confirm 동작을 비활성으로 둔다(요구사항 1.4).
 * - 인계가 유효하고 캐릭터가 비확정이면 작성 컨트롤을 활성으로 둔다(요구사항 2.4, 5.3).
 * - 각 요청 영역(schema/proposal/record/confirm)이 `loading`이면 그 진행 인디케이터를
 *   표시하고(요구사항 9.1, 13.9), 어느 요청이라도 진행 중이면 Propose/Save/Confirm을
 *   비활성으로 유지해 중복·동시 요청을 막는다(요구사항 9.3). 모든 요청이 진행을 벗어나면
 *   동작을 재활성화한다(요구사항 9.4).
 * - 확정 성공 시 잠금 규칙이 우선한다: `confirmed === true`이면 작성 컨트롤·Propose·Save·
 *   Confirm을 비활성(읽기 전용)으로 두고 확정 값을 읽기 전용으로 표시한다(요구사항 7.7, 7.8, 9.4).
 * - proposal/record/confirm 중 하나라도 오류로 종료되면(복구 가능 전송 오류) 동일 입력
 *   재시도 동작을 활성화한다(요구사항 10.4).
 * - Next_Screen 진입 동작은 `confirmed === true`일 때만 활성화하며, 1회 인계 후에는
 *   비활성으로 둔다(요구사항 8.1, 8.3, 8.4).
 *
 * @param {CharacterSheetState} state
 * @returns {{
 *   handoffValid: boolean,
 *   confirmed: boolean,
 *   readonly: boolean,
 *   narrativeInputsEnabled: boolean,
 *   traitEditEnabled: boolean,
 *   authoringDisabled: boolean,
 *   schemaLoading: boolean,
 *   proposalLoading: boolean,
 *   recordLoading: boolean,
 *   confirmLoading: boolean,
 *   anyRequestLoading: boolean,
 *   proposeEnabled: boolean,
 *   saveEnabled: boolean,
 *   confirmEnabled: boolean,
 *   retryEnabled: boolean,
 *   nextEnabled: boolean
 * }}
 */
// [flexible-stat-allocation 확장 대상 · 작업 8.2] 모드별 읽기 전용 도출을 추가한다: Confirmed_State는 모드 무관
// 잠금, DICE_ROLL Forced_Random=true는 비확정이라도 읽기 전용. (요구사항 5.5, 5.6, 10.1, 10.2)
// [scenario-character-cards 확장 대상 · 작업 7.1] proposeVisible(attributeProposalSupported 거짓이면 숨김)·
// statSectionVisible(Rated_Trait_Count 0이면 숨김)·cardSelectionEnabled(Confirmed_State이면 읽기 전용)를
// 도출에 추가한다. (요구사항 2.1, 2.3, 2.5, 2.6, 8.1)
export function computeVisibility(state) {
  const handoffValid = !!(state && state.handoffValid);
  const confirmed = !!(state && state.confirmed);

  // scenario-character-cards: Active_Sheet_Schema에서 능력치 제안 지원 여부·Rated_Trait_Count를 읽는다.
  const activeSchema = state && state.activeSchema ? state.activeSchema : {};
  const ratedTraitCount = Array.isArray(activeSchema.traits) ? activeSchema.traits.length : 0;
  // attributeProposalSupported가 불리언이면 그 값을, 없으면(구버전 상태) traits.length > 0으로 도출한다. (요구사항 7.4)
  const attributeProposalSupported =
    typeof activeSchema.attributeProposalSupported === "boolean"
      ? activeSchema.attributeProposalSupported
      : ratedTraitCount > 0;

  // flexible-stat-allocation: Active_Sheet_Schema에 실린 Allocation_Rule(모드·forcedRandom)을 읽는다.
  // 상태에 규칙이 없으면(기존 character-sheet 흐름) LADDER_SELECT로 취급해 기존 동작을 보존한다.
  const allocation =
    state && state.activeSchema && state.activeSchema.allocation
      ? state.activeSchema.allocation
      : { mode: "LADDER_SELECT" };
  const mode = allocation.mode || "LADDER_SELECT";
  // DICE_ROLL이고 forcedRandom이 참이면 비확정이라도 모든 평가 편집 요소가 읽기 전용. (요구사항 5.5)
  const forcedRandomLock = mode === "DICE_ROLL" && allocation.forcedRandom === true;

  // 영역별 진행 인디케이터(요구사항 9.1, 13.9).
  const schemaLoading = !!(state && state.schemaArea === AreaPhase.LOADING);
  const proposalLoading = !!(state && state.proposal === AreaPhase.LOADING);
  const recordLoading = !!(state && state.record === AreaPhase.LOADING);
  const confirmLoading = !!(state && state.confirm === AreaPhase.LOADING);
  // 어느 요청이라도 진행 중이면 동작을 비활성으로 유지한다(요구사항 9.3).
  const anyRequestLoading =
    schemaLoading || proposalLoading || recordLoading || confirmLoading;

  // 작성 컨트롤: 인계 유효 && 비확정일 때만 활성(요구사항 1.4, 2.4, 5.3, 7.7).
  const authoringEnabled = handoffValid && !confirmed;
  // 동작(Propose/Save/Confirm): 작성 가능 && 진행 중 아님(요구사항 9.3, 9.4). 확정 시 잠금 우선.
  const actionsEnabled = authoringEnabled && !anyRequestLoading;
  // 평가 편집 요소 활성: 작성 가능 && forcedRandom 잠금 아님. (요구사항 5.5, 5.6, 10.1)
  // LADDER_SELECT/POINT_BUY/FIXED_VALUE/DICE_ROLL(forcedRandom=false)는 forcedRandomLock=false이므로 기존과 동일.
  const traitEditEnabled = authoringEnabled && !forcedRandomLock;
  // 모드와 무관하게 확정 상태이거나 forcedRandom 잠금이면 모든 평가 편집 요소가 읽기 전용. (요구사항 5.5, 10.1)
  const traitsReadonly = confirmed || forcedRandomLock;
  // Dice_Roll_Action: DICE_ROLL 모드에서만, 비확정 && 진행 중 아님일 때 활성. 확정 시 읽기 전용. (요구사항 5.5, 10.1)
  const rollActionEnabled =
    mode === "DICE_ROLL" && handoffValid && !confirmed && !anyRequestLoading;

  // 복구 가능 전송 오류(proposal/record/confirm가 error)면 동일 입력 재시도 활성(요구사항 10.4).
  const hasRecoverableError = !!(
    state &&
    (state.proposal === AreaPhase.ERROR ||
      state.record === AreaPhase.ERROR ||
      state.confirm === AreaPhase.ERROR)
  );

  return {
    handoffValid,
    confirmed,
    // 확정 시 확정 값을 읽기 전용으로 표시한다(요구사항 7.8).
    readonly: confirmed,
    // 작성 컨트롤 활성/비활성(요구사항 1.4, 2.4, 5.3, 7.7).
    narrativeInputsEnabled: authoringEnabled,
    traitEditEnabled,
    authoringDisabled: !authoringEnabled,
    // flexible-stat-allocation 추가(ADDITIVE) 가시성 플래그:
    // 모드와 무관한 평가 편집 읽기 전용 여부(확정 또는 DICE_ROLL forcedRandom). (요구사항 5.5, 10.1)
    traitsReadonly,
    // Dice_Roll_Action 활성 여부(DICE_ROLL 모드, 비확정, 진행 중 아님). (요구사항 5.5, 10.1)
    rollActionEnabled,
    // Dice_Roll_Action 읽기 전용 여부(확정 시 잠금). (요구사항 10.1)
    rollActionReadonly: confirmed,
    // 영역별 진행 인디케이터(요구사항 9.1, 13.9).
    schemaLoading,
    proposalLoading,
    recordLoading,
    confirmLoading,
    anyRequestLoading,
    // 동작 활성(요구사항 9.3, 9.4) — 확정 성공 시 잠금 규칙이 우선해 비활성 유지.
    // scenario-character-cards: attributeProposalSupported가 거짓이면 Propose_Action을 표시하지 않으므로
    // proposeEnabled도 거짓으로 강제한다. 참이면 기존 활성 규칙(인계 유효·비확정·진행 중 아님)과 일치. (요구사항 2.1, 2.5)
    proposeVisible: attributeProposalSupported,
    proposeEnabled: attributeProposalSupported && actionsEnabled,
    // scenario-character-cards: Stat_Setting_Section은 Rated_Trait_Count가 0이면 표시하지 않는다. (요구사항 2.3, 2.6)
    statSectionVisible: ratedTraitCount >= 1,
    // scenario-character-cards: Card_Selection_Action은 인계 유효·비확정일 때만 동작 가능(확정 시 읽기 전용). (요구사항 8.1)
    cardSelectionEnabled: handoffValid && !confirmed,
    saveEnabled: actionsEnabled,
    confirmEnabled: actionsEnabled,
    // 동일 입력 재시도 동작(요구사항 10.4) — 진행 중에는 비활성.
    retryEnabled: handoffValid && hasRecoverableError && !anyRequestLoading,
    // Next_Screen 진입: 확정 && 아직 인계 전일 때만 활성(요구사항 8.1, 8.3, 8.4).
    nextEnabled: confirmed && !(state && state.nextHandoffDone),
  };
}

// ---------------------------------------------------------------------------
// 준비 현황 · 호스트 세션 시작 순수 헬퍼 (Readiness / Host-Start Pure Helpers)
// ---------------------------------------------------------------------------
//
// 멀티플레이어 흐름: 모두 캐릭터 시트에 도착하면 화면은 준비(확정) 인원을 표시하고,
// 호스트는 모두 확정됐을 때만 "세션 시작" 버튼을 활성화한다. 세션이 시작되면 모든
// 플레이어가 게임 화면으로 이동한다. 아래 함수들은 부수효과 없는 순수 함수이며, 기존
// build* 헬퍼·trim 규칙을 재사용한다. 폴링·DOM 갱신·네비게이션은 index.html이 담당한다.

/**
 * 준비 현황 정규화 형태.
 * @typedef {Object} Readiness
 * @property {number} total         방의 전체 플레이어 수(>=0 정수)
 * @property {number} confirmed     캐릭터를 확정한 플레이어 수(>=0 정수)
 * @property {boolean} allConfirmed 전원 확정 여부
 * @property {boolean} started      세션 시작 여부
 * @property {string} hostPlayerId  호스트 플레이어 식별자(없으면 "")
 * @property {boolean} returnToLobby 호스트가 전원을 로비(메인)로 되돌리도록 요청했는지 여부
 */

/**
 * 임의 값을 0 이상의 정수로 안전하게 강제한다.
 *
 * 숫자/숫자 문자열이면 내림(버림)하여 정수로 만들고 음수는 0으로 절단한다. 숫자가 아니거나
 * NaN/Infinity면 0으로 환원한다(렌더는 실패하지 않는다).
 * @param {unknown} value
 * @returns {number}
 */
function toNonNegativeInt(value) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  const floored = Math.floor(num);
  return floored < 0 ? 0 : floored;
}

/**
 * `GET /rooms/{encodeURIComponent(roomId)}/readiness` 요청 명세를 구성한다.
 *
 * 토큰이 있으면 `x-playtest-token` 헤더를 포함한다(buildAuthHeaders 재사용). null-safe하며
 * handoff가 없거나 roomId가 비어 있어도 안전하게 빈 문자열로 정규화한다.
 * @param {Handoff} handoff
 * @returns {{ url: string, method: string, headers: Record<string, string> }}
 */
export function buildReadinessRequest(handoff) {
  const safeHandoff = handoff || { roomId: "", playerId: "", token: "" };
  return {
    url: "/rooms/" + encodeURIComponent(toStringSafe(safeHandoff.roomId)) + "/readiness",
    method: "GET",
    headers: buildAuthHeaders(safeHandoff.token),
  };
}

/**
 * `POST /rooms/{enc(roomId)}/players/{enc(playerId)}/start` 요청 명세를 구성한다.
 *
 * 호스트가 세션을 시작할 때 전송한다. content-type 헤더와(토큰이 있으면) 인증 헤더를 갖고,
 * 본문은 빈 객체를 JSON 직렬화한다. null-safe.
 * @param {Handoff} handoff
 * @returns {{ url: string, method: string, headers: Record<string, string>, body: string }}
 */
export function buildStartRequest(handoff) {
  const safeHandoff = handoff || { roomId: "", playerId: "", token: "" };
  /** @type {Record<string, string>} */
  const headers = {
    "content-type": "application/json",
    ...buildAuthHeaders(safeHandoff.token),
    // player-acting 엔드포인트는 연결 티켓으로 신원을 검증한다(authorizePlayerAction).
    ...buildTicketHeaders(safeHandoff.ticket),
  };
  return {
    url:
      "/rooms/" +
      encodeURIComponent(toStringSafe(safeHandoff.roomId)) +
      "/players/" +
      encodeURIComponent(toStringSafe(safeHandoff.playerId)) +
      "/start",
    method: "POST",
    headers,
    body: JSON.stringify({}),
  };
}

/**
 * 준비 현황 응답 본문을 안전 기본값으로 정규화한다.
 *
 * `total`·`confirmed`는 0 이상의 정수로 강제하고, `allConfirmed`·`started`는 엄격히 `true`일
 * 때만 true로(그 외는 false), `hostPlayerId`는 비어 있지 않은 문자열일 때만 그대로 두고
 * 아니면 ""로 둔다. 본문이 객체가 아니면 모든 필드를 기본값으로 채운다(null-safe).
 * @param {unknown} body
 * @returns {Readiness}
 */
export function parseReadiness(body) {
  const b = body && typeof body === "object" ? /** @type {any} */ (body) : {};
  return {
    total: toNonNegativeInt(b.total),
    confirmed: toNonNegativeInt(b.confirmed),
    allConfirmed: b.allConfirmed === true,
    started: b.started === true,
    hostPlayerId: isNonEmptyString(b.hostPlayerId) ? b.hostPlayerId : "",
    // 호스트가 "메인으로 돌아가기"를 눌러 전원을 로비로 되돌리도록 요청했는지(폴링으로 전파).
    returnToLobby: b.returnToLobby === true,
  };
}

/**
 * `POST /rooms/{enc(roomId)}/players/{enc(playerId)}/return-to-lobby` 요청 명세를 구성한다.
 *
 * 호스트가 "메인으로 돌아가기"를 누르면 전송한다. 서버는 방에 "로비 복귀" 플래그를 세워
 * readiness 응답에 실어 주고, 캐릭터 화면에 있는 모든 플레이어가 폴링으로 이를 보고 로비로
 * 함께 이동한다. content-type 헤더 + (토큰이 있으면) 인증 헤더, 본문은 빈 객체. null-safe.
 * @param {Handoff} handoff
 * @returns {{ url: string, method: string, headers: Record<string, string>, body: string }}
 */
export function buildReturnToLobbyRequest(handoff) {
  const safeHandoff = handoff || { roomId: "", playerId: "", token: "" };
  /** @type {Record<string, string>} */
  const headers = {
    "content-type": "application/json",
    ...buildAuthHeaders(safeHandoff.token),
    // player-acting 엔드포인트는 연결 티켓으로 신원을 검증한다(authorizePlayerAction).
    ...buildTicketHeaders(safeHandoff.ticket),
  };
  return {
    url:
      "/rooms/" +
      encodeURIComponent(toStringSafe(safeHandoff.roomId)) +
      "/players/" +
      encodeURIComponent(toStringSafe(safeHandoff.playerId)) +
      "/return-to-lobby",
    method: "POST",
    headers,
    body: JSON.stringify({}),
  };
}

/**
 * 현재 뷰어(플레이어)가 방의 호스트인지 판정한다.
 *
 * `handoff.playerId`가 비어 있지 않고, readiness가 존재하며, `handoff.playerId`가
 * `readiness.hostPlayerId`와 정확히 일치할 때만 true. (null-safe)
 * @param {Handoff} handoff
 * @param {Readiness | null | undefined} readiness
 * @returns {boolean}
 */
export function isHostViewer(handoff, readiness) {
  if (!handoff || !readiness) return false;
  const playerId = toStringSafe(handoff.playerId);
  if (!isNonEmptyString(playerId)) return false;
  return playerId === readiness.hostPlayerId;
}

/**
 * 호스트의 "세션 시작" 버튼을 활성화할지 판정한다.
 *
 * readiness가 존재하고, 전원 확정(`allConfirmed === true`)이며, 아직 시작되지 않았을
 * (`started === false`) 때만 true. (null-safe)
 * @param {Readiness | null | undefined} readiness
 * @returns {boolean}
 */
export function hostStartEnabled(readiness) {
  return !!readiness && readiness.allConfirmed === true && readiness.started === false;
}

/**
 * 준비 현황을 한국어 표시 문자열로 만든다(예: `"준비 2 / 3"`).
 *
 * `confirmed`·`total`을 사용하며 readiness가 없으면 `"준비 0 / 0"`을 반환한다(null-safe).
 * @param {Readiness | null | undefined} readiness
 * @returns {string}
 */
export function formatReadiness(readiness) {
  const confirmed = readiness ? toNonNegativeInt(readiness.confirmed) : 0;
  const total = readiness ? toNonNegativeInt(readiness.total) : 0;
  return "준비 " + confirmed + " / " + total;
}

// ===========================================================================
// 유연한 능력치 배분 (flexible-stat-allocation) — 작업 1.2 스캐폴드
// ===========================================================================
//
// 이 영역은 캐릭터 시트 능력치 배분을, 시트 스키마(Active_Sheet_Schema)에 정확히 하나의
// 교체 가능한 Allocation_Rule을 싣는 단일 소켓(single pluggable structure) 구조로 일반화하는
// flexible-stat-allocation 스펙의 프론트엔드 순수 로직을 담는다.
//
// 본 작업(1.2)은 스캐폴드다: 타입 주석(JSDoc)과, 이후 단계(3.1·4.1·7.1·7.3·7.5·8.2·9.x)에서
// 채울 순수 함수 export 스텁만 선언한다. 스텁은 호출되기 전까지 던지지 않으므로 모듈은
// 부작용 없이 import 가능하다(기존 동작·기존 export 보존).
//
// 설계 문서: .kiro/specs/flexible-stat-allocation/design.md (Data Models · Components)

// ---------------------------------------------------------------------------
// 타입 주석 (JSDoc Typedefs)
// ---------------------------------------------------------------------------

/**
 * 한 Allocation_Rule의 종류. 정확히 네 가지 중 하나다.
 * @typedef {"LADDER_SELECT" | "POINT_BUY" | "FIXED_VALUE" | "DICE_ROLL"} AllocationMode
 * - LADDER_SELECT: 각 Rated_Trait를 자기 Trait_Ladder 안에서 독립적으로 고른다(기존 동작 보존, 요구사항 1·2).
 * - POINT_BUY: 모든 항목이 Base_Level에서 시작하고 Point_Pool만큼 올려 배분(총합 강제, 요구사항 3).
 * - FIXED_VALUE: 정해진 값 한 벌(Value_Pool)을 각 항목에 일대일 배정(요구사항 4).
 * - DICE_ROLL: 주사위 식(Dice_Formula)을 서버 측에서 굴려 각 항목 값을 정한다(요구사항 5).
 */

/**
 * LADDER_SELECT 규칙. 추가 매개변수 없음(기존 사다리 선택 동작 보존). (요구사항 1·2)
 * @typedef {Object} LadderSelectRule
 * @property {"LADDER_SELECT"} mode
 */

/**
 * POINT_BUY 규칙. (요구사항 3.1)
 * @typedef {Object} PointBuyRule
 * @property {"POINT_BUY"} mode
 * @property {number} baseLevel  모든 Trait_Ladder 안의 정수 시작값(Base_Level)
 * @property {number} pointPool  0 이상이며 Σ(ladder.max − baseLevel) 이하인 정수(Point_Pool)
 */

/**
 * FIXED_VALUE 규칙. (요구사항 4.1)
 * @typedef {Object} FixedValueRule
 * @property {"FIXED_VALUE"} mode
 * @property {number[]} valuePool  정수 다중집합(Value_Pool). 원소 개수 = Rated_Trait 개수(≥1).
 */

/**
 * DICE_ROLL 규칙. (요구사항 5.1)
 * @typedef {Object} DiceRollRule
 * @property {"DICE_ROLL"} mode
 * @property {string} diceFormula    "3d6"·"2d6+1" 등(Dice_Formula).
 * @property {boolean} forcedRandom  굴림 결과 편집 불가 여부(Forced_Random). 미제공 시 false.
 */

/**
 * 한 Active_Sheet_Schema에 실리는 교체 가능한 배분 규칙(판별 유니온). 정확히 하나의 Allocation_Mode를 갖는다.
 * @typedef {LadderSelectRule | PointBuyRule | FixedValueRule | DiceRollRule} AllocationRule
 */

/**
 * 능력치 한 벌: 각 Trait_Key에 하나의 정수 Trait_Level을 부여한 맵.
 * @typedef {Record<string, number>} RatedTraitSet
 */

/**
 * 배분 검증 결과. 사다리 경계 위반은 INVALID_ATTRIBUTES, 배분 제약 위반(+FIXED_VALUE 전체)은 INVALID_ALLOCATION.
 * (요구사항 9.3, 8.3; 설계 "요구사항 정합성 메모 1")
 * @typedef {{ ok: true } | { ok: false, reason: "INVALID_ATTRIBUTES" | "INVALID_ALLOCATION" }} AllocationValidation
 */

/**
 * 파싱된 Dice_Formula. `NdM` 또는 `NdM±K`. (요구사항 5.1, 5.3)
 * @typedef {Object} ParsedDiceFormula
 * @property {number} count     주사위 개수 N(≥1)
 * @property {number} sides     면 수 M(≥1)
 * @property {number} modifier  고정 보정 ±K(없으면 0)
 */

// ---------------------------------------------------------------------------
// 순수 함수 스텁 (Pure Function Stubs) — 이후 작업에서 구현
// ---------------------------------------------------------------------------
//
// 아래 함수들은 flexible-stat-allocation 작업 7~10에서 모두 구현되었다. 모듈 import 자체에는
// 부작용이 없다(순수 함수). 각 함수 위 주석에 구현 작업 번호와 검증 요구사항을 표기한다.

/**
 * [작업 4.1] Allocation_Rule로 한 Rated_Trait_Set의 유효성을 판정한다(Frontend_Allocation_Validator).
 *
 * 공통 선행 키 집합 검사(모든 Trait_Key 정확히 하나, 정의되지 않은 키 없음; 위반 시 INVALID_ATTRIBUTES;
 * 0개 항목 스키마는 항상 유효) 후 모드별 판정을 디스패치한다. (요구사항 2·3·4·5, 9.3)
 * @param {AllocationRule} rule
 * @param {SheetSchema} schema
 * @param {RatedTraitSet} ratedTraitSet
 * @returns {AllocationValidation}
 */
export function validateAllocation(rule, schema, ratedTraitSet) {
  const traits = schema && Array.isArray(schema.traits) ? schema.traits : [];
  const set = ratedTraitSet && typeof ratedTraitSet === "object" ? ratedTraitSet : {};

  // 공통 선행 검사(키 집합): 0개 항목 스키마(서사 전용)는 항상 유효(검증 미적용). (요구사항 8.6)
  if (traits.length === 0) return { ok: true };

  // 스키마가 정의한 모든 Trait_Key가 정확히 하나씩 존재하고, 정의되지 않은 Trait_Key가 없어야 한다.
  // 위반 시 INVALID_ATTRIBUTES. (요구사항 2.4)
  const schemaKeys = traits.map((t) => t && t.key);
  for (const key of schemaKeys) {
    if (!Object.prototype.hasOwnProperty.call(set, key)) {
      return { ok: false, reason: RecordRejection.INVALID_ATTRIBUTES };
    }
  }
  const schemaKeySet = new Set(schemaKeys);
  for (const key of Object.keys(set)) {
    if (!schemaKeySet.has(key)) {
      return { ok: false, reason: RecordRejection.INVALID_ATTRIBUTES };
    }
  }

  const mode = rule && rule.mode;

  switch (mode) {
    case "POINT_BUY": {
      // 1단계 사다리 경계: 각 Trait_Level이 baseLevel 이상이며 자신의 Trait_Ladder 안의 정수.
      // 위반 시 합과 무관하게 INVALID_ATTRIBUTES. (요구사항 3.4, 8.2, 9.3)
      const baseLevel = rule.baseLevel;
      for (const trait of traits) {
        const level = set[trait.key];
        if (!withinLadder(level, trait.ladder) || level < baseLevel) {
          return { ok: false, reason: RecordRejection.INVALID_ATTRIBUTES };
        }
      }
      // 2단계 배분 제약: Σ(level − baseLevel) === pointPool. 위반 시 INVALID_ALLOCATION. (요구사항 3.3, 8.3)
      if (pointBuySpent(set, baseLevel) !== rule.pointPool) {
        return { ok: false, reason: RecordRejection.INVALID_ALLOCATION };
      }
      return { ok: true };
    }

    case "FIXED_VALUE": {
      // 특수 우선 결정: 다중집합 불일치든 사다리 밖/비정수든 어떤 위반이라도 INVALID_ALLOCATION.
      // (요구사항 4.2, 4.3, 4.4; 설계 "요구사항 정합성 메모 1")
      for (const trait of traits) {
        if (!withinLadder(set[trait.key], trait.ladder)) {
          return { ok: false, reason: RecordRejection.INVALID_ALLOCATION };
        }
      }
      const levels = traits.map((t) => set[t.key]);
      if (!multisetEqual(levels, rule.valuePool)) {
        return { ok: false, reason: RecordRejection.INVALID_ALLOCATION };
      }
      return { ok: true };
    }

    // LADDER_SELECT·DICE_ROLL: 각 Trait_Level이 자기 사다리 안 정수일 때만 유효, 항목 간 제약 없음.
    // 위반 시 INVALID_ATTRIBUTES. (요구사항 2.1~2.3, 5.4, 9.3)
    case "LADDER_SELECT":
    case "DICE_ROLL":
    default: {
      for (const trait of traits) {
        if (!withinLadder(set[trait.key], trait.ladder)) {
          return { ok: false, reason: RecordRejection.INVALID_ATTRIBUTES };
        }
      }
      return { ok: true };
    }
  }
}

/**
 * [작업 4.1] POINT_BUY에서 소비한 점수 합 Σ(Trait_Level − baseLevel)을 계산한다(모든 Rated_Trait 합).
 * @param {RatedTraitSet} set
 * @param {number} baseLevel
 * @returns {number}
 */
export function pointBuySpent(set, baseLevel) {
  const safe = set && typeof set === "object" ? set : {};
  let spent = 0;
  for (const key of Object.keys(safe)) {
    spent += safe[key] - baseLevel;
  }
  return spent;
}

/**
 * [작업 4.1] 두 정수 배열이 다중집합(원소·개수)으로 정확히 일치하는지 판정한다.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {boolean}
 */
export function multisetEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sortedA = a.slice().sort((x, y) => x - y);
  const sortedB = b.slice().sort((x, y) => x - y);
  for (let i = 0; i < sortedA.length; i += 1) {
    if (sortedA[i] !== sortedB[i]) return false;
  }
  return true;
}

/**
 * [작업 4.1] level이 ladder 안의 정수인지 판정한다(기존 isValidLevel 재사용).
 * @param {number} level
 * @param {TraitLadder} ladder
 * @returns {boolean}
 */
export function withinLadder(level, ladder) {
  return isValidLevel(level, ladder);
}

/**
 * [작업 3.1] 스키마 응답의 Allocation_Rule 페이로드를 검증·정규화한다.
 *
 * 모드가 네 종류 중 하나이고 그 모드의 필수 매개변수를 모두 갖출 때에만 유효로 인정한다
 * (POINT_BUY: 정수 baseLevel + 0 이상 정수 pointPool; FIXED_VALUE: 정수 원소·개수 = Rated_Trait
 * 개수인 valuePool; DICE_ROLL: 공백 제거 시 1자 이상 diceFormula + 불리언 forcedRandom). (요구사항 7.1)
 * @param {unknown} raw
 * @param {RatedTrait[]} traits
 * @returns {{ ok: true, rule: AllocationRule } | { ok: false }}
 */
export function validateAllocationRule(raw, traits) {
  if (!raw || typeof raw !== "object") return { ok: false };
  const rule = /** @type {any} */ (raw);
  const mode = rule.mode;
  const traitCount = Array.isArray(traits) ? traits.length : 0;

  switch (mode) {
    case "LADDER_SELECT":
      // 추가 매개변수 없음. 모드만 맞으면 유효하다. (요구사항 7.1)
      return { ok: true, rule: { mode: "LADDER_SELECT" } };

    case "POINT_BUY": {
      // 정수 baseLevel + 0 이상 정수 pointPool. (요구사항 7.1)
      if (!Number.isInteger(rule.baseLevel)) return { ok: false };
      if (!Number.isInteger(rule.pointPool) || rule.pointPool < 0) return { ok: false };
      return {
        ok: true,
        rule: { mode: "POINT_BUY", baseLevel: rule.baseLevel, pointPool: rule.pointPool },
      };
    }

    case "FIXED_VALUE": {
      // 모든 원소가 정수이고 원소 개수가 Rated_Trait 개수와 정확히 같은 valuePool. (요구사항 7.1)
      if (!Array.isArray(rule.valuePool)) return { ok: false };
      if (rule.valuePool.length !== traitCount) return { ok: false };
      if (!rule.valuePool.every((v) => Number.isInteger(v))) return { ok: false };
      return { ok: true, rule: { mode: "FIXED_VALUE", valuePool: rule.valuePool.slice() } };
    }

    case "DICE_ROLL": {
      // 공백을 제거하면 1자 이상인 diceFormula + 불리언 forcedRandom. (요구사항 7.1)
      if (!isNonEmptyString(rule.diceFormula) || rule.diceFormula.trim().length < 1) {
        return { ok: false };
      }
      if (typeof rule.forcedRandom !== "boolean") return { ok: false };
      return {
        ok: true,
        rule: {
          mode: "DICE_ROLL",
          diceFormula: rule.diceFormula,
          forcedRandom: rule.forcedRandom,
        },
      };
    }

    default:
      // 모드가 네 종류 중 어느 것과도 일치하지 않으면 무효. (요구사항 7.1)
      return { ok: false };
  }
}

/**
 * [작업 7.1] 모드별 정준(canonical) 유효 시작 집합(Initial_Allocation)을 계산한다.
 *
 * LADDER_SELECT·DICE_ROLL은 각 항목 initialLevel(ladder), POINT_BUY는 Base_Level에서 시작해 스키마
 * 순서대로 사다리 max까지 올려 pointPool을 결정적으로 모두 소비, FIXED_VALUE는 valuePool 내림차순을
 * 스키마 순서에 큰 값부터 일대일 배정한 집합. (요구사항 4.6, 6.5)
 * @param {AllocationRule} rule
 * @param {SheetSchema} schema
 * @returns {RatedTraitSet}
 */
export function initialAllocation(rule, schema) {
  const traits = schema && Array.isArray(schema.traits) ? schema.traits : [];
  /** @type {RatedTraitSet} */
  const set = {};

  // 0개 항목(서사 전용) 스키마는 빈 집합이 항상 유효하다. (요구사항 1.6, 8.6)
  if (traits.length === 0) return set;

  const mode = rule && rule.mode;

  switch (mode) {
    case "POINT_BUY": {
      // 모든 항목을 Base_Level로 시작한 뒤, 스키마 정의 순서대로 각 항목을 사다리 max까지 올려
      // pointPool을 결정적으로 모두 소비한다. (3.1이 pointPool ≤ Σ(max − base)를 보장하므로 항상 구성 가능.)
      // 결과 집합은 Σ(level − baseLevel) === pointPool을 만족한다. (요구사항 6.5; 정합성 메모 2)
      const baseLevel = rule.baseLevel;
      let remaining = rule.pointPool;
      for (const trait of traits) {
        const capacity = trait.ladder.max - baseLevel;
        const add = Math.max(0, Math.min(capacity, remaining));
        set[trait.key] = baseLevel + add;
        remaining -= add;
      }
      return set;
    }

    case "FIXED_VALUE": {
      // valuePool을 내림차순으로 정렬해 스키마 정의 순서대로 큰 값부터 일대일 배정한다.
      // 결과 다중집합 = valuePool. (요구사항 4.6)
      const sorted = rule.valuePool.slice().sort((a, b) => b - a);
      traits.forEach((trait, i) => {
        set[trait.key] = sorted[i];
      });
      return set;
    }

    // LADDER_SELECT·DICE_ROLL: 각 항목 initialLevel(ladder)(굴림 전 표시값). 각 값이 사다리 안 정수이므로 유효.
    case "LADDER_SELECT":
    case "DICE_ROLL":
    default: {
      for (const trait of traits) {
        set[trait.key] = initialLevel(trait.ladder);
      }
      return set;
    }
  }
}

/**
 * [작업 7.3] POINT_BUY 남은 배분 점수를 계산한다: pointPool − Σ(Trait_Level − baseLevel). (요구사항 3.6)
 * @param {AllocationRule} rule
 * @param {RatedTraitSet} set
 * @returns {number}
 */
export function pointBuyRemaining(rule, set) {
  const baseLevel = rule && Number.isInteger(rule.baseLevel) ? rule.baseLevel : 0;
  const pointPool = rule && Number.isInteger(rule.pointPool) ? rule.pointPool : 0;
  // 남은 점수 = pointPool − Σ(Trait_Level − baseLevel)(set의 모든 항목 합). pointBuySpent를 재사용한다. (요구사항 3.6)
  return pointPool - pointBuySpent(set, baseLevel);
}

/**
 * [작업 7.5] FIXED_VALUE에서 한 Value_Pool 값 인스턴스를 대상 Rated_Trait에 일대일 배정한다.
 *
 * 상태 형태(Component 5): `{ assignments: Record<TraitKey, valueInstanceIndex>, valuePool: number[] }`.
 * `assignments`는 각 Rated_Trait의 Trait_Key를 그 항목에 배정된 Value_Pool 인스턴스 인덱스로 매핑하며,
 * 어떤 Trait_Key가 키로 존재하지 않으면 그 항목은 미배정 상태다.
 *
 * 동작: 대상 항목(traitKey)에 값 인스턴스(valueInstanceIndex)를 배정한다. 그 인스턴스가 직전에 다른
 * 항목에 배정되어 있었다면 그 직전 항목을 미배정으로 되돌려(엔트리 삭제) 어떤 값 인스턴스도 동시에
 * 둘 이상의 항목에 배정되지 않게 보장한다. 새 상태를 반환한다(순수: 입력 상태 비변형). (요구사항 4.5)
 * @param {{ assignments?: Record<string, number>, valuePool?: number[] }} state
 * @param {string} traitKey             대상 Rated_Trait의 Trait_Key
 * @param {number} valueInstanceIndex   Value_Pool 내 값 인스턴스 인덱스
 * @returns {{ assignments: Record<string, number>, valuePool: number[] }}
 */
export function assignFixedValue(state, traitKey, valueInstanceIndex) {
  const safe = state && typeof state === "object" ? state : {};
  const prevAssignments =
    safe.assignments && typeof safe.assignments === "object" ? safe.assignments : {};
  const valuePool = Array.isArray(safe.valuePool) ? safe.valuePool.slice() : [];

  /** @type {Record<string, number>} */
  const assignments = {};
  // 같은 값 인스턴스를 쓰던 직전 항목은 미배정으로 되돌린다(엔트리 제외). 대상 항목 자신도 일단 제외한다.
  for (const key of Object.keys(prevAssignments)) {
    if (key === traitKey) continue;
    if (prevAssignments[key] === valueInstanceIndex) continue;
    assignments[key] = prevAssignments[key];
  }
  // 대상 항목에 값 인스턴스를 배정한다.
  assignments[traitKey] = valueInstanceIndex;

  return { assignments, valuePool };
}

/**
 * [작업 8.2] 모드별 편집 요소(읽기 전용 여부 포함)를 담은 순수 데이터 모델을 도출한다(DOM 없음).
 *
 * 각 Rated_Trait의 편집 요소는 모드별 종류(`kind`)와 현재 표시 Trait_Level(`level`), 읽기 전용 여부
 * (`readOnly`)를 갖는다. 모드별 부가 정보:
 * - LADDER_SELECT: 사다리 선택(`ladder`).
 * - POINT_BUY: Base_Level 시작 + 남은 점수(pointBuyRemaining).
 * - FIXED_VALUE: Value_Pool 일대일 배정 정보.
 * - DICE_ROLL: 굴림 동작 + readOnly 플래그(forcedRandom·확정).
 *
 * 읽기 전용 도출: 확정 상태이면 모드 무관 모든 편집 요소·굴림 동작이 읽기 전용(요구사항 10.1).
 * DICE_ROLL이고 forcedRandom=true이면 비확정이라도 모든 편집 요소가 읽기 전용(요구사항 5.5),
 * forcedRandom=false이면 굴림 이후 편집 가능(요구사항 5.6).
 * @param {AllocationRule} rule
 * @param {SheetSchema} schema
 * @param {{ traitValues?: Record<string, number>, confirmed?: boolean }=} values
 * @returns {{ mode: string, confirmed: boolean, readonly: boolean, traits: Array<{ key: string, label: string, ladder: TraitLadder, kind: string, readOnly: boolean, level: number }>, pointBuy?: { baseLevel: number, pointPool: number, remaining: number }, fixedValue?: { valuePool: number[] }, diceRoll?: { diceFormula: string, forcedRandom: boolean, rollReadOnly: boolean, rollEnabled: boolean } }}
 */
export function allocationEditModel(rule, schema, values) {
  const traits = schema && Array.isArray(schema.traits) ? schema.traits : [];
  const safeValues = values && typeof values === "object" ? values : {};
  const traitValues =
    safeValues.traitValues && typeof safeValues.traitValues === "object"
      ? safeValues.traitValues
      : {};
  const confirmed = !!safeValues.confirmed;
  const mode = (rule && rule.mode) || "LADDER_SELECT";

  // DICE_ROLL forcedRandom=true이면 비확정이라도 읽기 전용. 확정이면 모드 무관 읽기 전용. (요구사항 5.5, 5.6, 10.1)
  const forcedRandomLock = mode === "DICE_ROLL" && rule.forcedRandom === true;
  const traitsReadOnly = confirmed || forcedRandomLock;

  // 각 항목의 현재 표시 Trait_Level: 값이 있으면 그대로, 없으면 사다리 초기값.
  /** @type {RatedTraitSet} */
  const currentSet = {};
  for (const trait of traits) {
    currentSet[trait.key] = Object.prototype.hasOwnProperty.call(traitValues, trait.key)
      ? traitValues[trait.key]
      : initialLevel(trait.ladder);
  }

  const traitElements = traits.map((trait) => ({
    key: trait.key,
    label: trait.label,
    ladder: trait.ladder,
    kind: mode,
    readOnly: traitsReadOnly,
    level: currentSet[trait.key],
  }));

  /** @type {any} */
  const model = { mode, confirmed, readonly: confirmed, traits: traitElements };

  switch (mode) {
    case "POINT_BUY":
      model.pointBuy = {
        baseLevel: rule.baseLevel,
        pointPool: rule.pointPool,
        // 남은 배분 점수(요구사항 3.6).
        remaining: pointBuyRemaining(rule, currentSet),
      };
      break;
    case "FIXED_VALUE":
      model.fixedValue = {
        valuePool: Array.isArray(rule.valuePool) ? rule.valuePool.slice() : [],
      };
      break;
    case "DICE_ROLL":
      model.diceRoll = {
        diceFormula: rule.diceFormula,
        forcedRandom: rule.forcedRandom === true,
        // 굴림 동작: 확정 시 읽기 전용(요구사항 10.1). forcedRandom은 굴림 자체를 막지 않는다.
        rollReadOnly: confirmed,
        rollEnabled: !confirmed,
      };
      break;
    default:
      break;
  }

  return model;
}

/**
 * [작업 9.1] Dice_Formula를 파싱한다. `NdM`·`NdM+K`·`NdM-K`(count≥1, sides≥1, 없으면 modifier 0).
 * 문법에 맞지 않으면 null. (요구사항 5.1, 5.3)
 * @param {string} formula
 * @returns {ParsedDiceFormula | null}
 */
export function parseDiceFormula(formula) {
  if (typeof formula !== "string") return null;
  // 앞뒤 공백을 제거한 뒤 NdM·NdM+K·NdM-K 형태를 파싱한다.
  const match = /^(\d+)d(\d+)([+-]\d+)?$/.exec(formula.trim());
  if (!match) return null;
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3]) : 0;
  // count ≥ 1, sides ≥ 1이어야 한다(modifier는 없으면 0).
  if (!Number.isInteger(count) || count < 1) return null;
  if (!Number.isInteger(sides) || sides < 1) return null;
  if (!Number.isInteger(modifier)) return null;
  return { count, sides, modifier };
}

/**
 * [작업 9.3] 각 Rated_Trait에 대해 Dice_Formula를 주입 무작위원(rng)으로 굴려 합·보정을 구하고,
 * 결과를 그 Trait_Ladder로 clamp한 정수 Trait_Level을 돌려준다(무작위 생성은 주입원/서버 책임). (요구사항 5.3)
 * @param {AllocationRule} rule
 * @param {SheetSchema} schema
 * @param {() => number} rng  [0,1) 무작위원(주입)
 * @returns {RatedTraitSet}
 */
export function rollAllocation(rule, schema, rng) {
  const traits = schema && Array.isArray(schema.traits) ? schema.traits : [];
  /** @type {RatedTraitSet} */
  const set = {};
  const parsed = rule && rule.mode === "DICE_ROLL" ? parseDiceFormula(rule.diceFormula) : null;
  const roll = typeof rng === "function" ? rng : () => 0;

  for (const trait of traits) {
    if (!trait || !isNonEmptyString(trait.key)) continue;
    let total;
    if (parsed) {
      // count개의 주사위를 각각 floor(rng()*sides)+1로 굴려 합하고 modifier를 더한다(무작위는 주입원 책임).
      total = parsed.modifier;
      for (let i = 0; i < parsed.count; i += 1) {
        total += Math.floor(roll() * parsed.sides) + 1;
      }
    } else {
      // 파싱 불가한 식이면 사다리 최소값으로 안전하게 폴백한다(이후 clamp로도 사다리 안).
      total = trait.ladder.min;
    }
    // 결과를 그 Trait_Ladder로 clamp한다(min 미만→min, max 초과→max, 사이→그대로). 정수 보장. (요구사항 5.3)
    const { min, max } = trait.ladder;
    let level = total;
    if (level < min) level = min;
    else if (level > max) level = max;
    set[trait.key] = level;
  }

  return set;
}

/**
 * [작업 9.5] Allocation_Roll_Endpoint 굴림 요청 명세를 구성한다.
 *
 * `POST /rooms/{encodeURIComponent(roomId)}/allocation-roll`(의도된 계약). Access_Token이 비어 있지
 * 않으면 `x-playtest-token` 헤더에 변형 없이 포함하고 비어 있으면 미포함한다. 어떤 무작위 값도
 * 클라이언트에서 생성하지 않는다. (요구사항 5.2)
 * @param {Handoff} handoff
 * @returns {{ url: string, method: string, headers: Record<string, string>, body: string }}
 */
export function buildRollRequest(handoff) {
  const safeHandoff = handoff || { roomId: "", playerId: "", token: "" };
  /** @type {Record<string, string>} */
  const headers = { "content-type": "application/json", ...buildAuthHeaders(safeHandoff.token) };
  return {
    url:
      "/rooms/" + encodeURIComponent(toStringSafe(safeHandoff.roomId)) + "/allocation-roll",
    method: "POST",
    headers,
    // 무작위는 서버가 생성한다. 클라이언트는 식별 정보만 보내며 어떤 무작위 값도 만들지 않는다. (요구사항 5.2)
    body: JSON.stringify({ playerId: toStringSafe(safeHandoff.playerId) }),
  };
}

/**
 * [작업 9.7] 굴림 응답 본문을 검증한다. 본문이 스키마의 모든 Rated_Trait에 정수 Trait_Level을 담을
 * 때에만 `{ ok: true, values }`, 누락·비정수면 `{ ok: false }`. (요구사항 5.8)
 * @param {unknown} body
 * @param {SheetSchema} schema
 * @returns {{ ok: true, values: RatedTraitSet } | { ok: false }}
 */
export function validateRollResponse(body, schema) {
  if (!body || typeof body !== "object") return { ok: false };
  const traits = schema && Array.isArray(schema.traits) ? schema.traits : [];
  // 굴림 결과는 `{ values: Record<traitKey, number> }` 또는 평면 본문(traitKey→number) 양식을 허용한다.
  const source =
    /** @type {any} */ (body).values && typeof (/** @type {any} */ (body).values) === "object"
      ? /** @type {any} */ (body).values
      : /** @type {any} */ (body);

  /** @type {RatedTraitSet} */
  const values = {};
  for (const trait of traits) {
    if (!trait || !isNonEmptyString(trait.key)) continue;
    const level = source[trait.key];
    // 모든 Rated_Trait에 대해 정수 Trait_Level을 담아야 한다. 누락·비정수면 무효. (요구사항 5.8)
    if (!Number.isInteger(level)) return { ok: false };
    values[trait.key] = level;
  }
  return { ok: true, values };
}

// ===========================================================================
// 시나리오 캐릭터 카드 (scenario-character-cards) — 작업 1.2 스캐폴드
// ===========================================================================
//
// 이 영역은 캐릭터 카드(Character_Card) 기반 시트 작성을, 시트 스키마(Active_Sheet_Schema)에
// 선택 가능한 Character_Card_List를 싣는 단일 스키마 확장(single pluggable schema) 구조로
// 도입하는 scenario-character-cards 스펙의 프론트엔드 순수 로직을 담는다. 직전에 병합된
// flexible-stat-allocation 경로 위에 가산적으로(additive) 쌓으며 기존 export·기존 동작을 보존한다.
//
// 본 작업(1.2)은 스캐폴드다: 타입 주석(JSDoc: CharacterCard·CardSelectionValidation, SheetSchema의
// characterCards/attributeProposalSupported, CharacterSheetState의 selectedCardId)·신규 한국어 메시지
// 상수(CARD_REQUIRED_MESSAGE)·신규 거부 사유(INVALID_CARD)는 이미 위에 선언되어 있고, 이후 단계
// (3.1·4.1·7.1·8.1)에서 채울 순수 함수 export 스텁만 아래에 선언한다. 스텁은 호출되기 전까지 던지지
// 않으므로 모듈은 부작용 없이 import 가능하다(기존 동작·기존 export 보존).
//
// 설계 문서: .kiro/specs/scenario-character-cards/design.md (Data Models · Components and Interfaces)

/**
 * [작업 3.1에서 구현] Card_Based_Sheet의 카드 선택 유효성을 판정한다(Frontend_Card_Validator).
 *
 * 설계 "카드 선택 검증 알고리즘": (1) cardList가 없거나 빈 배열이면 항상 유효(카드 기반 아님),
 * (2) 1개 이상이면 selectedId가 트림 후 1자 이상이어야 하고, (3) 트림한 selectedId가 목록의
 * 어떤 카드의 트림한 id와 정확히 일치해야 유효, 그렇지 않으면 INVALID_CARD. 순수·멱등.
 * (요구사항 5.3, 5.4, 6.2)
 * @param {CharacterCard[] | undefined | null} cardList
 * @param {string | undefined | null} selectedId
 * @returns {CardSelectionValidation}
 */
export function validateCardSelection(cardList, selectedId) {
  // (1) 카드 기반 아님 판정: cardList가 배열이 아니거나 비어 있으면 항상 유효. (요구사항 5.4)
  if (!Array.isArray(cardList) || cardList.length === 0) {
    return { ok: true };
  }
  // (2) 선택 존재 검사: selectedId가 문자열이며 트림 후 1자 이상이어야 한다. (요구사항 5.1, 6.2)
  if (typeof selectedId !== "string") {
    return { ok: false, reason: RecordRejection.INVALID_CARD };
  }
  const trimmedSelected = selectedId.trim();
  if (trimmedSelected.length < 1) {
    return { ok: false, reason: RecordRejection.INVALID_CARD };
  }
  // (3) 소속 검사: 트림한 selectedId가 목록의 어떤 카드의 트림한 id와 정확히 일치해야 한다. (요구사항 6.2)
  for (const card of cardList) {
    if (!card || typeof card !== "object") continue;
    const id = /** @type {any} */ (card).id;
    if (typeof id !== "string") continue;
    if (id.trim() === trimmedSelected) {
      return { ok: true };
    }
  }
  return { ok: false, reason: RecordRejection.INVALID_CARD };
}

/**
 * [작업 3.1에서 구현] 한 스키마가 Card_Based_Sheet인지 판정한다.
 *
 * `schema.characterCards`가 1개 이상이면 참, 없음/빈 배열이면 거짓. (요구사항 3.4, 3.5)
 * @param {SheetSchema} schema
 * @returns {boolean}
 */
export function isCardBasedSheet(schema) {
  return Boolean(
    schema &&
      typeof schema === "object" &&
      Array.isArray(/** @type {any} */ (schema).characterCards) &&
      /** @type {any} */ (schema).characterCards.length >= 1
  );
}

/**
 * [작업 4.1에서 구현] 스키마 응답의 characterCards 페이로드를 검증·정규화한다.
 *
 * 없거나 빈 배열이면 `{ ok: true, cards: [] }`(카드 기반 아님)로 정규화; 1개 이상이며 모든 원소가
 * 트림 후 1자 이상 id·roleLabel을 갖고 모든 id가 고유할 때에만 유효; 빈 id/roleLabel(전부 공백 포함)·
 * 중복 id·비객체 원소는 무효. (요구사항 7.1)
 * @param {unknown} raw
 * @returns {{ ok: true, cards: CharacterCard[] } | { ok: false }}
 */
export function validateCardList(raw) {
  // 없거나(null/undefined) 빈 배열이면 카드 기반이 아님 → 정규화된 빈 목록으로 유효. (요구사항 7.1)
  if (raw === undefined || raw === null) {
    return { ok: true, cards: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false };
  }
  if (raw.length === 0) {
    return { ok: true, cards: [] };
  }
  /** @type {CharacterCard[]} */
  const cards = [];
  /** @type {Set<string>} */
  const seenIds = new Set();
  for (const element of raw) {
    // 비객체 원소는 무효. (요구사항 7.1)
    if (!element || typeof element !== "object") {
      return { ok: false };
    }
    const e = /** @type {any} */ (element);
    // id·roleLabel은 문자열이며 트림 후 1자 이상이어야 한다(전부 공백 포함 무효). (요구사항 7.1)
    if (typeof e.id !== "string" || typeof e.roleLabel !== "string") {
      return { ok: false };
    }
    const trimmedId = e.id.trim();
    const trimmedRoleLabel = e.roleLabel.trim();
    if (trimmedId.length < 1 || trimmedRoleLabel.length < 1) {
      return { ok: false };
    }
    // 모든 id는 고유해야 한다(트림 기준 중복 무효). (요구사항 7.1)
    if (seenIds.has(trimmedId)) {
      return { ok: false };
    }
    seenIds.add(trimmedId);
    // 정규화: id·roleLabel·premise를 싣고, backstoryGuidance가 문자열이면 보존한다.
    /** @type {CharacterCard} */
    const card = {
      id: e.id,
      roleLabel: e.roleLabel,
      premise: typeof e.premise === "string" ? e.premise : "",
    };
    if (typeof e.backstoryGuidance === "string") {
      card.backstoryGuidance = e.backstoryGuidance;
    }
    cards.push(card);
  }
  return { ok: true, cards };
}

/**
 * 서버가 분배한 손패 응답(`{ cards: CharacterCard[] }`)을 검증·정규화한다.
 *
 * `body.cards`가 배열이고 각 원소가 객체이며 트림 후 1자 이상 id·roleLabel을 가질 때 그 원소만
 * 방어적으로 남겨 정규화한 배열을 반환한다(스키마 검증기와 동일한 정규화). 그 외(누락·비배열·
 * 무효 원소만 존재)는 빈 배열을 반환한다. 순수하며 절대 던지지 않는다.
 * @param {unknown} body
 * @returns {CharacterCard[]}
 */
export function parseCardHand(body) {
  const raw =
    body && typeof body === "object" ? /** @type {any} */ (body).cards : undefined;
  if (!Array.isArray(raw)) return [];
  /** @type {CharacterCard[]} */
  const cards = [];
  for (const element of raw) {
    if (!element || typeof element !== "object") continue;
    const e = /** @type {any} */ (element);
    if (typeof e.id !== "string" || typeof e.roleLabel !== "string") continue;
    if (e.id.trim().length < 1 || e.roleLabel.trim().length < 1) continue;
    /** @type {CharacterCard} */
    const card = {
      id: e.id,
      roleLabel: e.roleLabel,
      premise: typeof e.premise === "string" ? e.premise : "",
    };
    if (typeof e.backstoryGuidance === "string") {
      card.backstoryGuidance = e.backstoryGuidance;
    }
    cards.push(card);
  }
  return cards;
}

/**
 * [작업 7.1에서 구현] Card_Based_Sheet의 카드 목록 렌더 모델을 도출한다(단일 선택 표시).
 *
 * Character_Card_List의 모든 카드를 roleLabel·premise(+있으면 backstoryGuidance)와 함께 산출하고,
 * selectedCardId가 null이면 모두 `selected: false`, 목록의 한 id이면 그 카드 하나만 `selected: true`
 * (나머지 거짓)로 표시한다(모든 텍스트는 esc 이스케이프 대상). (요구사항 4.1, 4.4)
 * @param {SheetSchema} schema
 * @param {string | null} selectedCardId
 * @returns {{ cards: Array<{ id: string, roleLabel: string, premise: string, backstoryGuidance: string, selected: boolean }> }}
 */
export function cardListModel(schema, selectedCardId) {
  const cardsDef =
    schema && Array.isArray(/** @type {any} */ (schema).characterCards)
      ? /** @type {any} */ (schema).characterCards
      : [];
  // selectedCardId가 null/비문자열이면 선택 없음. 트림 후 1자 이상일 때만 매칭 후보로 둔다.
  const trimmedSelected =
    typeof selectedCardId === "string" && selectedCardId.trim().length >= 1
      ? selectedCardId.trim()
      : null;
  const cards = cardsDef.map((card) => {
    const c = card && typeof card === "object" ? card : {};
    const id = typeof c.id === "string" ? c.id : "";
    return {
      // index.html이 표시 시 esc로 이스케이프하므로 여기서는 원문 문자열을 그대로 반환한다.
      id,
      roleLabel: typeof c.roleLabel === "string" ? c.roleLabel : "",
      premise: typeof c.premise === "string" ? c.premise : "",
      backstoryGuidance: typeof c.backstoryGuidance === "string" ? c.backstoryGuidance : "",
      // selectedCardId가 null이면 모두 거짓, 목록의 한 id와 일치하면 그 카드 하나만 참(나머지 거짓). (요구사항 4.4)
      selected: trimmedSelected !== null && id.trim() === trimmedSelected,
    };
  });
  return { cards };
}

/**
 * [작업 8.1에서 구현] 카드 단일 선택 전이(순수). 입력 상태를 변형하지 않고 새 상태를 반환한다.
 *
 * Card_Based_Sheet이고 비확정이면 cardId를 유일한 Selected_Card로 두고 직전 선택을 해제해 항상
 * 최대 하나의 Selected_Card만 존재하게 한다(state.selectedCardId 갱신). 확정 상태이면 변경하지 않는다.
 * (요구사항 4.3, 8.1, 8.2)
 * @param {CharacterSheetState} state
 * @param {string} cardId
 * @returns {CharacterSheetState}
 */
export function selectCard(state, cardId) {
  if (!state || typeof state !== "object") return state;
  // 확정 상태이면 Selected_Card를 변경하지 않는다(잠금 보존). (요구사항 8.1, 8.2)
  if (state.confirmed === true) return state;
  // 카드 기반 시트가 아니면 카드 선택을 적용하지 않는다(기존 동작 보존). (요구사항 5.4)
  if (!isCardBasedSheet(state.activeSchema)) return state;
  // 카드 기반·비확정: cardId를 유일한 Selected_Card로 둔다(직전 선택 해제, 최대 하나만 존재). (요구사항 4.3)
  return { ...state, selectedCardId: toStringSafe(cardId) };
}
