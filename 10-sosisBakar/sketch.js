// 10 — Sosis Bakar (Grilled Sausage)
// Two-player face-tracked 8-bit fire cannon (ml5 faceMesh, maxFaces: 2).
// Close your mouth to charge a flame on your lips; open your mouth and it
// spits a jet of pixel fire along the mouth -> forehead vector frozen at the
// instant you open (the last aim before the shot). A flock of 8-bit sausages
// drifts across the top of the screen at different speeds, each with a target
// dot at its center. Torch one and it chars black and tumbles down. Players
// are split left / right; each keeps its own kill count in an 8-bit font.

let faceMesh;
let video;
let faces = [];

// video cover-fit transform (computed every frame)
let vScale = 1;
let vOffX = 0;
let vOffY = 0;

let players = [];
let birds = [];     // flying sausages
let shots = [];     // flying pixel-fire projectiles
let bursts = [];

const NUM_BIRDS = 5;

// ------------------------------------------------------------- tuning
const CHARGE_MS = 900;
const DRAIN_MS = 1400;
const OPEN_RATIO = 0.16;
const SHOT_SPEED = 17;
const HIT_R = 34;

// FaceMesh landmark indices (MediaPipe topology)
const FACE_TOP = 10, CHIN = 152;
const LIP_TOP = 13, LIP_BOT = 14;
const MOUTH_L = 61, MOUTH_R = 291;

const PALETTES = [
  { name: 'P1', marker: [255, 90, 70] },
  { name: 'P2', marker: [90, 200, 255] },
];

// ------------------------------------------------------------- sprites
// 8-bit sausage. . empty, D dark outline, R red body, O orange highlight
const SAUSAGE_PX = [
  '......DDDDDDDD........',
  '....DDRRRRRRRRRRDD....',
  '..DDRRRRRRRRRRRRRRDD..',
  '.DRRRROORRRRRRRRRRRRD.',
  '.DRRRRRRRROORRRRRRRRD.',
  '..DDRRRRRRRRRRRRRRDD..',
  '....DDRRRRRRRRRRDD....',
  '......DDDDDDDD........',
];
const SAUSAGE_COLS = {
  D: [26, 12, 40],
  R: [224, 51, 31],
  O: [242, 92, 42],
};

// 8-bit flame, points UP. R red, O orange, Y yellow core
const FIRE_PX = [
  '.....R.....',
  '.....R.....',
  '....RR.....',
  '....R......',
  '....R..R...',
  '....R..R...',
  '....RORR...',
  '...ROOOR...',
  '..ROOOOOR..',
  '..ROOYOOR..',
  '.ROOYYYOOR.',
  '.ROYYYYYOR.',
  '.ROYYYYYOR.',
  '.ROYYYYYOR.',
  '..ROYYYOR..',
  '..ROOYOOR..',
  '...RO.OR...',
  '...R..R....',
];
const FIRE_COLS = {
  R: [232, 51, 26],
  O: [245, 140, 30],
  Y: [247, 224, 46],
};

