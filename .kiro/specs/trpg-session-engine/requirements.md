# Requirements Document

## Introduction

This document specifies the requirements for the **TRPG Session Engine**, the Phase 1 MVP core of an AI-powered Tabletop Role-Playing Game (TRPG) Game Master web service. A group of friends join a shared, remotely-hosted session and play together while an AI acts as the Game Master.

The MVP goal is to validate fun: four friends complete one approximately two-hour one-shot session and enjoy it. The scope of this specification is the hardest and most central part of the MVP: the **ready-check hybrid real-time session combined with the AI GM progression loop**.

The session alternates between free-form text roleplay and structured round resolution. At the end of each round, every player must explicitly confirm an action or pass before the AI GM narrates the combined outcome, using server-side dice rolls and the EZFudge difficulty-grade rule system. The engine maintains short-term turn state as JSON and synchronizes that state across all connected players in real time.

**Out of scope for this specification (deferred to later phases):** payment, illustrations, user-generated scenarios, campaign long-term memory, multi-session continuity, and random scenario generation.

### Decisions Pending Confirmation

The following product decisions were resolved with reasonable defaults to produce this initial draft. They are flagged for review and may be revised during iteration:

1. **Rule system:** EZFudge (lightweight, generic, difficulty judgment via a ladder of grades), chosen because it maps cleanly onto the ready-check round structure.
2. **Dice authority:** Dice are rolled server-side by a dedicated Dice Service and the result is injected into the AI GM prompt. The AI GM narrates the outcome but does not generate the random result, ensuring fairness and consistency.
3. **AI rule-judgment scope:** The AI GM selects which check applies and the difficulty grade; the Dice Service produces the numeric result; the engine maps the result to a success grade. Combat is resolved as narrative difficulty checks rather than a separate tactical combat subsystem.
4. **Language:** The AI GM narrates and converses in Korean by default.

## Glossary

- **Session_Engine**: The complete system specified by this document, responsible for room lifecycle, the round loop, AI GM coordination, dice resolution, turn state, and real-time synchronization.
- **Room**: A single session container identified by a unique room identifier, holding the set of players, the selected scenario, and the current session state.
- **Host**: The Player who created the Room and holds elevated control, including the force-proceed action.
- **Player**: A participant in a Room, including the Host.
- **AI_GM**: The artificial-intelligence Game Master that narrates the story, interprets player actions, selects difficulty grades, and narrates round outcomes.
- **Scenario**: The pre-authored one-shot adventure content selected for the session. The MVP provides exactly one team-authored Scenario.
- **Character**: A Player's in-game persona, including a name, descriptive traits, and EZFudge attributes, created during setup.
- **Round**: One cycle of the progression loop consisting of a free-chat phase followed by a Ready_Check phase and an AI GM resolution.
- **Ready_Check**: The mechanism that requires every active Player to submit a Confirmed Action or a Pass before the AI GM resolves the Round.
- **Confirmed_Action**: A Player's committed intended action for the current Round, submitted via the "Confirm action" control.
- **Pass**: A Player's explicit declaration of taking no action in the current Round, submitted via the "Pass" control.
- **Auto_Pass**: A system-generated Pass applied to a Player who does not respond before the Ready_Check timeout expires.
- **Force_Proceed**: The Host-only action that ends the Ready_Check phase immediately and triggers AI GM resolution.
- **Ready_Check_Timeout**: The configurable duration a Player has to respond during the Ready_Check phase before Auto_Pass is applied.
- **Dice_Service**: The server-side component that generates random dice results used in difficulty judgment.
- **EZFudge**: The lightweight rule system used for difficulty judgment, expressing outcomes as a ladder of named success grades.
- **Difficulty_Grade**: A named level on the EZFudge ladder representing the difficulty of a check (for example: Trivial, Easy, Average, Hard, Formidable).
- **Outcome_Grade**: The resolved result of a check after combining the Dice_Service result with the Difficulty_Grade (for example: Failure, Partial Success, Success, Critical Success).
- **Turn_State**: The JSON short-term-memory record describing the current Round number, phase, per-player readiness, pending actions, and recent narrative context within a single session.
- **Realtime_Channel**: The real-time communication mechanism that synchronizes Room and Turn_State changes to all connected Players.
- **Session_Summary**: The end-of-session recap produced by the AI_GM and persisted when the one-shot concludes.

