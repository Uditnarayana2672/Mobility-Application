import type { PoseKind } from "./poseSource";

export type BusChoice = "bc" | "ws" | "both" | "default";

export interface RuntimeEnv {
  /** location.search */
  search: string;
  /** (pointer: coarse): a phone / tablet. */
  coarsePointer: boolean;
  /** navigator.xr exists (WebXR may still refuse immersive-ar later). */
  hasXr: boolean;
}

export interface RuntimeConfig {
  kind: PoseKind;
  bus: BusChoice;
  debug: boolean;
  demo: boolean;
}

/**
 * Which pose source and bus the visitor app starts with.
 *   ?pose=sim|xr|pdr  forces a source. Otherwise: ?demo=1 or a desktop = the simulator, a phone = camera + step counting (WebXR only with ?pose=xr).
 *   ?bus=bc|ws|both   forces the bus. Otherwise: the simulator talks BroadcastChannel (same-browser dashboard) and only *listens* on the
 *                      WebSocket (server notices); a live phone publishes over the WebSocket.
 *   ?debug=1          phone debug overlay.
 */
export function readRuntimeConfig(env: RuntimeEnv): RuntimeConfig {
  const q = new URLSearchParams(env.search);
  const demo = q.get("demo") === "1";
  const pose = q.get("pose");
  let kind: PoseKind;
  if (pose === "sim" || pose === "xr" || pose === "pdr") kind = pose;
  else if (demo || !env.coarsePointer) kind = "sim";
  else kind = "pdr"; // camera + step counting; WebXR only on request (?pose=xr): it needs ARCore and was not reliable on phones
  const b = q.get("bus");
  const bus: BusChoice = b === "bc" || b === "ws" || b === "both" ? b : "default";
  return { kind, bus, debug: q.get("debug") === "1", demo: demo && kind === "sim" };
}

/** Whether the WebSocket bus may publish (vs. listen only) for a configuration. */
export function wsPublishes(cfg: Pick<RuntimeConfig, "kind" | "bus">): boolean {
  if (cfg.bus === "ws" || cfg.bus === "both") return true;
  if (cfg.bus === "bc") return false;
  return cfg.kind !== "sim";
}

/** Whether BroadcastChannel is used at all. */
export function usesBroadcast(cfg: Pick<RuntimeConfig, "kind" | "bus">): boolean {
  if (cfg.bus === "ws") return false;
  if (cfg.bus === "bc" || cfg.bus === "both") return true;
  return cfg.kind === "sim";
}
