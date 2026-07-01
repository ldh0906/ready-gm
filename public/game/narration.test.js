// @ts-nocheck
/**
 * Property-based tests for Game_Play_App GM narration view model.
 * Feature: game-play
 *
 * Covers:
 * - Property 4: GM 서사는 도착 순서대로 추가되고 상한을 지킨다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { appendNarration, narrativeContextToEntries, MAX_ENTRIES, NarrationKind } from "./logic.js";

const entryGen = fc.record({
  kind: fc.constantFrom(NarrationKind.OPENING, NarrationKind.RESOLUTION, NarrationKind.CLOSING),
  roundNumber: fc.integer({ min: 0, max: 9999 }),
  text: fc.fullUnicodeString(),
});

describe("game-play property tests — narration", () => {
  it("Property 4: GM 서사는 도착 순서대로 추가되고 상한을 지킨다", () => {
    // Feature: game-play, Property 4: GM 서사는 도착 순서대로 추가되고 상한을 지킨다
    // MAX_ENTRIES(250) 미만/초과를 모두 자극하기 위해 0~300 길이의 시퀀스를 생성.
    const seqGen = fc.array(entryGen, { minLength: 0, maxLength: 300 });
    const ctxGen = fc.array(
      fc.record({ round: fc.integer({ min: 0, max: 9999 }), text: fc.fullUnicodeString() }),
      { maxLength: 300 },
    );

    fc.assert(
      fc.property(seqGen, ctxGen, (seq, ctx) => {
        let acc = [];
        for (const e of seq) {
          acc = appendNarration(acc, e);
        }
        const N = seq.length;
        // (a) 길이는 min(N, MAX_ENTRIES)를 넘지 않는다.
        expect(acc.length).toBe(Math.min(N, MAX_ENTRIES));

        if (N > 0) {
          // (b) 마지막 항목은 가장 최근에 추가한 항목.
          expect(acc[acc.length - 1]).toStrictEqual(seq[N - 1]);
        }
        if (N <= MAX_ENTRIES) {
          // (c) 상한 이내면 추가한 순서를 그대로 보존.
          expect(acc).toStrictEqual(seq);
        } else {
          // 초과 시 가장 오래된 것부터 제거된 꼬리 부분과 일치.
          expect(acc).toStrictEqual(seq.slice(N - MAX_ENTRIES));
        }

        // narrativeContextToEntries는 순서를 그대로 보존한다.
        const entries = narrativeContextToEntries(ctx);
        expect(entries.length).toBe(ctx.length);
        for (let i = 0; i < ctx.length; i++) {
          expect(entries[i]).toStrictEqual({
            kind: NarrationKind.RESOLUTION,
            roundNumber: ctx[i].round,
            text: ctx[i].text,
          });
        }
      }),
      { numRuns: 100 },
    );
  });
});
