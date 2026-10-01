import { GRID, markerBits } from "./aruco/dict";
import { MARKER_SIZE_MM, PRINT_IDS } from "./aruco/print";

const CELLS = GRID + 2;
const A5_W = 148;
const A5_H = 210;

function Marker({ id }: { id: number }) {
  const bits = markerBits(id);
  const cell = MARKER_SIZE_MM / CELLS;
  const x0 = (A5_W - MARKER_SIZE_MM) / 2;
  const y0 = 28;
  const rects: JSX.Element[] = [];
  rects.push(<rect key="b" x={x0} y={y0} width={MARKER_SIZE_MM} height={MARKER_SIZE_MM} fill="#000" />);
  bits.forEach((row, r) =>
    row.forEach((white, c) => {
      if (white) rects.push(<rect key={`${r}-${c}`} x={x0 + (c + 1) * cell} y={y0 + (r + 1) * cell} width={cell} height={cell} fill="#fff" />);
    }),
  );
  return (
    <svg className="marker-page" viewBox={`0 0 ${A5_W} ${A5_H}`} width={`${A5_W}mm`} height={`${A5_H}mm`} xmlns="http://www.w3.org/2000/svg">
      <rect width={A5_W} height={A5_H} fill="#fff" />
      {rects}
      <text x={A5_W / 2} y={y0 - 8} textAnchor="middle" fontSize="9" fontFamily="sans-serif">
        Marker {id} · IND_4X4_50
      </text>
      <text x={A5_W / 2} y={y0 + MARKER_SIZE_MM + 10} textAnchor="middle" fontSize="6" fontFamily="sans-serif">
        Black square = {MARKER_SIZE_MM} mm (measure it after printing!). Keep the white margin. Print at 100% / "actual size".
      </text>
      <text x={A5_W / 2} y={y0 + MARKER_SIZE_MM + 20} textAnchor="middle" fontSize="6" fontFamily="sans-serif">
        Top of the marker = up. Stick on a flat wall at about 1.4 m height.
      </text>
    </svg>
  );
}

/** Printable A5 sheet(s): one marker per page, true size. */
export default function S2Markers() {
  return (
    <div className="bg-white text-black">
      <style>{`
        @page { size: A5 portrait; margin: 0; }
        .marker-page { display: block; margin: 0 auto 8mm; border: 1px dashed #bbb; }
        @media print { .no-print { display: none } .marker-page { margin: 0; border: none; page-break-after: always; } }
      `}</style>
      <div className="no-print p-3 text-sm">
        Print on A5 at 100% scale (no "fit to page"), then measure the black square: it must be {MARKER_SIZE_MM} mm. If it isn't, edit MARKER_SIZE_MM in
        src/spikes/aruco/print.ts to the measured value.
      </div>
      {PRINT_IDS.map((id) => (
        <Marker key={id} id={id} />
      ))}
    </div>
  );
}
