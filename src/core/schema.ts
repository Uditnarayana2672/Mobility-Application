import { z } from "zod";
import { CAT_IDS, OBJECT_KIND_IDS, POI_KIND_IDS } from "./cats";

/**
 * Venue package, schema v2. Units are metres; frame is x east, y south, bearing 0 = north (clockwise).
 * Modelled on the mock's data.js default venue.
 */
export const SCHEMA_VERSION = 2 as const;

const finite = z.number().finite();
const bearing = z.number().finite().min(0).lt(360);

export const SideSchema = z.enum(["N", "S", "E", "W"]);
export type Side = z.infer<typeof SideSchema>;

/** A door on a room's wall. `side` is set for rectangle walls; `normal` (bearing pointing out of the room) for any wall, e.g. slanted ones. */
export const DoorSchema = z.object({ x: finite, y: finite, side: SideSchema.optional(), normal: bearing.optional() });
export type Door = z.infer<typeof DoorSchema>;

export const BackgroundSchema = z.object({
  imageUrl: z.string().min(1),
  widthPx: z.number().positive(),
  heightPx: z.number().positive(),
  opacity: z.number().min(0).max(1).default(0.55),
  /** Image top-left corner in metres, metres per image pixel, clockwise rotation about the top-left corner. */
  transform: z
    .object({ x: finite.default(0), y: finite.default(0), scale: z.number().positive().default(0.05), rotationDeg: finite.default(0) })
    .default({}),
  /** True once the user drew a line of known length over the photo. */
  calibrated: z.boolean().default(false),
  reference: z.string().optional(),
});
export type Background = z.infer<typeof BackgroundSchema>;

export const FloorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  short: z.string().default(""),
  /** Metres above the venue datum. */
  elevation: finite,
  /** Floor-to-ceiling height in metres. */
  height: z.number().positive().default(3),
  /** Drawing plate size in metres. */
  w: z.number().positive(),
  h: z.number().positive(),
  background: BackgroundSchema.optional(),
});
export type Floor = z.infer<typeof FloorSchema>;

export const CorridorSchema = z.object({ floor: z.string(), x: finite, y: finite, w: z.number().positive(), h: z.number().positive() });
export type Corridor = z.infer<typeof CorridorSchema>;

export const RoomSchema = z.object({
  id: z.string().min(1),
  floor: z.string(),
  name: z.string(),
  cat: z.enum(CAT_IDS),
  x: finite,
  y: finite,
  w: z.number().positive(),
  h: z.number().positive(),
  /** The main door. More doors go in `extraDoors`. */
  door: DoorSchema,
  extraDoors: z.array(DoorSchema).default([]),
  /** People may walk through this room between its doors (a passage). Default: no, so a second door does not create a shortcut. */
  passThrough: z.boolean().optional(),
  aliases: z.array(z.string()).default([]),
  /** What this place is good for, as need ids (coffee, food, water, washroom, rest, meeting, …): "I want a coffee" finds a room tagged `coffee`. */
  tags: z.array(z.string()).optional(),
  hours: z.string().default(""),
  access: z.enum(["public", "staff"]).default("public"),
  short: z.string().nullish(),
  icon: z.string().optional(),
  kind: z.enum(["lift", "stairs"]).optional(),
  capacity: z.number().optional(),
  /** Reserved: optional polygon outline (not edited or rendered yet; rectangles stay the default). */
  polygon: z.array(z.tuple([finite, finite])).min(3).optional(),
});
export type Room = z.infer<typeof RoomSchema>;

export const NodeSchema = z.object({
  id: z.string().min(1),
  floor: z.string(),
  x: finite,
  y: finite,
  kind: z.enum(["corridor", "door", "room"]),
  room: z.string().optional(),
});
export type VNode = z.infer<typeof NodeSchema>;

export const EdgeSchema = z
  .object({
    a: z.string(),
    b: z.string(),
    type: z.enum(["walk", "stairs", "lift"]),
    len: z.number().positive().optional(),
    /** Corridor width in metres (walk edges between corridor nodes): drawn on the map and used by step counting. */
    width: z.number().positive().optional(),
    upSec: z.number().positive().optional(),
    downSec: z.number().positive().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.type !== "walk" && (e.upSec === undefined || e.downSec === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "vertical edges need upSec and downSec" });
    }
  });
export type Edge = z.infer<typeof EdgeSchema>;

export const MarkerSchema = z.object({
  /** ArUco id (printed code), unique within the venue. */
  id: z.number().int().nonnegative(),
  floor: z.string(),
  name: z.string(),
  x: finite,
  y: finite,
  /** Install height of the marker centre in metres. */
  z: finite.default(1.4),
  /** Bearing the sticker faces (into the corridor). */
  normal: bearing,
  /** Side length of the printed black square in metres. */
  sizeM: z.number().positive().default(0.12),
  note: z.string().default(""),
});
export type Marker = z.infer<typeof MarkerSchema>;

