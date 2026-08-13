import {
  createCheckboxState,
  reduceCheckboxState,
  type CheckboxChoice,
  type CheckboxState,
} from "./checkbox-state.js";

interface RawInput {
  isRaw?: boolean;
  setRawMode(value: boolean): void;
  resume(): void;
  pause(): void;
  on(event: "data" | "error", listener: (...args: any[]) => void): unknown;
  off(event: "data" | "error", listener: (...args: any[]) => void): unknown;
}
interface RawOutput {
  write(value: string): unknown;
}
interface SignalSource {
  on(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface RawCheckboxOptions<Id extends string> {
  choices: readonly CheckboxChoice<Id>[];
  input: RawInput;
  output: RawOutput;
  signals?: SignalSource;
}

function render<Id extends string>(state: CheckboxState<Id>): string {
  const lines = state.choices.map((choice, index) => {
    const focus = index === state.focus ? "❯" : " ";
    const marker = choice.checked ? "◉" : "◯";
    const reason = choice.enabled ? "" : ` — ${choice.reason ?? "unavailable"}`;
    return `${focus} ${marker} ${choice.label}${reason}`;
  });
  return `\u001b[2J\u001b[HSelect agents (↑/↓ move, Space toggle, Enter continue, Esc cancel)\n${lines.join("\n")}${state.validation ? `\n${state.validation}` : ""}`;
}

function keyAction(bytes: Buffer): "up" | "down" | "toggle" | "submit" | "cancel" | undefined {
  const value = bytes.toString("utf8");
  if (value === "\u001b[A") return "up";
  if (value === "\u001b[B") return "down";
  if (value === " ") return "toggle";
  if (value === "\r" || value === "\n") return "submit";
  if (value === "\u001b" || value === "\u0003") return "cancel";
  return undefined;
}

export function runRawCheckbox<Id extends string>(options: RawCheckboxOptions<Id>): Promise<Id[]> {
  return new Promise((resolve) => {
    const signals = options.signals ?? process;
    const initialRaw = options.input.isRaw === true;
    let state = createCheckboxState(options.choices);
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      options.input.off("data", onData);
      options.input.off("error", onError);
      signals.off("SIGINT", onSignal);
      signals.off("SIGTERM", onSignal);
      options.input.setRawMode(initialRaw);
      options.input.pause();
      options.output.write("\u001b[?25h");
    };
    const finish = (selection: Id[]) => {
      cleanup();
      resolve(selection);
    };
    const onSignal = () => finish([]);
    const onError = () => finish([]);
    const onData = (bytes: Buffer) => {
      const action = keyAction(bytes);
      if (!action) return;
      state = reduceCheckboxState(state, action);
      if (state.cancelled) return finish([]);
      if (state.submitted) return finish(state.submitted);
      options.output.write(render(state));
    };
    options.input.setRawMode(true);
    options.input.resume();
    options.input.on("data", onData);
    options.input.on("error", onError);
    signals.on("SIGINT", onSignal);
    signals.on("SIGTERM", onSignal);
    try {
      options.output.write("\u001b[?25l");
      options.output.write(render(state));
    } catch (error) {
      cleanup();
      throw error;
    }
  });
}
