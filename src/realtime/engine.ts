/**
 * Engine composition root — assembles persistence, the realtime gateway, the AI
 * GM coordinator, and the per-room orchestrator into one wired {@link Engine}
 * the server entrypoint can use (task 16.2).
 *
 * Everything is dependency-injected: the only hard dependency a caller MUST
 * supply is a concrete {@link AiGmClient} (the LLM provider binding). Persistence
 * is selected from the environment via {@link createPersistence} (Postgres when a
 * connection string is configured, in-memory otherwise), and the gateway reads
 * Turn_State live from the selected store. The QA {@link EventSink} from
 * persistence is threaded through the dice service, the AI router/coordinator,
 * and the orchestrator so dice, AI, and round-timing events all land in one sink.
 *
 * The composition is intentionally thin and side-effect-free at module load: no
 * sockets are opened and no database connection is established here. Binding the
 * gateway to real WebSockets and starting the REST app are the server
 * entrypoint's job; this module just produces the wired object graph.
 *
 * Requirements: 5.2, 5.3, 10.1, 10.4, 10.5, 13.6, 15.1, 15.2, 15.5, 18.5.
 */
import process from "node:process";
import { DEFAULT_ENGINE_CONFIG } from "../core/config.js";
import { toVisibleCharacterState } from "../core/character-state.js";
import { toVisibleBlackboard } from "../core/scenario-blackboard.js";
import { createDiceServiceFromSpec, type DiceService, type UniformIntSource } from "../core/dice.js";
import type { EngineConfig } from "../core/types.js";
import { AiGmCoordinator } from "../ai/ai-gm-coordinator.js";
import { AiGmRouter } from "../ai/ai-gm-router.js";
import type { AiGmClient } from "../ai/ai-gm-client.js";
import type { EnvelopeGenerators } from "../observability/events.js";
import type { EventSink } from "../observability/event-sink.js";
import { NoopSessionLogger, type SessionLogger } from "../observability/session-log.js";
import { createPersistence, type Persistence } from "../persistence/factory.js";
import type { EnvLike } from "../persistence/pg-client.js";
import { ScenarioService, type Scenario } from "../services/scenario-service.js";
import { RealtimeGateway } from "./gateway.js";
import { RoomOrchestrator } from "./room-orchestrator.js";

/** Inputs to {@link createEngine}. Only {@link aiClient} is required. */
export interface CreateEngineDeps {
  /** The provider-agnostic LLM binding used by the AI GM coordinator. */
  aiClient: AiGmClient;
  /** Environment used to select persistence; defaults to `process.env`. */
  env?: EnvLike;
  /** Engine configuration; defaults to {@link DEFAULT_ENGINE_CONFIG}. */
  config?: EngineConfig;
  /** Clock injected into the orchestrator (deterministic tests). */
  now?: () => Date;
  /** Deterministic envelope generators for QA events (tests). */
  generators?: EnvelopeGenerators;
  /**
   * Optional uniform integer source for the dice service. Omitted in production
   * so the CSPRNG-seeded default is used; injectable for deterministic tests.
   */
  diceSource?: UniformIntSource;
  /**
   * Optional scenario catalog seeded into the in-memory scenario store. Defaults
   * to the single MVP scenario; the local playtest server passes a multi-scenario
   * catalog so the lobby can offer a scenario picker.
   */
  scenarioCatalog?: readonly Scenario[];
  /**
   * Optional best-effort session trace logger. When provided (and enabled), QA
   * events (incl. the AI raw output) and round-flow transitions are appended to
   * a local JSONL file for debugging. Defaults to a no-op (tests never log).
   */
  sessionLogger?: SessionLogger;
}

/** The fully wired engine object graph. */
export interface Engine {
  /** The selected persistence bundle (stores + repositories + event sink). */
  persistence: Persistence;
  /** The realtime gateway, reading Turn_State live from the store. */
  gateway: RealtimeGateway;
  /** The AI GM coordinator (router + dice + config wired in). */
  coordinator: AiGmCoordinator;
  /** The per-room single-writer orchestrator. */
  orchestrator: RoomOrchestrator;
  /** The server-side dice service. */
  dice: DiceService;
  /** The resolved engine configuration. */
  config: EngineConfig;
  /** The best-effort session trace logger (no-op unless enabled by the caller). */
  sessionLogger: SessionLogger;
}

