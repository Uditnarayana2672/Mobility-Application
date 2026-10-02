import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { DICTIONARY, markerBits } from "@/core/aruco/dict";
import { parseVenue, type Venue } from "@/core";
import { ArucoCode, MarkerSheet, mm } from "@/markers/MarkerSheet";
import { PAPERS, fitsPaper, maxMarkerMm, sheetLayout, smallestPaper } from "@/markers/paper";

const V: Venue = (() => {
  const r = parseVenue(JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8")));
  if (!r.ok) throw new Error("bad fixture");
  return r.data;
})();

describe("paper fitting", () => {
  it("the default 120 mm marker fits A5 and A4 but not A6", () => {
    expect(fitsPaper("A5", 120)).toBe(true);
    expect(fitsPaper("A4", 120)).toBe(true);
    expect(fitsPaper("A6", 120)).toBe(false);
    expect(smallestPaper([120])).toBe("A5");
  });
  it("A6 holds up to ~84 mm, A5 up to 120 mm, A4 up to ~170 mm", () => {
    expect(maxMarkerMm("A6")).toBeCloseTo(84.3, 0);
    expect(maxMarkerMm("A5")).toBeCloseTo(120, 0);
    expect(maxMarkerMm("A4")).toBeCloseTo(170.3, 0);
    expect(smallestPaper([80])).toBe("A6");
    expect(smallestPaper([80, 150])).toBe("A4");
    expect(smallestPaper([400])).toBeNull();
  });
  it("the laid out code and its quiet zone stay on the page, centred", () => {
    for (const p of ["A6", "A5", "A4"] as const) {
      const size = Math.floor(maxMarkerMm(p));
      const L = sheetLayout(p, size);
      const { w, h } = PAPERS[p];
      expect(L.codeX).toBeCloseTo((w - size) / 2, 6);
      expect(L.codeX - L.quiet).toBeGreaterThanOrEqual(-0.01);
      expect(L.codeX + size + L.quiet).toBeLessThanOrEqual(w + 0.01);
      expect(L.textY).toBeLessThan(h);
    }
  });
});

describe("ArucoCode", () => {
  it("prints the black square at exactly sizeM (in CSS mm)", () => {
    for (const sizeM of [0.08, 0.12, 0.16, 0.1234]) {
      const html = renderToStaticMarkup(<ArucoCode id={3} sizeM={sizeM} />);
      expect(html).toContain(`width="${mm(sizeM)}mm"`);
      expect(html).toContain(`height="${mm(sizeM)}mm"`);
      expect(html).toContain('viewBox="0 0 6 6"');
    }
  });
  it("draws one white cell per 1-bit of the dictionary code, matching markerBits()", () => {
    for (const id of [0, 7, 49]) {
      const html = renderToStaticMarkup(<ArucoCode id={id} sizeM={0.12} />);
      const whites = (html.match(/fill="#fff"/g) ?? []).length;
      const expected = markerBits(id).flat().filter(Boolean).length;
      expect(whites).toBe(expected);
      expect(html.match(/<rect /g)?.length).toBe(expected + 1); // + the black square
    }
  });
  it("different ids give different images", () => {
    const imgs = new Set(Array.from({ length: DICTIONARY.length }, (_, id) => renderToStaticMarkup(<ArucoCode id={id} sizeM={0.12} />)));
    expect(imgs.size).toBe(DICTIONARY.length);
  });
});

describe("MarkerSheet", () => {
  it("shows ID, location, floor, install height, facing, an up arrow and the 100 mm ruler", () => {
    const m = V.markers.find((x) => x.name.startsWith("Lift lobby (Floor 1)"))!;
    const html = renderToStaticMarkup(<MarkerSheet marker={m} venue={V} paper="A5" />);
    expect(html).toContain(`ID ${String(m.id).padStart(2, "0")}`);
    expect(html).toContain("Lift lobby (Floor 1)");
    expect(html).toContain("Floor 1");
    expect(html).toContain("Stick at 1.4 m height");
    expect(html).toContain("faces North");
    expect(html).toContain("▲ UP");
    expect(html).toContain("width:100mm"); // ruler bar
    expect(html).toContain("width:148mm");
    expect(html).toContain("height:210mm");
    expect(html).toContain(`width="${mm(m.sizeM)}mm"`);
  });
  it("every marker of the sample venue renders a code whose size equals its sizeM", () => {
    for (const m of V.markers) {
      const html = renderToStaticMarkup(<MarkerSheet marker={m} venue={V} paper="A5" />);
      expect(html).toContain(`<svg class="aruco" width="${mm(m.sizeM)}mm"`);
    }
  });
});
