// 07 — Differential Growth
// Hand-drawn seeds that grow into space-filling meanders (ml5 handPose).
//
// Gestures:
//   - quick thumb+index pinch (tap)  -> drop a circle
//   - pinch + hold and move          -> draw a curve along the pinch point
//   - release                        -> the line starts differential growth
//   - pinch ALL fingers together (hold ~0.5 s) -> clear everything
//
// FLIP mode (button, bottom center): drawn shapes stop growing and become
// static obstacles; random seeds spawn OUTSIDE the drawn lines and grow
// around them instead. Sliders: growth spacing + seed count (FLIP only).
// The screen edge is the outer boundary — growth stops when space runs out.

let handPose;
let video;
let hands = [];

// video cover-fit transform (computed every frame)
let vScale = 1;
let vOffX = 0;
let vOffY = 0;

// ------------------------------------------------------------- tuning
const ATTRACT = 0.14;   // pull toward connected neighbors
const ALIGN = 0.22;     // pull toward midpoint of neighbors (smoothing)
const REPEL = 0.72;     // push away from nearby nodes (any path)
const MAX_STEP = 1.25;  // px per frame per node
const JITTER = 0.18;    // symmetry-breaking noise
const MARGIN = 14;      // screen boundary margin
const MAX_NODES = 9000; // global node budget (perf / "no space left")
const STILL_FRAMES = 110; // frames of no motion before a path freezes

const PINCH_TAP_MS = 350;  // shorter pinch = circle, longer = curve
const CIRCLE_R = 38;

// ------------------------------------------------------------- state
// path: { nodes:[{x,y}], closed, growing, isSeed, still, frozen }
let paths = [];
let totalNodes = 0;

let pinch = { active: false, t0: 0, pts: [], lastSeen: 0 };
let clearedAt = -99999;

let flipOn = false;
let sepSlider, seedSlider, offSlider, sepVal, seedVal, offVal;
let flipBtn, seedsCtrl, offCtrl, hideCtrl, hideChk, textInput;

// center text obstacle (sampled to repeller nodes)
let textStr = '';
let textSizePx = 0;
let textPG = null;
let textNodes = [];

// fingertip markers (mapped canvas coords, null when no hand)
let thumbMark = null;
let indexMark = null;

function preload() {
  handPose = ml5.handPose({ flipped: true, maxHands: 1 });
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  video = createCapture(VIDEO, { flipped: true });
  video.size(640, 480);
  video.hide();
  handPose.detectStart(video, (r) => (hands = r));

  flipBtn = document.getElementById('flipBtn');
  sepSlider = document.getElementById('sepSlider');
  seedSlider = document.getElementById('seedSlider');
  offSlider = document.getElementById('offSlider');
  sepVal = document.getElementById('sepVal');
  seedVal = document.getElementById('seedVal');
  offVal = document.getElementById('offVal');
  seedsCtrl = document.getElementById('seedsCtrl');
  offCtrl = document.getElementById('offCtrl');
  hideCtrl = document.getElementById('hideCtrl');
  hideChk = document.getElementById('hideChk');
  textInput = document.getElementById('textInput');

  flipBtn.addEventListener('click', toggleFlip);
  sepSlider.addEventListener('input', () => {
    sepVal.textContent = sepSlider.value;
    wakeAll();
  });
  seedSlider.addEventListener('input', () => {
    seedVal.textContent = seedSlider.value;
    if (flipOn) respawnSeeds();
  });
  offSlider.addEventListener('input', () => {
    offVal.textContent = offSlider.value;
    wakeAll();
  });
  textInput.addEventListener('input', () => {
    textStr = textInput.value.trim();
    rebuildText();
    wakeAll();
    if (flipOn) respawnSeeds();
  });
  document.getElementById('restartBtn').addEventListener('click', () => {
    clearAll();
    if (flipOn) respawnSeeds();
  });
}

