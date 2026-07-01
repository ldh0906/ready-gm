// @ts-nocheck
/**
 * Property-based tests for Host_Entry_App reducer transitions.
 * Feature: frontend-applications
 *
 * Covers:
 * - Property 4: 처리 중 추가 제출은 멱등이다
 * - Property 5: 성공 응답은 success 단계로 전이하며 응답 데이터를 보존한다
 * - Property 6: 모든 실패는 동일한 회복 가능 상태로 전이한다
 * - Property 14: 복사 성공 확인 메시지는 최소 3초 표시된다
 * - Property 15: 입력 변경은 검증·오류 메시지를 제거한다
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createInitialState,
  reduce,
  computeVisibility,
  Phase,
  ErrorKind,
  ERROR_MESSAGES,
  VALIDATION_MESSAGE,
  COPY_CONFIRM_MS,
} from "./logic.js";

const token = fc.string();
const errorKind = fc.constantFrom(...Object.values(ErrorKind));

const successPayload = fc.record({
  roomId: fc.string(),
  inviteToken: fc.string(),
  inviteLink: fc.string(),
  hostPlayerId: fc.string(),
  state: fc.string(),
  maxPlayers: fc.integer(),
});

describe("frontend-applications property tests — reducer", () => {
  it("Property 4: 처리 중 추가 제출은 멱등이다", () => {
    // Feature: frontend-applications, Property 4: 처리 중 추가 제출은 멱등이다
    fc.assert(
      fc.property(fc.string(), token, (input, tok) => {
        const submitting = {
          ...createInitialState(tok),
          phase: Phase.SUBMITTING,
          displayNameInput: input,
        };
        const next = reduce(submitting, { type: "SUBMIT" });

        // 새 요청을 만들지 않으며 phase는 submitting으로 유지된다(중복 요청 방지).
        expect(next.phase).toBe(Phase.SUBMITTING);
        // no-op은 동일 참조를 반환한다.
        expect(next).toBe(submitting);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 5: 성공 응답은 success 단계로 전이하며 응답 데이터를 보존한다", () => {
    // Feature: frontend-applications, Property 5: 성공 응답은 success 단계로 전이하며 응답 데이터를 보존한다
    fc.assert(
      fc.property(successPayload, token, (payload, tok) => {
        const state = { ...createInitialState(tok), phase: Phase.SUBMITTING };
        const next = reduce(state, { type: "REQUEST_SUCCEEDED", payload });

        expect(next.phase).toBe(Phase.SUCCESS);
        // 모든 응답 필드가 변경 없이 저장된다.
        expect(next.success).toEqual(payload);
        expect(next.success.roomId).toBe(payload.roomId);
        expect(next.success.inviteToken).toBe(payload.inviteToken);
        expect(next.success.inviteLink).toBe(payload.inviteLink);
        expect(next.success.hostPlayerId).toBe(payload.hostPlayerId);
        expect(next.success.state).toBe(payload.state);
        expect(next.success.maxPlayers).toBe(payload.maxPlayers);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 6: 모든 실패는 동일한 회복 가능 상태로 전이한다", () => {
    // Feature: frontend-applications, Property 6: 모든 실패는 동일한 회복 가능 상태로 전이한다
    fc.assert(
      fc.property(errorKind, fc.string(), token, successPayload, (kind, input, tok, prior) => {
        // 임의의 입력·토큰 상태(직전에 성공 패널이 떠 있었을 수도 있음)에서 출발.
        const state = {
          ...createInitialState(tok),
          phase: Phase.SUBMITTING,
          displayNameInput: input,
          success: prior,
        };
        const next = reduce(state, { type: "REQUEST_FAILED", kind });

        expect(next.phase).toBe(Phase.ERROR);
        // Invite_Panel이 표시되지 않는다(success가 비워짐).
        expect(next.success).toBeNull();
        // 입력값과 토큰이 보존된다.
        expect(next.displayNameInput).toBe(input);
        expect(next.token).toBe(tok);
        // 오류 종류와 한국어 메시지가 매핑된다.
        expect(next.errorKind).toBe(kind);
        expect(next.errorMessage).toBe(ERROR_MESSAGES[kind]);
        // Submit_Action이 다시 활성화된다(재시도 가능).
        expect(computeVisibility(next).submitDisabled).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 14: 복사 성공 확인 메시지는 최소 3초 표시된다", () => {
    // Feature: frontend-applications, Property 14: 복사 성공 확인 메시지는 최소 3초 표시된다
    fc.assert(
      fc.property(fc.integer(), token, (now, tok) => {
        const state = {
          ...createInitialState(tok),
          phase: Phase.SUCCESS,
        };
        const next = reduce(state, { type: "COPY_SUCCEEDED", now });
        expect(next.copyConfirmedUntil).toBe(now + COPY_CONFIRM_MS);
        expect(COPY_CONFIRM_MS).toBe(3000);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 15: 입력 변경은 검증·오류 메시지를 제거한다", () => {
    // Feature: frontend-applications, Property 15: 입력 변경은 검증·오류 메시지를 제거한다
    fc.assert(
      fc.property(fc.string(), token, (value, tok) => {
        // validation 오류와 검증 안내 메시지가 활성인 상태.
        const state = {
          ...createInitialState(tok),
          phase: Phase.ERROR,
          errorKind: ErrorKind.VALIDATION,
          errorMessage: ERROR_MESSAGES.validation,
          validationMessage: VALIDATION_MESSAGE,
          displayNameInput: "이전 입력",
        };
        const next = reduce(state, { type: "INPUT_CHANGED", value });

        // 검증 안내 메시지가 제거되고 validation 오류 종류가 더 이상 활성이 아니다.
        expect(next.validationMessage).toBeNull();
        expect(next.errorKind).not.toBe(ErrorKind.VALIDATION);
        expect(next.errorKind).toBeNull();
        // 입력값은 새 값으로 갱신된다.
        expect(next.displayNameInput).toBe(value);
      }),
      { numRuns: 100 },
    );
  });
});
