# Implementation Plan: TRPG Session Engine

## Overview

This plan builds the TRPG Session Engine in TypeScript (Node.js backend) following the design's "authoritative server, pure testable core" approach. Work starts with the deterministic, transport-agnostic core (EZFudge resolver, Dice Service, Turn_State model, round-loop reducer) so the 36 correctness properties can be property-tested without network/AI/DB. It then layers the Room/Scenario/Character services, the AI GM Coordinator, durable persistence, and finally wires everything to the WebSocket gateway and REST surface.

Property-based tests use `fast-check` (minimum 100 iterations each) and are tagged with the format `// Feature: trpg-session-engine, Property {number}: {property_text}`. Each of the 36 design properties is implemented as a single property test placed close to the code it validates. Test sub-tasks are marked optional with `*`.

## Tasks

- [x] 1. Set up project structure, tooling, and shared types
  - Initialize a Node.js + TypeScript project (tsconfig, build, lint) with a layered `src/` layout: `core/` (pure logic), `services/`, `ai/`, `realtime/`, `persistence/`, `http/`
  - Set up the test runner (Vitest or Jest) and install `fast-check` for property-based testing; add a npm script for single-run test execution
  - Define shared domain types used across layers: `AttributeKey`, `AttributeLevel`, `DifficultyGrade`, `OutcomeGrade`, `Phase`, `ReadinessStatus`, `ActionKind`, `RequestType`, `ModelTier`, and the `EngineConfig` interface with defaults (`readyCheckTimeoutMs: 90000`, `maxPlayers: 6`, `aiMaxRetries: 2`, `diceRange`)
  - _Requirements: 1.4, 8.4, 11.6, 16.2, 17.1_

- [x] 2. Implement EZFudge resolver and Dice Service (pure core)
  - [x] 2.1 Implement the EZFudge `resolveCheck` pure function
    - Map `(attributeLevel, difficultyGrade, roll)` to an `OutcomeGrade` using `margin = (attribute + roll) - difficultyTarget(difficulty)` with targets Trivial=-2, Easy=-1, Average=0, Hard=+1, Formidable=+2 and the Failure/Partial/Success/Critical thresholds
    - _Requirements: 11.3, 11.4_

  - [x]* 2.2 Write property test for EZFudge mapping
    - **Property 23: EZFudge mapping is total and consistent** — for any attribute/difficulty/roll in range, exactly one Outcome_Grade is returned, and the result is monotonic (raising roll or attribute never lowers the grade; raising difficulty never raises it)
    - **Validates: Requirements 11.3**

  - [x] 2.3 Implement the Dice Service
    - Implement `roll()` returning a summed-dice integer over the configured dice model (`count` unbiased uniform dice over `face`, aggregate range `diceRange`) using a cryptographically seeded generator, server-side only; expose a failure path used later for withholding
    - _Requirements: 11.2, 11.6_

  - [x]* 2.4 Write property test for dice distribution
    - **Property 25: Dice are unbiased and follow the configured distribution** — over a large sample every die is uniform over its face, and the aggregate roll matches the configured model (flat for one die; symmetric and centre-weighted for a sum of dice, with extremes rarer than the centre)
    - **Validates: Requirements 11.6**

- [x] 3. Implement Turn_State model and lossless serialization
  - [x] 3.1 Define Turn_State entity types and JSON serializer/deserializer
    - Implement `TurnState`, `ReadinessEntry`, `ChatEntry`, `CheckRecord`, `NarrativeContextEntry` with `serialize`/`deserialize` functions that round-trip losslessly
    - _Requirements: 12.1, 12.2_

  - [x]* 3.2 Write property test for Turn_State serialization
    - **Property 26: Turn_State serialization round-trip** — deserializing the serialized JSON yields an equal Turn_State and always includes round number, phase, per-player readiness, each player's pending action, and recent narrative context
    - **Validates: Requirements 12.1, 12.2**

