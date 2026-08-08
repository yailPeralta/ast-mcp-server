import { describe, expect, it } from "vitest";
import {
  NO_REQUEST_CONTEXT,
  RequestContextError,
  createRequestContext,
} from "../src/services/request-context.js";

describe("request context", () => {
  it("throws the canonical cancellation error at a checkpoint", () => {
    const controller = new AbortController();
    const context = createRequestContext(controller.signal);

    controller.abort(new Error("must not be disclosed"));

    expect(() => context.checkpoint()).toThrowError(
      expect.objectContaining({
        name: "RequestContextError",
        code: "REQUEST_CANCELLED",
        message: "Request cancelled.",
      }),
    );
    expect(() => context.checkpoint()).toThrow(RequestContextError);
  });

  it("uses one stable non-cancelled context when no signal exists", () => {
    expect(NO_REQUEST_CONTEXT.signal.aborted).toBe(false);
    expect(() => NO_REQUEST_CONTEXT.checkpoint()).not.toThrow();
    expect(() => NO_REQUEST_CONTEXT.enterCompletionCritical()).not.toThrow();
    expect(createRequestContext()).toBe(NO_REQUEST_CONTEXT);
  });

  it("checks cancellation before entering completion-critical", () => {
    const controller = new AbortController();
    const context = createRequestContext(controller.signal);
    controller.abort();

    expect(() => context.enterCompletionCritical()).toThrowError(
      expect.objectContaining({ code: "REQUEST_CANCELLED" }),
    );
    expect(context.signal.aborted).toBe(true);
  });

  it("permanently suppresses later cancellation after entering completion-critical", () => {
    const controller = new AbortController();
    const context = createRequestContext(controller.signal);

    context.enterCompletionCritical();
    controller.abort();

    expect(context.signal.aborted).toBe(false);
    expect(() => context.checkpoint()).not.toThrow();
    expect(() => context.enterCompletionCritical()).not.toThrow();
  });
});
