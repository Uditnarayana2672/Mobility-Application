import { normalise } from "./vpr";

/**
 * Turns the model's output (one row per image token: a class token then the patch tokens) into one picture descriptor: the normalised
 * class token joined with the normalised mean of the patch tokens, normalised again. The class token says what the scene is, the mean of
 * the patches keeps where things are, and together they separate "the corridor by the lift" from "the corridor by the stairs" better
 * than either alone. Used identically by the server (index) and the phone (query).
 */
export function describePicture(tokens: ArrayLike<number>, rows: number, dim: number): number[] {
  const cls = normalise(Array.from({ length: dim }, (_, i) => tokens[i]!));
  const mean = new Array<number>(dim).fill(0);
  const patches = Math.max(1, rows - 1);
  for (let r = 1; r < rows; r++) for (let i = 0; i < dim; i++) mean[i]! += tokens[r * dim + i]! / patches;
  return normalise([...cls, ...normalise(mean)]);
}