// render the text to an offscreen buffer, sample filled pixels into
// static repeller nodes (always obstacles — they never grow)
function rebuildText() {
  textNodes = [];
  textPG = null;
  if (!textStr) return;

  const pg = createGraphics(width, height);
  pg.pixelDensity(1);
  pg.background(0);
  pg.fill(255);
  pg.noStroke();
  pg.textAlign(CENTER, CENTER);
  pg.textStyle(BOLD);
  pg.textFont('sans-serif');
  let s = min(height * 0.5, 380);
  pg.textSize(s);
  while (pg.textWidth(textStr) > width * 0.8 && s > 18) {
    s *= 0.93;
    pg.textSize(s);
  }
  textSizePx = s;
  pg.text(textStr, width / 2, height / 2);
  pg.loadPixels();

  const step = 8;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (pg.pixels[4 * (y * width + x)] > 127) {
        textNodes.push({ x, y, obs: true });
      }
    }
  }
  textPG = pg;
}

function insideText(x, y) {
  if (!textPG) return false;
  const xi = x | 0;
  const yi = y | 0;
  if (xi < 0 || yi < 0 || xi >= width || yi >= height) return false;
  return textPG.pixels[4 * (yi * width + xi)] > 127;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  rebuildText();
}

// ---------------------------------------------------------------- draw

function draw() {
  computeCover();
  background('#04060f');
  drawVideoBackground();

  const sep = +sepSlider.value;
  updateGesture(sep);
  stepGrowth(sep);

  drawTextObstacle();
  drawPaths();
  drawPinchPreview();
  drawHandMarkers();
  drawHud();
}

function computeCover() {
  vScale = max(width / video.width, height / video.height);
  vOffX = (width - video.width * vScale) / 2;
  vOffY = (height - video.height * vScale) / 2;
}

function drawVideoBackground() {
  push();
  tint(255, 34);
  image(video, vOffX, vOffY, video.width * vScale, video.height * vScale);
  pop();
}

function mapPt(k) {
  return { x: k.x * vScale + vOffX, y: k.y * vScale + vOffY };
}

// ------------------------------------------------------------ gestures

function updateGesture(sep) {
  const now = millis();
  const h = hands[0];

  if (!h) {
    thumbMark = null;
    indexMark = null;
    // hand lost mid-draw: finalize after a short grace period
    if (pinch.active && now - pinch.lastSeen > 220) finalizePinch(sep);
    return;
  }

  const kp = h.keypoints;
  const wrist = mapPt(kp[0]);
  const midMcp = mapPt(kp[9]);
  const handSize = dist(wrist.x, wrist.y, midMcp.x, midMcp.y);
  const thumb = mapPt(kp[4]);
  const index = mapPt(kp[8]);
  thumbMark = thumb;
  indexMark = index;

  // ---- thumb+index pinch (with hysteresis) — fingers must nearly touch
  const pd = dist(thumb.x, thumb.y, index.x, index.y);
  const isPinched = pinch.active
    ? pd < handSize * 0.32
    : pd < handSize * 0.2;

  if (isPinched) {
    const pos = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
    if (!pinch.active) {
      pinch = { active: true, t0: now, pts: [pos], lastSeen: now };
    } else {
      const last = pinch.pts[pinch.pts.length - 1];
      if (dist(pos.x, pos.y, last.x, last.y) > 6) pinch.pts.push(pos);
      pinch.lastSeen = now;
    }
  } else if (pinch.active) {
    finalizePinch(sep);
  }
}

function finalizePinch(sep) {
  const dur = millis() - pinch.t0;
  const pts = pinch.pts;
  pinch = { active: false, t0: 0, pts: [], lastSeen: 0 };

  let drawn = 0;
  for (let i = 1; i < pts.length; i++) {
    drawn += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
  }

  if (dur < PINCH_TAP_MS || drawn < 40) {
    addCircle(pts[0].x, pts[0].y, CIRCLE_R, 26, false);
  } else {
    addCurve(resample(pts, constrain(sep * 0.45, 6, 18)));
  }

  // in FLIP mode new shapes are static obstacles; refresh the seed field
  if (flipOn) respawnSeeds();
}

