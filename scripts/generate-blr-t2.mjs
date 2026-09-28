// Generates public/maps/blr-kia-t2.json — an illustrative indoor map of
// Kempegowda International Airport (BLR) Terminal 2. Run: node scripts/generate-blr-t2.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const METERS_PER_UNIT = 0.5;
const WALK_SPEED = 1.3; // m/s

const L0 = 'Level 0 - Arrivals';
const L1 = 'Level 1 - Departures';
const L2 = 'Level 2 - Lounges';

const elements = [];
const connections = [];
const byId = new Map();

const pad = n => String(n).padStart(2, '0');

function el(type, id, name, floor, x, y, width, height, attrs = {}) {
  const e = {
    id, type, name, floor, x, y, width, height,
    tags: [], custom_attributes: [], capacity: 0,
    ...attrs,
  };
  if (byId.has(id)) throw new Error(`Duplicate id ${id}`);
  elements.push(e);
  byId.set(id, e);
  return e;
}

function poi(poiType, id, name, floor, cx, cy, attrs = {}) {
  return el('poi', id, name, floor, cx, cy, 24, 24, { poiType, tags: [poiType], ...attrs });
}

const center = e => (e.type === 'poi' ? { x: e.x, y: e.y } : { x: e.x + e.width / 2, y: e.y + e.height / 2 });

function conn(a, b, attrs = {}) {
  const s = byId.get(a), t = byId.get(b);
  if (!s || !t) throw new Error(`Unknown element in connection ${a} -> ${b}`);
  const cs = center(s), ct = center(t);
  const distance = Math.max(1, Math.round(Math.hypot(ct.x - cs.x, ct.y - cs.y) * METERS_PER_UNIT));
  connections.push({
    id: `c-${a}--${b}`,
    source: a, target: b, floor: s.floor,
    type: 'straight', width: 2, capacity: 50,
    distance, travel_time: Math.round(distance / WALK_SPEED),
    directed: false, bidirectional: true,
    wheelchair_accessible: true, allow_vehicles: false,
    pathType: 'corridor', tags: [],
    ...attrs,
  });
}

const oneWay = { directed: true, bidirectional: false };

function vertical(a, b, kind) {
  const isLift = kind === 'elevator';
  conn(a, b, {
    type: 'straight', pathType: kind, distance: 6,
    travel_time: isLift ? 45 : 25,
    wheelchair_accessible: isLift,
    tags: ['vertical', kind],
  });
}

// Vertical circulation cores are stacked at identical x/y on every floor they serve.
const cores = [
  { id: 'EL-1', kind: 'elevator', name: 'Elevator EL-1 (Landside West)', x: 80, y: 120, w: 36, h: 36, floors: [L0, L1], zone: 'landside', flightType: 'common' },
  { id: 'EL-2', kind: 'elevator', name: 'Elevator EL-2 (Landside East)', x: 1684, y: 120, w: 36, h: 36, floors: [L0, L1], zone: 'landside', flightType: 'common' },
  { id: 'ESC-5', kind: 'escalator', name: 'Escalator ESC-5 (Landside West)', x: 130, y: 120, w: 40, h: 60, floors: [L0, L1], zone: 'landside', flightType: 'common', direction: 'reversible' },
  { id: 'ESC-6', kind: 'escalator', name: 'Escalator ESC-6 (Landside East)', x: 1630, y: 120, w: 40, h: 60, floors: [L0, L1], zone: 'landside', flightType: 'common', direction: 'reversible' },
  { id: 'EL-3', kind: 'elevator', name: 'Elevator EL-3 (Domestic Airside)', x: 600, y: 890, w: 36, h: 36, floors: [L0, L1, L2], zone: 'airside', flightType: 'domestic' },
  { id: 'EL-4', kind: 'elevator', name: 'Elevator EL-4 (International Airside)', x: 1200, y: 930, w: 36, h: 36, floors: [L0, L1, L2], zone: 'airside', flightType: 'international' },
  { id: 'ESC-1', kind: 'escalator', name: 'Escalator ESC-1 (Domestic Lounges)', x: 650, y: 880, w: 40, h: 70, floors: [L1, L2], zone: 'airside', flightType: 'domestic', direction: 'up' },
  { id: 'ESC-2', kind: 'escalator', name: 'Escalator ESC-2 (International Lounges)', x: 1250, y: 925, w: 40, h: 70, floors: [L1, L2], zone: 'airside', flightType: 'international', direction: 'up' },
  { id: 'ESC-3', kind: 'escalator', name: 'Escalator ESC-3 (Domestic Bus Gates)', x: 720, y: 880, w: 40, h: 70, floors: [L0, L1], zone: 'airside', flightType: 'domestic', direction: 'down' },
  { id: 'ESC-4', kind: 'escalator', name: 'Escalator ESC-4 (International Bus Gates)', x: 1320, y: 925, w: 40, h: 70, floors: [L0, L1], zone: 'airside', flightType: 'international', direction: 'down' },
];
const floorCode = f => f.slice(0, 7).replace(' ', ''); // "Level0"
const coreId = (core, floor) => `${core.id}-${floorCode(floor)}`;

function placeCores(floor) {
  for (const c of cores.filter(c => c.floors.includes(floor))) {
    el(c.kind, coreId(c, floor), c.name, floor, c.x, c.y, c.w, c.h, {
      label: c.id, liftId: c.id, servesFloors: c.floors, zone: c.zone, flightType: c.flightType,
      accessible: c.kind === 'elevator', direction: c.direction, capacity: c.kind === 'elevator' ? 16 : 0,
      tags: ['vertical-circulation', c.kind],
    });
  }
}

