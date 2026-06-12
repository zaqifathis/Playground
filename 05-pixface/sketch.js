// 05 — Pixface
// Pixelated face characters driven by ml5 faceMesh (MediaPipe).
// The webcam is never shown: each detected face (up to 4) gets a randomly
// generated blob of soft gradient pixels that follows the head, and the
// two pixel-eyes slide to follow the actual eyeballs (iris landmarks,
// refineLandmarks: true). Faces are tracked across frames by proximity so
// everyone keeps their own character while moving.
// Click or press R to reroll all shapes + palettes. V toggles a webcam preview.

let faceMesh;
let video;
let faces = [];
let people = []; // tracked faces, each with its own character + smoothing
let showPreview = false;

// video cover-fit transform (computed every frame)
let vScale = 1;
let vOffX = 0;
let vOffY = 0;

// ------------------------------------------------------------- tuning
const MAX_FACES = 4;      // ignore detections beyond this
const COLS = 15;          // blob grid width
const ROWS = 19;          // blob grid height
const BLOB_OVER_FACE = 1.7; // blob width / detected face width
const SMOOTH_POS = 0.35;  // anchor lerp factor
const SMOOTH_GAZE = 0.45; // gaze lerp factor
const GAZE_GAIN = 5;      // iris offsets are tiny, amplify them
const TRACK_FRAC = 0.2;   // face re-matching radius, fraction of width
const LOST_MS = 1200;     // drop a person after this long unseen

// FaceMesh landmark indices (MediaPipe topology, 478 pts with iris)
const L_IRIS = [468, 469, 470, 471, 472];
const R_IRIS = [473, 474, 475, 476, 477];
const L_EYE_OUT = 33, L_EYE_IN = 133, L_EYE_TOP = 159, L_EYE_BOT = 145;
const R_EYE_IN = 362, R_EYE_OUT = 263, R_EYE_TOP = 386, R_EYE_BOT = 374;
const CHEEK_L = 234, CHEEK_R = 454;

// color pool sampled from the reference image
const POOL = [
  '#7fbf7f', '#3e9e5c', '#1d7a3c', '#9fd6c2', '#5fb6a8', '#1c8d7a',
  '#8fc6e8', '#4a90d9', '#2747d4', '#1c2e6b', '#7ea0e8',
  '#f7a0cd', '#f06292', '#e8467c', '#f8c7d8', '#d96bb8',
  '#ffd233', '#ffb300', '#f47c20', '#f4a259', '#e8732a',
  '#f04a38', '#d62828', '#9b59d0', '#b9a6d4', '#7d3c98',
  '#74452d', '#3d2314', '#2b2d42', '#caa284',
];

// ---------------------------------------------------------------- setup

