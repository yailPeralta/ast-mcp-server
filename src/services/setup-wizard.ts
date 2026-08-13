import {
  AGENT_IDS,
  getAgentTarget,
  type AgentTargetId,
  type Compatibility,
} from "./agent-targets.js";
import { runRawCheckbox, type RawCheckboxOptions } from "./raw-tty.js";

export { AGENT_IDS } from "./agent-targets.js";
export type AgentId = AgentTargetId;
export type DetectionCompatibility =
  Compatibility | { status: "unavailable" | "blocked_untrusted_folder"; reason: string };

export interface AgentDetection {
  id: AgentId;
  label: string;
  installed: boolean;
  executable?: string;
  version?: string;
  compatibility?: DetectionCompatibility;
}

export type AgentSelectionRequest = AgentId[] | { mode: "all" };

function isAgentId(value: string): value is AgentId {
  return AGENT_IDS.includes(value as AgentId);
}

export function parseAgentsArgument(value: string): AgentSelectionRequest {
  const normalized = value.trim().toLowerCase();
  if (!normalized) throw new Error("The --agents value cannot be empty.");
  if (normalized === "all") return { mode: "all" };
  const requested = normalized
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const unsupported = requested.find((item) => !isAgentId(item));
  if (unsupported)
    throw new Error(`Unsupported agent: ${unsupported}. Expected ${AGENT_IDS.join(", ")}, or all.`);
  const selected = new Set(requested as AgentId[]);
  return AGENT_IDS.filter((id) => selected.has(id));
}

function usability(detection: AgentDetection): { usable: boolean; reason?: string } {
  if (!detection.installed)
    return {
      usable: false,
      reason:
        detection.compatibility?.status === "unavailable"
          ? detection.compatibility.reason
          : "Not found in PATH.",
    };
  if (!detection.compatibility || detection.compatibility.status === "compatible")
    return { usable: true };
  return { usable: false, reason: detection.compatibility.reason };
}

export function resolveAgentSelection(
  request: AgentSelectionRequest,
  detections: readonly AgentDetection[],
): AgentId[] {
  const byId = new Map(detections.map((item) => [item.id, item]));
  const ids = Array.isArray(request) ? request : AGENT_IDS.filter((id) => byId.get(id)?.installed);
  for (const id of ids) {
    const detection = byId.get(id);
    const result = detection
      ? usability(detection)
      : { usable: false, reason: "Detection result is missing." };
    if (!result.usable) throw new Error(`${getAgentTarget(id).label}: ${result.reason}`);
  }
  return AGENT_IDS.filter((id) => ids.includes(id));
}

export async function promptForAgentSelection(
  detections: readonly AgentDetection[],
  options: Omit<RawCheckboxOptions<AgentId>, "choices">,
): Promise<AgentId[]> {
  return runRawCheckbox({
    ...options,
    choices: detections.map((item) => {
      const result = usability(item);
      return {
        id: item.id,
        label: item.label,
        enabled: result.usable,
        checked: result.usable,
        ...(result.reason ? { reason: result.reason } : {}),
      };
    }),
  });
}