function toiletBlock(prefix, floor, x, y, zone, flightType, kinds = ['male', 'female', 'accessible'], vertical = false) {
  const labels = { male: 'M', female: 'F', accessible: 'Acc', family: 'Fam' };
  return kinds.map((gender, i) => {
    const id = `${prefix}-${gender}`;
    el('toilet', id, `Toilet (${gender})`, floor, vertical ? x : x + i * 55, vertical ? y + i * 50 : y, 50, 40, {
      label: labels[gender], gender, zone, flightType,
      accessible: gender === 'accessible' || gender === 'family',
      babyChanging: gender === 'family' || gender === 'accessible',
      openingHours: '24x7', tags: ['toilet', gender],
    });
    return id;
  });
}

/* ------------------------------------------------------------------ */
/* LEVEL 1 - DEPARTURES                                                */
/* ------------------------------------------------------------------ */
el('hallway', 'L1-forecourt', 'Departure Forecourt (Kerbside Drop-off)', L1, 60, 0, 1680, 60, {
  zone: 'landside', flightType: 'common', accessible: true, openingHours: '24x7', tags: ['kerb', 'drop-off'],
  custom_attributes: [{ key: 'vehicleAccess', value: 'Private cars, taxis, app cabs (drop-off only)' }],
});

const entryGates = [];
for (let i = 0; i < 8; i++) {
  const n = i + 1;
  const flightType = n <= 4 ? 'domestic' : 'international';
  const id = `L1-entry-${n}`;
  el('entry', id, `Departure Entry Gate ${n}`, L1, 165 + 210 * i - 35, 64, 70, 36, {
    label: `Entry ${n}`, gateNumber: String(n), entryType: 'departure-entry', idCheck: true,
    digiYatra: n % 2 === 1, zone: 'landside', flightType, accessible: true, openingHours: '24x7',
    tags: ['entry', flightType],
    custom_attributes: [{ key: 'screening', value: 'CISF ticket & photo-ID check' }],
  });
  entryGates.push(id);
}

el('hallway', 'L1-checkin-hall', 'Check-in Hall', L1, 60, 104, 1680, 396, {
  zone: 'landside', flightType: 'common', accessible: true, openingHours: '24x7', capacity: 3000, tags: ['check-in'],
});

placeCores(L1);

const islands = [
  { letter: 'A', cx: 300, flightType: 'domestic', airlines: ['Air India'] },
  { letter: 'B', cx: 540, flightType: 'domestic', airlines: ['Air India Express'] },
  { letter: 'C', cx: 780, flightType: 'domestic', airlines: ['Air India', 'Star Air'] },
  { letter: 'D', cx: 1020, flightType: 'international', airlines: ['Air India (International)', 'Air India Express (International)'] },
  { letter: 'E', cx: 1260, flightType: 'international', airlines: ['Emirates', 'Qatar Airways', 'Etihad Airways'] },
  { letter: 'F', cx: 1500, flightType: 'international', airlines: ['Singapore Airlines', 'Lufthansa', 'British Airways', 'Air France'] },
];
const COUNTERS_PER_SIDE = 7;
islands.forEach((isl, i) => {
  const first = i * COUNTERS_PER_SIDE * 2 + 1;
  const last = first + COUNTERS_PER_SIDE * 2 - 1;
  el('checkin', `L1-island-${isl.letter}`, `Check-in Island ${isl.letter} (${pad(first)}-${pad(last)})`, L1, isl.cx - 34, 164, 68, 262, {
    label: `Island ${isl.letter}`, role: 'island', island: isl.letter, counterRange: `${pad(first)}-${pad(last)}`,
    airlines: isl.airlines, zone: 'landside', flightType: isl.flightType, accessible: true,
    openingHours: 'Opens 3 h before departure (international), 2 h (domestic)', tags: ['check-in', 'island'],
  });
  for (let side = 0; side < 2; side++) {
    for (let k = 0; k < COUNTERS_PER_SIDE; k++) {
      const num = first + side * COUNTERS_PER_SIDE + k;
      el('checkin', `L1-counter-${pad(num)}`, `Check-in Counter ${pad(num)}`, L1,
        side === 0 ? isl.cx - 30 : isl.cx + 6, 184 + 34 * k, 24, 30, {
          label: pad(num), role: 'counter', island: isl.letter, counterNumber: num,
          airlines: isl.airlines, cabinClass: k < 2 ? 'business' : 'economy', bagDrop: true,
          zone: 'landside', flightType: isl.flightType, accessible: k === 0, tags: ['check-in', 'counter'],
        });
    }
  }
});

el('checkin', 'L1-sbd-dom', 'Self Bag Drop (Domestic)', L1, 120, 440, 150, 40, {
  role: 'self-bag-drop', zone: 'landside', flightType: 'domestic', bagDrop: true, accessible: true, capacity: 8,
  custom_attributes: [{ key: 'kiosks', value: '8' }], tags: ['check-in', 'self-service'],
});
el('checkin', 'L1-sbd-intl', 'Self Bag Drop (International)', L1, 1530, 440, 150, 40, {
  role: 'self-bag-drop', zone: 'landside', flightType: 'international', bagDrop: true, accessible: true, capacity: 8,
  custom_attributes: [{ key: 'kiosks', value: '8' }], tags: ['check-in', 'self-service'],
});
el('checkin', 'L1-ticketing-dom', 'Airline Ticketing Counters (Domestic)', L1, 380, 440, 120, 40, {
  role: 'ticketing', zone: 'landside', flightType: 'domestic', accessible: true, tags: ['ticketing'],
});
el('checkin', 'L1-ticketing-intl', 'Airline Ticketing Counters (International)', L1, 1300, 440, 120, 40, {
  role: 'ticketing', zone: 'landside', flightType: 'international', accessible: true, tags: ['ticketing'],
});
el('eatery', 'L1-landside-cafe', 'Landside Cafe & Bakery', L1, 845, 300, 110, 60, {
  cuisine: 'Coffee, bakery, sandwiches', dietary: ['veg', 'non-veg'], zone: 'landside', flightType: 'common',
  openingHours: '24x7', capacity: 40, accessible: true, tags: ['food', 'coffee'],
});
el('shop', 'L1-landside-convenience', 'Convenience Store', L1, 845, 380, 110, 40, {
  category: 'convenience', zone: 'landside', flightType: 'common', openingHours: '24x7', accessible: true, tags: ['shop'],
});

