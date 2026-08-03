export const AGENT_IDS = ["claude", "hermes"] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export interface AgentDetection {
  id: AgentId;
  label: string;
  installed: boolean;
  executable?: string;
  version?: string;
}

export type SetupQuestion = (question: string) => Promise<string>;

const AGENT_LABELS: Record<AgentId, string> = {
  claude: "Claude Code",
  hermes: "Hermes",
};

function isAgentId(value: string): value is AgentId {
  return AGENT_IDS.includes(value as AgentId);
}

export function parseAgentsArgument(value: string): AgentId[] {
  const normalized = value.trim().toLowerCase();
  if (normalized === "") {
    throw new Error("The --agents value cannot be empty.");
  }
  if (normalized === "all") {
    return [...AGENT_IDS];
  }

  const requested = normalized
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (requested.length === 0) {
    throw new Error("The --agents value cannot be empty.");
  }
  const unsupported = requested.find((item) => !isAgentId(item));
  if (unsupported !== undefined) {
    throw new Error(`Unsupported agent: ${unsupported}. Expected claude, hermes, or all.`);
  }

  const selected = new Set(requested as AgentId[]);
  return AGENT_IDS.filter((agent) => selected.has(agent));
}

export function applyAgentDeselections(answer: string, detections: AgentDetection[]): AgentId[] {
  const installed = detections.filter((item) => item.installed);
  const selected = new Set(installed.map((item) => item.id));
  const normalized = answer.trim().toLowerCase();
  if (normalized === "") {
    return AGENT_IDS.filter((agent) => selected.has(agent));
  }
  if (normalized === "none") {
    return [];
  }

  const tokens = normalized
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  for (const token of tokens) {
    let detection: AgentDetection | undefined;
    if (/^\d+$/.test(token)) {
      detection = detections[Number(token) - 1];
    } else if (isAgentId(token)) {
      detection = detections.find((item) => item.id === token);
    }

    if (detection === undefined) {
      throw new Error(`Invalid selection: ${token}.`);
    }
    if (!detection.installed) {
      throw new Error(`${detection.label} is not installed.`);
    }
    selected.delete(detection.id);
  }

  return AGENT_IDS.filter((agent) => selected.has(agent));
}

function renderSelectionQuestion(detections: AgentDetection[], validationMessage?: string): string {
  const choices = detections
    .map((item, index) => {
      const marker = item.installed ? "x" : " ";
      const detail = item.installed
        ? [item.version, item.executable].filter(Boolean).join(" · ")
        : "not installed";
      return `  [${marker}] ${index + 1}. ${AGENT_LABELS[item.id]} (${detail})`;
    })
    .join("\n");
  const validation = validationMessage === undefined ? "" : `\n${validationMessage}\n`;
  return `\nDetected agents (all installed agents are selected):\n${choices}\n${validation}\nEnter agents to deselect by number or name, 'none' to deselect all, or press Enter to keep all:\n> `;
}

function renderConfirmation(agents: AgentId[], validationMessage?: string): string {
  const labels = agents.map((agent) => AGENT_LABELS[agent]).join(", ");
  const validation = validationMessage === undefined ? "" : `\n${validationMessage}\n`;
  return `${validation}\nSetup will install the MCP server and skill for: ${labels}.\nContinue? [Y/n] `;
}

export async function promptForAgentSelection(
  detections: AgentDetection[],
  ask: SetupQuestion,
): Promise<AgentId[]> {
  if (!detections.some((item) => item.installed)) {
    throw new Error("No supported agents were detected in PATH.");
  }

  let selected: AgentId[];
  let selectionError: string | undefined;
  while (true) {
    const answer = await ask(renderSelectionQuestion(detections, selectionError));
    try {
      selected = applyAgentDeselections(answer, detections);
      break;
    } catch (error) {
      selectionError = error instanceof Error ? error.message : String(error);
    }
  }

  if (selected.length === 0) {
    return [];
  }

  let confirmationError: string | undefined;
  while (true) {
    const answer = (await ask(renderConfirmation(selected, confirmationError)))
      .trim()
      .toLowerCase();
    if (answer === "" || answer === "y" || answer === "yes") {
      return selected;
    }
    if (answer === "n" || answer === "no") {
      return [];
    }
    confirmationError = "Enter y or n.";
  }
}
