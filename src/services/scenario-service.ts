/**
 * Scenario service: scenario catalog listing and per-room association.
 *
 * Owns the read side of "which scenario is selected for a room" plus the MVP
 * scenario catalog. The Room Service records the chosen scenario id on the Room
 * (`Room.scenarioId`); this service is the authority for the available catalog,
 * default pre-selection, and the explicit-selection requirement.
 *
 * Persistence is deferred (task 14) — the catalog and the room→scenario mapping
 * live behind {@link ScenarioStore} so a durable implementation can be dropped
 * in later without touching callers.
 *
 * Sources: design.md "Data Models" (Scenario), "Components and Interfaces"
 * (Room Service.selectScenario), Screen 3 — Scenario Selection.
 * Requirements: 3.2, 3.4, 3.5
 */
import type { AllocationRule } from "./sheet-schema.js";

/**
 * A pre-authored one-shot adventure. The MVP ships exactly one team-authored
 * Scenario (Requirement 3.1).
 */
export interface Scenario {
  id: string;
  /** Display title shown to all players (Requirements 3.1, 3.3). */
  title: string;
  /** Introductory summary broadcast to all players on selection (Requirement 3.3). */
  summary: string;
  /** Grounding context handed to the AI GM for the opening narration (Requirement 5.2). */
  openingSeed: string;
  /** Condition the AI GM evaluates to end the one-shot (Requirement 15.1). */
  endingCondition: string;
  /** Genre label surfaced on the sheet/lobby (e.g. "판타지 던전 탐험"). */
  genre: string;
  /** Higher-level category grouping (e.g. "판타지 액션·탐험"). */
  category: string;
  /** Whether the scenario uses a custom (non-universal) rule system. */
  hasSpecialRules: boolean;
  /** Named rule system driving the sheet/resolution (e.g. "EZFudge"). */
  system: string;
  /**
   * Optional per-scenario GM rules/tone overlay, injected into the AI GM prompts
   * (opening / decision / narration / ending) ON TOP of the universal EZFudge
   * resolution. This is the "custom system over a universal base" layer: it
   * shapes tone, which attributes to use, what kinds of checks fit, and any
   * special-rule flavor — WITHOUT changing the server-authoritative dice math.
   * Kept as curated static text (not vector-retrieved) since the catalog is
   * small; the injection points let it become retrieval-backed later if needed.
   */
  rulesBrief?: string;
  /**
   * The scenario's play form — "원샷"(one-shot) or "캠페인"(campaign);
   * omitted/absent is treated as "원샷". Optional to avoid breaking existing
   * Scenario literals/fixtures.
   */
  form?: string;
  /**
   * Optional stat-allocation hint for the resolved sheet. When present it is
   * normalized by the Sheet_Schema_Resolver (`normalizeAllocationRule`) against
   * the resolved traits; unspecified or invalid hints fall back to
   * `LADDER_SELECT`. Authored data may be partial/invalid, so consumers must
   * treat this as untrusted input and normalize before use.
   */
  allocation?: AllocationRule;
  /**
   * Optional Attribute_Proposal_Disabled input. When `true`, the
   * Sheet_Schema_Resolver sets the resolved sheet's `attributeProposalSupported`
   * to `false` even when the sheet has ≥ 1 rated trait (Requirement 1.3).
   * Omitted/`false` leaves proposal support derived from the rated-trait count.
   */
  attributeProposalDisabled?: boolean;
}

/**
 * Storage abstraction for the scenario catalog and the per-room selection.
 * In-memory for the MVP; a Postgres-backed implementation arrives in task 14.
 */
export interface ScenarioStore {
  /** All scenarios available for selection (Requirement 3.1). */
  listScenarios(): Scenario[];
  /** Look up a single scenario by id, or `undefined` when unknown. */
  getScenario(id: string): Scenario | undefined;
  /** The explicitly selected scenario id for a room, or `null` if none set. */
  getSelection(roomId: string): string | null;
  /** Record an explicit scenario selection for a room. */
  setSelection(roomId: string, scenarioId: string): void;
}

/** Raised when a caller selects a scenario id that is not in the catalog. */
export class UnknownScenarioError extends Error {
  constructor(public readonly scenarioId: string) {
    super(`Unknown scenario: ${scenarioId}`);
    this.name = "UnknownScenarioError";
  }
}

/**
 * The single team-authored MVP scenario (design.md Screen 3 — Scenario Selection).
 */