function preload() {
  faceMesh = ml5.faceMesh({ maxFaces: 2, refineLandmarks: true, flipped: true });
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  video = createCapture(VIDEO, { flipped: true });
  video.size(640, 480);
  video.hide();
  faceMesh.detectStart(video, (r) => (faces = r));

  players = PALETTES.map(makePlayer);
  for (let i = 0; i < NUM_BIRDS; i++) birds.push(makeBird(true));
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function makePlayer(palette) {
  return {
    palette,
    mouth: { x: width / 2, y: height / 2 },
    aim: { x: 0, y: -1 },
    shotDir: { x: 0, y: -1 },
    smoothSize: 200,
    charge: 0,
    firing: false,
    wasOpen: false,
    seen: false,
    killed: 0,
  };
}

function birdScale() {
  return max(3, (min(width, height) / 900) * 5);
}

function makeBird(scatter) {
  const goRight = random() < 0.5;
  const px = birdScale();
  const w = SAUSAGE_PX[0].length * px;
  return {
    px,
    w,
    h: SAUSAGE_PX.length * px,
    dirX: goRight ? 1 : -1,
    x: scatter ? random(width) : goRight ? -w : width + w,
    y: random(height * 0.05, height * 0.32),
    speed: random(3.2, 6.5),
    phase: random(TWO_PI),
    wob: random(0.4, 0.9),
    dead: false,
    vy: 0,
    angle: 0,
  };
}

// ---------------------------------------------------------------- draw

function draw() {
  background('#0a0e16');
  drawVideoBackground();

  updateCannons();
  updateBirds();
  updateShots();

  for (const b of birds) drawBird(b);

  push();
  blendMode(ADD);
  for (const p of players) if (p.charge > 0.05 && !p.firing) drawMuzzleFlame(p);
  for (const s of shots) drawFireSprite(s.x, s.y, s.px, s.angle, s.flick);
  blendMode(BLEND);
  pop();

  for (const p of players) if (p.seen) drawFaceMarker(p);
  drawBursts();
  drawHUD();
  drawScore();
}

// Cover-fit: fill the canvas, crop the overflow — no stretching, no tint.
function drawVideoBackground() {
  vScale = max(width / video.width, height / video.height);
  vOffX = (width - video.width * vScale) / 2;
  vOffY = (height - video.height * vScale) / 2;
  image(video, vOffX, vOffY, video.width * vScale, video.height * vScale);
}

// ---------------------------------------------------------------- cannons

function toScreen(kp) {
  return { x: vOffX + kp.x * vScale, y: vOffY + kp.y * vScale };
}

// per-face features in screen space
function faceFeatures(f) {
  const kp = f.keypoints;
  const top = toScreen(kp[FACE_TOP]);
  const chin = toScreen(kp[CHIN]);
  const lipT = toScreen(kp[LIP_TOP]);
  const lipB = toScreen(kp[LIP_BOT]);
  const mL = toScreen(kp[MOUTH_L]);
  const mR = toScreen(kp[MOUTH_R]);
  const mx = (mL.x + mR.x) / 2;
  const my = (lipT.y + lipB.y) / 2;
  const faceH = dist(top.x, top.y, chin.x, chin.y);
  const openRatio = dist(lipT.x, lipT.y, lipB.x, lipB.y) / max(faceH, 1);
  return { top, mx, my, faceH, openRatio };
}

function updateCannons() {
  // split faces left -> right so P1 = left person, P2 = right person
  const feats = faces.map(faceFeatures).sort((a, b) => a.mx - b.mx);
  for (let i = 0; i < players.length; i++) {
    updateCannon(players[i], feats[i]);
  }
}

function updateCannon(p, ft) {
  p.seen = false;
  const dt = deltaTime;

  if (!ft) {
    p.firing = false;
    p.wasOpen = false;
    p.charge = max(0, p.charge - dt / 800);
    return;
  }
  p.seen = true;

  p.mouth.x = lerp(p.mouth.x, ft.mx, 0.45);
  p.mouth.y = lerp(p.mouth.y, ft.my, 0.45);
  p.smoothSize = lerp(p.smoothSize, ft.faceH, 0.2);

  let ax = ft.top.x - ft.mx;
  let ay = ft.top.y - ft.my;
  const m = sqrt(ax * ax + ay * ay) || 1;
  p.aim.x = lerp(p.aim.x, ax / m, 0.25);
  p.aim.y = lerp(p.aim.y, ay / m, 0.25);
  const dm = sqrt(p.aim.x * p.aim.x + p.aim.y * p.aim.y) || 1;
  p.aim.x /= dm;
  p.aim.y /= dm;

  const open = ft.openRatio > OPEN_RATIO;
  if (open) {
    if (!p.wasOpen && p.charge > 0.15) {
      p.shotDir = { x: p.aim.x, y: p.aim.y }; // freeze last aim
      p.firing = true;
    }
    if (p.firing) {
      p.charge = max(0, p.charge - dt / DRAIN_MS);
      emitFire(p);
      if (p.charge <= 0) p.firing = false;
    }
  } else {
    p.firing = false;
    p.charge = min(1, p.charge + dt / CHARGE_MS);
  }
  p.wasOpen = open;
}

function fireScale(p) {
  return max(3, (p.smoothSize / 220) * 5);
}

function emitFire(p) {
  const ang = atan2(p.shotDir.y, p.shotDir.x) + HALF_PI;
  const px = -p.shotDir.y;
  const py = p.shotDir.x;
  for (let i = 0; i < 2; i++) {
    const spread = random(-1, 1);
    const off = spread * p.smoothSize * 0.12;
    const sp = SHOT_SPEED * random(0.85, 1.15);
    shots.push({
      x: p.mouth.x + px * off,
      y: p.mouth.y + py * off,
      vx: p.shotDir.x * sp + px * spread * 1.2,
      vy: p.shotDir.y * sp + py * spread * 1.2,
      px: fireScale(p) * random(0.7, 1.1),
      angle: ang + random(-0.25, 0.25),
      flick: random(TWO_PI),
      life: 1,
      pidx: players.indexOf(p),
    });
  }
}

// ---------------------------------------------------------------- birds

function updateBirds() {
  for (let i = 0; i < birds.length; i++) {
    const b = birds[i];
    if (b.dead) {
      b.vy += 0.9;
      b.y += b.vy;
      b.x += b.dirX * 0.6;
      b.angle += 0.08 * b.dirX;
      if (b.y - b.h > height) birds[i] = makeBird(false);
      continue;
    }
    b.phase += 0.03;
    b.x += b.dirX * b.speed;
    b.y += sin(b.phase) * b.wob;
    if (b.dirX > 0 && b.x > width + b.w) birds[i] = makeBird(false);
    if (b.dirX < 0 && b.x < -b.w) birds[i] = makeBird(false);
  }
}

function birdTarget(b) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function drawBird(b) {
  push();
  const t = birdTarget(b);
  translate(t.x, t.y);
  if (b.dead) rotate(b.angle);
  if (b.dirX < 0) scale(-1, 1);
  translate(-b.w / 2, -b.h / 2);
  noStroke();
  for (let r = 0; r < SAUSAGE_PX.length; r++) {
    const row = SAUSAGE_PX[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      if (b.dead) {
        fill(ch === 'D' ? 10 : 26, 22, 24); // charred
      } else {
        const col = SAUSAGE_COLS[ch];
        fill(col[0], col[1], col[2]);
      }
      rect(c * b.px, r * b.px, b.px + 0.5, b.px + 0.5);
    }
  }
  pop();

  if (!b.dead) {
    push();
    const pulse = 1 + 0.25 * sin(frameCount * 0.2);
    noFill();
    stroke(255, 230, 80, 220);
    strokeWeight(2);
    circle(t.x, t.y, 16 * pulse);
    line(t.x - 12, t.y, t.x + 12, t.y);
    line(t.x, t.y - 12, t.x, t.y + 12);
    noStroke();
    fill(255, 230, 80);
    circle(t.x, t.y, 5);
    pop();
  }
}

// ---------------------------------------------------------------- shots

function updateShots() {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.x += s.vx;
    s.y += s.vy;
    s.life -= 0.012;
    const off =
      s.x < -120 || s.x > width + 120 || s.y < -120 || s.y > height + 120;
    if (s.life <= 0 || off) {
      shots.splice(i, 1);
      continue;
    }
    for (const b of birds) {
      if (b.dead) continue;
      const t = birdTarget(b);
      if (dist(s.x, s.y, t.x, t.y) < HIT_R + s.px * 2) {
        b.dead = true;
        b.vy = -2;
        if (players[s.pidx]) players[s.pidx].killed++;
        spawnBurst(t.x, t.y);
      }
    }
  }
}