export const WallSchema = z.object({
  id: z.string().min(1),
  floor: z.string(),
  label: z.string(),
  x1: finite,
  y1: finite,
  x2: finite,
  y2: finite,
  /** Height of the bottom edge above the floor, metres. */
  bottom: finite.default(1),
  height: z.number().positive().default(1.6),
  normal: bearing,
  approved: z.boolean().default(false),
});
export type Wall = z.infer<typeof WallSchema>;

export const PoiSchema = z.object({ id: z.string().min(1), floor: z.string(), kind: z.enum(POI_KIND_IDS), name: z.string(), x: finite, y: finite });
export type Poi = z.infer<typeof PoiSchema>;

/** A piece of furniture or a fixture (bed, table, toilet...). Centre x,y, footprint w x h metres, rotation in degrees clockwise. Map-only. */
export const ObjectSchema = z.object({
  id: z.string().min(1),
  floor: z.string(),
  kind: z.enum(OBJECT_KIND_IDS),
  x: finite,
  y: finite,
  w: z.number().positive(),
  h: z.number().positive(),
  rotation: finite.default(0),
  label: z.string().default(""),
});
export type MapObject = z.infer<typeof ObjectSchema>;

export const ScaleSchema = z.object({
  /** Always 1 in v2: coordinates are metres. Kept for mock compatibility. */
  metersPerUnit: z.number().positive().default(1),
  calibrated: z.boolean(),
  reference: z.string().optional(),
});

const latlng = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

/** Where the venue is on Earth: how the app knows, from the phone's GPS, which building it is in. Optional. */
export const GeoSchema = z.object({
  /** A point inside the building. */
  anchor: latlng,
  /** Fence radius around the anchor when there is no footprint (metres). */
  radiusM: z.number().positive().default(60),
  /** Corners of the building outline (from a map), in order. */
  footprint: z.array(latlng).min(3).optional(),
  /** Doors into the building from outside. `marker` = the marker id stuck near it, which gives an exact first position. */
  entrances: z.array(z.object({ name: z.string(), latlng, marker: z.number().int().nonnegative().optional() })).default([]),
});
export type Geo = z.infer<typeof GeoSchema>;

export const VenueSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i),
  name: z.string().min(1),
  type: z.string().default(""),
  city: z.string().default(""),
  address: z.string().default(""),
  latlng: z.tuple([finite, finite]).optional(),
  /** True compass bearing of the map's up direction (map bearing 0), degrees. true bearing = map bearing + northOffsetDeg. */
  northOffsetDeg: z.number().optional(),
  geo: GeoSchema.optional(),
  version: z.number().int().positive(),
  status: z.enum(["draft", "published"]),
  publishedAt: z.string().optional(),
  scale: ScaleSchema,
  floors: z.array(FloorSchema).min(1),
  corridors: z.array(CorridorSchema).default([]),
  rooms: z.array(RoomSchema).default([]),
  nodes: z.array(NodeSchema).default([]),
  edges: z.array(EdgeSchema).default([]),
  markers: z.array(MarkerSchema).default([]),
  walls: z.array(WallSchema).default([]),
  pois: z.array(PoiSchema).default([]),
  /** Furniture and fixtures (map-only). */
  objects: z.array(ObjectSchema).default([]),
});
export type Venue = z.infer<typeof VenueSchema>;

export const CampaignSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  brand: z.string(),
  type: z.enum(["image", "video"]),
  theme: z.tuple([z.string(), z.string()]),
  headline: z.string(),
  offer: z.string().default(""),
  cta: z.string().default(""),
  /** Room id the ad routes to, or null. */
  target: z.string().nullable().default(null),
  walls: z.array(z.string()).default([]),
  status: z.enum(["active", "paused", "ended"]),
  start: z.string(),
  end: z.string(),
  hours: z.string().default(""),
  budget: z.number().default(0),
  mediaUrl: z.string().optional(),
  stats: z.object({ impressions: z.number(), taps: z.number(), dwell: z.number() }).default({ impressions: 0, taps: 0, dwell: 0 }),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const CampaignsFileSchema = z.object({
  venueId: z.string(),
  version: z.number().int().positive(),
  publishedAt: z.string().optional(),
  campaigns: z.array(CampaignSchema),
});
export type CampaignsFile = z.infer<typeof CampaignsFileSchema>;

export interface ValidationResult {
  level: "pass" | "warn" | "fail";
  title: string;
  detail: string;
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; issues: { path: string; message: string }[] };

function wrap<T>(r: z.SafeParseReturnType<unknown, T>): ParseResult<T> {
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

export const parseVenue = (input: unknown): ParseResult<Venue> => wrap(VenueSchema.safeParse(input));
export const parseCampaigns = (input: unknown): ParseResult<CampaignsFile> => wrap(CampaignsFileSchema.safeParse(input));
