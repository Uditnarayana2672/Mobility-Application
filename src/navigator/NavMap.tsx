import { useEffect, useRef, useState } from "react";
import { MapCanvas, clamp, type MapHandle, type MapItem } from "@/ui/map";
import type { NavController, NavState } from "./controller";

/** Heading-up rotation that eases (shortest arc, time-based) instead of snapping at every pose. */
function useSmoothAngle(target: number, rate = 6): number {
  const [angle, setAngle] = useState(target);
  const cur = useRef(target);
  const tgt = useRef(target);
  tgt.current = target;
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const d = ((((tgt.current - cur.current) % 360) + 540) % 360) - 180;
      if (Math.abs(d) > 0.05) {
        cur.current += d * (1 - Math.exp(-dt * rate));
        setAngle(cur.current);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [rate]);
  return angle;
}

const ANCHOR: Record<NavState["mode"], number> = { explore: 0.4, place: 0.4, preview: 0.34, nav: 0.66 };

/** The shared SVG map, driven by the controller: explore = north-up, navigate = heading-up following the dot. */
export default function NavMap({ ctl, s }: { ctl: NavController; s: NavState }) {
  const handle = useRef<MapHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const heading = s.mode === "nav" && s.follow && s.user ? -s.user.heading : 0;
  const rotation = useSmoothAngle(heading);

  const nonce = s.focus?.nonce;
  useEffect(() => {
    const f = s.focus;
    const h = handle.current;
    const el = box.current;
    if (!f || !h || !el) return;
    let scale = f.scale;
    if (f.fitW && f.fitH !== undefined) {
      const r = el.getBoundingClientRect();
      scale = clamp(Math.min((r.width - 70) / f.fitW, (r.height * 0.4) / Math.max(1, f.fitH)), 4, 14);
    }
    h.centerOn(f.x, f.y, scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const onSelect = (item: MapItem | null) => {
    if (s.mode === "nav") return;
    if (!item) {
      if (s.mode === "place") ctl.closePlace();
      return;
    }
    if (item.type === "room") ctl.showPlace({ room: item.id });
    else if (item.type === "poi") ctl.showPlace({ poi: item.id });
  };

  return (
    <div id="mapbox" ref={box} data-testid="navmap" data-floor={s.viewFloor} data-mode={s.mode}>
      <MapCanvas
        ref={handle}
        venue={s.venue}
        floorId={s.viewFloor}
        layers={{ pois: true, markers: false }}
        selected={s.place && s.place.kind === "room" && (s.mode === "place" || s.mode === "preview") ? { type: "room", id: s.place.id } : null}
        route={s.route}
        progress={s.snap?.s ?? 0}
        user={s.user}
        rotation={rotation}
        anchorY={ANCHOR[s.mode]}
        followUser={s.mode === "nav" && s.follow}
        minScale={3}
        maxScale={42}
        onSelect={onSelect}
        onUserMove={() => ctl.onUserMovedMap()}
      />
    </div>
  );
}