export const MVP_SCENARIO: Scenario = {
  id: "the-sunless-crypt",
  title: "The Sunless Crypt",
  summary:
    "The village's children have vanished into the old crypt beneath the chapel. " +
    "A one-shot dungeon delve for 2-6 heroes, roughly two hours.",
  openingSeed:
    "Dusk over a fearful village; the chapel's crypt stairs descend into cold dark. " +
    "The party gathers at the broken seal where the children were last seen.",
  endingCondition:
    "The party escapes the crypt with the missing children, or the crypt claims them.",
  genre: "판타지 던전 탐험",
  category: "판타지 액션·탐험",
  hasSpecialRules: false,
  system: "EZFudge",
  form: "원샷",
  rulesBrief:
    "정통 판타지 던전 탐험. 어둠·미지·함정의 긴장을 감각적으로 묘사한다. 능력치: " +
    "Might(완력·근접 전투·힘쓰기), Agility(민첩·회피·은신·손재주), Wits(지식·관찰·마법·추리), " +
    "Spirit(의지·감각·정신력). 탐색·전투·함정 판정을 상황에 맞게 배분한다.",
};

/** The default MVP catalog: exactly one scenario. */
export const MVP_SCENARIO_CATALOG: readonly Scenario[] = [MVP_SCENARIO];

/**
 * Additional pre-authored scenarios used by the local playtest server so the
 * lobby can offer a real choice (combobox). These are NOT part of
 * {@link MVP_SCENARIO_CATALOG} — that constant stays a single scenario so the
 * default-pre-selection semantics (Requirement 3.4) are unchanged.
 */
export const TIDEWATCH_SMUGGLERS: Scenario = {
  id: "tidewatch-smugglers",
  title: "조수감시 항구의 밀수선",
  summary:
    "안개 낀 항구도시 '조수감시'에 정박한 밀수선에서 사라진 화물과 실종된 선원의 " +
    "흔적을 쫓는다. 잠입과 협상이 얽힌 2~3시간짜리 도시 모험.",
  openingSeed:
    "비에 젖은 부두, 등불이 흔들리는 새벽. 일행은 출항을 앞둔 밀수선 '검은 갈매기호' " +
    "앞에서 만나, 갑판 아래에서 새어 나오는 낯선 소리를 듣는다.",
  endingCondition:
    "일행이 화물의 진실을 밝혀내고 실종된 선원을 구하거나, 밀수단에 정체가 발각되어 쫓겨난다.",
  genre: "도시 판타지·잠입/협상",
  category: "판타지 액션·탐험",
  hasSpecialRules: false,
  system: "EZFudge",
  form: "원샷",
  rulesBrief:
    "도시 판타지 잠입·협상극. 정면 전투보다 은밀 접근, 대화·흥정, 발각 위험을 중심으로 굴린다. " +
    "능력치는 EZFudge(Might/Agility/Wits/Spirit): 잠입·손재주는 Agility, 설득·직감은 Spirit, " +
    "정보·간파는 Wits를 주로 쓴다. 소란은 대가를 부른다는 톤.",
};

export const ASHFALL_MONASTERY: Scenario = {
  id: "ashfall-monastery",
  title: "잿빛 안개 수도원",
  summary:
    "산정의 폐허가 된 수도원에서 매일 밤 울리는 종소리의 정체를 파헤친다. " +
    "공포와 수수께끼가 짙은 2시간 분량의 미스터리.",
  openingSeed:
    "눈보라가 잦아든 산길 끝, 잿빛 안개에 잠긴 수도원의 부서진 정문. 일행은 얼어붙은 " +
    "성수반 옆에서 마지막 수도사가 남긴 핏빛 낙서를 발견한다.",
  endingCondition:
    "일행이 종소리의 근원을 잠재우고 수도원을 빠져나오거나, 안개에 영영 갇힌다.",
  genre: "호러·미스터리",
  category: "호러·미스터리",
  hasSpecialRules: false,
  system: "EZFudge",
  form: "원샷",
  rulesBrief:
    "조용한 호러 미스터리. 불안·정적·수수께끼가 중심이며, 성급한 전투보다 조사·관찰·의지 판정을 " +
    "앞세운다. 능력치는 EZFudge: 단서·간파는 Wits, 공포에 맞서는 판정은 Spirit. 공포는 " +
    "폭발적 장면보다 서서히 조여드는 분위기로 그린다.",
};