- [x] 4. Implement Room Service (creation, invites, joining)
  - [x] 4.1 Implement room creation and invite token generation
    - Implement `createRoom`, `getInviteLink`, and `resolveInvite` producing a unique room id, an unguessable high-entropy invite token mapped 1:1 to the room, and host designation
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2_

  - [x]* 4.2 Write property test for room identity and host designation
    - **Property 1: Unique room identity and host designation** — every created room has a unique id and invite token, and the requester is host
    - **Validates: Requirements 1.1, 1.2**

  - [x]* 4.3 Write property test for invite link round-trip
    - **Property 2: Invite link round-trip** — fetching the invite link returns the token from creation, and resolving that token returns the same room
    - **Validates: Requirements 1.3, 2.1**

  - [x] 4.4 Implement join with capacity, lobby gating, and display-name uniqueness
    - Implement `joinRoom` checking capacity (max 6) before adding, rejecting with `ROOM_FULL`, allowing joins only while `lobby`, and assigning a display name unique within the room
    - _Requirements: 1.4, 1.5, 2.3, 2.4, 2.6_

  - [x]* 4.5 Write property test for room capacity
    - **Property 3: Room capacity is never exceeded** — player count never exceeds 6, checked before adding; a join against a full room is rejected with `ROOM_FULL` leaving the room unchanged
    - **Validates: Requirements 1.4, 2.3, 2.4**

  - [x]* 4.6 Write property test for join-before-start gating
    - **Property 4: Joins allowed only before session start** — a join is admitted iff the room is in `lobby` and below capacity
    - **Validates: Requirements 1.5**

  - [x]* 4.7 Write property test for display-name uniqueness
    - **Property 5: Display names are unique within a room** — across any join sequence with colliding requested names, assigned display names contain no duplicates
    - **Validates: Requirements 2.6**

  - [x]* 4.8 Write unit tests for invalid invite and full-room messaging
    - Cover the "Room unavailable" (invalid token) and "Room full" rejection messages
    - _Requirements: 2.2, 2.4_

- [x] 5. Implement Scenario selection and Character setup
  - [x] 5.1 Implement scenario listing and association
    - Implement `selectScenario` and scenario read-back; pre-select the single MVP scenario as default and require explicit selection when more than one exists
    - _Requirements: 3.2, 3.4, 3.5_

  - [x]* 5.2 Write property test for scenario association
    - **Property 6: Scenario association round-trip** — reading the room's scenario after selection returns the selected scenario
    - **Validates: Requirements 3.2**

  - [x] 5.3 Implement character recording, confirmation locking, name uniqueness, and start gating
    - Implement `recordCharacter`, confirmation that locks attributes and disallows further revision, rejection of duplicate character names, and `canStart`/`startSession` gating on all players confirmed
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 5.1_

  - [x]* 5.4 Write property test for confirmed-character immutability
    - **Property 7: Confirmed characters are immutable** — after confirmation, any revision attempt is rejected and recorded attributes remain equal to confirmation-time values
    - **Validates: Requirements 4.4**

  - [x]* 5.5 Write property test for character recording and name uniqueness
    - **Property 8: Character recording and name uniqueness** — each confirmed character is recorded, and confirming a name already used in the room is rejected so names stay unique
    - **Validates: Requirements 4.5, 4.6**

  - [x]* 5.6 Write property test for session start gating
    - **Property 9: Session start gating** — the session can start iff every player has confirmed a character; start is prevented while any player is unconfirmed
    - **Validates: Requirements 4.7, 5.1**

  - [x]* 5.7 Write unit tests for character setup prompts and editability
    - Cover the name/concept prompt and accept/revise-before-confirm behavior
    - _Requirements: 4.1, 4.3_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement the round-loop reducer: start, free-chat, and readiness
  - [x] 7.1 Implement session start and Turn_State initialization in the pure reducer
    - Implement `(TurnState, Command) -> TurnState` handling of `START_SESSION`, initializing `roundNumber = 1` and `phase = free_chat`
    - _Requirements: 5.4_

  - [x]* 7.2 Write property test for Turn_State initialization
    - **Property 10: Turn_State initialization on start** — after the host starts, `roundNumber == 1` and `phase == free_chat`
    - **Validates: Requirements 5.4**

  - [x] 7.3 Implement free-chat message handling
    - Handle `SEND_CHAT` in `free_chat` phase: accept messages from room members, append to the current round's `chatLog` in send order, attributed to the sender's character name
    - _Requirements: 6.1, 6.3, 6.4_

  - [x]* 7.4 Write property test for free-chat acceptance and attribution
    - **Property 11: Free-chat acceptance and attribution** — messages are accepted, retained in `chatLog` in send order, and attributed to the sender's character name
    - **Validates: Requirements 6.1, 6.3, 6.4**

  - [x] 7.5 Implement readiness recording for confirm and pass
    - Handle `CONFIRM_ACTION` (mark ready, `actionKind = confirmed_action`, store action text) and `PASS` (mark ready, `actionKind = pass`, no text); open the ready-check gate on first submission
    - _Requirements: 7.1, 7.2_

  - [x]* 7.6 Write property test for readiness recording
    - **Property 12: Readiness recording for confirm and pass** — confirm marks ready with action text; pass marks ready with no text
    - **Validates: Requirements 7.1, 7.2**