## Requirements

### Requirement 1: Room Creation and Invitation

**User Story:** As a Host, I want to create a room and get a shareable invite link, so that I can bring my friends into the same session.

#### Acceptance Criteria

1. WHEN a Host requests a new Room, THE Session_Engine SHALL create a Room with a unique room identifier and designate the requesting Player as the Host.
2. WHEN a Room is created, THE Session_Engine SHALL generate a unique invite link associated with that Room.
3. WHEN a Host requests the invite link for an existing Room, THE Session_Engine SHALL return the invite link associated with that Room.
4. THE Session_Engine SHALL support a maximum of 6 Players per Room.
5. WHILE a Room has not started its session, THE Session_Engine SHALL allow additional Players to join.

### Requirement 2: Joining a Room

**User Story:** As a Player, I want to join my friend's room from the invite link, so that I can play in the same session.

#### Acceptance Criteria

1. WHEN a Player opens a valid invite link, THE Session_Engine SHALL add the Player to the associated Room.
2. IF a Player opens an invite link for a Room that does not exist, THEN THE Session_Engine SHALL display a message stating that the Room is unavailable.
3. WHEN a Player attempts to join a Room, THE Session_Engine SHALL check the Room's current Player count against the 6-Player capacity before adding the Player to the Room.
4. IF a Player attempts to join a Room that already contains 6 Players, THEN THE Session_Engine SHALL reject the join and display a message stating that the Room is full.
5. WHEN a Player joins a Room, THE Session_Engine SHALL notify all connected Players of the updated Player list within 2 seconds.
6. WHEN a Player joins a Room, THE Session_Engine SHALL assign the Player a display name that is unique within that Room.

### Requirement 3: Scenario Selection

**User Story:** As a Host, I want to select the one-shot scenario for the session, so that the group has shared content to play through.

#### Acceptance Criteria

1. WHEN the Host views the scenario selection, THE Session_Engine SHALL present the team-authored one-shot Scenario available for the MVP.
2. WHEN the Host selects a Scenario, THE Session_Engine SHALL associate that Scenario with the Room.
3. WHEN a Scenario is associated with the Room, THE Session_Engine SHALL display the Scenario title and introductory summary to all connected Players within 2 seconds.
4. WHERE only one Scenario is available, THE Session_Engine SHALL pre-select that Scenario as the default for the Room.
5. WHERE more than one Scenario is available, THE Session_Engine SHALL require the Host to explicitly select a Scenario before the session can start.

### Requirement 4: AI-Assisted Character Setup

**User Story:** As a Player, I want help from the AI to create my character, so that I can start playing quickly without knowing the rules.

#### Acceptance Criteria

1. WHEN a Player begins character setup, THE Session_Engine SHALL prompt the Player to provide a character name and character concept.
2. WHEN a Player submits a character concept, THE AI_GM SHALL propose a set of EZFudge attributes consistent with the concept and the selected Scenario.
3. WHEN the AI_GM proposes character attributes, THE Session_Engine SHALL allow the Player to accept or revise the proposed attributes before confirming the Character.
4. WHEN a Player confirms a Character, THE Session_Engine SHALL treat the Character's attributes as final and disallow further revision of that Character.
5. WHEN a Player confirms a Character, THE Session_Engine SHALL record the Character in the Room and notify all connected Players within 2 seconds.
6. IF a Player submits a character name that is already used by another Character in the Room, THEN THE Session_Engine SHALL reject the name and request a different name.
7. THE Session_Engine SHALL require every Player to confirm a Character before the session can start.

### Requirement 5: Session Start and Opening Narration