/**
 * "끔찍한 거위들" — a D6 dice-pool comedy where the players are a flock of geese
 * causing escalating mayhem in a peaceful village while a chaos-keeper hands out
 * ever-more-annoying prank goals. Uses a custom rule system (special sheet).
 */
export const TERRIBLE_GEESE: Scenario = {
  id: "terrible-geese",
  title: "끔찍한 거위들",
  summary:
    "평화로운 마을의 어느 아침, 플레이어 전원이 한 무리의 끔찍한 거위가 된다. " +
    "혼돈의 존재가 점점 더 성가신 장난 목표를 던져 주고, 거위들은 은밀함·재빠름·집요함을 " +
    "발휘해 마을을 뒤집어 놓는다. 가볍고 빠른 코미디 원샷.",
  openingSeed:
    "이슬 맺힌 마을 광장, 빨래가 널리고 파이가 식어 가는 한가로운 아침. 거위 무리가 " +
    "울타리 뒤에 모여 첫 번째 표적을 노린다. 혼돈의 존재가 첫 임무를 속삭인다: " +
    "'저 창턱의 파이를 망쳐 놓아라.'",
  endingCondition:
    "거위들이 혼돈의 존재가 내준 마지막이자 가장 거창한 장난을 완수해 마을을 완전한 " +
    "아수라장으로 만들거나, 모든 거위가 들켜 연못으로 은퇴하면 하루가 끝난다.",
  genre: "코미디",
  category: "코미디 소동극",
  hasSpecialRules: true,
  system: "D6 다이스 풀",
  form: "원샷",
  rulesBrief:
    "가볍고 빠른 슬랩스틱 코미디. 저위험·고혼돈이며 실패조차 웃기게 그린다. 능력치는 커스텀 3종: " +
    "Sneaky(은밀·몰래 접근), Fast(재빠름·기습·도주), Tenacious(집요·끈질기게 물고 늘어짐). " +
    "판정 attribute는 반드시 이 셋 중에서만 고른다(EZFudge 능력치 쓰지 말 것). " +
    "서술과 판정 안내에서 능력치를 언급할 때는 반드시 한국어 라벨(은밀함/재빠름/집요함)을 사용하고, " +
    "영어 키(Sneaky/Fast/Tenacious)는 blackboardDeltas·checks 같은 구조화 필드에서만 사용한다. 마을을 뒤엎는 " +
    "장난 목표가 중심이고, 혼돈의 존재가 내주는 장난 목표는 블랙보드 fronts의 순서를 따른다 - 완료되면 다음 장난으로 격화시킨다. " +
    "사람이 다치는 묘사는 피하며 소동·망신·아수라장으로 표현한다.",
};

/**
 * "가라앉을 때까지" — a GM-less cooperative mystery on a slowly sinking island.
 * A fisherman is found dead and the players uncover events through nightly
 * conversation, promoting their own explanations to truth. Card-based system.
 */
export const UNTIL_IT_SINKS: Scenario = {
  id: "until-it-sinks",
  title: "가라앉을 때까지",
  summary:
    "서서히 가라앉는 태평양의 휴양 섬. 원주민과 관광객이 뒤섞인 가운데 한 낚시꾼이 " +
    "시체로 발견된다. GM 없이, 매일 저녁 연회장에 모여 나누는 대화만으로 사건을 풀어 가는 " +
    "협동 미스터리. 누군가 승리하는 게임이 아니라, 함께 이야기를 완성하는 게임.",
  openingSeed:
    "첫째 날 저녁, 호텔 연회장. 최근에야 서로를 알게 된 사람들이 모인 자리에 " +
    "'낚시꾼이 시체로 발견되다'라는 소식이 펼쳐진다. 발밑에서는 섬이 조금씩 " +
    "물에 잠겨 가고, 사람들은 어색한 첫인사를 나눈다.",
  endingCondition:
    "'섬이 가라앉다' 카드가 등장해 섬이 잠기고, 고장난 보트 위에서 나누는 마지막 대화로 " +
    "남은 모든 사건이 일관되게 해명되면 이야기가 끝난다.",
  genre: "미스터리/호러",
  category: "호러·미스터리(GM리스)",
  hasSpecialRules: true,
  system: "카드 기반(GM리스)",
  form: "원샷",
  rulesBrief:
    "GM 없는 협동 미스터리. 승패가 없고 함께 이야기를 완성하는 게임이다. 능력치 판정을 만들지 말고 " +
    "(checks는 비워 둔다) 대화·회상·해석과 분위기 묘사로만 진행한다. 플레이어가 내놓은 설명을 " +
    "존중해 사실로 굳혀 가고, 발밑에서 섬이 서서히 잠기는 불안한 정조를 유지한다.",
};

