import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createCheckboxState, reduceCheckboxState } from "../src/services/checkbox-state.js";
import { runRawCheckbox } from "../src/services/raw-tty.js";

describe("checkbox state", () => {
  const choices = [
    { id: "claude", label: "Claude Code", enabled: true, checked: true },
    { id: "opencode", label: "OpenCode", enabled: false, checked: false, reason: "incompatible" },
    { id: "codex", label: "Codex CLI", enabled: true, checked: true },
  ] as const;

  it("moves focus across choices and toggles only enabled choices", () => {
    let state = createCheckboxState(choices);
    state = reduceCheckboxState(state, "down");
    state = reduceCheckboxState(state, "toggle");
    expect(state.focus).toBe(1);
    expect(state.choices.map((choice) => choice.checked)).toEqual([true, false, true]);
    state = reduceCheckboxState(state, "down");
    state = reduceCheckboxState(state, "toggle");
    expect(state.choices.map((choice) => choice.checked)).toEqual([true, false, false]);
  });

  it("rejects empty submission and accepts a non-empty ordered selection", () => {
    let state = createCheckboxState([
      { id: "claude", label: "Claude", enabled: true, checked: true },
    ]);
    state = reduceCheckboxState(state, "toggle");
    expect(reduceCheckboxState(state, "submit")).toMatchObject({
      validation: "Select at least one agent.",
    });
    state = reduceCheckboxState(state, "toggle");
    expect(reduceCheckboxState(state, "submit")).toMatchObject({ submitted: ["claude"] });
  });
});

describe("raw TTY cleanup", () => {
  it.each(["escape", "ctrl-c", "signal", "error"])(
    "restores terminal resources once after %s",
    async (exit) => {
      const input = new EventEmitter() as EventEmitter & {
        isRaw?: boolean;
        setRawMode(value: boolean): void;
        resume(): void;
        pause(): void;
      };
      input.isRaw = false;
      input.setRawMode = vi.fn((value: boolean) => {
        input.isRaw = value;
      });
      input.resume = vi.fn();
      input.pause = vi.fn();
      const output = { write: vi.fn(() => true) };
      const signals = new EventEmitter();
      const promise = runRawCheckbox({
        choices: [{ id: "claude", label: "Claude Code", enabled: true, checked: true }],
        input,
        output,
        signals,
      });
      if (exit === "escape") input.emit("data", Buffer.from("\u001b"));
      if (exit === "ctrl-c") input.emit("data", Buffer.from("\u0003"));
      if (exit === "signal") signals.emit("SIGTERM");
      if (exit === "error") input.emit("error", new Error("read failed"));
      await expect(promise).resolves.toEqual([]);
      expect(input.setRawMode).toHaveBeenCalledTimes(2);
      expect(output.write).toHaveBeenCalledWith("\u001b[?25h");
    },
  );

  it("restores resources when the initial render throws synchronously", async () => {
    const input = Object.assign(new EventEmitter(), {
      isRaw: false,
      setRawMode: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn(),
    });
    const write = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockImplementationOnce(() => {
        throw new Error("render failed");
      });
    const signals = new EventEmitter();
    await expect(
      runRawCheckbox({
        choices: [{ id: "claude", label: "Claude Code", enabled: true, checked: true }],
        input,
        output: { write },
        signals,
      }),
    ).rejects.toThrow("render failed");
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(input.listenerCount("data")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    expect(write).toHaveBeenCalledWith("\u001b[?25h");
  });
});