- [x] 8. Implement the round-loop reducer: gating, revision, and revert
  - [x] 8.1 Implement resolution gating
    - Transition to `resolving` iff every active player is ready or Force_Proceed occurred; otherwise withhold resolution
    - _Requirements: 7.4, 7.5, 7.7_

  - [x]* 8.2 Write property test for resolution gating
    - **Property 13: Resolution gating** — the round enters `resolving` iff all active players ready or host force-proceeded
    - **Validates: Requirements 7.4, 7.5, 7.7**

  - [x] 8.3 Implement revision before resolution and locking during resolution
    - Handle `REVISE` accepted while `ready_check`, rejected once `resolving` (controls locked)
    - _Requirements: 7.6, 7.8_

  - [x]* 8.4 Write property test for revision/locking
    - **Property 14: Revision allowed only before resolution; locked during resolution** — revision accepted in `ready_check`, rejected in `resolving`
    - **Validates: Requirements 7.6, 7.8**

  - [x] 8.5 Implement mid-resolution revert halt
    - When an accepted readiness revert occurs during `resolving`, discard the pending narration, clear `resolutionRequested`, and return phase to `ready_check`
    - _Requirements: 7.9_

  - [x]* 8.6 Write property test for mid-resolution revert
    - **Property 15: Mid-resolution revert halts and returns to ready-check** — an accepted revert during `resolving` halts the in-progress resolution (pending narration discarded) and returns to `ready_check`
    - **Validates: Requirements 7.9**

