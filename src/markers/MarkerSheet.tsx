import { markerBits } from "@/core/aruco/dict";
import type { Marker, Venue } from "@/core/schema";
import { CELLS, sheetLayout, type Paper } from "./paper";

const DIRS: Record<number, string> = { 0: "North", 90: "East", 180: "South", 270: "West" };
export const facing = (deg: number): string => DIRS[deg] ?? `${deg}°`;
export const mm = (sizeM: number): number => Math.round(sizeM * 100000) / 100;

/** The ArUco image alone: a black square whose printed side is exactly `sizeM` (CSS millimetres), white cells for 1-bits. */
export function ArucoCode({ id, sizeM }: { id: number; sizeM: number }) {
  const bits = markerBits(id);
  const size = `${mm(sizeM)}mm`;
  return (
    <svg className="aruco" width={size} height={size} viewBox={`0 0 ${CELLS} ${CELLS}`} shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg" data-marker-id={id}>
      <rect width={CELLS} height={CELLS} fill="#000" />
      {bits.flatMap((row, r) => row.map((white, c) => (white ? <rect key={`${r}-${c}`} x={c + 1} y={r + 1} width={1} height={1} fill="#fff" /> : null)))}
    </svg>
  );
}

/** One printable page for one marker: code at true size, big ID, location, floor, install height, up arrow, ruler bar. */
export function MarkerSheet({ marker: m, venue, paper, highlight }: { marker: Marker; venue: Venue; paper: Paper; highlight?: boolean }) {
  const sizeMm = mm(m.sizeM);
  const L = sheetLayout(paper, sizeMm);
  const floor = venue.floors.find((f) => f.id === m.floor)?.name ?? m.floor;
  return (
    <section className={`sheet ${highlight ? "hl" : ""}`} style={{ width: `${L.pageW}mm`, height: `${L.pageH}mm` }} data-marker-sheet={m.id}>
      <div className="up">▲ UP</div>
      <div className="code-wrap" style={{ left: `${L.codeX}mm`, top: `${L.codeY}mm` }}>
        <ArucoCode id={m.id} sizeM={m.sizeM} />
      </div>
      <div className="text" style={{ top: `${L.textY}mm` }}>
        <div className="arrow">▲</div>
        <div className="id">ID {String(m.id).padStart(2, "0")}</div>
        <div className="loc">{m.name}</div>
        <div className="meta">
          {venue.name} · {floor}
        </div>
        <div className="meta">
          Stick at {m.z} m height · faces {facing(m.normal)} · ({m.x}, {m.y}) m
        </div>
        {m.note && <div className="meta">{m.note}</div>}
        <div className="ruler" style={{ width: "100mm" }}>
          <span>100 mm: measure this bar after printing (print at 100%)</span>
        </div>
        <div className="size">black square {sizeMm} mm</div>
      </div>
      <span className="cut">✂ cut here</span>
    </section>
  );
}

/** Print + screen CSS for the sheets. `paper` sets the @page size. */
export function SheetStyles({ paper, w, h }: { paper: Paper; w: number; h: number }) {
  return (
    <style>{`
      @page { size: ${w}mm ${h}mm; margin: 0; }
      .sheets { display: flex; flex-wrap: wrap; gap: 8mm; padding: 6mm; justify-content: center; }
      .sheet { position: relative; background: #fff; color: #000; border: 1px dashed #98a3b8; box-sizing: border-box; overflow: hidden; font-family: system-ui, sans-serif; }
      .sheet.hl { outline: 3px solid #2f5bea; }
      .sheet .up { position: absolute; top: 3mm; left: 4mm; font-size: 3.4mm; font-weight: 800; color: #555; }
      .sheet .code-wrap { position: absolute; line-height: 0; }
      .sheet .aruco { display: block; }
      .sheet .text { position: absolute; left: 0; right: 0; text-align: center; padding: 0 4mm; }
      .sheet .arrow { font-size: 6mm; line-height: 6mm; }
      .sheet .id { font-size: 9mm; font-weight: 800; line-height: 10mm; letter-spacing: .04em; }
      .sheet .loc { font-size: 4.6mm; font-weight: 700; line-height: 5.5mm; }
      .sheet .meta { font-size: 3.2mm; line-height: 4mm; color: #333; }
      .sheet .ruler { margin: 2mm auto 0; border: .3mm solid #000; border-top: none; height: 3mm; text-align: center; box-sizing: border-box; position: relative; }
      .sheet .ruler span { position: absolute; left: 0; right: 0; top: 3.4mm; font-size: 2.6mm; color: #555; }
      .sheet .size { margin-top: 6mm; font-size: 2.6mm; color: #777; }
      .sheet .cut { position: absolute; bottom: 1mm; right: 3mm; font-size: 2.6mm; color: #98a3b8; }
      @media print {
        body { background: #fff !important; }
        .noprint { display: none !important; }
        .sheets { display: block; padding: 0; gap: 0; }
        .sheet { border: none; page-break-after: always; break-after: page; margin: 0; outline: none !important; }
        .sheet .cut { display: none; }
      }
    `}</style>
  );
}
