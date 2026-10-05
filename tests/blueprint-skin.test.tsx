import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseVenue, type Venue } from "@/core";
import { MapCanvas } from "@/ui/map";

const r = parseVenue(JSON.parse(fs.readFileSync("public/venues/office-hq/venue.json", "utf8")));
if (!r.ok) throw new Error("fixture");
const V: Venue = r.data;
const html = (props: Partial<Parameters<typeof MapCanvas>[0]> = {}) => renderToStaticMarkup(<MapCanvas venue={V} floorId="F1" {...props} />);

describe("Blueprint map skin", () => {
  it("is the default look: paper grid, thick walls with a hairline, door swing arcs, north arrow and scale bar", () => {
    const h = html();
    expect(h).toContain('id="bpGrid1"');
    expect(h).toContain('data-testid="map-decor"');
    expect(h).toMatch(/stroke="#2f4257" stroke-width="0\.2"/); // wall thickness 0.2 m
    expect(h).toMatch(/<path d="M[\d. -]+ A[\d. ]+0 0 [01] [\d. -]+"[^>]*stroke-dasharray="0\.12 0\.08"/); // a door arc
    expect(h).toContain('aria-label="North"');
  });

  it("keeps every hit-test attribute the classic skin has", () => {
    const bp = html();
    const classic = html({ theme: "classic" });
    for (const room of V.rooms.filter((x) => x.floor === "F1")) {
      expect(bp).toContain(`data-id="${room.id}"`);
      expect(classic).toContain(`data-id="${room.id}"`);
    }
    expect(classic).not.toContain("bpGrid1");
    expect(classic).not.toContain("map-decor");
  });

  it("the decor can be switched off; the north arrow follows the true-north offset", () => {
    expect(html({ decor: false })).not.toContain("map-decor");
    const v: Venue = { ...V, northOffsetDeg: 30 };
    const h = renderToStaticMarkup(<MapCanvas venue={v} floorId="F1" rotation={10} />);
    expect(h).toContain("rotate(-20)"); // rotation 10 - offset 30
  });

  it("draws furniture as plan symbols (a bed has pillows), and shows room sizes on request", () => {
    const withBed: Venue = { ...V, objects: [{ id: "O1", floor: "F1", kind: "bed", x: 10, y: 10, w: 2, h: 1, rotation: 0, label: "Bed" }] };
    const h = renderToStaticMarkup(<MapCanvas venue={withBed} floorId="F1" />);
    expect(h).toContain('data-id="O1"');
    expect(h).not.toContain("🛏️");
    expect(renderToStaticMarkup(<MapCanvas venue={withBed} floorId="F1" layers={{ dims: true }} />)).toMatch(/\d+(\.\d)? × \d+(\.\d)? m/);
  });
});
