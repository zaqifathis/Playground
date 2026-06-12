// 04 — Pixman
// Mosaic pixel people from body pose (ml5 bodyPose / MoveNet multipose).
// The camera image is never shown: each detected person is rasterized onto
// a white tile wall as a little figure built from colored squares and
// half-square triangles, like a 70s swimming-pool mosaic. Every person
// gets a random outfit palette (stable per tile via seeded hash).
// R rerolls all colors, V toggles a small webcam preview.

let bodyPose;
let video;
let poses = [];

let cell = 32; // tile size in px, recomputed from canvas size
let wall;      // pre-rendered tile-wall background
let people = [];
let showPreview = false;

// video cover-fit transform (computed every frame)
let vScale = 1;
let vOffX = 0;
let vOffY = 0;

// ------------------------------------------------------------- tuning
const MAX_PEOPLE = 4;    // ignore detections beyond this
const GRID_DIVS = 22;    // min(width, height) / this = tile size
const CONF = 0.25;       // keypoint confidence threshold
const TRACK_FRAC = 0.25; // person re-matching radius, fraction of width
const LOST_MS = 1200;    // drop a person after this long unseen
const SMOOTH = 0.4;      // keypoint lerp factor

// mosaic colors sampled from the reference wall
const COLORS = [
  '#e8467c', '#f2a0b8', '#ff4d00', '#ff7b29', '#8f9c3f', '#c8b400',
  '#0e7a8a', '#1c2e6b', '#5a0f1e', '#1a1a1a', '#b9a6d4', '#9aa0a6',
  '#2e7d32', '#ffd400', '#c0392b', '#16606e', '#d35400', '#284b8f',
  '#7d3c98', '#74452d',
];
const SKIN = ['#f3c89d', '#e0a878', '#a96a3f', '#f4b8a0', '#caa284'];
const HAIR = ['#1a1a1a', '#3d2314', '#c8b400', '#5a0f1e', '#2b2d42', '#b8860b'];

const PART_ID = {
  hair: 1, head: 2, torso: 3, armL: 4, armR: 5, legs: 6, hands: 7, feet: 8,
};

// MoveNet keypoint indices
const NOSE = 0, L_EYE = 1, R_EYE = 2, L_EAR = 3, R_EAR = 4;
const L_SHO = 5, R_SHO = 6, L_ELB = 7, R_ELB = 8, L_WRI = 9, R_WRI = 10;
const L_HIP = 11, R_HIP = 12, L_KNE = 13, R_KNE = 14, L_ANK = 15, R_ANK = 16;

// ---------------------------------------------------------------- setup

function preload() {
  bodyPose = ml5.bodyPose({ flipped: true, modelType: 'MULTIPOSE_LIGHTNING' });
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  video = createCapture(VIDEO, { flipped: true });
  video.size(640, 480);
  video.hide();
  bodyPose.detectStart(video, (r) => (poses = r));
  buildWall();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  buildWall();
}

function keyPressed() {
  if (key === 'r' || key === 'R') {
    for (const p of people) reroll(p);
  }
  if (key === 'v' || key === 'V') showPreview = !showPreview;
}

function mousePressed() {
  for (const p of people) reroll(p);
}

// Reroll one person's outfit, avoiding the torso color every other
// person currently wears so people stay tellable apart.
function reroll(p) {
  const used = people.filter((q) => q !== p).map((q) => q.palette.torso[0]);
  for (let tries = 0; tries < 40; tries++) {
    const seed = floor(random(1e9));
    const pal = makePalette(seed);
    if (!used.includes(pal.torso[0]) || tries === 39) {
      p.seed = seed;
      p.palette = pal;
      return;
    }
  }
}

// ---------------------------------------------------------------- draw

function draw() {
  vScale = max(width / video.width, height / video.height);
  vOffX = (width - video.width * vScale) / 2;
  vOffY = (height - video.height * vScale) / 2;

  image(wall, 0, 0);
  updatePeople();

  for (const p of people) drawCells(rasterizePerson(p), p);

  drawHUD();
}

// ---------------------------------------------------------------- wall

// Off-white tiles with grout, plus a few static colored accent tiles.
function buildWall() {
  cell = max(14, floor(min(width, height) / GRID_DIVS));
  wall = createGraphics(width, height);
  wall.background('#dddcd6'); // grout
  wall.noStroke();

  const cols = ceil(width / cell);
  const rows = ceil(height / cell);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const t = 245 + (cellHash(i, j, 0, 7) - 0.5) * 7;
      wall.fill(t, t, t - 3);
      wall.rect(i * cell + 1, j * cell + 1, cell - 2, cell - 2, 1);
    }
  }

  // scattered accents, like stray colored tiles in the reference
  const rnd = mulberry32(99);
  const n = floor(cols * rows * 0.005) + 6;
  for (let k = 0; k < n; k++) {
    const i = floor(rnd() * cols);
    const j = floor(rnd() * rows);
    wall.fill(COLORS[floor(rnd() * COLORS.length)]);
    wall.rect(i * cell + 1, j * cell + 1, cell - 2, cell - 2, 1);
    if (rnd() < 0.5) {
      wall.fill(COLORS[floor(rnd() * COLORS.length)]);
      wall.rect((i + 1) * cell + 1, j * cell + 1, cell - 2, cell - 2, 1);
    }
  }
}

