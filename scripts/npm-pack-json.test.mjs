import assert from "node:assert/strict";
import test from "node:test";
import { parseSingleNpmPackRecord } from "./npm-pack-json.mjs";

const identity = Object.freeze({
  expectedName: "ast-mcp-server",
  expectedVersion: "0.13.0",
  expectedFilename: "ast-mcp-server-0.13.0.tgz",
});

const baseRecord = Object.freeze({
  id: "ast-mcp-server@0.13.0",
  name: "ast-mcp-server",
  version: "0.13.0",
  filename: "ast-mcp-server-0.13.0.tgz",
  integrity:
    "sha512-vbna6hhjX+VlayTnrgWQ/EitxkBmhVza0az6J/MCpE14M4Yn50D4yTQZrrcjfCi05sVhJhWFGPnzv6VE3V9KIw==",
  shasum: "166f95121a72f0b03c325cef586a211cd9107a24",
});

function parse(value, options = identity) {
  return parseSingleNpmPackRecord(JSON.stringify(value), options);
}

function assertRejected(value, pattern, options = identity) {
  assert.throws(() => parse(value, options), pattern);
}

test("accepts the legacy npm pack array with one public baseline record", () => {
  assert.deepEqual(parse([baseRecord]), baseRecord);
});

test("accepts the npm 12 package-keyed object with one public baseline record", () => {
  const stdout = { "ast-mcp-server": baseRecord };

  assert.deepEqual(parse(stdout), baseRecord);
});

test("rejects malformed JSON", () => {
  assert.throws(() => parseSingleNpmPackRecord("{", identity), /invalid JSON/u);
});

test("rejects empty or multiple legacy array records", () => {
  assertRejected([], /exactly one record/u);
  assertRejected([baseRecord, baseRecord], /exactly one record/u);
});

test("rejects empty, multiple, or wrong package-keyed object records", () => {
  assertRejected({}, /expected package key ast-mcp-server/u);
  assertRejected({ "ast-mcp-server": baseRecord, other: baseRecord }, /exactly one package key/u);
  assertRejected({ other: baseRecord }, /expected package key ast-mcp-server/u);
});

test("rejects non-object records", () => {
  assertRejected([null], /record must be an object/u);
  assertRejected({ "ast-mcp-server": [] }, /record must be an object/u);
});

test("rejects wrong identity metadata when npm provides those fields", () => {
  assertRejected([{ ...baseRecord, id: "other@0.13.0" }], /id must be ast-mcp-server@0\.13\.0/u);
  assertRejected([{ ...baseRecord, name: "other" }], /name must be ast-mcp-server/u);
  assertRejected([{ ...baseRecord, version: "0.13.1" }], /version must be 0\.13\.0/u);
});

test("allows optional identity metadata to be absent while keeping filename mandatory", () => {
  const { id, name, version, ...recordWithoutOptionalIdentity } = baseRecord;
  assert.deepEqual(parse([recordWithoutOptionalIdentity]), recordWithoutOptionalIdentity);
  assert.equal(id, "ast-mcp-server@0.13.0");
  assert.equal(name, "ast-mcp-server");
  assert.equal(version, "0.13.0");
});

test("rejects missing, invalid, or unexpected filenames", () => {
  const { filename, ...missingFilename } = baseRecord;
  assertRejected([missingFilename], /filename must be a non-empty string/u);
  assertRejected([{ ...baseRecord, filename: "" }], /filename must be a non-empty string/u);
  assertRejected(
    [{ ...baseRecord, filename: "../ast-mcp-server-0.13.0.tgz" }],
    /filename must be ast-mcp-server-0\.13\.0\.tgz/u,
  );
  assert.equal(filename, "ast-mcp-server-0.13.0.tgz");
});

test("leaves integrity and shasum enforcement to the caller", () => {
  const record = parse([
    {
      ...baseRecord,
      integrity: "sha512-caller-must-check",
      shasum: "caller-must-check",
    },
  ]);

  assert.equal(record.integrity, "sha512-caller-must-check");
  assert.equal(record.shasum, "caller-must-check");
});