const l1LandsideToilets = [
  ...toiletBlock('L1-wc-landside-west', L1, 70, 300, 'landside', 'domestic'),
  ...toiletBlock('L1-wc-landside-east', L1, 1570, 300, 'landside', 'international'),
];

poi('info', 'L1-info-central', 'Information Desk', L1, 900, 200, { zone: 'landside', flightType: 'common', openingHours: '24x7' });
poi('info', 'L1-info-west', 'Help Desk (Domestic)', L1, 210, 240, { zone: 'landside', flightType: 'domestic' });
poi('currency', 'L1-forex-landside', 'Currency Exchange', L1, 1600, 240, { zone: 'landside', flightType: 'international' });
poi('atm', 'L1-atm-landside', 'ATM', L1, 1700, 240, { zone: 'landside', flightType: 'common', openingHours: '24x7' });
poi('trolley', 'L1-trolley-west', 'Trolley Bay', L1, 230, 130, { zone: 'landside' });
poi('trolley', 'L1-trolley-east', 'Trolley Bay', L1, 1580, 130, { zone: 'landside' });
poi('drinkingwater', 'L1-water-landside', 'Drinking Water', L1, 900, 470, { zone: 'landside' });

// Security band
el('restricted', 'L1-cisf-control', 'CISF Security Control Room', L1, 60, 505, 55, 150, {
  label: 'CISF', accessLevel: 'cisf', authority: 'CISF', reason: 'Security operations', zone: 'restricted', tags: ['restricted', 'staff-only'],
});
el('security', 'L1-sec-dom', 'Domestic Security Check (Pre-embarkation)', L1, 120, 505, 740, 150, {
  role: 'zone', securityType: 'security', authority: 'CISF', zone: 'landside', flightType: 'domestic',
  openingHours: '24x7', accessible: true, capacity: 400, tags: ['security'],
});
const domLanes = [];
for (let k = 0; k < 8; k++) {
  const n = k + 1;
  const id = `L1-sec-lane-${n}`;
  el('security', id, `Security Lane ${n}`, L1, 140 + 88 * k, 540, 70, 80, {
    label: `Lane ${n}`, role: 'lane', securityType: 'security', laneNumber: n, authority: 'CISF',
    fastTrack: n <= 2, digiYatra: n <= 3, accessible: n === 8, zone: 'landside', flightType: 'domestic',
    capacity: 180, tags: ['security', 'lane'],
    custom_attributes: [{ key: 'screening', value: n <= 3 ? 'CT scanner + body scanner' : 'X-ray + DFMD' }],
  });
  domLanes.push(id);
}

el('security', 'L1-emigration', 'Emigration (Departures)', L1, 940, 505, 760, 70, {
  role: 'zone', securityType: 'emigration', authority: 'Bureau of Immigration', zone: 'landside',
  flightType: 'international', openingHours: '24x7', accessible: true, capacity: 300, tags: ['emigration'],
});
for (let k = 0; k < 12; k++) {
  const n = k + 1;
  el('security', `L1-emig-counter-${pad(n)}`, `Emigration Counter ${pad(n)}`, L1, 960 + 60 * k, 530, 40, 28, {
    label: `E${pad(n)}`, role: 'counter', securityType: 'emigration', counterNumber: n,
    authority: 'Bureau of Immigration', accessible: n === 1, zone: 'landside', flightType: 'international',
    tags: ['emigration', 'counter'],
    custom_attributes: [{ key: 'counterType', value: n >= 11 ? 'e-Gate / FTI-TTP' : 'Manual' }],
  });
}
el('security', 'L1-sec-intl', 'International Security Check', L1, 940, 580, 760, 95, {
  role: 'zone', securityType: 'security', authority: 'CISF', zone: 'landside', flightType: 'international',
  openingHours: '24x7', accessible: true, capacity: 300, tags: ['security'],
});
const intlLanes = [];
for (let k = 0; k < 8; k++) {
  const n = k + 9;
  const id = `L1-sec-lane-${n}`;
  el('security', id, `Security Lane ${n}`, L1, 960 + 88 * k, 605, 70, 60, {
    label: `Lane ${n}`, role: 'lane', securityType: 'security', laneNumber: n, authority: 'CISF',
    fastTrack: n <= 10, digiYatra: false, accessible: n === 16, zone: 'landside', flightType: 'international',
    capacity: 180, tags: ['security', 'lane'],
  });
  intlLanes.push(id);
}
el('restricted', 'L1-airline-ops', 'Airline Operations (Staff Only)', L1, 1705, 505, 35, 170, {
  label: 'Ops', accessLevel: 'airline-crew', reason: 'Airline back-office', zone: 'restricted', tags: ['restricted', 'staff-only'],
});

