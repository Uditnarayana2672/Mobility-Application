import { roomDoors } from "@/core/doors";
import { delta, dist } from "@/core/geo";
import { nextStep, pointAt } from "@/core/playback";
import type { Route } from "@/core/route";
import type { Campaign, Venue, Wall } from "@/core/schema";
import type { Pose } from "@/navigator/poseSource";

export interface ArPose extends Pose {
  /** Metres travelled along the compiled route. */
  progressM: number;
  /** Horizontal camera field of view. The default matches the simulation camera. */
  horizontalFovDeg?: number;
}

export interface MapPoint3 {
  x: number;
  y: number;
  /** Height above the venue datum, in metres. */
  z: number;
}

export interface Chevron {
  id: string;
  at: MapPoint3;
  bearing: number;
  distanceM: number;
  opacity: number;
}

export interface TurnArrow {
  at: MapPoint3;
  before: MapPoint3;
  after: MapPoint3;
  dir: "left" | "right";
  distanceM: number;
  label: string;
}

export interface DestinationPin {
  at: MapPoint3;
  label: string;
  distanceM: number;
}

export interface FloorChangeArrow {
  at: MapPoint3;
  via: "stairs" | "lift";
  direction: "up" | "down";
  toFloor: string;
  label: string;
  distanceM: number;
}

export interface AdQuad {
  id: string;
  campaign: Campaign;
  wall: Wall;
  /** TL, TR, BR, BL in venue/map coordinates. */
  corners: readonly [MapPoint3, MapPoint3, MapPoint3, MapPoint3];
  centre: MapPoint3;
  normal: { x: number; y: number };
  distanceM: number;
}

export interface ArSceneModel {
  floor: string;
  floorElevation: number;
  chevrons: Chevron[];
  turnArrows: TurnArrow[];
  destinationPin: DestinationPin | null;
  floorChangeArrow: FloorChangeArrow | null;
  adQuads: AdQuad[];
}

export interface SceneModelOptions {
  chevronSpacingM: number;
  chevronStartM: number;
  lookAheadM: number;
  turnRangeM: number;
  cueRangeM: number;
  adRangeM: number;
  safetyRadiusM: number;
}

export const DEFAULT_SCENE_OPTIONS: SceneModelOptions = {
  chevronSpacingM: 1.5,
  chevronStartM: 1.2,
  lookAheadM: 20,
  turnRangeM: 15,
  cueRangeM: 24,
  adRangeM: 10,
  safetyRadiusM: 2,
};

const rad = (deg: number): number => (deg * Math.PI) / 180;

function floorElevation(venue: Venue, floor: string): number {
  return venue.floors.find((f) => f.id === floor)?.elevation ?? 0;
}

function verticalDoors(venue: Venue, floor: string): { x: number; y: number }[] {
  return venue.rooms.filter((r) => r.floor === floor && (r.kind === "stairs" || r.kind === "lift")).flatMap((r) => roomDoors(r));
}

function clearOfVerticalDoor(x: number, y: number, doors: readonly { x: number; y: number }[], radius: number): boolean {
  return doors.every((d) => Math.hypot(x - d.x, y - d.y) >= radius);
}

function pointSegmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const den = dx * dx + dy * dy;
  const t = den === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function wallClearOfVerticalDoors(wall: Wall, doors: readonly { x: number; y: number }[], radius: number): boolean {
  return doors.every((d) => pointSegmentDistance(d, { x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }) >= radius);
}

function bearingTo(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return ((Math.atan2(b.x - a.x, -(b.y - a.y)) / Math.PI) * 180 + 360) % 360;
}

function wallQuad(wall: Wall, elevation: number, campaign: Campaign, distanceM: number): AdQuad {
  const mx = (wall.x1 + wall.x2) / 2;
  const my = (wall.y1 + wall.y2) / 2;
  const nx = Math.sin(rad(wall.normal));
  const ny = -Math.cos(rad(wall.normal));
  // Offset 4 cm towards the viewer-facing normal to avoid z-fighting with the surveyed wall.
  const ox = nx * 0.04;
  const oy = ny * 0.04;
  const bottom = elevation + wall.bottom;
  const top = bottom + wall.height;
  const tl = { x: wall.x1 + ox, y: wall.y1 + oy, z: top };
  const tr = { x: wall.x2 + ox, y: wall.y2 + oy, z: top };
  const br = { x: wall.x2 + ox, y: wall.y2 + oy, z: bottom };
  const bl = { x: wall.x1 + ox, y: wall.y1 + oy, z: bottom };
  return {
    id: `${campaign.id}:${wall.id}`,
    campaign,
    wall,
    corners: [tl, tr, br, bl],
    centre: { x: mx + ox, y: my + oy, z: bottom + wall.height / 2 },
    normal: { x: nx, y: ny },
    distanceM,
  };
}

