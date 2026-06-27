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
};

/** The default MVP catalog: exactly one scenario. */
export const MVP_SCENARIO_CATALOG: readonly Scenario[] = [MVP_SCENARIO];

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
