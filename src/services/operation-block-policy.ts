import type { TemplateDiagnostics } from "./angular-template-typecheck.js";

export interface BlockPolicyInput {
  readonly allowNewErrors: boolean;
  /** Number of TypeScript errors the operation would add. */
  readonly typescriptErrors: number;
  /** Present only when the template type check ran. */
  readonly template?: TemplateDiagnostics;
  readonly blockOnTemplateErrors: boolean;
}

export interface BlockVerdict {
  readonly blocked: boolean;
  readonly reason: string | null;
}

const REVIEW_HINT = "Prepare again with allow_new_errors=true only after explicit review.";

/**
 * A plan is blocked by new TypeScript errors, and, only when opted in, by new template errors of
 * a `completed` check. A check that did not complete never blocks. `allow_new_errors` waives both.
 */
export function evaluateBlock(input: BlockPolicyInput): BlockVerdict {
  const templateErrors =
    input.blockOnTemplateErrors && input.template?.status === "completed"
      ? input.template.addedErrors.length
      : 0;
  const reasons = [
    ...(input.typescriptErrors > 0
      ? [`${input.typescriptErrors} new TypeScript error(s) would be introduced.`]
      : []),
    ...(templateErrors > 0 ? [`${templateErrors} new template error(s) would be introduced.`] : []),
  ];
  if (input.allowNewErrors || reasons.length === 0) return { blocked: false, reason: null };
  return { blocked: true, reason: `${reasons.join(" ")} ${REVIEW_HINT}` };
}