**User Story:** As a Player, I want the AI GM to set the scene at the start, so that we know where our adventure begins.

#### Acceptance Criteria

1. WHILE one or more Players have not confirmed a Character, THE Session_Engine SHALL prevent the session from starting.
2. WHEN the Host starts the session and every Player has confirmed a Character, THE AI_GM SHALL generate an opening narration based on the selected Scenario.
3. WHEN the opening narration is generated, THE Session_Engine SHALL deliver the opening narration to all connected Players within 2 seconds of its generation.
4. WHEN the Host explicitly starts the session, THE Session_Engine SHALL initialize the Turn_State with Round number 1 and the free-chat phase active.

### Requirement 6: Free-Chat Roleplay Phase

**User Story:** As a Player, I want to chat freely with my friends in character during a round, so that we can roleplay naturally.

#### Acceptance Criteria

1. WHILE a Round is in the free-chat phase, THE Session_Engine SHALL accept text chat messages from any Player in the Room.
2. WHEN a Player sends a chat message, THE Session_Engine SHALL deliver the message to all connected Players within 2 seconds.
3. WHILE a Round is in the free-chat phase, THE Session_Engine SHALL display each chat message attributed to the sending Player's Character name.
4. WHILE a Round is in the free-chat phase, THE Session_Engine SHALL retain the chat messages of the current Round as part of the Turn_State.
5. IF a chat message fails to be delivered to one or more connected Players, THEN THE Session_Engine SHALL notify the affected Players of the delivery failure and retry delivery.

### Requirement 7: Ready-Check Action Confirmation

**User Story:** As a Player, I want to confirm my action or pass at the end of a round, so that the GM only acts once everyone is ready.

#### Acceptance Criteria

1. WHEN a Player submits a Confirmed_Action during a Round, THE Session_Engine SHALL record the Confirmed_Action and mark that Player as ready in the Turn_State.
2. WHEN a Player submits a Pass during a Round, THE Session_Engine SHALL mark that Player as ready with no action in the Turn_State.
3. WHEN a Player's readiness changes, THE Session_Engine SHALL update the readiness indicator for all connected Players within 2 seconds.
4. WHILE at least one active Player is not marked ready, THE Session_Engine SHALL withhold AI GM round resolution.
5. WHEN every active Player is marked ready, THE Session_Engine SHALL trigger AI GM round resolution.
6. WHERE a Player has already submitted a Confirmed_Action or Pass for the current Round, THE Session_Engine SHALL allow the Player to revise that submission until round resolution begins.
7. THE Session_Engine SHALL withhold the resolving state until every active Player is marked ready or Force_Proceed is invoked.
8. WHEN AI GM round resolution begins, THE Session_Engine SHALL lock readiness submissions for the current Round.
9. IF a Player's readiness reverts to not-ready while AI GM round resolution is in progress, THEN THE Session_Engine SHALL halt the in-progress resolution and return the Round to the Ready_Check phase.

### Requirement 8: AFK Timeout Auto-Pass

**User Story:** As a Player, I want the round to keep moving when someone is away, so that we are not stuck waiting indefinitely.

#### Acceptance Criteria

1. WHEN the Ready_Check phase begins for a Round, THE Session_Engine SHALL start a Ready_Check_Timeout for each Player who is not yet marked ready.
2. IF a Player's Ready_Check_Timeout expires before that Player submits a Confirmed_Action or Pass, THEN THE Session_Engine SHALL apply an Auto_Pass for that Player and mark the Player as ready.
3. WHILE the Ready_Check phase is active, THE Session_Engine SHALL display the remaining time until Auto_Pass to all connected Players.
4. THE Session_Engine SHALL use a default Ready_Check_Timeout of 90 seconds.
5. WHEN an Auto_Pass is applied to a Player, THE Session_Engine SHALL indicate to all connected Players that the action was auto-passed.

### Requirement 9: Host Force-Proceed

**User Story:** As a Host, I want a "just proceed" button, so that I can advance the round without waiting for everyone.

#### Acceptance Criteria