- [x] 9. Implement the round-loop reducer: timeout, force-proceed, resolution lifecycle
  - [x] 9.1 Implement ready-check timeout auto-pass
    - On entering `ready_check`, set a deadline for not-ready players; handle `TIMEOUT_EXPIRED` by applying an Auto_Pass (`actionKind = auto_pass`, distinguishable from manual pass) and marking ready
    - _Requirements: 8.1, 8.2, 8.5_

  - [x]* 9.2 Write property test for timeout auto-pass
    - **Property 16: Ready-check timeout produces auto-pass** — an expired deadline applies Auto_Pass marking the player ready with `actionKind = auto_pass`, distinguishable from a manual pass
    - **Validates: Requirements 8.1, 8.2, 8.5**

  - [x] 9.3 Implement host force-proceed
    - Handle `FORCE_PROCEED`: host-only; auto-pass all unready active players and trigger resolution once; reject non-host invocations leaving Turn_State unchanged; abort and withhold if any auto-pass fails
    - _Requirements: 9.2, 9.3, 9.4_

  - [x]* 9.4 Write property test for force-proceed
    - **Property 17: Force-proceed auto-passes all unready players (host only)** — host force-proceed marks unready players auto-passed and triggers resolution exactly once; non-host invocation rejected with state unchanged
    - **Validates: Requirements 9.2, 9.4**

  - [x]* 9.5 Write unit test for force-proceed auto-pass failure abort
    - Cover the abort path where an auto-pass failure during force-proceed withholds resolution and keeps readiness intact
    - _Requirements: 9.3_

  - [x] 9.6 Implement at-most-once resolution guard and round advancement
    - Use the `resolutionRequested` check-and-set guard so all-ready/timeout/force triggers issue at most one resolution per round; on successful `RESOLUTION_READY` delivery, advance to `roundNumber + 1` and set `phase = free_chat`; record resolved checks in `checks`
    - _Requirements: 10.3, 10.5, 11.5, 16.1_

  - [x]* 9.7 Write property test for at-most-once resolution
    - **Property 19: At-most-once resolution per round** — any combination/concurrency of triggers issues at most one resolution request per round
    - **Validates: Requirements 10.3, 16.1**

  - [x]* 9.8 Write property test for round advancement
    - **Property 20: Round advancement after delivery** — after successful delivery, Turn_State advances to `roundNumber + 1` with `phase == free_chat`
    - **Validates: Requirements 10.5**

  - [x]* 9.9 Write property test for check recording consistency
    - **Property 24: Each check is fully recorded and internally consistent** — each resolved check records difficulty, dice result, and outcome, and the recorded outcome equals `resolveCheck(attribute, difficulty, roll)`
    - **Validates: Requirements 11.5**

- [x] 10. Implement reducer convergence and terminal-state handling
  - [x] 10.1 Implement sequential convergence of concurrent readiness commands
    - Ensure the single-writer reducer applies a sequence of readiness commands so the resulting Turn_State reflects each player's final submission regardless of interleaving
    - _Requirements: 13.6_

  - [x]* 10.2 Write property test for concurrent readiness convergence
    - **Property 29: Concurrent readiness changes all converge** — for any interleaving, the resulting Turn_State reflects each player's final submission
    - **Validates: Requirements 13.6**

  - [x] 10.3 Implement ended/terminal state handling
    - On ending condition during resolution, set `phase = ended` and room state `ended`; reject new rounds and any start/restart request on an ended room
    - _Requirements: 15.4, 15.6, 15.7_

  - [x]* 10.4 Write property test for terminal rooms
    - **Property 32: Ended rooms are terminal** — an ended room's state is `ended`, no new round advances, and start/restart requests are rejected
    - **Validates: Requirements 15.4, 15.6, 15.7**

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement Turn_State Store and AI context derivation
  - [x] 12.1 Implement Turn_State Store and context builder
    - Implement `get`/`save` (Redis live + Postgres durable shapes behind an interface) and `toContext` deriving `TurnStateContext` from the current Turn_State (scenario, characters, current-round actions/checks, recent narrative)
    - _Requirements: 10.2, 12.3, 12.4_

  - [x]* 12.2 Write property test for AI context derivation
    - **Property 27: AI context is derived from the current Turn_State** — provided context is derived from the room's current Turn_State
    - **Validates: Requirements 10.2, 12.4**

  - [x] 12.3 Implement narrative-context update and token-budget truncation
    - Append resolution narration to `narrativeContext` after resolution; truncate oldest narrative entries when over token budget while always preserving the current round's readiness and actions
    - _Requirements: 12.5, 16.3_

  - [x]* 12.4 Write property test for narrative-context update
    - **Property 28: Narrative context updated after resolution** — resolution narration is appended to recent narrative context
    - **Validates: Requirements 12.5**

  - [x]* 12.5 Write property test for token-budget truncation
    - **Property 34: Token-budget truncation preserves the current round** — over-budget context is trimmed to fit while retaining the current round's readiness/actions; only oldest narrative entries are trimmed
    - **Validates: Requirements 16.3**

