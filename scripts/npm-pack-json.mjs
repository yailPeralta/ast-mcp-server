function fail(message) {
  throw new Error(`npm pack JSON: ${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function validateRecord(record, { expectedName, expectedVersion, expectedFilename }) {
  if (!isPlainObject(record)) fail("record must be an object");

  const expectedId = `${expectedName}@${expectedVersion}`;
  if ("id" in record && record.id !== expectedId) fail(`id must be ${expectedId}`);
  if ("name" in record && record.name !== expectedName) fail(`name must be ${expectedName}`);
  if ("version" in record && record.version !== expectedVersion) {
    fail(`version must be ${expectedVersion}`);
  }

  const filename = requireString(record.filename, "filename");
  if (filename !== expectedFilename) fail(`filename must be ${expectedFilename}`);

  return record;
}

function selectPackageKeyedRecord(parsed, { expectedName }) {
  if (!isPlainObject(parsed)) {
    fail("top-level value must be an array or package-keyed object");
  }
  const keys = Object.keys(parsed);
  if (!keys.includes(expectedName)) fail(`expected package key ${expectedName}`);
  if (keys.length !== 1) fail(`expected exactly one package key, received ${keys.length}`);
  return parsed[expectedName];
}

export function parseSingleNpmPackRecord(stdout, options) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    fail(`invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }

  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) fail(`expected exactly one record, received ${parsed.length}`);
    return validateRecord(parsed[0], options);
  }

  return validateRecord(selectPackageKeyedRecord(parsed, options), options);
}