el('wall', 'L1-wall-dom-intl', 'Domestic / International Separation Wall', L1, 895, 500, 10, 690, {
  label: '', wallThickness: 1, material: 'glass',
});

// Airside - domestic
el('hallway', 'L1-airside-dom', 'Domestic Airside Plaza', L1, 60, 680, 835, 330, {
  zone: 'airside', flightType: 'domestic', accessible: true, openingHours: '24x7', capacity: 2500, tags: ['airside', 'plaza'],
});
const domShops = [
  ['L1-shop-souvenir', 'Karnataka Handicrafts & Souvenirs', 'souvenirs', 80, 120],
  ['L1-shop-books', 'Books & Magazines', 'books', 220, 120],
  ['L1-shop-electronics', 'Electronics & Travel Gadgets', 'electronics', 360, 120],
  ['L1-shop-fashion', 'Fashion & Accessories', 'fashion', 500, 120],
  ['L1-shop-silk', 'Mysore Silk Store', 'retail', 640, 120],
  ['L1-shop-pharmacy', 'Pharmacy', 'pharmacy', 780, 100],
].map(([id, name, category, x, w]) => {
  el('shop', id, name, L1, x, 690, w, 70, {
    category, zone: 'airside', flightType: 'domestic', openingHours: '05:00-01:00', accessible: true, tags: ['shop', category],
  });
  return id;
});
const domEats = [
  ['L1-eat-foodcourt-dom', 'Food Court (Domestic)', 'Multi-cuisine', 80, 220, 200],
  ['L1-eat-southindian', 'South Indian Kitchen', 'Dosa, idli, filter coffee', 320, 120, 60],
  ['L1-eat-coffee-dom', 'Coffee House', 'Coffee & snacks', 460, 100, 30],
  ['L1-eat-bar-dom', 'Bar & Grill', 'Grill, beverages', 580, 120, 50],
].map(([id, name, cuisine, x, w, capacity]) => {
  el('eatery', id, name, L1, x, 780, w, 80, {
    cuisine, dietary: ['veg', 'non-veg'], zone: 'airside', flightType: 'domestic',
    openingHours: '24x7', capacity, accessible: true, tags: ['food'],
  });
  return id;
});
const domAirToilets = toiletBlock('L1-wc-air-dom', L1, 80, 890, 'airside', 'domestic', ['male', 'female', 'accessible', 'family']);
poi('babycare', 'L1-babycare-dom', 'Baby Care Room', L1, 330, 910, { zone: 'airside', flightType: 'domestic' });
poi('charging', 'L1-charging-dom', 'Charging Station', L1, 400, 910, { zone: 'airside', flightType: 'domestic' });
poi('prayer', 'L1-prayer-dom', 'Prayer Room', L1, 450, 910, { zone: 'airside', flightType: 'domestic' });
poi('medical', 'L1-medical-dom', 'Medical Centre', L1, 500, 910, { zone: 'airside', flightType: 'domestic', openingHours: '24x7' });
poi('drinkingwater', 'L1-water-dom', 'Drinking Water', L1, 360, 960, { zone: 'airside' });
poi('info', 'L1-info-dom-air', 'Transfer & Information Desk', L1, 820, 910, { zone: 'airside', flightType: 'domestic' });

// Airside - international
el('hallway', 'L1-airside-intl', 'International Airside Plaza', L1, 905, 680, 835, 330, {
  zone: 'airside', flightType: 'international', accessible: true, openingHours: '24x7', capacity: 2500, tags: ['airside', 'plaza'],
});
const intlShops = [
  ['L1-shop-dutyfree', 'Duty Free (Walk-through)', 'duty-free', 925, 690, 300, 120],
  ['L1-shop-liquor', 'Liquor & Tobacco', 'duty-free', 1245, 690, 120, 55],
  ['L1-shop-luxury', 'Luxury Fashion', 'fashion', 1245, 755, 120, 55],
  ['L1-shop-chocolates', 'Chocolates & Confectionery', 'duty-free', 1385, 690, 110, 55],
  ['L1-shop-spices', 'Tea, Coffee & Spices of India', 'souvenirs', 1385, 755, 110, 55],
  ['L1-shop-jewellery', 'Jewellery & Watches', 'retail', 1515, 690, 110, 55],
  ['L1-shop-travel', 'Travel Essentials', 'convenience', 1515, 755, 110, 55],
].map(([id, name, category, x, y, w, h]) => {
  el('shop', id, name, L1, x, y, w, h, {
    category, zone: 'airside', flightType: 'international', openingHours: '24x7', accessible: true, tags: ['shop', category],
  });
  return id;
});
const intlEats = [
  ['L1-eat-foodhall-intl', 'Food Hall (International)', 'Multi-cuisine', 925, 220, 200],
  ['L1-eat-craftbeer', 'Craft Beer Bar', 'Bengaluru craft beer, bar food', 1165, 120, 60],
  ['L1-eat-patisserie', 'Cafe & Patisserie', 'Coffee, pastries', 1305, 110, 40],
  ['L1-eat-finedining', 'Indian Fine Dining', 'North & South Indian', 1435, 140, 70],
].map(([id, name, cuisine, x, w, capacity]) => {
  el('eatery', id, name, L1, x, 830, w, 80, {
    cuisine, dietary: ['veg', 'non-veg', 'vegan'], zone: 'airside', flightType: 'international',
    openingHours: '24x7', capacity, accessible: true, tags: ['food'],
  });
  return id;
});
const intlAirToilets = toiletBlock('L1-wc-air-intl', L1, 925, 925, 'airside', 'international', ['male', 'female', 'accessible', 'family']);
poi('babycare', 'L1-babycare-intl', 'Baby Care Room', L1, 1165, 960, { zone: 'airside', flightType: 'international' });
poi('charging', 'L1-charging-intl', 'Charging Station', L1, 1450, 950, { zone: 'airside', flightType: 'international' });
poi('prayer', 'L1-prayer-intl', 'Prayer Room', L1, 1500, 950, { zone: 'airside', flightType: 'international' });
poi('medical', 'L1-medical-intl', 'Medical Centre', L1, 1550, 950, { zone: 'airside', flightType: 'international', openingHours: '24x7' });
poi('drinkingwater', 'L1-water-intl', 'Drinking Water', L1, 1600, 950, { zone: 'airside' });
poi('info', 'L1-info-intl-air', 'Transfer & Information Desk', L1, 1660, 950, { zone: 'airside', flightType: 'international' });
poi('currency', 'L1-forex-air', 'Currency Exchange', L1, 1680, 720, { zone: 'airside', flightType: 'international' });
poi('atm', 'L1-atm-air', 'ATM', L1, 1680, 780, { zone: 'airside', flightType: 'international' });

