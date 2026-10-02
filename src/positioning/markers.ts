import type { Detection } from "@/spikes/aruco/detect";
import { project, solveMarkerPose, type Intrinsics, type MarkerPose } from "@/spikes/aruco/pose";
import type { Marker, Venue } from "@/core/schema";
import { refineMarkerPose } from "./refine";
import { bearingOfEN, col, DEG, markerAxesInWorld, mulM, mulV, rotZ, scale, sub, add, transpose, type M3, type V3 } from "./math";

/**
 * A fix is rejected when the quad does not fit the pose well, or the marker is seen too edge-on / too far / too close. */
export interface MarkerGate {
  maxReprojPx: number;
  maxObliqueDeg: number;
  minDistM: number;
  maxDistM: number;
}
export const DEFAULT_GATE: MarkerGate = { maxReprojPx: 2.5, maxObliqueDeg: 70, minDistM: 0.2, maxDistM: 2.5 };

/** RMS distance (px) between the detected corners and the model corners projected with the solved pose. */
export function reprojectionError(corners: readonly { x: number; y: number }[], pose: Pick<MarkerPose, "R" | "t">, K: Intrinsics, sizeM: number): number {
  const h = sizeM / 2;
  const model: V3[] = [
    [-h, -h, 0],
    [h, -h, 0],
    [h, h, 0],
    [-h, h, 0],
  ];
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const p = project(pose, K, model[i]!);
    const c = corners[i]!;
    sum += (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
  }
  return Math.sqrt(sum / 4);
}

/** Angle (deg) between the marker's outward normal and the line of sight to the camera. 0 = face-on, 90 = edge-on. */
export function obliquityDeg(pose: Pick<MarkerPose, "R" | "t">): number {
  const { R, t } = pose;
  const d = Math.hypot(t[0], t[1], t[2]);
  if (d === 0) return 90;
  const cos = (R[2]! * t[0] + R[5]! * t[1] + R[8]! * t[2]) / d;
  return Math.acos(Math.max(-1, Math.min(1, cos))) / DEG;
}

export type RejectReason = "unknown-marker" | "reprojection" | "oblique" | "too-far" | "too-close";

/** A camera pose in the venue world: right-handed (E, N, up), metres; `R` columns = camera x/y/z (OpenCV) in the world. */
export interface WorldCamera {
  pos: V3;
  R: M3;
}

export interface MarkerFix {
  markerId: number;
  floor: string;
  x: number;
  y: number;
  /** Bearing the camera looks at (deg). */
  heading: number;
  acc: number;
  distance: number;
  reprojPx: number;
  obliqueDeg: number;
  /** Marker -> camera pose as solved. */
  markerPose: MarkerPose;
  /** Camera in the venue world (E, N, up). */
  camera: WorldCamera;
}

export type MarkerFixResult = { ok: true; fix: MarkerFix } | { ok: false; reason: RejectReason; reprojPx?: number; obliqueDeg?: number; distance?: number; markerId: number };

export const floorElevation = (v: Venue, floorId: string): number => v.floors.find((f) => f.id === floorId)?.elevation ?? 0;

/** Marker frame -> venue world (E, N, up): rotation and the marker centre. */
export function markerInWorld(v: Venue, m: Marker): { R: M3; p: V3 } {
  return { R: markerAxesInWorld(m.normal), p: [m.x, -m.y, floorElevation(v, m.floor) + m.z] };
}

/** Camera pose in the venue world from a solved marker -> camera pose. */
export function cameraInWorld(v: Venue, m: Marker, pose: Pick<MarkerPose, "R" | "t">): WorldCamera {
  const mw = markerInWorld(v, m);
  const Rt = transpose(pose.R);
  const camInMarker = scale(mulV(Rt, pose.t), -1);
  return { pos: add(mulV(mw.R, camInMarker), mw.p), R: mulM(mw.R, Rt) };
}

/** Compass heading (deg) of a camera: its forward axis on the ground, or its "up" axis when it points steeply down/up. */
export function cameraHeading(R: M3): number {
  const fwd = col(R, 2);
  if (Math.hypot(fwd[0], fwd[1]) > 0.3) return bearingOfEN(fwd[0], fwd[1]);
  const up = scale(col(R, 1), -1); // OpenCV y points down, the top of the phone is -y
  return bearingOfEN(up[0], up[1]);
}

