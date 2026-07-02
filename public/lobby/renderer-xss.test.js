// @vitest-environment happy-dom
// @ts-nocheck
import { describe, expect, it } from "vitest";
import { renderRoster } from "./logic.js";

describe("lobby escaped string renderer", () => {
  it("does not create attacker-controlled elements when inserted as HTML", () => {
    const mount = document.createElement("div");
    mount.innerHTML = renderRoster(
      [
        {
          id: "p1",
          displayName: '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>',
          isHost: true,
        },
      ],
      6,
    );

    expect(mount.querySelector("img")).toBeNull();
    expect(mount.querySelector("script")).toBeNull();
    expect(mount.textContent).toContain('<img src=x onerror="window.__xss=1">');
    expect(mount.textContent).toContain("<script>window.__xss=1</script>");
    expect(window.__xss).toBeUndefined();
  });
});
