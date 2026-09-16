export function needsPageOcr(embeddedText: string, hasRasterContent: boolean) {
  // A scanner may add a readable title, footer, or annotation to a scanned page.
  // A character-count threshold alone silently misses the quote underneath.
  return embeddedText.trim().length < 40 || hasRasterContent;
}

export function mergeRecognizedPage(embeddedText: string, visualText: string, pageNumber: number) {
  const embedded = embeddedText.trim(), visual = visualText.trim();
  const normalize = (value: string) => value.replace(/\s+/g, " ").toLowerCase();
  const content = !embedded || normalize(embedded) === normalize(visual) ? visual || embedded
    : !visual ? embedded : `${embedded}\n\n--- SCANNED CONTENT ---\n${visual}`;
  return `--- PAGE ${pageNumber} ---\n${content}`;
}

export function boundedOcrScale(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("This PDF page has no readable dimensions.");
  // Leave room for the canvas dimensions being rounded up to whole pixels.
  return Math.min(2, 4096 / Math.max(width, height), Math.sqrt(7_990_000 / (width * height)));
}