// ---------------------------------------------------------------- people

// Map a raw pose to screen-space keypoints with validity flags.
function toScreenKp(pose) {
  return pose.keypoints.map((k) => ({
    x: vOffX + k.x * vScale,
    y: vOffY + k.y * vScale,
    ok: (k.confidence ?? k.score ?? 0) > CONF,
  }));
}

function kpCenter(kp) {
  let x = 0, y = 0, n = 0;
  for (const k of kp) {
    if (!k.ok) continue;
    x += k.x;
    y += k.y;
    n++;
  }
  return n ? { x: x / n, y: y / n } : null;
}

// Track detections across frames by torso-center proximity so each
// person keeps their outfit while moving around.
function updatePeople() {
  const now = millis();
  const detections = [];
  for (const pose of poses) {
    const kp = toScreenKp(pose);
    if (kp.filter((k) => k.ok).length >= 6) detections.push(kp);
  }

  const freePeople = [...people];
  for (const kp of detections) {
    const c = kpCenter(kp);
    let best = null;
    let bd = width * TRACK_FRAC;
    for (const p of freePeople) {
      const d = dist(c.x, c.y, p.center.x, p.center.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) {
      freePeople.splice(freePeople.indexOf(best), 1);
      for (let i = 0; i < kp.length; i++) {
        const prev = best.kp[i];
        if (kp[i].ok && prev.ok) {
          kp[i].x = lerp(prev.x, kp[i].x, SMOOTH);
          kp[i].y = lerp(prev.y, kp[i].y, SMOOTH);
        }
      }
      best.kp = kp;
      best.center = c;
      best.lastSeen = now;
    } else if (people.length < MAX_PEOPLE) {
      const person = {
        seed: 0,
        palette: null,
        kp,
        center: c,
        lastSeen: now,
      };
      people.push(person);
      reroll(person); // picks a palette distinct from everyone else's
    }
  }

  people = people.filter((p) => now - p.lastSeen < LOST_MS);
}

// ---------------------------------------------------------------- palette

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// stable pseudo-random per tile, so colors don't flicker frame to frame
function cellHash(i, j, k, seed) {
  const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7 + seed * 0.001) * 43758.5453;
  return s - Math.floor(s);
}

function makePalette(seed) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[floor(rnd() * arr.length)];
  const pickN = (arr, n) => {
    const out = [];
    while (out.length < n) {
      const c = pick(arr);
      if (!out.includes(c)) out.push(c);
    }
    return out;
  };

  const torso = pickN(COLORS, 1 + floor(rnd() * 3));
  const arm = rnd() < 0.6 ? [torso[0]] : [pick(COLORS)];
  return {
    hair: [pick(HAIR)],
    head: [pick(SKIN)],
    torso,
    armL: arm,
    armR: rnd() < 0.8 ? arm : [pick(COLORS)],
    legs: pickN(COLORS, 1 + floor(rnd() * 2)),
    hands: arm,
    feet: [pick(COLORS)],
  };
}

// ---------------------------------------------------------------- raster

// Turn one person's keypoints into a map of grid cells. First write to a
// cell wins, so fill order sets the part priority.
function rasterizePerson(p) {
  const cells = new Map();
  const kp = p.kp;
  const put = (i, j, part, tri = null) => {
    const key = i + ',' + j;
    if (!cells.has(key)) cells.set(key, { i, j, part, tri });
  };

  const shouldersOk = kp[L_SHO].ok && kp[R_SHO].ok;
  const shoulderW = shouldersOk
    ? dist(kp[L_SHO].x, kp[L_SHO].y, kp[R_SHO].x, kp[R_SHO].y)
    : cell * 3;

  // head + hair: disc of tiles around the face center, top cap is hair
  const headPts = [NOSE, L_EYE, R_EYE, L_EAR, R_EAR].filter((i) => kp[i].ok);
  if (headPts.length) {
    let hx = 0, hy = 0;
    for (const i of headPts) {
      hx += kp[i].x / headPts.length;
      hy += kp[i].y / headPts.length;
    }
    const r = max(cell * 0.7, shoulderW * 0.32);
    const i0 = floor((hx - r) / cell);
    const i1 = floor((hx + r) / cell);
    const j0 = floor((hy - r) / cell);
    const j1 = floor((hy + r) / cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const cx = (i + 0.5) * cell;
        const cy = (j + 0.5) * cell;
        if (dist(cx, cy, hx, hy) < r) {
          put(i, j, cy < hy - r * 0.2 ? 'hair' : 'head');
        }
      }
    }
  }

  // torso: filled quad between shoulders and hips, slightly inflated
  if (shouldersOk && kp[L_HIP].ok && kp[R_HIP].ok) {
    fillQuad([kp[L_SHO], kp[R_SHO], kp[R_HIP], kp[L_HIP]], put, 'torso');
  }

  // legs (before arms so pants beat a hand brushing the thigh)
  limb(kp, L_HIP, L_KNE, put, 'legs');
  limb(kp, L_KNE, L_ANK, put, 'legs');
  limb(kp, R_HIP, R_KNE, put, 'legs');
  limb(kp, R_KNE, R_ANK, put, 'legs');
  tip(kp, L_KNE, L_ANK, put, 'feet');
  tip(kp, R_KNE, R_ANK, put, 'feet');

  // arms + hand tips
  limb(kp, L_SHO, L_ELB, put, 'armL');
  limb(kp, L_ELB, L_WRI, put, 'armL');
  limb(kp, R_SHO, R_ELB, put, 'armR');
  limb(kp, R_ELB, R_WRI, put, 'armR');
  tip(kp, L_ELB, L_WRI, put, 'hands');
  tip(kp, R_ELB, R_WRI, put, 'hands');

  return cells;
}