/**
 * Wire persistence + gateway + coordinator + orchestrator into one {@link
 * Engine}. Pure assembly: constructs the object graph without opening sockets
 * or database connections.
 */
export function createEngine(deps: CreateEngineDeps): Engine {
  const config = deps.config ?? DEFAULT_ENGINE_CONFIG;
  const persistence = createPersistence(
    deps.env ?? process.env,
    deps.scenarioCatalog ? { scenarioCatalog: deps.scenarioCatalog } : {},
  );

  const sessionLogger = deps.sessionLogger ?? new NoopSessionLogger();
  // When session logging is on, tee every QA event (incl. the AI `ai_output`
  // event carrying the raw model text + validation result) into the trace file
  // alongside the normal sink. Off → use the persistence sink unchanged.
  const eventSink: EventSink = sessionLogger.enabled
    ? {
        emit: (event) => {
          persistence.eventSink.emit(event);
          sessionLogger.emitQa(event);
        },
      }
    : persistence.eventSink;

  const gateway = new RealtimeGateway({
    getTurnState: (roomId) => persistence.turnStateStore.get(roomId),
    // Enrich the fan-out state with display-only data (never persisted):
    //  - readiness roster character/join names so the game header shows
    //    "CharacterName(JoinName)" instead of raw player ids, and
    //  - the player-visible character states (conditions/inventory/resources/
    //    personal clocks) so the game UI and reconnect resync can render the
    //    Living Character Sheet. GM-only material (memories/flags/relationships)
    //    is projected away by toVisibleCharacterState.
    decorateState: (roomId, state) => {
      const readiness = Array.isArray(state.readiness) ? state.readiness : [];
      const characterStates = persistence.characterStateStore.get(roomId);
      const blackboard = persistence.blackboardStore.get(roomId);
      if (readiness.length === 0 && characterStates.length === 0 && blackboard === undefined) return state;
      const displayById = new Map(
        persistence.roomStore.listPlayers(roomId).map((p) => [p.id, p.displayName]),
      );
      const characters = persistence.roomStore.listCharactersByRoom(roomId);
      const charById = new Map(characters.map((c) => [c.playerId, c.name]));
      const charNameById = new Map(characters.map((c) => [c.id, c.name]));
      return {
        ...state,
        readiness: readiness.map((entry) => {
          const characterName = charById.get(entry.playerId);
          const displayName = displayById.get(entry.playerId);
          return {
            ...entry,
            ...(characterName !== undefined && characterName.length > 0
              ? { characterName }
              : {}),
            ...(displayName !== undefined && displayName.length > 0 ? { displayName } : {}),
          };
        }),
        ...(characterStates.length > 0
          ? {
              characterStates: characterStates.map((characterState) =>
                toVisibleCharacterState(
                  characterState,
                  charNameById.get(characterState.characterId) ?? "",
                ),
              ),
            }
          : {}),
        ...(blackboard !== undefined ? { blackboard: toVisibleBlackboard(blackboard) } : {}),
      };
    },
  });

  const dice = createDiceServiceFromSpec(config.dice, deps.diceSource, {
    sink: eventSink,
  });

  const router = new AiGmRouter({
    client: deps.aiClient,
    config,
    sink: eventSink,
    ...(deps.generators ? { generators: deps.generators } : {}),
  });

  const coordinator = new AiGmCoordinator({
    router,
    dice,
    config,
    sink: eventSink,
    ...(deps.generators ? { generators: deps.generators } : {}),
  });

  const scenarioService = new ScenarioService(persistence.scenarioStore);

  const orchestrator = new RoomOrchestrator({
    store: persistence.turnStateStore,
    gateway,
    coordinator,
    roomReader: persistence.roomStore,
    scenarioResolver: scenarioService,
    sessionSummaryRepository: persistence.sessionSummaryRepository,
    clockStore: persistence.clockStore,
    sceneStore: persistence.sceneStore,
    characterStateStore: persistence.characterStateStore,
    blackboardStore: persistence.blackboardStore,
    memoryStore: persistence.memoryStore,
    eventSink,
    config,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.generators ? { generators: deps.generators } : {}),
    ...(sessionLogger.enabled
      ? { log: (category: string, data?: Record<string, unknown>) => sessionLogger.log(category, data) }
      : {}),
  });

  return { persistence, gateway, coordinator, orchestrator, dice, config, sessionLogger };
}