// ---------------------------------------------------------------- fx

function spawnBurst(x, y) {
  for (let i = 0; i < 44; i++) {
    const a = random(TWO_PI);
    const sp = random(2, 9);
    bursts.push({ x, y, vx: cos(a) * sp, vy: sin(a) * sp, life: 1 });
  }
}

function drawBursts() {
  noStroke();
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.x += b.vx;
    b.y += b.vy;
    b.vy += 0.2;
    b.life -= 0.03;
    if (b.life <= 0) {
      bursts.splice(i, 1);
      continue;
    }
    fill(247, 150 + random(80), 40, 235 * b.life);
    circle(b.x, b.y, 7 * b.life + 1);
  }
}

function drawFireSprite(cx, cy, px, angle, flick) {
  const cols = FIRE_PX[0].length;
  const rows = FIRE_PX.length;
  const f = 1 + 0.12 * sin(millis() * 0.02 + flick);
  push();
  translate(cx, cy);
  rotate(angle);
  scale(f, f);
  translate((-cols * px) / 2, (-rows * px) / 2);
  noStroke();
  for (let r = 0; r < rows; r++) {
    const row = FIRE_PX[r];
    for (let c = 0; c < cols; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      const col = FIRE_COLS[ch];
      fill(col[0], col[1], col[2]);
      rect(c * px, r * px, px + 0.6, px + 0.6);
    }
  }
  pop();
}

function drawMuzzleFlame(p) {
  const ang = atan2(p.aim.y, p.aim.x) + HALF_PI;
  const px = fireScale(p) * (0.4 + 0.8 * p.charge);
  drawFireSprite(p.mouth.x, p.mouth.y, px, ang, 0);
}

// ---------------------------------------------------------------- hud

function drawFaceMarker(p) {
  const m = p.palette.marker;
  noFill();
  stroke(m[0], m[1], m[2], 170);
  strokeWeight(2);
  circle(p.mouth.x, p.mouth.y, 12);
}

function drawHUD() {
  textFont('Press Start 2P');
  textSize(11);
  noStroke();
  drawPlayerHint(players[0], LEFT, 16);
  drawPlayerHint(players[1], RIGHT, width - 16);
}

function hintMsg(p) {
  if (!p.seen) return 'NO FACE';
  if (p.firing) return 'BAKAR!!';
  if (p.charge >= 1) return 'OPEN MOUTH';
  return 'CLOSE MOUTH';
}

function drawPlayerHint(p, align, x) {
  const m = p.palette.marker;
  textAlign(align, BOTTOM);
  fill(m[0], m[1], m[2], 220);
  text(`${p.palette.name}: ${hintMsg(p)}`, x, height - 18);

  if (p.seen) {
    const bw = 180;
    const bx = align === LEFT ? x : x - bw;
    fill(m[0], m[1], m[2], 70);
    rect(bx, height - 46, bw, 8, 2);
    fill(m[0], m[1], m[2], 230);
    rect(bx, height - 46, bw * p.charge, 8, 2);
  }
}

function drawScore() {
  textFont('Press Start 2P');
  noStroke();
  drawCount(players[0], LEFT, 18);
  drawCount(players[1], RIGHT, width - 18);
}

function drawCount(p, align, x) {
  const m = p.palette.marker;
  textAlign(align, TOP);
  fill(m[0], m[1], m[2], 210);
  textSize(10);
  text(`${p.palette.name} BAKAR`, x, 16);
  fill(m[0], m[1], m[2]);
  textSize(34);
  text(nf(p.killed, 2), x, 34);
}