- [x] 13. Implement AI GM Coordinator
  - [x] 13.1 Implement the provider-agnostic `AiGmClient` adapter and model-tier routing
    - Implement `complete({ tier, prompt, budget })` and route each request type (opening/attributes/resolution/ending) to its configured model tier
    - Emit an `ai_call` QA event per call via the EventSink (17.1): model name and the provider `usage` verbatim (input tokens, output tokens, cache read/write tokens) for per-round cost estimation
    - _Requirements: 16.2, 18.4_

  - [x]* 13.2 Write property test for model-tier routing
    - **Property 33: AI requests are routed to their configured model tier** — each request type invokes the client with the configured tier
    - **Validates: Requirements 16.2**

  - [x] 13.3 Implement `resolveRound`: check selection, dice, EZFudge, then narration
    - Ask the model which checks apply and at what difficulty, call the Dice_Service per check, map via EZFudge, then narrate using resolved outcomes; build context that includes an action entry for every active player; keep randomness server-side
    - Emit a `state_mutation` QA event capturing BOTH the AI-proposed state change (proposed diff) and the value the engine actually applied (applied diff), so AI hallucinations (invalid/absent changes) can be detected
    - _Requirements: 10.1, 10.6, 11.1, 11.2, 11.4, 18.5_

  - [x]* 13.4 Write property test for checks-before-narration ordering
    - **Property 21: Checks resolved before narration uses their outcomes** — dice is invoked and Outcome_Grade computed before being supplied to the AI GM
    - **Validates: Requirements 10.6, 11.4**

  - [x]* 13.5 Write property test for server-side dice authority
    - **Property 22: Dice are server-side and never AI-sourced** — the random value used always comes from the Dice_Service, never from an AI-provided value
    - **Validates: Requirements 11.2**

  - [x]* 13.6 Write property test for resolution incorporating every submission
    - **Property 18: Resolution incorporates every player's submission** — the narration context contains an action entry for every active player
    - **Validates: Requirements 10.1**

  - [x] 13.7 Implement Korean validation, retry policy, and failure preservation
    - Validate responses are Korean and withhold/report on non-Korean output (never substitute another language); retry failed requests up to 2 additional times (3 total) stopping on success; on exhausted failure, report error and leave Turn_State (recorded actions/passes) identical to its pre-request value with `resolutionRequested` cleared
    - Emit an `ai_output` QA event capturing the raw AI output BEFORE parsing/validation, plus the schema-validation pass/fail result and the failure reason on failure, so validation-failure cases can be reproduced
    - _Requirements: 14.4, 17.1, 17.2, 17.4, 18.6_

  - [x]* 13.8 Write property test for non-Korean withholding
    - **Property 30: Non-Korean narration is withheld, never substituted** — non-Korean responses are withheld with a reported failure
    - **Validates: Requirements 14.4**

  - [x]* 13.9 Write property test for AI retry bound
    - **Property 35: AI retry bound** — at most 3 total attempts, stopping immediately on success
    - **Validates: Requirements 17.1**

  - [x]* 13.10 Write property test for failed-resolution state preservation
    - **Property 36: Failed resolution preserves the round's state** — after exhausted retries, an error is reported and Turn_State (including recorded actions/passes) is identical to its pre-request value
    - **Validates: Requirements 17.2, 17.4**

  - [x] 13.11 Implement opening, attribute-proposal, and ending generation
    - Implement `generateOpening`, `proposeAttributes`, and `generateEnding` (closing narration + Session_Summary) through the coordinator and tiers
    - _Requirements: 4.2, 5.2, 15.1, 15.2_

  - [x]* 13.12 Write unit tests for dice-service-failure withholding and AI attribute completeness
    - Cover dice failure withholding the affected resolution until a result is produced, and attribute proposal returning a complete attribute set
    - _Requirements: 4.2, 17.3_

  - [x] 13.13 Implement AiGmClient record/replay mode for corpus capture and regression reuse
    - Wrap the provider-agnostic `AiGmClient` with a record mode that captures each real AI call (request type, model tier, prompt/context, raw response, and token usage) into a durable, append-only corpus keyed by a stable request fingerprint, building a reusable dataset for later judge/regression evaluation. Add a replay mode that, given a corpus, serves matching recorded responses deterministically (no live provider call) and falls back to (or flags) a miss; reuse the existing `ai_call`/`ai_output` QA events. Provide a passthrough/off mode as the default so production behavior is unchanged.
    - _Requirements: 16.2, 17.1, 18.4, 18.6_

