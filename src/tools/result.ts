export function structuredResult<T extends Record<string, unknown>>(
  structuredContent: T,
): {
  content: [];
  structuredContent: T;
} {
  return { content: [], structuredContent };
}

export function errorResult(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}
