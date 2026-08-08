export type RequestContextErrorCode = "REQUEST_CANCELLED" | "OPERATION_DEADLINE_EXCEEDED";

export class RequestContextError extends Error {
  readonly code: RequestContextErrorCode;

  constructor(code: RequestContextErrorCode) {
    super(code === "REQUEST_CANCELLED" ? "Request cancelled." : "Operation deadline exceeded.");
    this.name = "RequestContextError";
    this.code = code;
  }
}

export function isCooperativeInterruption(error: unknown): boolean {
  const code = (error as { readonly code?: unknown } | null)?.code;
  return code === "REQUEST_CANCELLED" || code === "OPERATION_DEADLINE_EXCEEDED";
}

export interface RequestContext {
  readonly signal: AbortSignal;
  checkpoint(): void;
}

export interface CompletionCriticalRequestContext extends RequestContext {
  enterCompletionCritical(): void;
}

const neverAbortedSignal = new AbortController().signal;

export const NO_REQUEST_CONTEXT: CompletionCriticalRequestContext = Object.freeze({
  signal: neverAbortedSignal,
  checkpoint(): void {},
  enterCompletionCritical(): void {},
});

class ActiveRequestContext implements CompletionCriticalRequestContext {
  #completionCritical = false;
  readonly #requestSignal: AbortSignal;

  constructor(requestSignal: AbortSignal) {
    this.#requestSignal = requestSignal;
  }

  get signal(): AbortSignal {
    return this.#completionCritical ? neverAbortedSignal : this.#requestSignal;
  }

  checkpoint(): void {
    if (!this.#completionCritical && this.#requestSignal.aborted) {
      throw new RequestContextError("REQUEST_CANCELLED");
    }
  }

  enterCompletionCritical(): void {
    if (this.#completionCritical) return;
    this.checkpoint();
    this.#completionCritical = true;
  }
}

export function createRequestContext(signal?: AbortSignal): CompletionCriticalRequestContext {
  return signal === undefined ? NO_REQUEST_CONTEXT : new ActiveRequestContext(signal);
}