function preload() {
  faceMesh = ml5.faceMesh({ maxFaces: MAX_FACES, refineLandmarks: true, flipped: true });
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  video = createCapture(VIDEO, { flipped: true });
  video.size(640, 480);
  video.hide();
  faceMesh.detectStart(video, (r) => (faces = r));
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function keyPressed() {
  if (key === 'r' || key === 'R') rerollAll();
  if (key === 'v' || key === 'V') showPreview = !showPreview;
}

function mousePressed() {
  rerollAll();
}

// Reroll everyone, keeping the first gradient anchor distinct per person
// so characters stay tellable apart.
function rerollAll() {
  for (const p of people) {
    const used = people.filter((q) => q !== p).map((q) => q.character.anchors[0]);
    for (let tries = 0; tries < 40; tries++) {
      const ch = makeCharacter(floor(random(1e9)));
      if (!used.includes(ch.anchors[0]) || tries === 39) {
        p.character = ch;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- random

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// stable per-cell hash so the gradient grain doesn't flicker
function cellHash(i, j, seed) {
  const s = Math.sin(i * 127.1 + j * 311.7 + seed * 0.013) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------------------------------------------------------- character

// A character is a boolean grid mask (the blob silhouette), a per-cell
// color function (one of three gradient styles) and eye slot positions.
function makeCharacter(seed) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[floor(rnd() * arr.length)];

  // --- silhouette: head-ish ellipse + random-walk ragged edges
  const cx = COLS / 2 + (rnd() - 0.5) * 1.5;
  const cy = ROWS / 2;
  const rx = COLS * (0.34 + rnd() * 0.1);
  const ry = ROWS * (0.38 + rnd() * 0.08);

  // per-column random walks for top and bottom edge jitter
  const walkT = [0];
  const walkB = [0];
  for (let i = 1; i < COLS; i++) {
    walkT[i] = constrain(walkT[i - 1] + floor(rnd() * 3) - 1, -2, 2);
    walkB[i] = constrain(walkB[i - 1] + floor(rnd() * 3) - 1, -2, 2);
  }

  const mask = [];
  for (let i = 0; i < COLS; i++) {
    mask[i] = [];
    const nx = (i + 0.5 - cx) / rx;
    if (abs(nx) >= 1) continue;
    const half = sqrt(1 - nx * nx) * ry;
    const top = round(cy - half + walkT[i]);
    const bot = round(cy + half + walkB[i]);
    for (let j = max(0, top); j <= min(ROWS - 1, bot); j++) mask[i][j] = true;
  }

  // erosion: randomly chip edge cells; a few stray pixels just outside
  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      if (!mask[i][j]) continue;
      const edge =
        !(mask[i - 1] && mask[i - 1][j]) || !(mask[i + 1] && mask[i + 1][j]) ||
        !mask[i][j - 1] || !mask[i][j + 1];
      if (edge && rnd() < 0.12) mask[i][j] = false;
    }
  }
  for (let k = 0; k < 4; k++) {
    if (rnd() < 0.6) {
      const i = floor(rnd() * COLS);
      const j = floor(rnd() * ROWS);
      if (mask[i] && !mask[i][j]) mask[i][j] = true;
    }
  }

  // --- eyes: a row in the upper-middle, symmetric slots 2 cells wide
  const eyeRow = floor(ROWS * 0.36 + rnd() * 2);
  const gap = 1 + floor(rnd() * 2); // half-distance between eyes
  const eyeL = { i: floor(cx) - gap - 2, j: eyeRow };
  const eyeR = { i: floor(cx) + gap, j: eyeRow };
  // make sure there are face pixels behind the eyes
  for (const e of [eyeL, eyeR]) {
    for (let d = -1; d <= 2; d++) {
      if (mask[e.i + d]) mask[e.i + d][e.j] = true;
    }
  }

  // --- palette: 2-4 distinct anchors, one of three gradient styles
  const anchors = [];
  const n = 2 + floor(rnd() * 3);
  while (anchors.length < n) {
    const c = pick(POOL);
    if (!anchors.includes(c)) anchors.push(c);
  }
  const style = floor(rnd() * 3); // 0 vertical stripes, 1 radial, 2 horizontal
  const focusI = cx + (rnd() - 0.5) * COLS * 0.5;
  const focusJ = cy + (rnd() - 0.5) * ROWS * 0.5;
  const maxD = dist(0, 0, COLS, ROWS) * 0.55;

  return { seed, mask, eyeL, eyeR, anchors, style, focusI, focusJ, maxD };
}

// interpolate through the anchor color list at t in 0..1
function gradientColor(anchors, t) {
  t = constrain(t, 0, 0.999);
  if (anchors.length === 1) return color(anchors[0]);
  const f = t * (anchors.length - 1);
  const k = floor(f);
  return lerpColor(color(anchors[k]), color(anchors[k + 1]), f - k);
}

function cellColor(ch, i, j) {
  const grain = (cellHash(i, j, ch.seed) - 0.5) * 0.18;
  let t;
  if (ch.style === 0) t = i / (COLS - 1);
  else if (ch.style === 1) t = dist(i, j, ch.focusI, ch.focusJ) / ch.maxD;
  else t = j / (ROWS - 1);
  let c = gradientColor(ch.anchors, t + grain);

  // soften: blend toward white, more near the silhouette edge
  const edge =
    !(ch.mask[i - 1] && ch.mask[i - 1][j]) || !(ch.mask[i + 1] && ch.mask[i + 1][j]) ||
    !ch.mask[i][j - 1] || !ch.mask[i][j + 1];
  const fade = (edge ? 0.22 : 0.06) + cellHash(j, i, ch.seed) * 0.2;
  return lerpColor(c, color(255), fade);
}

// ---------------------------------------------------------------- face

function avgPoint(kp, idx) {
  let x = 0, y = 0;
  for (const i of idx) {
    x += kp[i].x / idx.length;
    y += kp[i].y / idx.length;
  }
  return { x, y };
}

// normalized position of value v between a and b, 0..1
function normBetween(v, a, b) {
  return (v - a) / (b - a || 1);
}

// Measure one detection: screen-space anchor, cell size and raw gaze.
function measureFace(kp) {
  // anchor: face center + width from cheek landmarks (video coords -> screen)
  const faceW = dist(kp[CHEEK_L].x, kp[CHEEK_L].y, kp[CHEEK_R].x, kp[CHEEK_R].y) * vScale;
  const eyesMid = avgPoint(kp, [L_EYE_OUT, L_EYE_IN, R_EYE_IN, R_EYE_OUT]);
  const px = vOffX + eyesMid.x * vScale;
  const py = vOffY + eyesMid.y * vScale;
  const cell = constrain((faceW * BLOB_OVER_FACE) / COLS, 8, 80);

  // gaze: iris center relative to eye corners / lids, both eyes averaged
  const li = avgPoint(kp, L_IRIS);
  const ri = avgPoint(kp, R_IRIS);
  const lx = normBetween(li.x, kp[L_EYE_OUT].x, kp[L_EYE_IN].x);
  const rx = normBetween(ri.x, kp[R_EYE_IN].x, kp[R_EYE_OUT].x);
  const ly = normBetween(li.y, kp[L_EYE_TOP].y, kp[L_EYE_BOT].y);
  const ry = normBetween(ri.y, kp[R_EYE_TOP].y, kp[R_EYE_BOT].y);

  // left eye runs outer->inner, right runs inner->outer, so the two x
  // fractions point the same way; 0.5 means looking straight ahead
  const gx = constrain((((lx - 0.5) + (rx - 0.5)) / 2) * -GAZE_GAIN, -1, 1);
  const gy = constrain((((ly - 0.5) + (ry - 0.5)) / 2) * GAZE_GAIN * 0.8, -1, 1);

  return { px, py, cell, gx, gy };
}

// Track detections across frames by anchor proximity so each face keeps
// its character while moving around.
function updatePeople() {
  const now = millis();
  const detections = [];
  for (const f of faces) {
    if (f.keypoints && f.keypoints.length >= 478) {
      detections.push(measureFace(f.keypoints));
    }
  }

  const freePeople = [...people];
  for (const d of detections) {
    let best = null;
    let bd = width * TRACK_FRAC;
    for (const p of freePeople) {
      const dd = dist(d.px, d.py, p.fx, p.fy);
      if (dd < bd) {
        bd = dd;
        best = p;
      }
    }
    if (best) {
      freePeople.splice(freePeople.indexOf(best), 1);
      best.fx = lerp(best.fx, d.px, SMOOTH_POS);
      best.fy = lerp(best.fy, d.py, SMOOTH_POS);
      best.fCell = lerp(best.fCell, d.cell, SMOOTH_POS);
      best.gazeX = lerp(best.gazeX, d.gx, SMOOTH_GAZE);
      best.gazeY = lerp(best.gazeY, d.gy, SMOOTH_GAZE);
      best.lastSeen = now;
    } else if (people.length < MAX_FACES) {
      // pick a character whose lead color differs from everyone else's
      const used = people.map((q) => q.character.anchors[0]);
      let ch = makeCharacter(floor(random(1e9)));
      for (let tries = 0; tries < 40 && used.includes(ch.anchors[0]); tries++) {
        ch = makeCharacter(floor(random(1e9)));
      }
      people.push({
        character: ch,
        fx: d.px,
        fy: d.py,
        fCell: d.cell,
        gazeX: d.gx,
        gazeY: d.gy,
        lastSeen: now,
      });
    }
  }

  people = people.filter((p) => now - p.lastSeen < LOST_MS);
}

// ---------------------------------------------------------------- draw

function draw() {
  background(255);

  vScale = max(width / video.width, height / video.height);
  vOffX = (width - video.width * vScale) / 2;
  vOffY = (height - video.height * vScale) / 2;

  updatePeople();

  for (const p of people) drawCharacter(p);
  drawHUD();
}

function drawCharacter(p) {
  const ch = p.character;
  const cell = p.fCell;
  // place the grid so the eye row lands on the real eyes
  const x0 = p.fx - (COLS / 2) * cell;
  const y0 = p.fy - (ch.eyeL.j + 0.5) * cell;

  noStroke();
  for (let i = 0; i < COLS; i++) {
    if (!ch.mask[i]) continue;
    for (let j = 0; j < ROWS; j++) {
      if (!ch.mask[i][j]) continue;
      fill(cellColor(ch, i, j));
      rect(x0 + i * cell, y0 + j * cell, cell + 0.5, cell + 0.5);
    }
  }

  // eyes: white 2-cell slot, black pupil slides with the eyeballs
  for (const e of [ch.eyeL, ch.eyeR]) {
    const ex = x0 + e.i * cell;
    const ey = y0 + e.j * cell;
    fill(255);
    rect(ex, ey, cell * 2, cell);
    fill(20);
    const pupilX = ex + (p.gazeX * 0.5 + 0.5) * cell;
    const pupilY = ey + p.gazeY * cell * 0.12;
    rect(pupilX, pupilY, cell, cell);
  }
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
    ? 'click or press R to reroll faces — V toggles camera preview'
    : 'look at the camera';
  text(msg, 14, height - 14);
}
