import { describe, expect, it } from "vitest";
import { paginate, PaginationInputSchema } from "../src/services/pagination.js";

describe("paginate", () => {
  it("returns deterministic continuation metadata", () => {
    expect(paginate(["a", "b", "c"], 0, 2)).toEqual({
      items: ["a", "b"],
      offset: 0,
      limit: 2,
      total: 3,
      has_more: true,
      next_offset: 2,
    });
    expect(paginate(["a", "b", "c"], 2, 2)).toEqual({
      items: ["c"],
      offset: 2,
      limit: 2,
      total: 3,
      has_more: false,
      next_offset: null,
    });
  });

  it("rejects offsets that cannot be represented exactly", () => {
    expect(PaginationInputSchema.offset.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  });
});