/** Detection -> gated device pose in the venue frame. Pure; the caller supplies the intrinsics for the image the corners come from. */
export function devicePoseFromMarker(v: Venue, det: Detection, K: Intrinsics, gate: MarkerGate = DEFAULT_GATE, refine = true): MarkerFixResult {
  const m = v.markers.find((x) => x.id === det.id);
  if (!m) return { ok: false, reason: "unknown-marker", markerId: det.id };
  const first = solveMarkerPose(det.corners, m.sizeM, K);
  const pose = refine ? refineMarkerPose(det.corners, m.sizeM, K, first) : first;
  const reprojPx = reprojectionError(det.corners, pose, K, m.sizeM);
  const obl = obliquityDeg(pose);
  const info = { markerId: det.id, reprojPx, obliqueDeg: obl, distance: pose.distance };
  if (pose.distance > gate.maxDistM) return { ok: false, reason: "too-far", ...info };
  if (pose.distance < gate.minDistM) return { ok: false, reason: "too-close", ...info };
  if (reprojPx > gate.maxReprojPx) return { ok: false, reason: "reprojection", ...info };
  if (obl > gate.maxObliqueDeg) return { ok: false, reason: "oblique", ...info };
  const camera = cameraInWorld(v, m, pose);
  // Measured on synthetic 12 cm markers (see tests): position error grows ~distance^2 (plane-pose ambiguity), so accuracy does too.
  const acc = Math.max(0.25, Math.min(1.5, 0.2 + 0.12 * pose.distance ** 2 + 0.05 * reprojPx));
  return {
    ok: true,
    fix: { markerId: m.id, floor: m.floor, x: camera.pos[0], y: -camera.pos[1], heading: cameraHeading(camera.R), acc, distance: pose.distance, reprojPx, obliqueDeg: obl, markerPose: pose, camera },
  };
}

/* ------------------------------------------------------------------------------------------------------------------
 * WebXR alignment. XR "local" space: x right, y up, -z forward (gravity aligned, arbitrary yaw + origin).
 * Venue world: (E, N, up). Map: p_world = Rz(theta) * S * p_xr + tau, S = (x, -z, y) a fixed axis swap,
 * so one marker sighting fixes theta (yaw) and tau (translation). Floor and its elevation come from the marker.
 * ---------------------------------------------------------------------------------------------------------------- */
export interface XrAlignment {
  theta: number;
  tau: V3;
  floor: string;
  /** World "up" (m) of the marker's floor, for the vertical floor-change check. */
  floorElevation: number;
  markerId: number;
}

const swap = (p: V3): V3 => [p[0], -p[2], p[1]];
const CV_TO_XR: M3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];

/** Column-major 4x4 -> rotation (row-major 3x3) and translation. */
export function splitMatrix4(m: ArrayLike<number>): { R: M3; t: V3 } {
  return { R: [m[0]!, m[4]!, m[8]!, m[1]!, m[5]!, m[9]!, m[2]!, m[6]!, m[10]!], t: [m[12]!, m[13]!, m[14]!] };
}

/** Marker -> XR local, given the XR camera-to-local matrix of the view the image came from and the solved marker -> camera pose. */
export function markerInXr(viewToRef: ArrayLike<number>, pose: Pick<MarkerPose, "R" | "t">): { R: M3; p: V3 } {
  const { R: Rv, t: tv } = splitMatrix4(viewToRef);
  const Rx = mulM(Rv, CV_TO_XR);
  return { R: mulM(Rx, pose.R), p: add(mulV(Rx, pose.t), tv) };
}

export function alignmentFromMarker(v: Venue, m: Marker, viewToRef: ArrayLike<number>, pose: Pick<MarkerPose, "R" | "t">): XrAlignment {
  const mw = markerInWorld(v, m);
  const mx = markerInXr(viewToRef, pose);
  // Horizontal direction of the marker's z axis (into the wall) in both frames fixes the yaw.
  const zx = swap(col(mx.R, 2));
  const zw = col(mw.R, 2);
  const theta = Math.atan2(zw[1], zw[0]) - Math.atan2(zx[1], zx[0]);
  const tau = sub(mw.p, mulV(rotZ(theta), swap(mx.p)));
  return { theta, tau, floor: m.floor, floorElevation: floorElevation(v, m.floor), markerId: m.id };
}

/** XR local point -> venue world (E, N, up). */
export function xrToWorld(al: Pick<XrAlignment, "theta" | "tau">, p: V3): V3 {
  return add(mulV(rotZ(al.theta), swap(p)), al.tau);
}

/** XR local direction -> venue world direction. */
export function xrDirToWorld(al: Pick<XrAlignment, "theta">, d: V3): V3 {
  return mulV(rotZ(al.theta), swap(d));
}

/** Device pose in the venue from the XR camera-to-local matrix (the phone's own tracking, no camera image needed). */
export function xrDevicePose(al: XrAlignment, viewToRef: ArrayLike<number>): { x: number; y: number; up: number; heading: number } {
  const { R, t } = splitMatrix4(viewToRef);
  const pos = xrToWorld(al, t);
  const fwd = xrDirToWorld(al, scale(col(R, 2), -1));
  const top = xrDirToWorld(al, col(R, 1));
  const heading = Math.hypot(fwd[0], fwd[1]) > 0.3 ? bearingOfEN(fwd[0], fwd[1]) : bearingOfEN(top[0], top[1]);
  return { x: pos[0], y: -pos[1], up: pos[2], heading };
}
