import { Vector3 } from 'three/webgpu';

// ---------------------------------------------------------------------------
// Hall registry. One entry per auditorium; the whole page (room, seats, map,
// prices, metrics) is derived from the active entry. Add a hall here and it
// becomes selectable — no other file needs to know its shape.
//
// Seat data convention (from the Maoyan seat map of the real hall):
//   - Row 1 is nearest the screen; seat numbers start at the audience's RIGHT
//     (facing the screen) and increase towards the left.
//   - Each row is a list of segments, right to left: { seats: n } or
//     { aisle: n } where an aisle's width is counted in seat slots.
//   - A "gap" is an unnumbered empty slot inside a row (aisle: 1).
// All dimensions in metres. x to the right (audience's right when seated),
// y up, z from the screen towards the back.
// ---------------------------------------------------------------------------

export const HALLS = [
  {
    id: 'bozhou-wanda-imax',
    city: '亳州',
    cinema: '万达影城（南万达广场IMAX店）',
    hallName: '1号IMAX巨幕厅',
    // The lit 1.90:1 picture. The fabric is 23.4 x 13.5 m (single-source
    // reference value) with its bottom edge 1.0 m above the first-row floor;
    // the 12.3 m picture sits centred on it, so its bottom is at 1.6 m.
    screen: { width: 23.4, height: 23.4 / 1.9, bottom: 1.6, radius: 32 },
    screenFabric: '23.4 × 13.5 米',
    price: 45,
    rowFront: 9.0, // first row's front edge to the screen (derived estimate)
    rowDepth: 1.35,
    rowRise: 0.32,
    rowBase: 0.15,
    gapBefore: { 3: 0.9 }, // a wider cross walkway between rows 3 and 4
    arcCenterZ: -14,
    seatPitch: 0.58,
    eyeSeated: 1.16,
    room: { halfWidth: 13.5, ceiling: 16, backPad: 2.6 },
    rows: [
      { segments: [{ seats: 23 }] },
      { segments: [{ seats: 27 }] },
      { segments: [{ seats: 31 }] },
      // Row 4: 29 numbered seats, one unnumbered empty slot after No.5.
      { segments: [{ seats: 5 }, { aisle: 1 }, { seats: 24 }] },
      { segments: [{ seats: 29 }] },
      { segments: [{ seats: 29 }] },
      { segments: [{ seats: 29 }] },
      { segments: [{ seats: 29 }] },
      { segments: [{ seats: 29 }] },
      // Rows 10-12: right section 3, aisle 3 slots, main block 29, aisle 2, left section 3.
      { segments: [{ seats: 3 }, { aisle: 3 }, { seats: 29 }, { aisle: 2 }, { seats: 3 }] },
      { segments: [{ seats: 3 }, { aisle: 3 }, { seats: 29 }, { aisle: 2 }, { seats: 3 }] },
      { segments: [{ seats: 3 }, { aisle: 3 }, { seats: 29 }, { aisle: 2 }, { seats: 3 }] },
      { segments: [{ seats: 40 }] },
    ],
  },
];

const requested = new URLSearchParams(location.search).get('hall');
export const HALL = HALLS.find((h) => h.id === requested) ?? HALLS[0];

// ---------------------------------------------------------------------------
// Derived geometry (same exported shapes the rest of the app was built on).
// ---------------------------------------------------------------------------

export const SCREEN = HALL.screen;
export const SCREEN_CENTER = new Vector3(0, SCREEN.bottom + SCREEN.height / 2, 0);

// A point on the screen from its uv (0..1 from the bottom left), with the normal towards the audience.
export function screenPoint(u, v) {
  const angle = (u - 0.5) * SCREEN.width / SCREEN.radius;
  return {
    position: new Vector3(
      SCREEN.radius * Math.sin(angle),
      SCREEN.bottom + v * SCREEN.height,
      SCREEN.radius - SCREEN.radius * Math.cos(angle)
    ),
    normal: new Vector3(-Math.sin(angle), 0, Math.cos(angle)),
  };
}

export const ROWS = HALL.rows.length;
export const ROW_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, ROWS);
export const ROW_FRONT = HALL.rowFront;
export const ROW_DEPTH = HALL.rowDepth;
export const ROW_RISE = HALL.rowRise;
export const ROW_BASE = HALL.rowBase;
export const ARC_CENTER_Z = HALL.arcCenterZ;
export const SEAT_PITCH = HALL.seatPitch;
export const AISLE_WIDTH = 1.2; // step-light inset in room.js

export const LANE = 0.32;
export const HINGE = 0.75;

export const EYE_SEATED = HALL.eyeSeated;
export const EYE_STANDING = 1.62;

// Cumulative row fronts: rowFront(r) is the z of row r's front edge.
const FRONTS = [ROW_FRONT];
for (let r = 1; r <= ROWS; r++) FRONTS.push(FRONTS[r - 1] + ROW_DEPTH + (HALL.gapBefore?.[r] ?? 0));
export const rowFront = (row) => FRONTS[Math.min(row, ROWS)];
export const rowFloor = (row) => ROW_BASE + row * ROW_RISE;

// Which row a given z falls in (for the camera's obstacle check).
export function rowIndexAtZ(z) {
  let row = 0;
  while (row < ROWS && FRONTS[row + 1] <= z) row++;
  return row;
}

export const ROOM = {
  halfWidth: HALL.room.halfWidth,
  ceiling: HALL.room.ceiling,
  back: rowFront(ROWS) + HALL.room.backPad,
};

export const STAGE = { halfWidth: 12.5, depth: 2.6, height: 0.55 };