// Gate piers
el('hallway', 'L1-concourse-dom', 'Domestic Gate Concourse (Gates 1-8)', L1, 60, 1010, 835, 50, {
  zone: 'airside', flightType: 'domestic', accessible: true, tags: ['concourse'],
});
el('hallway', 'L1-concourse-intl', 'International Gate Concourse (Gates 9-16)', L1, 905, 1010, 835, 50, {
  zone: 'airside', flightType: 'international', accessible: true, tags: ['concourse'],
});
const domGates = [], intlGates = [];
for (let k = 0; k < 16; k++) {
  const n = k + 1;
  const domestic = n <= 8;
  const id = `L1-gate-${n}`;
  el('gate', id, `Gate ${n}`, L1, domestic ? 70 + 103 * k : 915 + 103 * (k - 8), 1065, 90, 100, {
    label: `Gate ${n}`, gateNumber: String(n), gateType: 'contact', aerobridge: true,
    zone: 'airside', flightType: domestic ? 'domestic' : 'international', accessible: true,
    capacity: domestic ? 180 : 250, tags: ['gate', 'boarding'],
    custom_attributes: [{ key: 'aircraftCode', value: domestic ? 'C (A320/B737)' : n >= 15 ? 'E (B777/A350)' : 'C/E' }],
  });
  (domestic ? domGates : intlGates).push(id);
}
el('restricted', 'L1-apron', 'Apron / Aircraft Stands (Airside Restricted)', L1, 60, 1170, 1680, 60, {
  accessLevel: 'airside-pass', authority: 'BIAL / BCAS', reason: 'Aircraft movement area', zone: 'restricted',
  tags: ['restricted', 'apron'],
});

// Level 1 connections
entryGates.forEach(g => { conn('L1-forecourt', g, oneWay); conn(g, 'L1-checkin-hall', oneWay); });
islands.forEach(i => conn('L1-checkin-hall', `L1-island-${i.letter}`));
['L1-sbd-dom', 'L1-sbd-intl', 'L1-ticketing-dom', 'L1-ticketing-intl', 'L1-landside-cafe', 'L1-landside-convenience',
  ...l1LandsideToilets, coreId(cores[0], L1), coreId(cores[1], L1), coreId(cores[2], L1), coreId(cores[3], L1),
].forEach(id => conn('L1-checkin-hall', id));
conn('L1-checkin-hall', 'L1-sec-dom', oneWay);
domLanes.forEach(l => { conn('L1-sec-dom', l, oneWay); conn(l, 'L1-airside-dom', oneWay); });
conn('L1-checkin-hall', 'L1-emigration', oneWay);
conn('L1-emigration', 'L1-sec-intl', oneWay);
intlLanes.forEach(l => { conn('L1-sec-intl', l, oneWay); conn(l, 'L1-airside-intl', oneWay); });
[...domShops, ...domEats, ...domAirToilets, 'EL-3-Level1', 'ESC-1-Level1', 'ESC-3-Level1', 'L1-concourse-dom']
  .forEach(id => conn('L1-airside-dom', id));
[...intlShops, ...intlEats, ...intlAirToilets, 'EL-4-Level1', 'ESC-2-Level1', 'ESC-4-Level1', 'L1-concourse-intl']
  .forEach(id => conn('L1-airside-intl', id));
domGates.forEach(g => conn('L1-concourse-dom', g));
intlGates.forEach(g => conn('L1-concourse-intl', g));

