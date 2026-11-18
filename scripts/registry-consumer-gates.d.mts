export const REGISTRY_CONSUMER_GATE_NAMES: readonly string[];

export function createPassedRegistryConsumerGates(): Readonly<Record<string, true>>;

export interface ConsumerAuditAcceptedAdvisory {
  readonly id: string;
  readonly source: number;
  readonly package: string;
  readonly url: string;
  readonly expires: string;
}

export const CONSUMER_AUDIT_ACCEPTED_ADVISORIES: readonly ConsumerAuditAcceptedAdvisory[];

export type ConsumerAuditEvaluation =
  | { readonly ok: true; readonly accepted_advisories: ConsumerAuditAcceptedAdvisory[] }
  | { readonly ok: false; readonly reason: string };

export function evaluateConsumerAudit(report: unknown, now: Date): ConsumerAuditEvaluation;

export function validateAcceptedAuditAdvisories(value: unknown): boolean;
