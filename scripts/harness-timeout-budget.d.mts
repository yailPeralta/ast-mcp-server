export interface HarnessTimeoutBudget {
  queueWaitMs: number;
  executionDeadlineMs: number;
  marginMs: number;
  outerToolCallMs: number;
}

export function validateTimeoutBudget(value: unknown): Readonly<HarnessTimeoutBudget>;