/* ------------------------------------------------------------------ */
/* LEVEL 0 - ARRIVALS                                                  */
/* ------------------------------------------------------------------ */
el('hallway', 'L0-kerb', 'Arrivals Kerb - Pickup (Taxi, App Cabs, BMTC Vayu Vajra)', L0, 60, 0, 1680, 60, {
  zone: 'landside', flightType: 'common', accessible: true, openingHours: '24x7', tags: ['kerb', 'pickup', 'transport'],
});
const arrivalExits = [];
[200, 480, 760, 1040, 1320, 1600].forEach((cx, i) => {
  const n = i + 1;
  const id = `L0-exit-${n}`;
  el('entry', id, `Arrival Exit ${n}`, L0, cx - 40, 64, 80, 36, {
    label: `Exit ${n}`, gateNumber: String(n), entryType: 'arrival-exit', idCheck: false,
    zone: 'landside', flightType: n <= 3 ? 'domestic' : 'international', accessible: true, tags: ['exit'],
  });
  arrivalExits.push(id);
});
el('hallway', 'L0-greet-hall', 'Arrivals Meet & Greet Hall', L0, 60, 104, 1680, 196, {
  zone: 'landside', flightType: 'common', accessible: true, openingHours: '24x7', capacity: 2000, tags: ['arrivals'],
});
placeCores(L0);
const l0LandsideToilets = [
  ...toiletBlock('L0-wc-greet-west', L0, 190, 120, 'landside', 'domestic'),
  ...toiletBlock('L0-wc-greet-east', L0, 1450, 120, 'landside', 'international'),
];
el('eatery', 'L0-eat-arrivals-cafe', 'Arrivals Cafe', L0, 700, 200, 110, 60, {
  cuisine: 'Coffee & snacks', dietary: ['veg', 'non-veg'], zone: 'landside', flightType: 'common', openingHours: '24x7', capacity: 30, tags: ['food'],
});
el('shop', 'L0-shop-sim', 'Convenience & SIM Cards', L0, 840, 200, 120, 60, {
  category: 'convenience', zone: 'landside', flightType: 'common', openingHours: '24x7', tags: ['shop'],
});
el('eatery', 'L0-eat-quickbites', 'Quick Bites', L0, 990, 200, 110, 60, {
  cuisine: 'Fast food', dietary: ['veg', 'non-veg'], zone: 'landside', flightType: 'common', openingHours: '24x7', capacity: 30, tags: ['food'],
});
poi('taxi', 'L0-taxi-dom', 'Prepaid Taxi / App Cab Desk', L0, 260, 250, { zone: 'landside' });
poi('taxi', 'L0-taxi-intl', 'Prepaid Taxi / Car Rental Desk', L0, 1480, 250, { zone: 'landside' });
poi('atm', 'L0-atm', 'ATM', L0, 600, 250, { zone: 'landside', openingHours: '24x7' });
poi('currency', 'L0-forex', 'Currency Exchange', L0, 1200, 250, { zone: 'landside', flightType: 'international' });
poi('info', 'L0-info', 'Information Desk', L0, 900, 150, { zone: 'landside', openingHours: '24x7' });
poi('info', 'L0-lostfound', 'Lost & Found', L0, 1100, 150, { zone: 'landside' });

el('security', 'L0-customs-green', 'Customs - Green Channel (Nothing to Declare)', L0, 960, 310, 300, 30, {
  label: 'Customs Green Channel', role: 'zone', securityType: 'customs', authority: 'Indian Customs',
  zone: 'airside', flightType: 'international', tags: ['customs'],
});
el('security', 'L0-customs-red', 'Customs - Red Channel (Goods to Declare)', L0, 1300, 310, 200, 30, {
  label: 'Customs Red Channel', role: 'zone', securityType: 'customs', authority: 'Indian Customs',
  zone: 'airside', flightType: 'international', tags: ['customs'],
});
el('restricted', 'L0-customs-office', 'Customs Office', L0, 1520, 310, 180, 30, {
  accessLevel: 'customs', authority: 'Indian Customs', zone: 'restricted', tags: ['restricted'],
});

el('baggage', 'L0-reclaim-dom', 'Baggage Reclaim - Domestic', L0, 60, 350, 835, 280, {
  zone: 'airside', flightType: 'domestic', accessible: true, capacity: 1200, tags: ['baggage-reclaim'],
});
el('baggage', 'L0-reclaim-intl', 'Baggage Reclaim - International', L0, 905, 350, 835, 280, {
  zone: 'airside', flightType: 'international', accessible: true, capacity: 1200, tags: ['baggage-reclaim'],
});
const belts = [];
for (let k = 0; k < 8; k++) {
  const n = k + 1;
  const domestic = n <= 4;
  const id = `L0-belt-${n}`;
  el('baggage', id, `Baggage Belt ${n}`, L0, domestic ? 150 + 180 * k : 995 + 180 * (k - 4), 390, 60, 200, {
    label: `Belt ${n}`, beltNumber: n, zone: 'airside', flightType: domestic ? 'domestic' : 'international',
    accessible: true, tags: ['baggage-belt'],
  });
  belts.push(id);
}
const reclaimToiletsDom = toiletBlock('L0-wc-reclaim-dom', L0, 780, 380, 'airside', 'domestic', ['male', 'female', 'accessible'], true);
const reclaimToiletsIntl = toiletBlock('L0-wc-reclaim-intl', L0, 1625, 380, 'airside', 'international', ['male', 'female', 'accessible'], true);
el('shop', 'L0-shop-arrival-dutyfree', 'Arrival Duty Free', L0, 1680, 380, 55, 190, {
  label: 'Arrival Duty Free', category: 'duty-free', zone: 'airside', flightType: 'international', openingHours: '24x7', tags: ['shop', 'duty-free'],
});
poi('trolley', 'L0-trolley-dom', 'Trolley Bay', L0, 100, 610, { zone: 'airside' });
poi('trolley', 'L0-trolley-intl', 'Trolley Bay', L0, 940, 610, { zone: 'airside' });