// --------------------------------------------------------------- paths

function makePath(nodes, closed, growing, isSeed) {
  return { nodes, closed, growing, isSeed, still: 0, frozen: false };
}

function addCircle(x, y, r, n, isSeed) {
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const a = (TWO_PI * i) / n;
    nodes.push({
      x: constrain(x + r * cos(a), MARGIN, width - MARGIN),
      y: constrain(y + r * sin(a), MARGIN, height - MARGIN),
    });
  }
  paths.push(makePath(nodes, true, !flipOn || isSeed, isSeed));
}

function addCurve(nodes) {
  if (nodes.length < 3) return;
  paths.push(makePath(nodes, false, !flipOn, false));
}

function resample(pts, spacing) {
  const out = [{ ...pts[0] }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let d = dist(a.x, a.y, b.x, b.y);
    while (carry + d >= spacing) {
      const t = (spacing - carry) / d;
      const nx = a.x + (b.x - a.x) * t;
      const ny = a.y + (b.y - a.y) * t;
      out.push({ x: nx, y: ny });
      a = { x: nx, y: ny };
      d = dist(a.x, a.y, b.x, b.y);
      carry = 0;
    }
    carry += d;
  }
  return out;
}

function clearAll() {
  paths = [];
  clearedAt = millis();
}

function wakeAll() {
  for (const p of paths) {
    if (p.growing) {
      p.frozen = false;
      p.still = 0;
    }
  }
}

// ---------------------------------------------------------------- FLIP

function toggleFlip() {
  flipOn = !flipOn;
  flipBtn.classList.toggle('on', flipOn);
  seedsCtrl.classList.toggle('visible', flipOn);
  offCtrl.classList.toggle('visible', flipOn);
  hideCtrl.classList.toggle('visible', flipOn);

  if (flipOn) {
    // drawn shapes stop growing, become obstacles
    for (const p of paths) if (!p.isSeed) p.growing = false;
    respawnSeeds();
  } else {
    // drop seeds, resume growth of drawn shapes
    paths = paths.filter((p) => !p.isSeed);
    for (const p of paths) {
      p.growing = true;
      p.frozen = false;
      p.still = 0;
    }
  }
}

function respawnSeeds() {
  paths = paths.filter((p) => !p.isSeed);
  const count = +seedSlider.value;
  const sep = +sepSlider.value;
  const off = +offSlider.value;
  const obstacles = paths; // everything left is a drawn shape

  for (let k = 0; k < count; k++) {
    let placed = false;
    for (let tries = 0; tries < 250 && !placed; tries++) {
      const x = random(MARGIN + 20, width - MARGIN - 20);
      const y = random(MARGIN + 20, height - MARGIN - 20);
      if (insideAnyShape(x, y, obstacles)) continue;
      if (insideText(x, y)) continue;
      if (nearAnyNode(x, y, sep * 1.2 + off)) continue;
      addCircle(x, y, 9, 10, true);
      placed = true;
    }
  }
}

function insideAnyShape(x, y, obstacles) {
  for (const p of obstacles) {
    if (p.closed && pointInPolygon(x, y, p.nodes)) return true;
  }
  return false;
}