- [x] 14. Implement durable persistence
  - [x] 14.1 Implement Postgres persistence for durable entities
    - Implement repositories for `Room`, `Player`, `Character`, `Scenario`, and `SessionSummary`, plus Turn_State persistence on change; provide scenario listing for the MVP scenario
    - Implement a durable, queryable `EventSink` backend for the QA events (table or log stream keyed by `sessionId` + `roundNo` with time ordering), satisfying the acceptance criterion that any session's five event types are retrievable per round in chronological order
    - _Requirements: 3.1, 12.3, 15.3, 18.1, 18.2_

  - [x]* 14.2 Write property test for session summary persistence
    - **Property 31: Session summary persistence round-trip** — the persisted Session_Summary loaded afterward equals the generated closing narration and summary text for that room
    - **Validates: Requirements 15.3**

  - [x]* 14.3 Write integration test for Turn_State persistence on change
    - Verify a tracked Turn_State change is persisted durably
    - _Requirements: 12.3_

- [x] 15. Implement Realtime Channel (WebSocket gateway)
  - [x] 15.1 Implement the WebSocket gateway connection lifecycle and broadcast
    - Implement connect/reconnect handlers that deliver current Turn_State, heartbeat-driven re-establishment, broadcast of Turn_State changes, chat delivery-failure notify+retry, and buffering of narration generated while no players are connected
    - _Requirements: 6.5, 10.7, 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x]* 15.2 Write integration tests for realtime sync and resync
    - Cover broadcast latency on Turn_State/scenario/player/readiness changes, connect/reconnect resync to current state, and narration buffering delivered on connect
    - _Requirements: 2.5, 3.3, 4.5, 5.3, 6.2, 7.3, 8.3, 9.5, 10.4, 10.7, 13.1, 13.2, 13.3, 13.4, 13.5, 15.5_

  - [x]* 15.3 Write unit test for chat delivery-failure handling
    - Verify affected players are notified and delivery is retried on failure
    - _Requirements: 6.5_

- [x] 16. Implement REST surface and wire the system together
  - [x] 16.1 Implement the non-realtime REST endpoints
    - Implement `POST /rooms`, `GET /rooms/:token`, `GET /rooms/:id/invite`, `GET /scenarios`, and `GET /rooms/:id/summary` over the Room Service and persistence
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 15.3_

  - [x] 16.2 Wire the per-room orchestrator actor to the gateway, stores, and AI coordinator
    - Connect the WebSocket gateway events to sequential per-room command handling, the Turn_State Store (Redis/Postgres), the AI GM Coordinator, and the Dice_Service so a full round flows free-chat → ready-check → resolution → next round
    - Emit a `round_timing` QA event per round capturing the all-players-confirmed timestamp and the GM-narration-returned timestamp (latency measurement); wire a configured EventSink (default no-op) through the orchestrator
    - _Requirements: 5.2, 5.3, 10.1, 10.4, 10.5, 13.6, 15.1, 15.2, 15.5, 18.5_

  - [x]* 16.3 Write end-to-end integration test for the AI round flow
    - Drive opening → round resolution → ending with a mocked `AiGmClient` and a language detector at the boundary
    - _Requirements: 5.2, 10.1, 14.1, 15.1, 15.2_

  - [x]* 16.4 Write smoke/configuration tests
    - Verify default ready-check timeout (90,000 ms) and that model-tier and token-budget config load correctly
    - _Requirements: 8.4, 16.2, 16.3_