/**
 * The local playtest catalog: the MVP scenario plus the extra demo scenarios,
 * so the lobby can present a multi-option scenario picker.
 */
export const DEMO_SCENARIO_CATALOG: readonly Scenario[] = [
  MVP_SCENARIO,
  TIDEWATCH_SMUGGLERS,
  ASHFALL_MONASTERY,
  TERRIBLE_GEESE,
  UNTIL_IT_SINKS,
];

/**
 * Default in-memory {@link ScenarioStore}. The catalog is fixed at construction;
 * per-room selections are held in a Map. Returns defensive copies of scenarios
 * so callers cannot mutate the shared catalog.
 */
export class InMemoryScenarioStore implements ScenarioStore {
  private readonly catalog: Map<string, Scenario>;
  private readonly selections = new Map<string, string>();

  constructor(catalog: readonly Scenario[] = MVP_SCENARIO_CATALOG) {
    this.catalog = new Map(catalog.map((s) => [s.id, { ...s }]));
  }

  listScenarios(): Scenario[] {
    return [...this.catalog.values()].map((s) => ({ ...s }));
  }

  getScenario(id: string): Scenario | undefined {
    const found = this.catalog.get(id);
    return found ? { ...found } : undefined;
  }

  getSelection(roomId: string): string | null {
    return this.selections.get(roomId) ?? null;
  }

  setSelection(roomId: string, scenarioId: string): void {
    this.selections.set(roomId, scenarioId);
  }
}

/**
 * Scenario listing and per-room association.
 *
 * Default pre-selection (Requirement 3.4): when exactly one scenario exists it
 * is the default for every room, so reading a room's scenario before any
 * explicit selection returns that single scenario.
 *
 * Explicit-selection requirement (Requirement 3.5): when more than one scenario
 * exists, a room has no scenario until the Host explicitly selects one, and
 * {@link ScenarioService.isSelectionResolved} reports `false` until then.
 */
export class ScenarioService {
  constructor(private readonly store: ScenarioStore = new InMemoryScenarioStore()) {}

  /** List the scenarios available for the MVP (Requirement 3.1). */
  listScenarios(): Scenario[] {
    return this.store.listScenarios();
  }

  /**
   * The scenario id that is pre-selected by default, or `null` when a default
   * cannot be inferred. A default exists only when exactly one scenario is
   * available (Requirement 3.4); with multiple scenarios the Host must choose
   * explicitly (Requirement 3.5).
   */
  getDefaultScenarioId(): string | null {
    const scenarios = this.store.listScenarios();
    return scenarios.length === 1 ? scenarios[0].id : null;
  }

  /**
   * Whether the catalog forces the Host to make an explicit choice before the
   * session can start (Requirement 3.5). True when more than one scenario
   * exists.
   */
  isExplicitSelectionRequired(): boolean {
    return this.store.listScenarios().length > 1;
  }

  /**
   * Associate a scenario with a room (Requirement 3.2).
   *
   * @throws {UnknownScenarioError} when `scenarioId` is not in the catalog.
   */
  selectScenario(roomId: string, scenarioId: string): void {
    if (!this.store.getScenario(scenarioId)) {
      throw new UnknownScenarioError(scenarioId);
    }
    this.store.setSelection(roomId, scenarioId);
  }

  /**
   * The effective scenario id for a room: the explicit selection if one was
   * made, otherwise the default pre-selection (Requirement 3.4), otherwise
   * `null` when an explicit selection is still required (Requirement 3.5).
   */
  getSelectedScenarioId(roomId: string): string | null {
    return this.store.getSelection(roomId) ?? this.getDefaultScenarioId();
  }

  /**
   * Read back the room's effective scenario (Requirement 3.2 round-trip),
   * resolving the default pre-selection when no explicit choice was made.
   * Returns `null` when the room has no scenario yet.
   */
  getSelectedScenario(roomId: string): Scenario | null {
    const id = this.getSelectedScenarioId(roomId);
    return id ? (this.store.getScenario(id) ?? null) : null;
  }

  /**
   * Whether the room has a usable scenario — either explicitly selected or
   * resolved from the single-scenario default. Gates session start together
   * with the character checks owned by the Room Service.
   */
  isSelectionResolved(roomId: string): boolean {
    return this.getSelectedScenarioId(roomId) !== null;
  }
}
