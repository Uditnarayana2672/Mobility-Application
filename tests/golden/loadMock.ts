import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/** Loads the mock UI's data.js + engine.js (IIFEs on a global `IS`) into an isolated vm context. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MockIS = any;

const MOCK_DIR = path.join(process.cwd(), "docs", "mock-ui", "js");

export function loadMock(): MockIS {
  const ctx = vm.createContext({ console });
  for (const f of ["data.js", "engine.js"]) {
    vm.runInContext(fs.readFileSync(path.join(MOCK_DIR, f), "utf8"), ctx, { filename: f });
  }
  return (ctx as { IS: MockIS }).IS;
}
