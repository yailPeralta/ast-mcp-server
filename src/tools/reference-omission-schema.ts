import { z } from "zod";

/** Counts of the locations a references result leaves out; shared by every tool that reports references. */
export const OmittedReferencesSchema = z.object({
  external_library: z.number().int().min(0),
  unrelated_declarations: z.number().int().min(0),
  unrelated_usages: z.number().int().min(0),
});

/** Present only when at least one location was omitted. */
export const referenceOmissionFields = {
  omitted_references: OmittedReferencesSchema.optional(),
};
