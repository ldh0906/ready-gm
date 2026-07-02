import {
  createEmptyBlackboard,
  type ScenarioBlackboard,
} from "../core/scenario-blackboard.js";

export function seedBlackboardForScenario(roomId: string, scenarioId: string): ScenarioBlackboard {
  const empty = createEmptyBlackboard(roomId, scenarioId);
  switch (scenarioId) {
    case "the-sunless-crypt":
      return {
        ...empty,
        sceneNodes: [
          { id: "crypt_entrance", name: "Crypt entrance", status: "active" },
          { id: "chapel_interior", name: "Ruined chapel" },
        ],
        activeThreats: [{ id: "crypt_cold", name: "Unnatural crypt cold", status: "pressing" }],
        fronts: [{ id: "waking_crypt", name: "The crypt wakes", stage: "stirring" }],
        clues: [
          {
            id: "small_footprints",
            conclusion: "The children walked into the crypt rather than being dragged.",
            discoveryCondition: { kind: "scene_entry", sceneId: "crypt_entrance" },
            visibility: "undiscovered",
            redundantPathGroup: "children_entered_willingly",
          },
          {
            id: "ritual_symbol",
            conclusion: "The broken seal matches a warding rite, not a summoning mark.",
            discoveryCondition: { kind: "action_intent", intent: "inspect" },
            visibility: "undiscovered",
            redundantPathGroup: "seal_origin",
          },
          {
            id: "fresh_blood",
            conclusion: "Someone living was hurt recently at the chapel threshold.",
            discoveryCondition: { kind: "check_result", outcome: "Success" },
            visibility: "undiscovered",
            redundantPathGroup: "recent_violence",
          },
        ],
        secrets: [
          {
            id: "children_opened_crypt",
            truth: "The missing children opened the crypt willingly after hearing voices below.",
            sensitivity: "medium",
            revealState: "hidden",
            relatedClueIds: ["small_footprints"],
          },
          {
            id: "priest_knows_seal",
            truth: "The village priest recognizes the warding seal and is hiding prior knowledge of the crypt.",
            sensitivity: "high",
            revealState: "hidden",
            relatedClueIds: ["ritual_symbol", "fresh_blood"],
          },
        ],
        npcs: [
          {
            npcId: "npc_village_priest",
            name: "창백한 사제",
            role: "Village priest",
            attitudeByCharacter: {},
            goals: ["keep the party moving", "avoid explaining the old ward"],
            knownSecretIds: ["priest_knows_seal"],
            location: "crypt_entrance",
            pressureClockId: "crypt_alert",
          },
        ],
      };
    default:
      return empty;
  }
}
