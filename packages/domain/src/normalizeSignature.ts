export function normalizeSignature(lines: string[]): string {
  return lines
    .map((line) => line.replace(/^<[^>]+>\s*/, "").trim())
    .filter((line) => line.length > 0)
    .sort((a, b) => a.localeCompare(b))
    .join("\n");
}
