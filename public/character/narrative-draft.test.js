import { describe, expect, it } from "vitest";
import {
  applyNarrativeDraftsToBlankFields,
  buildNarrativeDraftRequest,
} from "./logic.js";

describe("character-sheet narrative draft helpers", () => {
  it("builds the narrative-draft request with auth and selected card", () => {
    const req = buildNarrativeDraftRequest("room 1", "player/1", "  concept  ", " card-a ", "tok", "ticket");
    expect(req.url).toBe("/rooms/room%201/players/player%2F1/narrative-draft");
    expect(req.method).toBe("POST");
    expect(req.headers["x-playtest-token"]).toBe("tok");
    expect(req.headers["x-connection-ticket"]).toBe("ticket");
    expect(JSON.parse(req.body)).toEqual({
      concept: "concept",
      selectedCardId: "card-a",
    });
  });

  it("applies AI drafts only to blank known fields and clamps lengths", () => {
    const schema = {
      narrativeFields: [
        { id: "name", maxLength: 10 },
        { id: "concept", maxLength: 8 },
        { id: "bonds", maxLength: 5 },
      ],
    };
    const next = applyNarrativeDraftsToBlankFields(
      { concept: "이미 있음", bonds: "   " },
      schema,
      { name: "이름", concept: "덮어쓰기", bonds: "123456", unknown: "무시" },
    );
    expect(next).toEqual({ concept: "이미 있음", bonds: "12345" });
  });
});