el('hallway', 'L0-arrival-corridor-dom', 'Domestic Arrival Corridor', L0, 60, 640, 835, 60, {
  zone: 'airside', flightType: 'domestic', accessible: true, tags: ['arrivals', 'corridor'],
});
el('security', 'L0-immigration', 'Immigration (Arrivals)', L0, 905, 640, 835, 65, {
  role: 'zone', securityType: 'immigration', authority: 'Bureau of Immigration', zone: 'airside',
  flightType: 'international', openingHours: '24x7', accessible: true, capacity: 400, tags: ['immigration'],
});
for (let k = 0; k < 12; k++) {
  const n = k + 1;
  el('security', `L0-imm-counter-${pad(n)}`, `Immigration Counter ${pad(n)}`, L0, 960 + 60 * k, 662, 40, 30, {
    label: `I${pad(n)}`, role: 'counter', securityType: 'immigration', counterNumber: n,
    authority: 'Bureau of Immigration', zone: 'airside', flightType: 'international', accessible: n === 1,
    tags: ['immigration', 'counter'],
    custom_attributes: [{ key: 'counterType', value: n <= 2 ? 'Diplomats / Crew' : n >= 11 ? 'e-Gate / FTI-TTP' : 'All passports' }],
  });
}
el('hallway', 'L0-arrival-corridor-intl', 'International Arrival Corridor', L0, 905, 710, 835, 50, {
  zone: 'airside', flightType: 'international', accessible: true, tags: ['arrivals', 'corridor'],
});
el('restricted', 'L0-bhs', 'Baggage Handling System / Make-up Area', L0, 60, 710, 835, 110, {
  accessLevel: 'staff-only', authority: 'BIAL', reason: 'Outbound baggage sorting & screening', zone: 'restricted',
  tags: ['restricted', 'baggage-handling'],
});
el('restricted', 'L0-customs-screening', 'Customs Examination & Baggage Screening', L0, 905, 770, 835, 50, {
  accessLevel: 'customs', authority: 'Indian Customs', zone: 'restricted', tags: ['restricted'],
});
el('hallway', 'L0-bus-lounge-dom', 'Remote Bus Boarding Lounge (Domestic)', L0, 60, 830, 835, 180, {
  zone: 'airside', flightType: 'domestic', accessible: true, capacity: 600, tags: ['bus-gates'],
});
el('hallway', 'L0-bus-lounge-intl', 'Remote Bus Boarding Lounge (International)', L0, 905, 830, 835, 180, {
  zone: 'airside', flightType: 'international', accessible: true, capacity: 600, tags: ['bus-gates'],
});
const busGates = [];
[[17, 90], [18, 210], [19, 330], [20, 450], [21, 950], [22, 1420], [23, 1530], [24, 1640]].forEach(([n, x]) => {
  const domestic = n <= 20;
  const id = `L0-gate-${n}`;
  el('gate', id, `Gate ${n} (Bus)`, L0, x, 940, 90, 60, {
    label: `Gate ${n}`, gateNumber: String(n), gateType: 'bus', aerobridge: false,
    zone: 'airside', flightType: domestic ? 'domestic' : 'international', accessible: true, capacity: 150,
    tags: ['gate', 'bus-boarding'],
  });
  busGates.push(id);
});
el('restricted', 'L0-apron', 'Apron - Bus Stands (Airside Restricted)', L0, 60, 1020, 1680, 60, {
  accessLevel: 'airside-pass', authority: 'BIAL / BCAS', reason: 'Airside vehicle area', zone: 'restricted', tags: ['restricted', 'apron'],
});

// Level 0 connections
arrivalExits.forEach(x => { conn('L0-greet-hall', x, oneWay); conn(x, 'L0-kerb', oneWay); });
[...l0LandsideToilets, 'L0-eat-arrivals-cafe', 'L0-shop-sim', 'L0-eat-quickbites',
  'EL-1-Level0', 'EL-2-Level0', 'ESC-5-Level0', 'ESC-6-Level0'].forEach(id => conn('L0-greet-hall', id));
conn('L0-arrival-corridor-dom', 'L0-reclaim-dom', oneWay);
conn('L0-reclaim-dom', 'L0-greet-hall', oneWay);
belts.slice(0, 4).forEach(b => conn('L0-reclaim-dom', b));
reclaimToiletsDom.forEach(t => conn('L0-reclaim-dom', t));
conn('L0-arrival-corridor-intl', 'L0-immigration', oneWay);
conn('L0-immigration', 'L0-reclaim-intl', oneWay);
belts.slice(4).forEach(b => conn('L0-reclaim-intl', b));
[...reclaimToiletsIntl, 'L0-shop-arrival-dutyfree'].forEach(t => conn('L0-reclaim-intl', t));
conn('L0-reclaim-intl', 'L0-customs-green', oneWay);
conn('L0-reclaim-intl', 'L0-customs-red', oneWay);
conn('L0-customs-green', 'L0-greet-hall', oneWay);
conn('L0-customs-red', 'L0-greet-hall', oneWay);
['EL-3-Level0', 'ESC-3-Level0', ...busGates.slice(0, 4)].forEach(id => conn('L0-bus-lounge-dom', id));
['EL-4-Level0', 'ESC-4-Level0', ...busGates.slice(4)].forEach(id => conn('L0-bus-lounge-intl', id));

