export interface ManagedSkillBundleValidationInput {
  packagedSkill: string;
  packagedGuidance: string;
  packagedReleases: string;
  copiedSkills: readonly string[];
}

export interface ManagedSkillBundleValidationResult {
  version: string;
}

export function validateManagedSkillBundle(
  input: ManagedSkillBundleValidationInput,
): ManagedSkillBundleValidationResult;
