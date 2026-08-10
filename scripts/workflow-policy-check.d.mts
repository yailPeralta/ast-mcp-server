/// <reference types="node" />

export interface WorkflowPolicySummary {
  readonly status: "pass";
  readonly workflow_count: number;
  readonly job_count: number;
  readonly action_count: number;
  readonly workflows: readonly string[];
}

export function validateWorkflowPolicyDocuments(
  documents: Readonly<Record<string, string>>,
): WorkflowPolicySummary;

export function checkWorkflowPolicy(repositoryRoot?: string): Promise<WorkflowPolicySummary>;