1. WHILE a Round is awaiting one or more Player readiness submissions, THE Session_Engine SHALL make the Force_Proceed action available to the Host.
2. WHEN the Host invokes Force_Proceed, THE Session_Engine SHALL apply an Auto_Pass to every active Player who is not yet marked ready and trigger AI GM round resolution.
3. IF applying an Auto_Pass to any unready Player fails during Force_Proceed, THEN THE Session_Engine SHALL abort the Force_Proceed action and withhold AI GM round resolution.
4. THE Session_Engine SHALL restrict the Force_Proceed action to the Host.
5. WHEN the Host invokes Force_Proceed, THE Session_Engine SHALL notify all connected Players that the Round was advanced by the Host.

### Requirement 10: AI GM Round Resolution

**User Story:** As a Player, I want the AI GM to narrate the combined result of everyone's actions once per round, so that the story moves forward coherently.

#### Acceptance Criteria

1. WHEN AI GM round resolution is triggered, THE AI_GM SHALL generate one resolution narration that incorporates every Player's Confirmed_Action and Pass for the Round.
2. WHEN AI GM round resolution is triggered, THE Session_Engine SHALL provide the AI_GM with the current Turn_State as context.
3. THE Session_Engine SHALL issue at most one AI_GM resolution request per Round regardless of whether resolution was triggered by all-Players-ready or by Force_Proceed.
4. WHEN the resolution narration is generated, THE Session_Engine SHALL deliver the resolution narration to all connected Players within 2 seconds of its generation.
5. WHEN resolution narration is delivered, THE Session_Engine SHALL advance the Turn_State to the next Round number and set the phase to free-chat.
6. WHEN a Confirmed_Action requires a difficulty judgment, THE AI_GM SHALL request a check from the Dice_Service before narrating the outcome of that action.
7. IF no Players are connected when resolution narration is generated, THEN THE Session_Engine SHALL retain the resolution narration and deliver it to each Player upon connection.

### Requirement 11: Server-Side Dice and Difficulty Judgment

**User Story:** As a Player, I want dice results to be fair and consistent, so that I trust the outcomes of my actions.

#### Acceptance Criteria

1. WHEN a difficulty check is requested, THE AI_GM SHALL specify the Difficulty_Grade and the acting Character's relevant attribute.
2. WHEN a difficulty check is requested, THE Dice_Service SHALL generate the random result server-side rather than relying on the AI_GM to produce the random value.
3. WHEN the Dice_Service generates a result, THE Session_Engine SHALL map the result and the Difficulty_Grade to an Outcome_Grade using the EZFudge ladder.
4. WHEN an Outcome_Grade is determined, THE Session_Engine SHALL provide the Outcome_Grade to the AI_GM for narration.
5. THE Session_Engine SHALL record each check's Difficulty_Grade, dice result, and Outcome_Grade in the Turn_State.
6. THE Dice_Service SHALL produce each die as an unbiased draw, uniform over that die's face range, with the random result generated server-side; the result range MAY be defined as the sum of one or more dice (a single die yields a flat distribution, while summing multiple dice yields a symmetric, centre-weighted distribution over the aggregate range).

### Requirement 12: Turn State Short-Term Memory

**User Story:** As a Player, I want the AI GM to remember what just happened, so that the story stays consistent within our session.

#### Acceptance Criteria

1. THE Session_Engine SHALL maintain a Turn_State as a JSON record for each active Room.
2. THE Turn_State SHALL include the current Round number, the current phase, each Player's readiness status, each Player's pending Confirmed_Action or Pass, and recent narrative context.
3. WHEN any tracked element of the Turn_State changes, THE Session_Engine SHALL persist the updated Turn_State.
4. WHEN the AI_GM is invoked, THE Session_Engine SHALL include the current Turn_State in the AI_GM request context.
5. WHEN a Round resolution completes, THE Session_Engine SHALL update the recent narrative context in the Turn_State to include the resolution narration.

### Requirement 13: Real-Time Synchronization