- [x] 17. Implement QA instrumentation (structured event logging)
  - [x] 17.1 Define the structured QA event model and async best-effort EventSink
    - Define a common correlation envelope (`sessionId`/roomId, `roundNo`, `eventId`, `timestamp`, `eventType`) and the five structured (JSON) event payloads: `dice_roll`, `state_mutation`, `ai_call`, `round_timing`, `ai_output`. Implement an async, non-blocking, best-effort `EventSink` interface (logging failures must never block or fail game flow) with an in-memory implementation that supports time-ordered query by session and by round. Provide a no-op sink as the default so the engine runs without instrumentation configured.
    - _Requirements: 18.1, 18.2, 18.7_
  - [x] 17.2 Retrofit the Dice Service for a reproducible recorded seed and emit `dice_roll` events
    - Replace the non-reproducible CSPRNG draw with a server-side seeded PRNG; generate the seed via the CSPRNG (so rolls stay unpredictable) and record it for replay. Emit a `dice_roll` event per roll capturing the roller, the dice expression/range, the raw value(s), the resolved result, and the seed. Dice MUST remain 100% server-side (never client/AI sourced). Preserve the existing failure path.
    - _Requirements: 18.3, 11.2, 11.6_
  - [x] 17.3 Add a deterministic seed-injection / replay mode to the Dice Service
    - Build a first-class injectable seed source that replays an ordered list of recorded seeds (from prior `dice_roll` events) so a session's checks reproduce exactly, then surfaces deterministic misses (exhaustion) rather than silently falling back to the CSPRNG. Provide a small helper to construct a replay `DiceService` from a recorded seed sequence and a fixed-seed convenience for tests. Production default stays CSPRNG-seeded and unchanged.
    - _Requirements: 11.2, 11.6, 18.3_
  - Note: `ai_call`, `ai_output`, `state_mutation`, and `round_timing` emission are implemented within their owning tasks (13.1/13.3/13.7 for AI, 16.2 for timing, 14.1 for durable/queryable storage), all built on the 17.1 EventSink.

- [x] 18. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Verify the acceptance criteria: for any chosen session, the five event types are queryable per round in time order; dice occur only server-side; logging failures do not block gameplay.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but they validate the 36 correctness properties and key examples/integrations.
- Each of the 36 design properties is implemented as a single `fast-check` property test (minimum 100 iterations) tagged `// Feature: trpg-session-engine, Property {number}: {property_text}`.
- The pure core (EZFudge resolver, Dice Service, Turn_State serializer, round-loop reducer) is built and property-tested before transport/AI/DB wiring so state-machine properties are deterministic.
- Realtime "within 2 seconds" timing, AI generation quality, and persistence wiring are covered by integration/smoke tests, not property tests, per the design's Testing Strategy.
- Checkpoints ensure incremental validation at natural breaks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.3", "3.1", "4.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "3.2", "4.2", "4.3", "4.4", "5.2", "5.3"] },
    { "id": 3, "tasks": ["4.5", "4.6", "4.7", "4.8", "5.4", "5.5", "5.6", "5.7", "7.1", "7.3", "7.5"] },
    { "id": 4, "tasks": ["7.2", "7.4", "7.6", "8.1", "8.3", "8.5"] },
    { "id": 5, "tasks": ["8.2", "8.4", "8.6", "9.1", "9.3", "9.6"] },
    { "id": 6, "tasks": ["9.2", "9.4", "9.5", "9.7", "9.8", "9.9", "10.1", "10.3"] },
    { "id": 7, "tasks": ["10.2", "10.4", "12.1", "12.3", "13.1"] },
    { "id": 8, "tasks": ["12.2", "12.4", "12.5", "13.2", "13.3", "13.11", "14.1"] },
    { "id": 9, "tasks": ["13.4", "13.5", "13.6", "13.7", "14.2", "14.3"] },
    { "id": 10, "tasks": ["13.8", "13.9", "13.10", "13.12", "15.1", "16.1"] },
    { "id": 11, "tasks": ["15.2", "15.3", "16.2"] },
    { "id": 12, "tasks": ["16.3", "16.4"] }
  ]
}
```
