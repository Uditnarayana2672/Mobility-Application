/** Paper sizes (mm) and the rule for whether a marker of a given printed size fits on one. */
export type Paper = "A6" | "A5" | "A4";
export const PAPERS: Record<Paper, { w: number; h: number }> = {
  A6: { w: 105, h: 148 },
  A5: { w: 148, h: 210 },
  A4: { w: 210, h: 297 },
};
export const PAPER_IDS: Paper[] = ["A6", "A5", "A4"];

/** Cells across a printed marker: 4 data cells + a black border cell on each side. */
export const CELLS = 6;
/** White quiet zone around the black square, in marker cells (the detector samples 0.5 cell outside the border). */
export const QUIET_CELLS = 0.7;
/** Height reserved under the code for the ID, location, details and the ruler bar. */
export const TEXT_MM = 38;
const TOP_MM = 6;
const EPS = 0.01;

/** Largest black-square size (mm) that fits the paper with the quiet zone and the text block. */
export function maxMarkerMm(paper: Paper): number {
  const { w, h } = PAPERS[paper];
  const k = 1 + (2 * QUIET_CELLS) / CELLS; // square + quiet zone, relative to the square
  return Math.min(w / k, (h - TEXT_MM - TOP_MM) / k);
}

export const fitsPaper = (paper: Paper, sizeMm: number): boolean => sizeMm <= maxMarkerMm(paper) + EPS;

/** Smallest paper that fits every given size (mm), or null if none does. */
export function smallestPaper(sizesMm: number[]): Paper | null {
  const biggest = Math.max(0, ...sizesMm);
  return PAPER_IDS.find((p) => fitsPaper(p, biggest)) ?? null;
}

/** Layout of one sheet, all in mm from the top-left of the page. */
export function sheetLayout(paper: Paper, sizeMm: number) {
  const { w, h } = PAPERS[paper];
  const quiet = (QUIET_CELLS * sizeMm) / CELLS;
  const codeX = (w - sizeMm) / 2;
  const codeY = TOP_MM + quiet;
  return { pageW: w, pageH: h, codeX, codeY, quiet, textY: codeY + sizeMm + quiet + 2 };
}
