// @ts-nocheck
/**
 * Property-based tests for Character_Sheet_App REST request building.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 3: REST 요청 명세는 올바른 URL·메서드·본문을 만든다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  buildSchemaRequest,
  buildProposalRequest,
  buildRecordRequest,
  buildConfirmRequest,
} from "./logic.js";

// 빈 문자열(토큰 없음) + 임의의 비어있지 않은 문자열(특수문자 포함, 토큰 있음).
const tokenGen = fc.oneof(fc.constant(""), fc.string({ minLength: 1 }));

// roomId·playerId: 인코딩이 필요한 문자(`/`, 공백, `?`, `#`, `&`, 한글, 이모지 등)를 포함할 수 있는 임의 문자열.
const idGen = fc.oneof(
  fc.string(),
  fc.string({ unit: fc.constantFrom("/", " ", "?", "#", "&", "=", "%", "가", "🙂") }),
);

// 앞뒤 공백을 무작위로 덧붙여 트림 동작을 검증하기 위한 텍스트 생성기(내부 공백 보존 확인 포함).
const wsGen = fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 4 });
const paddedTextGen = fc
  .tuple(wsGen, fc.string(), wsGen)
  .map(([lead, core, trail]) => lead + core + trail);

// Trait_Key 목록.
const traitKeysGen = fc.array(fc.string({ minLength: 1 }), { maxLength: 8 });

// 서사 필드 맵(fieldId → 보존된 값). "__proto__" 키는 JSON 라운드트립 비교를 어지럽히므로 제외.
const narrativeGen = fc.dictionary(
  fc.string({ minLength: 1 }).filter((k) => k !== "__proto__"),
  paddedTextGen,
  { maxKeys: 6 },
);

// Rated_Trait_Set(traitKey → Trait_Level 정수).
const ratedTraitSetGen = fc.dictionary(
  fc.string({ minLength: 1 }).filter((k) => k !== "__proto__"),
  fc.integer({ min: -2, max: 4 }),
  { maxKeys: 6 },
);

describe("character-sheet property tests — request building", () => {
  it("Property 3: REST 요청 명세는 올바른 URL·메서드·본문을 만든다", () => {
    // Feature: character-sheet, Property 3: REST 요청 명세는 올바른 URL·메서드·본문을 만든다
    fc.assert(
      fc.property(
        idGen,
        idGen,
        tokenGen,
        paddedTextGen,
        traitKeysGen,
        paddedTextGen,
        narrativeGen,
        ratedTraitSetGen,
        (roomId, playerId, token, concept, traitKeys, name, narrative, ratedTraitSet) => {
          const handoff = { roomId, playerId, token };

          // --- buildSchemaRequest: GET /rooms/{enc(roomId)}/sheet-schema ---
          const schema = buildSchemaRequest(roomId, token);
          expect(schema.method).toBe("GET");
          expect(schema.url).toBe("/rooms/" + encodeURIComponent(roomId) + "/sheet-schema");

          // --- buildProposalRequest: POST /rooms/{enc(roomId)}/players/{enc(playerId)}/proposal ---
          const proposal = buildProposalRequest(roomId, playerId, concept, traitKeys, token);
          expect(proposal.method).toBe("POST");
          expect(proposal.url).toBe(
            "/rooms/" +
              encodeURIComponent(roomId) +
              "/players/" +
              encodeURIComponent(playerId) +
              "/proposal",
          );
          const proposalBody = JSON.parse(proposal.body);
          // 본문 컨셉은 앞뒤 공백만 제거되고 내부 공백은 보존된다.
          expect(proposalBody.concept).toBe(concept.trim());
          // 스키마의 Trait_Key 목록이 변형 없이 그대로 포함된다.
          expect(proposalBody.traitKeys).toEqual(traitKeys);

          // --- buildRecordRequest: POST /rooms/{enc(roomId)}/players/{enc(playerId)}/character ---
          const record = buildRecordRequest(handoff, name, narrative, ratedTraitSet);
          expect(record.method).toBe("POST");
          expect(record.url).toBe(
            "/rooms/" +
              encodeURIComponent(roomId) +
              "/players/" +
              encodeURIComponent(playerId) +
              "/character",
          );
          const recordBody = JSON.parse(record.body);
          // 이름은 앞뒤 공백만 제거된다.
          expect(recordBody.name).toBe(name.trim());
          // 서사 값 맵의 각 값도 앞뒤 공백만 제거되고 내부 공백은 보존된다.
          const expectedNarrative = {};
          for (const key of Object.keys(narrative)) {
            expectedNarrative[key] = narrative[key].trim();
          }
          expect(recordBody.narrative).toEqual(expectedNarrative);
          // Rated_Trait_Set은 변형 없이 attributes로 담긴다.
          expect(recordBody.attributes).toEqual(ratedTraitSet);

          // --- buildConfirmRequest: POST /rooms/{enc(roomId)}/players/{enc(playerId)}/character/confirm ---
          const confirm = buildConfirmRequest(handoff);
          expect(confirm.method).toBe("POST");
          expect(confirm.url).toBe(
            "/rooms/" +
              encodeURIComponent(roomId) +
              "/players/" +
              encodeURIComponent(playerId) +
              "/character/confirm",
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
