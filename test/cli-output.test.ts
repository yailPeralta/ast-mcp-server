import { decode } from "@toon-format/toon";
import { describe, expect, it } from "vitest";
import { CliOutputError, serializeCliSuccess } from "../src/cli-output.js";

const fixture = {
  version: 1,
  status: "ok",
  result: {
    symbols: [
      { file: "src/a.ts", selector: "alpha@1", message: 'comma, quote: " and ✅' },
      { file: "src/b.ts", selector: "beta@2", message: "second\nline" },
    ],
  },
};

describe("CLI success serialization", () => {
  it("keeps compact JSON as the default machine representation", () => {
    expect(serializeCliSuccess(fixture, "json")).toBe(JSON.stringify(fixture));
  });

  it("serializes the final logical result to lossless TOON", () => {
    const output = serializeCliSuccess(fixture, "toon");
    expect(output.startsWith("{")).toBe(false);
    expect(decode(output)).toEqual(fixture);
  });

  it("enforces the final UTF-8 byte limit after serialization", () => {
    const output = serializeCliSuccess({ value: "é" }, "toon");
    const exactBytes = Buffer.byteLength(output, "utf8");
    expect(serializeCliSuccess({ value: "é" }, "toon", exactBytes)).toBe(output);
    try {
      serializeCliSuccess({ value: "é" }, "toon", exactBytes - 1);
      throw new Error("Expected output limit failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(CliOutputError);
      expect((error as CliOutputError).code).toBe("OUTPUT_LIMIT");
    }
  });

  it("reports serialization failures with a typed encoding code", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    try {
      serializeCliSuccess(cyclic, "toon");
      throw new Error("Expected encoding failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(CliOutputError);
      expect((error as CliOutputError).code).toBe("ENCODING_ERROR");
    }
  });
});
