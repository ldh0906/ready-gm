// @ts-nocheck
/**
 * Property-based tests for Character_Sheet_App access token → request header equivalence.
 * Feature: character-sheet
 *
 * Covers:
 * - Property 2: 접근 토큰과 요청 헤더는 동치다
 *
 * Validates: Requirements 1.2, 1.5, 11.1, 11.2
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  buildSchemaRequest,
  buildProposalRequest,
  buildRecordRequest,
  buildConfirmRequest,
} from "./logic.js";

// 토큰 생성기: 빈 문자열(토큰 없음) + 특수문자를 포함할 수 있는 임의의 비공백 문자열(토큰 있음).
// fullUnicodeString으로 `< > & " '` 등 특수문자와 유니코드를 포함하되, 트림 후 비어 있지 않도록
// minLength 1과 trim 길이 ≥ 1 필터를 둔다(인계 token은 항상 트림된 값으로 보존되기 때문).
const presentToken = fc
  .fullUnicodeString({ minLength: 1 })
  .filter((s) => s.trim().length >= 1)
  .map((s) => s.trim());
const tokenGen = fc.oneof(fc.constant(""), presentToken);
// 연결 티켓 생성기(auth-hardening): 토큰과 독립적으로 빈/존재를 조합한다.
const ticketGen = fc.oneof(fc.constant(""), presentToken);

// 요청 빌더에 넣을 임의의 식별자·작성 값 생성기(헤더 동치에는 영향이 없어야 한다).
const idGen = fc.string({ minLength: 1 });
const conceptGen = fc.string();
const traitKeysGen = fc.array(fc.string({ minLength: 1 }), { maxLength: 6 });
const nameGen = fc.string();
const narrativeGen = fc.dictionary(fc.string({ minLength: 1 }), fc.string(), { maxKeys: 4 });
const ratedTraitSetGen = fc.dictionary(fc.string({ minLength: 1 }), fc.integer(), { maxKeys: 6 });

/**
 * 한 요청의 헤더가 토큰과 동치인지 검증한다.
 * - 토큰이 비어 있지 않으면 x-playtest-token에 값을 한 글자도 변경하지 않고 포함.
 * - 토큰이 비어 있으면 x-playtest-token이 헤더에 존재하지 않음.
 */
function assertTokenHeader(headers, token) {
  if (token.length > 0) {
    expect("x-playtest-token" in headers).toBe(true);
    expect(headers["x-playtest-token"]).toBe(token);
  } else {
    expect("x-playtest-token" in headers).toBe(false);
  }
}

/**
 * 한 요청의 헤더가 연결 티켓과 동치인지 검증한다(auth-hardening).
 * - 티켓이 비어 있지 않으면 x-connection-ticket에 값을 한 글자도 변경하지 않고 포함.
 * - 티켓이 비어 있으면 x-connection-ticket이 헤더에 존재하지 않음.
 */
function assertTicketHeader(headers, ticket) {
  if (ticket.length > 0) {
    expect("x-connection-ticket" in headers).toBe(true);
    expect(headers["x-connection-ticket"]).toBe(ticket);
  } else {
    expect("x-connection-ticket" in headers).toBe(false);
  }
}

describe("character-sheet property tests — access token ↔ request header equivalence", () => {
  it("Property 2: 접근 토큰과 요청 헤더는 동치다", () => {
    // Feature: character-sheet, Property 2: 접근 토큰과 요청 헤더는 동치다
    fc.assert(
      fc.property(
        tokenGen,
        idGen,
        idGen,
        conceptGen,
        traitKeysGen,
        nameGen,
        narrativeGen,
        ratedTraitSetGen,
        (token, roomId, playerId, concept, traitKeys, name, narrative, ratedTraitSet) => {
          // buildSchemaRequest / buildProposalRequest는 token을 인자로 받는다.
          assertTokenHeader(buildSchemaRequest(roomId, token).headers, token);
          assertTokenHeader(
            buildProposalRequest(roomId, playerId, concept, traitKeys, token).headers,
            token,
          );

          // buildRecordRequest / buildConfirmRequest는 handoff.token에서 토큰을 읽는다.
          const handoff = { roomId, playerId, token };
          assertTokenHeader(
            buildRecordRequest(handoff, name, narrative, ratedTraitSet).headers,
            token,
          );
          assertTokenHeader(buildConfirmRequest(handoff).headers, token);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("연결 티켓과 x-connection-ticket 헤더는 동치다(auth-hardening) — x-playtest-token과 독립", () => {
    // proposal/character/confirm 빌더는 ticket이 비어 있지 않을 때만 x-connection-ticket를
    // 변형 없이 싣고, x-playtest-token은 token에만 의존해 그대로 유지된다.
    fc.assert(
      fc.property(
        tokenGen,
        ticketGen,
        idGen,
        idGen,
        conceptGen,
        traitKeysGen,
        nameGen,
        narrativeGen,
        ratedTraitSetGen,
        (token, ticket, roomId, playerId, concept, traitKeys, name, narrative, ratedTraitSet) => {
          // proposal: ticket은 6번째 인자.
          const proposal = buildProposalRequest(roomId, playerId, concept, traitKeys, token, ticket);
          assertTicketHeader(proposal.headers, ticket);
          assertTokenHeader(proposal.headers, token); // token 헤더는 영향받지 않음.

          // record/confirm: ticket은 handoff.ticket에서 읽는다.
          const handoff = { roomId, playerId, token, ticket };
          const record = buildRecordRequest(handoff, name, narrative, ratedTraitSet);
          assertTicketHeader(record.headers, ticket);
          assertTokenHeader(record.headers, token);

          const confirm = buildConfirmRequest(handoff);
          assertTicketHeader(confirm.headers, ticket);
          assertTokenHeader(confirm.headers, token);

          // proposal에 ticket 인자를 생략하면(기존 5-인자 호출) 헤더에 ticket이 없다.
          const legacyProposal = buildProposalRequest(roomId, playerId, concept, traitKeys, token);
          expect("x-connection-ticket" in legacyProposal.headers).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