**User Story:** As a Player, I want everyone's screen to stay in sync, so that we all see the same game state at the same time.

#### Acceptance Criteria

1. WHEN the Turn_State changes, THE Session_Engine SHALL propagate the change to all connected Players over the Realtime_Channel within 2 seconds.
2. WHEN a Player connects to a Room, THE Session_Engine SHALL deliver the current Turn_State to that Player.
3. IF a Player's Realtime_Channel connection is lost, THEN THE Session_Engine SHALL attempt to re-establish the connection.
4. WHEN a periodic health check indicates that a Player's Realtime_Channel is stale or unresponsive while appearing connected, THE Session_Engine SHALL attempt to re-establish the connection.
5. WHEN a Player's Realtime_Channel connection is re-established, THE Session_Engine SHALL deliver the current Turn_State to that Player so the Player's view matches the current Room state.
6. WHILE multiple Players submit readiness changes concurrently, THE Session_Engine SHALL apply each change so that the resulting Turn_State reflects all submitted changes.

### Requirement 14: Korean-Native GM Tone

**User Story:** As a Korean-speaking Player, I want the AI GM to narrate naturally in Korean, so that the game feels immersive.

#### Acceptance Criteria

1. THE AI_GM SHALL generate narration and conversational responses in Korean by default.
2. WHEN the AI_GM narrates a round resolution, THE AI_GM SHALL maintain a consistent Game-Master tone across the session.
3. WHERE a term has no established Korean equivalent, THE AI_GM SHALL be permitted to include that term in its original language within Korean narration.
4. IF Korean generation is unavailable for a requested narration, THEN THE Session_Engine SHALL withhold the narration and report the failure rather than substituting another language.

### Requirement 15: One-Shot Ending and Session Summary

**User Story:** As a Player, I want a satisfying ending and a saved recap, so that we can remember our session.

#### Acceptance Criteria

1. WHEN the Scenario's ending condition is reached, THE AI_GM SHALL generate a closing narration.
2. WHEN the closing narration is generated, THE AI_GM SHALL generate a Session_Summary of the session's key events.
3. WHEN a Session_Summary is generated, THE Session_Engine SHALL persist the Session_Summary associated with the Room.
4. WHEN end-of-session delivery begins, THE Session_Engine SHALL stop accepting new Rounds.
5. WHEN the session ends, THE Session_Engine SHALL deliver the closing narration and Session_Summary to all connected Players within 2 seconds of generation.
6. WHEN the session ends, THE Session_Engine SHALL set the Room state to ended and stop accepting new Rounds.
7. WHILE a Room state is ended, THE Session_Engine SHALL reject requests to restart or start a new session in that Room.

### Requirement 16: AI Cost Control

**User Story:** As the service operator, I want predictable AI usage per round, so that operating costs stay manageable.

#### Acceptance Criteria

1. THE Session_Engine SHALL issue at most one AI_GM resolution request per Round.
2. WHERE a configured AI model tier is selected for a request type, THE Session_Engine SHALL route that request to the configured model tier.
3. IF an AI_GM request exceeds a configured token budget, THEN THE Session_Engine SHALL truncate the provided Turn_State context to the most recent narrative context while preserving the current Round's readiness and actions.

### Requirement 17: AI and Connectivity Error Handling

**User Story:** As a Player, I want the session to recover gracefully from failures, so that one error does not end our game.

#### Acceptance Criteria

1. IF an AI_GM request fails, THEN THE Session_Engine SHALL retry the request up to 2 additional times before reporting an error.
2. IF an AI_GM request fails after all retries, THEN THE Session_Engine SHALL display an error message to all connected Players and preserve the current Turn_State so the Round can be retried.
3. IF the Dice_Service fails to produce a result for a requested check, THEN THE Session_Engine SHALL report the failure and withhold the affected resolution narration until a result is produced.
4. WHEN a Round resolution fails, THE Session_Engine SHALL keep the recorded Confirmed_Actions and Passes for the current Round so they are not lost.