// The back cross-aisle is "row ROWS" for walking purposes.
export const PLATFORM = ROWS;

export const arcRadius = (row, offset = 0) => rowFront(row) + offset - ARC_CENTER_Z;

// A point on a row's arc, from its arc length s (0 = the centre line, + = audience's right).
export function arcPoint(radius, s, y = 0) {
  const angle = s / radius;
  return new Vector3(radius * Math.sin(angle), y, ARC_CENTER_Z + radius * Math.cos(angle));
}

// ---------------------------------------------------------------------------
// Seats, built row by row from the segment lists. Numbers run right to left.
// ---------------------------------------------------------------------------

export const SEATS = [];
export const ROW_COUNTS = [];
export const ROW_OFFSETS = [];
export const ARMS = []; // armrest placements: { position, angle }
export const AISLE_STEPS = []; // real walk aisles (>= 2 slots): { row, s }
let carpetAisleS = 0;

HALL.rows.forEach((rowDef, row) => {
  ROW_OFFSETS.push(SEATS.length);
  const slots = rowDef.segments.reduce((sum, seg) => sum + (seg.seats ?? seg.aisle), 0);
  let cursor = (slots * SEAT_PITCH) / 2; // right edge of the row
  let number = 0;
  const radius = arcRadius(row, HINGE);
  for (const seg of rowDef.segments) {
    if (seg.seats) {
      // One armrest at every seat edge, shared between neighbouring seats.
      for (let k = 0; k <= seg.seats; k++) {
        const edge = cursor - SEAT_PITCH * k;
        ARMS.push({ position: arcPoint(radius, edge, rowFloor(row)), angle: edge / radius });
      }
      for (let k = 0; k < seg.seats; k++) {
        const s = cursor - SEAT_PITCH * (k + 0.5);
        number++;
        SEATS.push({
          index: SEATS.length,
          row,
          number,
          label: `${row + 1}排${number}座`,
          s,
          angle: s / radius,
          position: arcPoint(radius, s, rowFloor(row)),
        });
      }
      cursor -= seg.seats * SEAT_PITCH;
    } else {
      const s = cursor - (seg.aisle * SEAT_PITCH) / 2;
      if (seg.aisle >= 2) {
        AISLE_STEPS.push({ row, s, width: seg.aisle * SEAT_PITCH });
        if (seg.aisle === 2) carpetAisleS = s;
      }
      cursor -= seg.aisle * SEAT_PITCH;
    }
  }
  ROW_COUNTS.push(number);
});

export const seatAt = (row, number) => SEATS[ROW_OFFSETS[row] + number - 1];
export const SEATS_EDGE_S = Math.max(...SEATS.map((seat) => Math.abs(seat.s))) + SEAT_PITCH / 2;
export const CARPET_AISLE_S = carpetAisleS;

// Where your eyes are when you sit in a seat, or stand in a row's lane.
export const seatedEye = (seat) => arcPoint(arcRadius(seat.row, HINGE + 0.04), seat.s, rowFloor(seat.row) + EYE_SEATED);
export const laneEye = (row, s) =>
  arcPoint(arcRadius(row, row === PLATFORM ? 0.7 : LANE), s, rowFloor(row) + EYE_STANDING);

// The opening view: from just under the projection booth, looking out over the rows.
export const OVERVIEW_EYE = new Vector3(0, rowFloor(PLATFORM) + 4.2, ROOM.back - 0.6);
export const OVERVIEW_TARGET = new Vector3(0, 3.2, 10);

// ---------------------------------------------------------------------------
// Objective view metrics for a seat — the decision numbers shown in the UI.
// ---------------------------------------------------------------------------

const toDeg = (rad) => (rad * 180) / Math.PI;

export function seatMetrics(seat) {
  const eye = seatedEye(seat);
  const left = screenPoint(0, 0.5).position.clone().sub(eye);
  const right = screenPoint(1, 0.5).position.clone().sub(eye);
  return {
    distance: Math.hypot(eye.x, eye.z), // horizontal distance to the screen centre
    hAngle: toDeg(left.angleTo(right)), // horizontal angle the screen spans
    offAxis: toDeg(Math.atan2(Math.abs(eye.x), Math.max(eye.z, 0.01))), // angle off the centre axis
  };
}

// The reference zone: purely geometric — the screen spans 40–58° and the seat
// sits within 11° of the centre axis. A viewing-geometry hint, not a score.
export const isBest = (seat) => {
  const m = seatMetrics(seat);
  return m.hAngle >= 40 && m.hAngle <= 58 && m.offAxis <= 11;
};
export const PRICE = HALL.price;
export const priceOf = () => PRICE;

// Seats someone else has already booked — an illustrative pattern only (the
// real availability is whatever the cinema's official channel shows).
// Seeded, so it's the same every time.
export const TAKEN = new Set();
{
  let state = 20221215;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let row = 0; row < ROWS; row++) {
    const count = ROW_COUNTS[row];
    let number = 1 + Math.floor(random() * 3);
    while (number <= count) {
      const seat = seatAt(row, number);
      const busy = row < 3 ? 0.5 : isBest(seat) ? 0.42 : 0.24;
      if (random() < busy) {
        const group = 1 + Math.floor(random() * 3);
        for (let k = 0; k < group && number + k <= count; k++) TAKEN.add(seatAt(row, number + k).index);
        number += group + 1 + Math.floor(random() * 3);
      } else {
        number += 1 + Math.floor(random() * 2);
      }
    }
  }
}
export const isTaken = (seat) => TAKEN.has(seat.index);
