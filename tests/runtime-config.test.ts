import { describe, expect, it } from "vitest";
import { readRuntimeConfig, usesBroadcast, wsPublishes } from "@/navigator/runtimeConfig";

const env = (search: string, coarsePointer = false, hasXr = false) => ({ search, coarsePointer, hasXr });

describe("readRuntimeConfig", () => {
  it("desktop and ?demo=1 use the simulator", () => {
    expect(readRuntimeConfig(env("")).kind).toBe("sim");
    expect(readRuntimeConfig(env("?demo=1", true, true)).kind).toBe("sim");
    expect(readRuntimeConfig(env("?demo=1")).demo).toBe(true);
  });
  it("a phone uses WebXR when the browser has it, else step counting", () => {
    expect(readRuntimeConfig(env("", true, true)).kind).toBe("pdr"); // camera + step counting is the default even when WebXR exists
    expect(readRuntimeConfig(env("", true, false)).kind).toBe("pdr");
  });
  it("?pose= forces a source (and the demo panel only exists for the simulator)", () => {
    expect(readRuntimeConfig(env("?pose=pdr")).kind).toBe("pdr");
    expect(readRuntimeConfig(env("?pose=xr&demo=1")).demo).toBe(false);
    expect(readRuntimeConfig(env("?pose=bogus", true, true)).kind).toBe("pdr");
  });
  it("debug flag", () => {
    expect(readRuntimeConfig(env("?debug=1")).debug).toBe(true);
    expect(readRuntimeConfig(env("")).debug).toBe(false);
  });
});

describe("bus choice", () => {
  it("default: the simulator publishes on BroadcastChannel and only listens on the WebSocket; a live phone publishes on the WebSocket", () => {
    expect([usesBroadcast({ kind: "sim", bus: "default" }), wsPublishes({ kind: "sim", bus: "default" })]).toEqual([true, false]);
    expect([usesBroadcast({ kind: "xr", bus: "default" }), wsPublishes({ kind: "xr", bus: "default" })]).toEqual([false, true]);
  });
  it("?bus= overrides", () => {
    expect([usesBroadcast({ kind: "sim", bus: "ws" }), wsPublishes({ kind: "sim", bus: "ws" })]).toEqual([false, true]);
    expect([usesBroadcast({ kind: "sim", bus: "both" }), wsPublishes({ kind: "sim", bus: "both" })]).toEqual([true, true]);
    expect([usesBroadcast({ kind: "pdr", bus: "bc" }), wsPublishes({ kind: "pdr", bus: "bc" })]).toEqual([true, false]);
  });
});
