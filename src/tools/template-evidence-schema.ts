import { z } from "zod";

/** Output schemas for Angular template evidence, shared by every tool that reports references. */
export const ReferenceOriginSchema = z.enum(["compiler", "template_external", "template_inline"]);

export const TemplateCoverageSchema = z.object({
  status: z.enum(["completed", "unfinished", "unsupported"]),
  reason: z
    .enum([
      "compiler_missing",
      "compiler_unsupported",
      "template_unresolved",
      "template_unsafe",
      "template_parse_error",
      "size_exceeded",
      "work_exhausted",
      "inherited_member",
      "cross_component",
    ])
    .optional(),
  templates: z.number().int().min(0).optional(),
});

/** Present only when template coverage applies to the symbol. */
export const templateEvidenceFields = {
  template_coverage: TemplateCoverageSchema.optional(),
  template_reference_count: z.number().int().min(0).optional(),
};