function nearAnyNode(x, y, r) {
  const r2 = r * r;
  for (const p of paths) {
    for (const n of p.nodes) {
      const dx = n.x - x;
      const dy = n.y - y;
      if (dx * dx + dy * dy < r2) return true;
    }
  }
  for (const n of textNodes) {
    const dx = n.x - x;
    const dy = n.y - y;
    if (dx * dx + dy * dy < r2) return true;
  }
  return false;
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y &&
        x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// --------------------------------------------- differential growth core

function stepGrowth(sep) {
  totalNodes = paths.reduce((a, p) => a + p.nodes.length, 0);
  if (!paths.some((p) => p.growing && !p.frozen)) return;

  // obstacle paths (non-growing, i.e. drawn shapes in FLIP mode) repel
  // from a wider radius: sep + offset
  const off = flipOn ? +offSlider.value : 0;
  const cell = sep + off;
  const grid = buildGrid(cell);

  for (const p of paths) {
    if (!p.growing || p.frozen) continue;
    const moved = stepPath(p, grid, cell, sep, off);
    if (moved < 0.09) {
      if (++p.still > STILL_FRAMES) p.frozen = true; // no space left
    } else {
      p.still = 0;
    }
  }

  if (totalNodes < MAX_NODES) {
    for (const p of paths) {
      if (p.growing && !p.frozen) growEdges(p, sep);
    }
  }
}

function buildGrid(cell) {
  const grid = new Map();
  for (const p of paths) {
    const obs = !p.growing;
    for (const n of p.nodes) {
      n.obs = obs;
      gridPush(grid, cell, n);
    }
  }
  for (const n of textNodes) gridPush(grid, cell, n);
  return grid;
}

function gridPush(grid, cell, n) {
  const key = ((n.x / cell) | 0) * 100000 + ((n.y / cell) | 0);
  let arr = grid.get(key);
  if (!arr) grid.set(key, (arr = []));
  arr.push(n);
}

function stepPath(p, grid, cell, sep, off) {
  const ns = p.nodes;
  const L = ns.length;
  const obsR = sep + off; // wider clearance around static obstacles
  let maxMove = 0;

  for (let i = 0; i < L; i++) {
    const n = ns[i];
    const prev = p.closed ? ns[(i - 1 + L) % L] : ns[i - 1];
    const next = p.closed ? ns[(i + 1) % L] : ns[i + 1];

    let fx = 0;
    let fy = 0;

    if (prev) {
      fx += (prev.x - n.x) * ATTRACT;
      fy += (prev.y - n.y) * ATTRACT;
    }
    if (next) {
      fx += (next.x - n.x) * ATTRACT;
      fy += (next.y - n.y) * ATTRACT;
    }
    if (prev && next) {
      fx += ((prev.x + next.x) / 2 - n.x) * ALIGN;
      fy += ((prev.y + next.y) / 2 - n.y) * ALIGN;
    }

    // repulsion from every nearby node on any path (keeps lines apart,
    // prevents self/other intersection)
    const gx = (n.x / cell) | 0;
    const gy = (n.y / cell) | 0;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const arr = grid.get((gx + ox) * 100000 + (gy + oy));
        if (!arr) continue;
        for (const o of arr) {
          if (o === n || o === prev || o === next) continue;
          const r = o.obs ? obsR : sep;
          const dx = n.x - o.x;
          const dy = n.y - o.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r || d2 < 0.0001) continue;
          const d = Math.sqrt(d2);
          const w = ((1 - d / r) * REPEL) / d;
          fx += dx * w;
          fy += dy * w;
        }
      }
    }

    fx += random(-JITTER, JITTER);
    fy += random(-JITTER, JITTER);

    const m = Math.sqrt(fx * fx + fy * fy);
    if (m > MAX_STEP) {
      fx = (fx / m) * MAX_STEP;
      fy = (fy / m) * MAX_STEP;
    }

    n.x = constrain(n.x + fx, MARGIN, width - MARGIN);
    n.y = constrain(n.y + fy, MARGIN, height - MARGIN);
    maxMove = max(maxMove, abs(fx), abs(fy));
  }
  return maxMove;
}

