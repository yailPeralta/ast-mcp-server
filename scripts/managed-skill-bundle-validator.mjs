const managedGuidanceMarker = "<!-- ast-tool:structural-code-editing guidance";
const skillNamePattern = /^name: structural-code-editing$/mu;
const skillVersionPattern = /^ {2}version: "([^"]+)"$/gmu;

function fail(message) {
  throw new Error(`Managed skill bundle validation failed: ${message}`);
}

export function validateManagedSkillBundle({
  packagedSkill,
  packagedGuidance,
  packagedReleases,
  copiedSkills,
}) {
  let manifest;
  try {
    manifest = JSON.parse(packagedReleases);
  } catch {
    fail("release manifest is not valid JSON.");
  }
  if (!skillNamePattern.test(packagedSkill)) {
    fail("bundled skill metadata is invalid.");
  }
  const versionMatches = [...packagedSkill.matchAll(skillVersionPattern)];
  if (versionMatches.length !== 1 || versionMatches[0]?.[1] === undefined) {
    fail("bundled skill version metadata is invalid.");
  }
  const bundledVersion = versionMatches[0][1];
  if (manifest?.current?.version !== bundledVersion) {
    fail("release-manifest version does not match the bundled skill version.");
  }
  if (packagedGuidance.includes(managedGuidanceMarker)) {
    fail("bundled guidance contains its managed embedding marker.");
  }
  if (!Array.isArray(copiedSkills) || copiedSkills.length === 0) {
    fail("installed skill copies are required.");
  }
  if (copiedSkills.some((copy) => copy !== packagedSkill)) {
    fail("installed skill copy does not match the bundled skill bytes.");
  }
  return { version: bundledVersion };
}
