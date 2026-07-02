import { cloneBlackboard, type ScenarioBlackboard } from "../core/scenario-blackboard.js";

export interface BlackboardStore {
  get(roomId: string): ScenarioBlackboard | undefined;
  save(roomId: string, blackboard: ScenarioBlackboard): void;
}

export class InMemoryBlackboardStore implements BlackboardStore {
  private readonly blackboards = new Map<string, ScenarioBlackboard>();

  get(roomId: string): ScenarioBlackboard | undefined {
    const blackboard = this.blackboards.get(roomId);
    return blackboard === undefined ? undefined : cloneBlackboard(blackboard);
  }

  save(roomId: string, blackboard: ScenarioBlackboard): void {
    this.blackboards.set(roomId, cloneBlackboard(blackboard));
  }
}
