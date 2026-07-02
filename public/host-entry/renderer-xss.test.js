// @vitest-environment happy-dom
// @ts-nocheck
import { describe, expect, it } from "vitest";
import { renderInvitePanel } from "./logic.js";

describe("host-entry escaped string renderer", () => {
  it("does not create attacker-controlled elements when inserted as HTML", () => {
    const mount = document.createElement("div");
    mount.innerHTML = renderInvitePanel({
      inviteLink: '<img src=x onerror="window.__xss=1">',
      maxPlayers: '<script>window.__xss=1</script>',
    });

    expect(mount.querySelector("img")).toBeNull();
    expect(mount.querySelector("script")).toBeNull();
    expect(mount.textContent).toContain('<img src=x onerror="window.__xss=1">');
    expect(mount.textContent).toContain("<script>window.__xss=1</script>");
    expect(window.__xss).toBeUndefined();
  });
});
