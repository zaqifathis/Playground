// 03 — Kamehameha
// Two-hand energy attack (ml5 handPose), up to two players. Bring both
// palms close together to charge a glowing blob of energy (3 s, small ->
// big). Then open your fingers / pull the hands apart and the ball erupts
// into a Goku-style beam. Beam direction = average palm -> middle-fingertip
// vector of both hands. With four hands in view, hands are paired by
// proximity: left player fires blue, right player fires red.

let handPose;
let video;
let hands = [];

// video cover-fit transform (computed every frame)
let vScale = 1;
let vOffX = 0;
let vOffY = 0;

// ------------------------------------------------------------- tuning
const CHARGE_MS = 3000;      // small -> full ball
const DRAIN_MS = 2600;       // beam life once firing
const CLOSE_RATIO = 1.6;     // palms closer than handSize * this -> charging
const APART_RATIO = 2.4;     // palms further than handSize * this -> fire
const OPEN_SPREAD = 1.45;    // fingertip spread / handSize -> "fingers open"

const PALETTES = [
  { // blue — player 1
    name: 'blue',
    halo: [40, 90, 255],
    ball: [
      { c: [50, 110, 255, 110], s: 1.45, spike: 0.5, freq: 6 },
      { c: [0, 220, 255, 170], s: 1.1, spike: 0.3, freq: 5 },
      { c: [190, 255, 255, 235], s: 0.72, spike: 0.12, freq: 4 },
    ],
    beam: [
      { c: [40, 90, 255, 70], s: 2.0, jag: 0.5 },
      { c: [0, 200, 255, 150], s: 1.15, jag: 0.3 },
      { c: [230, 255, 255, 240], s: 0.45, jag: 0.12 },
    ],
    spark: [120, 230, 255],
    marker: [120, 220, 255],
  },
  { // red — player 2
    name: 'red',
    halo: [255, 60, 30],
    ball: [
      { c: [255, 60, 40, 110], s: 1.45, spike: 0.5, freq: 6 },
      { c: [255, 150, 40, 170], s: 1.1, spike: 0.3, freq: 5 },
      { c: [255, 235, 210, 235], s: 0.72, spike: 0.12, freq: 4 },
    ],
    beam: [
      { c: [255, 50, 30, 70], s: 2.0, jag: 0.5 },
      { c: [255, 130, 40, 150], s: 1.15, jag: 0.3 },
      { c: [255, 245, 230, 240], s: 0.45, jag: 0.12 },
    ],
    spark: [255, 160, 110],
    marker: [255, 140, 110],
  },
];

// ------------------------------------------------------------- players
// mode: 'idle' | 'charging' | 'firing'
function makePlayer(palette) {
  return {
    palette,
    mode: 'idle',
    charge: 0,
    ball: { x: 0, y: 0 },
    dir: { x: 0, y: -1 },
    smoothSize: 120,
    particles: [],
    seen: false, // pose available this frame
  };
}

let players = [];

