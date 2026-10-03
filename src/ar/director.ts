import type { ArSceneModel } from "./sceneModel";

/**
 * The AR director decides WHAT is allowed on screen right now. Where an arrow goes is geometry (route + pose, in sceneModel.ts); whether
 * it may be drawn depends on how sure the app is of where the visitor is and where the camera points. Plain rules, no model:
 *
 *   tracking lost                     -> nothing in the world, one hint
 *   camera above the horizon          -> no floor cues (they would float in the ceiling), a hint to aim lower
 *   position rougher than 2.5 m       -> only the big compass arrow (world-fixed cues would land in the wrong place)
 *   position 1.5 – 2.5 m              -> a few near floor cues, the next turn when close, no ads
 *   position better than 1.5 m        -> full set, but ads step aside while a turn is close (one thing to look at)
 */
export interface DirectorInput {
  /** Accuracy radius of the position, metres. */
  acc: number;
  stale: boolean;
  /** How far below the horizon the camera looks (deg); undefined when unknown. */
  pitchDownDeg?: number;
}

export interface Directed {
  model: ArSceneModel;
  /** Draw only the screen-space compass arrow, no world-anchored cue. */
  compassOnly: boolean;
  /** One short sentence for the visitor, or null. */
  hint: string | null;
}

export const LIMITS = {
  roughAcc: 2.5,
  fairAcc: 1.5,
  maxChevronsRough: 4,
  maxChevronsGood: 8,
  turnRangeFair: 10,
  adQuietTurnM: 6,
  lookUpPitch: -15,
};

const EMPTY = (m: ArSceneModel): ArSceneModel => ({ ...m, chevrons: [], turnArrows: [], destinationPin: null, floorChangeArrow: null, adQuads: [] });

export function direct(model: ArSceneModel, input: DirectorInput): Directed {
  if (input.stale) return { model: EMPTY(model), compassOnly: true, hint: "Tracking lost: scan a marker to fix your position." };
  if (input.acc > LIMITS.roughAcc) {
    return { model: EMPTY(model), compassOnly: true, hint: `Position is rough (about ${input.acc.toFixed(0)} m): follow the arrow, and scan a marker to sharpen it.` };
  }
  const lookingUp = input.pitchDownDeg !== undefined && input.pitchDownDeg < LIMITS.lookUpPitch;
  if (lookingUp) return { model: { ...EMPTY(model), destinationPin: model.destinationPin, floorChangeArrow: model.floorChangeArrow }, compassOnly: false, hint: "Aim the phone a little lower, towards the floor ahead." };

  const fair = input.acc > LIMITS.fairAcc;
  const chevrons = model.chevrons.slice(0, fair ? LIMITS.maxChevronsRough : LIMITS.maxChevronsGood);
  const turnArrows = fair ? model.turnArrows.filter((t) => t.distanceM <= LIMITS.turnRangeFair) : model.turnArrows;
  const turnClose = turnArrows.some((t) => t.distanceM <= LIMITS.adQuietTurnM);
  const adQuads = fair || turnClose ? [] : model.adQuads.slice(0, 1);
  return {
    model: { ...model, chevrons, turnArrows, adQuads, destinationPin: fair ? null : model.destinationPin },
    compassOnly: false,
    hint: fair ? `Position about ${input.acc.toFixed(1)} m: scan a marker for sharper arrows.` : null,
  };
}
