import { z } from "zod";

export const DEFAULT_PAGE_LIMIT = 100;
export const MAX_PAGE_LIMIT = 500;

export function createPaginationInputSchema(defaultLimit = DEFAULT_PAGE_LIMIT) {
  if (!Number.isInteger(defaultLimit) || defaultLimit < 1 || defaultLimit > MAX_PAGE_LIMIT) {
    throw new Error(`Default page limit must be an integer from 1 to ${MAX_PAGE_LIMIT}.`);
  }
  return {
    offset: z.number().int().min(0).default(0).describe("Zero-based result offset."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_LIMIT)
      .default(defaultLimit)
      .describe(`Maximum results to return (1-${MAX_PAGE_LIMIT}).`),
  };
}

export const PaginationInputSchema = createPaginationInputSchema();

export const PaginationOutputSchema = {
  offset: z.number().int().min(0),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
  has_more: z.boolean(),
  next_offset: z.number().int().min(0).nullable(),
};

export interface Page<T> {
  items: T[];
  offset: number;
  limit: number;
  total: number;
  has_more: boolean;
  next_offset: number | null;
}

export function paginate<T>(items: readonly T[], offset: number, limit: number): Page<T> {
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  const hasMore = nextOffset < items.length;
  return {
    items: pageItems,
    offset,
    limit,
    total: items.length,
    has_more: hasMore,
    next_offset: hasMore ? nextOffset : null,
  };
}