function preload() {
  handPose = ml5.handPose({ flipped: true, maxHands: 4 });
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  video = createCapture(VIDEO, { flipped: true });
  video.size(640, 480);
  video.hide();
  handPose.detectStart(video, (r) => (hands = r));
  players = PALETTES.map((p) => makePlayer(p));
  for (const pl of players) pl.ball = { x: width / 2, y: height / 2 };
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// ---------------------------------------------------------------- draw

function draw() {
  background('#04060f');
  drawVideoBackground();

  const poses = readPoses(); // 0..2 two-hand poses, sorted left -> right
  assignPoses(poses);

  // screen shake while any beam fires
  push();
  const shake = players.reduce(
    (a, p) => (p.mode === 'firing' ? max(a, p.charge) : a),
    0
  );
  if (shake > 0) {
    const k = 6 * shake;
    translate(random(-k, k), random(-k, k));
  }

  blendMode(ADD);
  for (const p of players) {
    if (p.mode === 'charging') {
      drawChargeParticles(p);
      drawEnergyBall(p, ballRadius(p), p.charge);
    } else if (p.mode === 'firing') {
      drawBeam(p);
      drawEnergyBall(p, ballRadius(p) * (1 + 0.35 * p.charge), 1);
    }
  }
  blendMode(BLEND);
  pop();

  for (const p of players) if (p.pose) drawHandMarkers(p);
  drawHUD();
}

// Cover-fit: fill the canvas, crop the overflow — no stretching.
function drawVideoBackground() {
  vScale = max(width / video.width, height / video.height);
  vOffX = (width - video.width * vScale) / 2;
  vOffY = (height - video.height * vScale) / 2;
  image(video, vOffX, vOffY, video.width * vScale, video.height * vScale);
}

// ---------------------------------------------------------------- hands

// Per-hand features in screen space.
function handFeatures(hand) {
  const kp = hand.keypoints.map((k) => ({
    x: vOffX + k.x * vScale,
    y: vOffY + k.y * vScale,
  }));
  // palm center: wrist + the four finger knuckles
  const ids = [0, 5, 9, 13, 17];
  const palm = ids.reduce(
    (a, i) => ({ x: a.x + kp[i].x / ids.length, y: a.y + kp[i].y / ids.length }),
    { x: 0, y: 0 }
  );
  const size = dist(kp[0].x, kp[0].y, kp[9].x, kp[9].y);
  // fingertip spread: how open the hand is
  const tips = [8, 12, 16, 20];
  const spread =
    tips.reduce((a, i) => a + dist(palm.x, palm.y, kp[i].x, kp[i].y), 0) /
    tips.length / max(size, 1);
  // aim: palm -> middle fingertip
  const aim = { x: kp[12].x - palm.x, y: kp[12].y - palm.y };
  return { palm, size, spread, aim, middleTip: kp[12] };
}

// Combine two hands into one pose.
function makePose(a, b) {
  const size = (a.size + b.size) / 2;
  const palmDist = dist(a.palm.x, a.palm.y, b.palm.x, b.palm.y);
  const spread = min(a.spread, b.spread);

  // average aim of both hands, normalized
  const ax = a.aim.x + b.aim.x;
  const ay = a.aim.y + b.aim.y;
  const m = sqrt(ax * ax + ay * ay);
  const aim = m > 1 ? { x: ax / m, y: ay / m } : null;

  return { a, b, size, palmDist, spread, aim };
}

// Pair detected hands into up to two two-hand poses.
// 2 hands -> one pose. 3 hands -> closest pair (third ignored).
// 4 hands -> closest pair + remaining pair. Sorted left -> right by midpoint.
function readPoses() {
  const hs = hands.map(handFeatures);
  if (hs.length < 2) return [];

  const poses = [];
  if (hs.length === 2) {
    poses.push(makePose(hs[0], hs[1]));
  } else {
    // pick the globally closest pair first
    let best = null;
    for (let i = 0; i < hs.length; i++) {
      for (let j = i + 1; j < hs.length; j++) {
        const d = dist(hs[i].palm.x, hs[i].palm.y, hs[j].palm.x, hs[j].palm.y);
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    poses.push(makePose(hs[best.i], hs[best.j]));
    const rest = hs.filter((_, k) => k !== best.i && k !== best.j);
    if (rest.length === 2) poses.push(makePose(rest[0], rest[1]));
  }

  poses.sort(
    (p, q) => (p.a.palm.x + p.b.palm.x) - (q.a.palm.x + q.b.palm.x)
  );
  return poses;
}

// Match poses to players so colors don't swap mid-game: a player keeps
// the pose nearest to its current ball; leftover pose goes to a free player.
function assignPoses(poses) {
  for (const p of players) {
    p.pose = null;
    p.seen = false;
  }

  const free = [...poses];
  // active players grab their nearest pose first
  const byActivity = [...players].sort((a, b) => b.charge - a.charge);
  for (const pl of byActivity) {
    if (!free.length) break;
    if (pl.mode === 'idle' && pl.charge === 0) continue;
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < free.length; i++) {
      const mid = poseMid(free[i]);
      const d = dist(mid.x, mid.y, pl.ball.x, pl.ball.y);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    pl.pose = free.splice(bi, 1)[0];
  }
  // remaining poses -> idle players, left to right
  for (const pose of free) {
    const pl = players.find((p) => !p.pose && p.mode === 'idle' && p.charge === 0);
    if (pl) pl.pose = pose;
  }

  for (const p of players) updatePlayer(p, p.pose);
}

function poseMid(pose) {
  return {
    x: (pose.a.palm.x + pose.b.palm.x) / 2,
    y: (pose.a.palm.y + pose.b.palm.y) / 2,
  };
}

function updatePlayer(p, pose) {
  const dt = deltaTime;

  if (!pose) {
    // lost hands: ball/beam fizzles out
    p.charge = max(0, p.charge - dt / 800);
    if (p.charge === 0) p.mode = 'idle';
    return;
  }
  p.seen = true;

  p.smoothSize = lerp(p.smoothSize, pose.size, 0.15);
  const mid = poseMid(pose);
  p.ball.x = lerp(p.ball.x, mid.x, 0.25);
  p.ball.y = lerp(p.ball.y, mid.y, 0.25);
  if (pose.aim) {
    p.dir.x = lerp(p.dir.x, pose.aim.x, 0.2);
    p.dir.y = lerp(p.dir.y, pose.aim.y, 0.2);
    const m = sqrt(p.dir.x * p.dir.x + p.dir.y * p.dir.y);
    if (m > 0.001) {
      p.dir.x /= m;
      p.dir.y /= m;
    }
  }

  const close = pose.palmDist < p.smoothSize * CLOSE_RATIO;
  const apart = pose.palmDist > p.smoothSize * APART_RATIO;
  const open = pose.spread > OPEN_SPREAD;

  if (p.mode === 'idle') {
    if (close) {
      p.mode = 'charging';
      p.charge = 0;
    }
  } else if (p.mode === 'charging') {
    p.charge = min(1, p.charge + dt / CHARGE_MS);
    if (p.charge > 0.2 && (apart || open)) {
      p.mode = 'firing';
    } else if (!close && pose.palmDist > p.smoothSize * (CLOSE_RATIO + 0.4)) {
      // drifted apart before any real charge built up
      if (p.charge <= 0.2) p.mode = 'idle';
    }
  } else if (p.mode === 'firing') {
    p.charge -= dt / DRAIN_MS;
    if (close) {
      // hands cupped again -> back to charging what's left
      p.mode = 'charging';
      p.charge = max(p.charge, 0.05);
    } else if (p.charge <= 0) {
      p.charge = 0;
      p.mode = 'idle';
    }
  }
}

function ballRadius(p) {
  return p.smoothSize * (0.25 + 1.05 * p.charge);
}

// ---------------------------------------------------------------- energy

function layerColor(rgba, power) {
  return color(rgba[0], rgba[1], rgba[2], rgba[3] * power);
}

// Spiky glowing blob: layered noise-wobbled shapes, dark -> bright -> core.
function drawEnergyBall(p, r, power) {
  const { x, y } = p.ball;
  const t = millis() * 0.004;
  const pal = p.palette;
  noStroke();

  // soft halo
  for (let i = 5; i >= 1; i--) {
    fill(pal.halo[0], pal.halo[1], pal.halo[2], 9 * power);
    circle(x, y, r * (2.2 + i * 0.55));
  }

  for (const L of pal.ball) {
    fill(layerColor(L.c, power));
    beginShape();
    const n = 64;
    for (let i = 0; i < n; i++) {
      const a = (TWO_PI * i) / n;
      // low-freq wobble + high-freq flame spikes
      const w = noise(cos(a) * 1.3 + 9, sin(a) * 1.3 + 9, t) - 0.5;
      const sp = noise(cos(a) * L.freq + 30, sin(a) * L.freq + 30, t * 2.4);
      const rad = r * L.s * (1 + 0.18 * w + L.spike * pow(sp, 3));
      vertex(x + cos(a) * rad, y + sin(a) * rad);
    }
    endShape(CLOSE);
  }
}

// Layered jagged beam from the player's ball along its aim direction.
function drawBeam(p) {
  const { x, y } = p.ball;
  const d = p.dir;
  const power = p.charge;
  const len = width + height; // always overshoots the screen
  const t = millis() * 0.003;
  const px = -d.y; // perpendicular
  const py = d.x;
  const w = ballRadius(p) * 0.9;

  noStroke();
  for (const L of p.palette.beam) {
    fill(layerColor(L.c, power));
    const steps = 26;
    const top = [];
    const bot = [];
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const cx = x + d.x * len * f;
      const cy = y + d.y * len * f;
      // jagged flame edge scrolling away from the ball
      const e1 = noise(f * 14 - t * 6, 3.7) - 0.5;
      const e2 = noise(f * 14 - t * 6, 8.1) - 0.5;
      const half = w * L.s * (0.85 + 0.3 * sin(f * 40 - t * 14) * L.jag);
      top.push({ x: cx + px * half * (1 + e1 * L.jag * 2), y: cy + py * half * (1 + e1 * L.jag * 2) });
      bot.push({ x: cx - px * half * (1 + e2 * L.jag * 2), y: cy - py * half * (1 + e2 * L.jag * 2) });
    }
    beginShape();
    for (const q of top) vertex(q.x, q.y);
    for (let i = bot.length - 1; i >= 0; i--) vertex(bot[i].x, bot[i].y);
    endShape(CLOSE);
  }
}

// Sparks getting sucked into the ball while charging.
function drawChargeParticles(p) {
  if (random() < 0.5 + p.charge) {
    const a = random(TWO_PI);
    const d = ballRadius(p) * random(2.5, 4.5);
    p.particles.push({
      x: p.ball.x + cos(a) * d,
      y: p.ball.y + sin(a) * d,
      life: 1,
    });
  }
  noStroke();
  const s = p.palette.spark;
  for (let i = p.particles.length - 1; i >= 0; i--) {
    const q = p.particles[i];
    q.x = lerp(q.x, p.ball.x, 0.12);
    q.y = lerp(q.y, p.ball.y, 0.12);
    q.life -= 0.025;
    if (q.life <= 0 || dist(q.x, q.y, p.ball.x, p.ball.y) < ballRadius(p) * 0.5) {
      p.particles.splice(i, 1);
      continue;
    }
    fill(s[0], s[1], s[2], 200 * q.life);
    circle(q.x, q.y, 5 * q.life + 1);
  }
}

// ---------------------------------------------------------------- hud

function drawHandMarkers(p) {
  const m = p.palette.marker;
  noFill();
  stroke(m[0], m[1], m[2], 130);
  strokeWeight(2);
  for (const h of [p.pose.a, p.pose.b]) {
    circle(h.palm.x, h.palm.y, 14);
    line(h.palm.x, h.palm.y, h.middleTip.x, h.middleTip.y);
  }
}

function drawHUD() {
  textSize(13);
  textAlign(LEFT, BOTTOM);

  let y = height - 14;
  for (const p of players) {
    if (!p.seen && p.mode === 'idle') continue;
    const m = p.palette.marker;
    const msg =
      p.mode === 'charging'
        ? `charging… ${floor(p.charge * 100)}%  — open hands to FIRE`
        : p.mode === 'firing'
          ? 'KAMEHAMEHA!!'
          : 'bring both palms close together to charge';

    noStroke();
    fill(m[0], m[1], m[2], 200);
    text(`${p.palette.name}: ${msg}`, 14, y);

    if (p.mode !== 'idle') {
      fill(m[0], m[1], m[2], 60);
      rect(14, y - 30, 160, 6, 3);
      fill(m[0], m[1], m[2], 220);
      rect(14, y - 30, 160 * p.charge, 6, 3);
    }
    y -= 48;
  }

  if (players.every((p) => !p.seen && p.mode === 'idle')) {
    noStroke();
    fill(200, 230, 255, 160);
    text('bring both palms close together to charge — 2 players supported', 14, height - 14);
  }
}
