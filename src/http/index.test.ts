import { describe, expect, it } from "vitest";
import * as httpExports from "./index.js";

describe("HTTP package entry", () => {
  it("does not export the unauthenticated legacy Express app surface", () => {
    expect("createApp" in httpExports).toBe(false);
    expect("InMemorySummaryReader" in httpExports).toBe(true);
  });
});