function growEdges(p, sep) {
  const ns = p.nodes;
  const maxLen = sep * 0.85;
  const minLen = max(6, sep * 0.18); // injection floor: stops at saturation

  // split overstretched edges (long hand-drawn segments)
  const last = p.closed ? ns.length : ns.length - 1;
  for (let i = last - 1; i >= 0; i--) {
    if (totalNodes >= MAX_NODES) return;
    if (edgeLen(ns, i) > maxLen) insertMid(ns, i);
  }

  // node injection — the actual growth driver: new nodes overcrowd the
  // line and repulsion resolves it by buckling into meanders
  const tries = max(1, floor(ns.length / 25));
  const edges = p.closed ? ns.length : ns.length - 1;
  for (let t = 0; t < tries; t++) {
    if (totalNodes >= MAX_NODES) return;
    const i = floor(random(edges));
    if (edgeLen(ns, i) > minLen) insertMid(ns, i);
  }
}

function edgeLen(ns, i) {
  const a = ns[i];
  const b = ns[(i + 1) % ns.length];
  return dist(a.x, a.y, b.x, b.y);
}

function insertMid(ns, i) {
  const a = ns[i];
  const b = ns[(i + 1) % ns.length];
  ns.splice(i + 1, 0, {
    x: (a.x + b.x) / 2 + random(-0.5, 0.5),
    y: (a.y + b.y) / 2 + random(-0.5, 0.5),
  });
  totalNodes++;
}

// -------------------------------------------------------------- render

function hideObstacles() {
  return hideChk.checked;
}

function drawTextObstacle() {
  if (!textStr || hideObstacles()) return;
  push();
  noStroke();
  fill(255);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textFont('sans-serif');
  textSize(textSizePx);
  text(textStr, width / 2, height / 2);
  pop();
}

function drawPaths() {
  noFill();
  strokeJoin(ROUND);
  strokeCap(ROUND);
  const hideObs = hideObstacles();
  for (const p of paths) {
    if (hideObs && !p.growing && !p.isSeed) continue;
    // dark halo then white core -> tube look on black
    stroke(4, 6, 15);
    strokeWeight(9);
    drawPoly(p);
    stroke(255);
    strokeWeight(4.5);
    drawPoly(p);
  }
}

function drawHandMarkers() {
  if (!thumbMark || !indexMark) return;
  push();
  const pinched = pinch.active;
  stroke(127, 208, 255, pinched ? 230 : 110);
  strokeWeight(1.5);
  line(thumbMark.x, thumbMark.y, indexMark.x, indexMark.y);
  noStroke();
  fill(pinched ? color(255) : color(127, 208, 255, 200));
  circle(thumbMark.x, thumbMark.y, 11);
  circle(indexMark.x, indexMark.y, 11);
  pop();
}

function drawPoly(p) {
  beginShape();
  for (const n of p.nodes) vertex(n.x, n.y);
  if (p.closed) endShape(CLOSE);
  else endShape();
}

function drawPinchPreview() {
  if (!pinch.active) return;
  const pts = pinch.pts;
  const holding = millis() - pinch.t0 >= PINCH_TAP_MS;

  noFill();
  stroke(127, 208, 255, 220);
  strokeWeight(3);
  if (holding && pts.length > 1) {
    beginShape();
    for (const q of pts) vertex(q.x, q.y);
    endShape();
  }
  const tip = pts[pts.length - 1];
  circle(tip.x, tip.y, holding ? 14 : CIRCLE_R * 2);
}

function drawHud() {
  push();
  noStroke();
  fill(207, 214, 228, 160);
  textFont('sans-serif');
  textStyle(NORMAL);
  textSize(12);
  textAlign(LEFT, BOTTOM);
  text(
    'pinch tap: circle   ·   pinch + hold: draw curve   ·   release: grow',
    16, height - 34
  );
  fill(143, 160, 184, 130);
  text(`nodes ${totalNodes}${totalNodes >= MAX_NODES ? ' (full)' : ''}`, 16, height - 16);
  pop();

  if (millis() - clearedAt < 800) {
    push();
    textAlign(CENTER, CENTER);
    textSize(34);
    fill(255, map(millis() - clearedAt, 0, 800, 255, 0));
    noStroke();
    text('CLEARED', width / 2, height / 2);
    pop();
  }
}