/* ------------------------------------------------------------------ */
/* LEVEL 2 - LOUNGES (mezzanine above airside)                          */
/* ------------------------------------------------------------------ */
el('hallway', 'L2-mezz-dom', 'Domestic Mezzanine', L2, 100, 850, 760, 110, {
  zone: 'airside', flightType: 'domestic', accessible: true, tags: ['mezzanine'],
});
el('hallway', 'L2-mezz-intl', 'International Mezzanine', L2, 945, 910, 760, 90, {
  zone: 'airside', flightType: 'international', accessible: true, tags: ['mezzanine'],
});
placeCores(L2);
el('lounge', 'L2-lounge-080-dom', '080 Domestic Lounge', L2, 100, 700, 360, 140, {
  operator: 'BLR Airport (080 Lounges)', accessRules: 'Business class, eligible cards, paid entry',
  amenities: ['buffet', 'bar', 'wifi', 'showers', 'flight info'], zone: 'airside', flightType: 'domestic',
  openingHours: '24x7', capacity: 250, accessible: true, tags: ['lounge'],
});
el('lounge', 'L2-lounge-airline-dom', 'Airline Business Lounge (Domestic)', L2, 480, 700, 250, 140, {
  operator: 'Airline', accessRules: 'Business class / frequent flyer elite', amenities: ['buffet', 'wifi', 'work pods'],
  zone: 'airside', flightType: 'domestic', openingHours: '04:00-00:00', capacity: 120, accessible: true, tags: ['lounge'],
});
el('eatery', 'L2-eat-mezz-bar', 'Mezzanine Bar & Cafe', L2, 120, 870, 150, 70, {
  cuisine: 'Cafe, cocktails', dietary: ['veg', 'non-veg'], zone: 'airside', flightType: 'domestic',
  openingHours: '06:00-01:00', capacity: 60, accessible: true, tags: ['food', 'bar'],
});
const l2DomToilets = toiletBlock('L2-wc-dom', L2, 760, 700, 'airside', 'domestic', ['male', 'female'], true);
el('restricted', 'L2-boh-dom', 'Lounge Back-of-House (Staff Only)', L2, 760, 800, 100, 40, {
  label: 'BOH', accessLevel: 'staff-only', reason: 'Lounge kitchen & stores', zone: 'restricted', tags: ['restricted'],
});
el('lounge', 'L2-lounge-080-intl', '080 International Lounge', L2, 945, 700, 380, 190, {
  operator: 'BLR Airport (080 Lounges)', accessRules: 'Business/First class, eligible cards, paid entry',
  amenities: ['buffet', 'bar', 'wifi', 'showers', 'spa', 'quiet zone'], zone: 'airside', flightType: 'international',
  openingHours: '24x7', capacity: 300, accessible: true, tags: ['lounge'],
});
el('lounge', 'L2-lounge-premium-intl', 'Premium / First Class Lounge', L2, 1345, 700, 250, 190, {
  operator: 'Airline alliance', accessRules: 'First class / top-tier elite', amenities: ['a la carte dining', 'bar', 'showers', 'wifi'],
  zone: 'airside', flightType: 'international', openingHours: '24x7', capacity: 80, accessible: true, tags: ['lounge'],
});
const l2IntlToilets = toiletBlock('L2-wc-intl', L2, 1615, 700, 'airside', 'international', ['male', 'female'], true);
el('lounge', 'L2-sleep-pods', 'Sleeping Pods & Spa', L2, 1615, 800, 100, 90, {
  operator: 'Third party', accessRules: 'Paid, hourly', amenities: ['sleep pods', 'massage', 'showers'],
  zone: 'airside', flightType: 'international', openingHours: '24x7', capacity: 20, tags: ['lounge', 'rest'],
});

['L2-lounge-080-dom', 'L2-lounge-airline-dom', 'L2-eat-mezz-bar', ...l2DomToilets, 'EL-3-Level2', 'ESC-1-Level2']
  .forEach(id => conn('L2-mezz-dom', id));
['L2-lounge-080-intl', 'L2-lounge-premium-intl', 'L2-sleep-pods', ...l2IntlToilets, 'EL-4-Level2', 'ESC-2-Level2']
  .forEach(id => conn('L2-mezz-intl', id));

/* ------------------------------------------------------------------ */
/* VERTICAL (cross-floor) CONNECTIONS                                  */
/* ------------------------------------------------------------------ */
for (const c of cores) {
  for (let i = 0; i < c.floors.length - 1; i++) {
    vertical(coreId(c, c.floors[i]), coreId(c, c.floors[i + 1]), c.kind);
  }
}
// Arriving passengers leave the aerobridges via ramps down to the Level 0 arrival corridors
conn('L1-concourse-dom', 'L0-arrival-corridor-dom', { ...oneWay, pathType: 'ramp', distance: 40, travel_time: 35, tags: ['vertical', 'ramp', 'arrivals'] });
conn('L1-concourse-intl', 'L0-arrival-corridor-intl', { ...oneWay, pathType: 'ramp', distance: 40, travel_time: 35, tags: ['vertical', 'ramp', 'arrivals'] });

// Stable layering: halls at the bottom, then areas, then lifts/escalators, then POIs on top
const layer = e => (e.type === 'hallway' ? 0 : e.type === 'poi' ? 3 : e.tags.includes('vertical-circulation') ? 2 : 1);
elements.sort((a, b) => layer(a) - layer(b));

const output = {
  floors: [L0, L1, L2],
  currentFloor: L1,
  trueNorth: 0,
  elements,
  connections,
  metadata: {
    name: 'Kempegowda International Airport Bengaluru - Terminal 2',
    iata: 'BLR',
    icao: 'VOBL',
    terminal: 'T2',
    approximateLocation: { latitude: 13.1989, longitude: 77.7068 },
    scale: { metersPerUnit: METERS_PER_UNIT },
    disclaimer: 'Illustrative schematic for wayfinding demos. Counter, lane, gate and belt numbers, airline allocations and outlet names are approximate and not an official BIAL layout.',
    createdAt: new Date().toISOString(),
    customPois: [],
  },
};

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '../public/maps/blr-kia-t2.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`Wrote ${elements.length} elements and ${connections.length} connections to ${outPath}`);