/**
 * Deterministic AR content selection and placement. Everything is returned in the venue/map frame
 * (x east, y south, z up from the venue datum); renderers only project/map these primitives.
 */
export function buildSceneModel(
  route: Route | null,
  venue: Venue,
  pose: ArPose,
  campaigns: readonly Campaign[],
  options: Partial<SceneModelOptions> = {},
): ArSceneModel {
  const opt = { ...DEFAULT_SCENE_OPTIONS, ...options };
  const elevation = floorElevation(venue, pose.floor);
  const doors = verticalDoors(venue, pose.floor);
  const chevrons: Chevron[] = [];
  const turnArrows: TurnArrow[] = [];
  let destinationPin: DestinationPin | null = null;
  let floorChangeArrow: FloorChangeArrow | null = null;

  if (route) {
    for (let d = opt.chevronStartM; d <= opt.lookAheadM && pose.progressM + d < route.total; d += opt.chevronSpacingM) {
      const p = pointAt(route, pose.progressM + d);
      if (p.floor !== pose.floor || p.vertical) break;
      if (!clearOfVerticalDoor(p.x, p.y, doors, opt.safetyRadiusM)) continue;
      chevrons.push({
        id: `chevron-${chevrons.length}`,
        at: { x: p.x, y: p.y, z: elevation + 0.035 },
        bearing: p.bearing,
        distanceM: d,
        opacity: Math.max(0.12, 1 - d / opt.lookAheadM),
      });
    }

    const next = nextStep(route, pose.progressM);
    if (next.step.kind === "turn" && next.remaining <= opt.turnRangeM && next.remaining > 0.2 && next.step.at.floor === pose.floor) {
      const before = pointAt(route, Math.max(0, next.step.sAt - 2.5));
      const after = pointAt(route, Math.min(route.total, next.step.sAt + 2.8));
      turnArrows.push({
        at: { ...next.step.at, z: elevation + 0.07 },
        before: { x: before.x, y: before.y, z: elevation + 0.07 },
        after: { x: after.x, y: after.y, z: elevation + 0.07 },
        dir: next.step.dir,
        distanceM: next.remaining,
        label: `Turn ${next.step.dir}`,
      });
    } else if (next.step.kind === "vertical" && next.remaining <= opt.cueRangeM && next.step.at.floor === pose.floor) {
      const vertical = next.step;
      const doorway = venue.rooms
        .filter((room) => room.floor === pose.floor && room.kind === vertical.via)
        .flatMap((room) => roomDoors(room))
        .sort((a, b) => dist(a, vertical.at) - dist(b, vertical.at))[0] ?? vertical.at;
      floorChangeArrow = {
        at: { x: doorway.x, y: doorway.y, z: elevation + 1.65 },
        via: vertical.via,
        direction: vertical.up ? "up" : "down",
        toFloor: vertical.toFloor,
        label: `${vertical.via === "lift" ? "Lift" : "Stairs"} ${vertical.up ? "up" : "down"}`,
        distanceM: next.remaining,
      };
    }

    const end = route.points[route.points.length - 1];
    if (end?.floor === pose.floor) {
      destinationPin = {
        at: { x: end.x, y: end.y, z: elevation + 2.2 },
        label: route.destName,
        distanceM: Math.max(0, route.total - pose.progressM),
      };
    }
  }

  const fov = pose.horizontalFovDeg ?? 70;
  const adQuads: AdQuad[] = [];
  for (const campaign of campaigns) {
    if (campaign.status !== "active") continue;
    for (const wallId of campaign.walls) {
      const wall = venue.walls.find((w) => w.id === wallId);
      if (!wall || !wall.approved || wall.floor !== pose.floor || !wallClearOfVerticalDoors(wall, doors, opt.safetyRadiusM)) continue;
      const mx = (wall.x1 + wall.x2) / 2;
      const my = (wall.y1 + wall.y2) / 2;
      const distanceM = dist(pose, { x: mx, y: my });
      if (distanceM > opt.adRangeM) continue;
      const nx = Math.sin(rad(wall.normal));
      const ny = -Math.cos(rad(wall.normal));
      if ((pose.x - mx) * nx + (pose.y - my) * ny <= 0.2) continue;
      if (Math.abs(delta(bearingTo(pose, { x: mx, y: my }) - pose.heading)) > fov / 2 + 8) continue;
      adQuads.push(wallQuad(wall, elevation, campaign, distanceM));
    }
  }

  return { floor: pose.floor, floorElevation: elevation, chevrons, turnArrows, destinationPin, floorChangeArrow, adQuads };
}