// fill the tiles a limb segment passes through
function limb(kp, a, b, put, part) {
  if (!kp[a].ok || !kp[b].ok) return;
  const steps = max(1, ceil(dist(kp[a].x, kp[a].y, kp[b].x, kp[b].y) / (cell * 0.4)));
  for (let s = 0; s <= steps; s++) {
    const x = lerp(kp[a].x, kp[b].x, s / steps);
    const y = lerp(kp[a].y, kp[b].y, s / steps);
    put(floor(x / cell), floor(y / cell), part);
  }
}

// triangle tile one cell beyond an extremity, pointing along the limb
function tip(kp, from, end, put, part) {
  if (!kp[from].ok || !kp[end].ok) return;
  const dx = kp[end].x - kp[from].x;
  const dy = kp[end].y - kp[from].y;
  const m = max(1, sqrt(dx * dx + dy * dy));
  const ux = dx / m;
  const uy = dy / m;
  const tx = kp[end].x + ux * cell * 0.8;
  const ty = kp[end].y + uy * cell * 0.8;
  const tri = {
    dx: abs(ux) > 0.35 ? Math.sign(ux) : 0,
    dy: abs(uy) > 0.35 ? Math.sign(uy) : 0,
  };
  put(floor(tx / cell), floor(ty / cell), part, tri);
}

function fillQuad(pts, put, part) {
  let cx = 0, cy = 0;
  for (const p of pts) {
    cx += p.x / pts.length;
    cy += p.y / pts.length;
  }
  const q = pts.map((p) => ({
    x: cx + (p.x - cx) * 1.2,
    y: cy + (p.y - cy) * 1.15,
  }));

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of q) {
    minX = min(minX, p.x);
    maxX = max(maxX, p.x);
    minY = min(minY, p.y);
    maxY = max(maxY, p.y);
  }
  for (let i = floor(minX / cell); i <= floor(maxX / cell); i++) {
    for (let j = floor(minY / cell); j <= floor(maxY / cell); j++) {
      if (inPoly((i + 0.5) * cell, (j + 0.5) * cell, q)) put(i, j, part);
    }
  }
}

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------- render

function drawCells(cells, person) {
  noStroke();
  for (const c of cells.values()) {
    const colors = person.palette[c.part];
    const h = cellHash(c.i, c.j, PART_ID[c.part], person.seed);
    fill(colors[floor(pow(h, 1.4) * colors.length)]);
    const x = c.i * cell;
    const y = c.j * cell;
    if (c.tri) drawTri(x, y, c.tri);
    else rect(x + 1, y + 1, cell - 2, cell - 2, 1);
  }
}

// half-square triangle; right angle sits in the corner the limb points to
function drawTri(x, y, t) {
  let { dx, dy } = t;
  const i = floor(x / cell);
  const j = floor(y / cell);
  if (!dx) dx = (i + j) % 2 ? 1 : -1;
  if (!dy) dy = (i + j) % 2 ? 1 : -1;
  const x0 = x + 1, y0 = y + 1, x1 = x + cell - 1, y1 = y + cell - 1;
  const cx = dx > 0 ? x1 : x0;
  const cyn = dy > 0 ? y1 : y0;
  triangle(cx, cyn, dx > 0 ? x0 : x1, cyn, cx, dy > 0 ? y0 : y1);
}

// ---------------------------------------------------------------- hud

function drawHUD() {
  if (showPreview) {
    const w = 180;
    const h = (w * video.height) / video.width;
    noFill();
    stroke(40, 120);
    strokeWeight(2);
    rect(width - w - 13, height - h - 13, w + 2, h + 2);
    noStroke();
    image(video, width - w - 12, height - h - 12, w, h);
  }

  noStroke();
  fill(60, 60, 60, 180);
  textSize(13);
  textAlign(LEFT, BOTTOM);
  const msg = people.length
    ? 'click or press R to reroll colors — V toggles camera preview'
    : 'step back so your whole body is in view';
  text(msg, 14, height - 14);
}
