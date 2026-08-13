export interface CheckboxChoice<Id extends string = string> {
  id: Id;
  label: string;
  enabled: boolean;
  checked: boolean;
  reason?: string;
}

export interface CheckboxState<Id extends string = string> {
  choices: CheckboxChoice<Id>[];
  focus: number;
  validation?: string;
  submitted?: Id[];
  cancelled?: boolean;
}

export type CheckboxAction = "up" | "down" | "toggle" | "submit" | "cancel";

export function createCheckboxState<Id extends string>(
  choices: readonly CheckboxChoice<Id>[],
): CheckboxState<Id> {
  return {
    choices: choices.map((choice) => ({ ...choice })),
    focus: Math.max(
      0,
      choices.findIndex((choice) => choice.enabled),
    ),
  };
}

export function reduceCheckboxState<Id extends string>(
  state: CheckboxState<Id>,
  action: CheckboxAction,
): CheckboxState<Id> {
  if (action === "cancel") return { ...state, cancelled: true };
  if (action === "up" || action === "down") {
    const delta = action === "up" ? -1 : 1;
    return {
      ...state,
      focus: Math.max(0, Math.min(state.choices.length - 1, state.focus + delta)),
      validation: undefined,
    };
  }
  if (action === "toggle") {
    return {
      ...state,
      validation: undefined,
      choices: state.choices.map((choice, index) =>
        index === state.focus && choice.enabled ? { ...choice, checked: !choice.checked } : choice,
      ),
    };
  }
  const selected = state.choices
    .filter((choice) => choice.enabled && choice.checked)
    .map((choice) => choice.id);
  return selected.length === 0
    ? { ...state, validation: "Select at least one agent." }
    : { ...state, submitted: selected };
}
