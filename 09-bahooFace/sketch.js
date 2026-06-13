// 09 — bahooFace
// A Bauhaus-style "Bahoo" face: a colored square with a decorated border
// (plain / dots / scallop / zigzag), blue cloud eyebrows, white eyes with
// blue pupils, red cheeks, a blue nose line and a blue mouth.
//
// The whole square mirrors your head (ml5 faceMesh / MediaPipe). The live
// features track you: pupils slide to your eyeballs, eyebrows rise and fall
// with your real brows, and the mouth reshapes between happy / normal / sad
// from your expression. A pinch (thumb + index, ml5 handPose) rerolls the
// character's colors and border style. Dot helpers show the pinch.

let faceMesh;
let handPose;
let video;
let faces = [];
let hands = [];

// smoothed face state
let fx = 0;
let fy = 0;
let fScale = 1;
let gazeX = 0;   // -1..1 pupil offset
let gazeY = 0;
let browRaise = 0; // 0 rest, 1 raised
let smile = 0;     // -1 sad .. 0 normal .. 1 happy
let mouthOpen = 0; // 0..1

// video cover-fit transform (computed every frame)
let vScale = 1;
let vOffX = 0;
let vOffY = 0;

// pinch tap state
let pinching = false;
let pinchStartFrame = 0;

const PINCH_RATIO = 0.18;
const TAP_FRAMES = 20;
const GAZE_GAIN = 5;

// FaceMesh landmark indices (MediaPipe topology, 478 pts with iris)
const L_IRIS = [468, 469, 470, 471, 472];
const R_IRIS = [473, 474, 475, 476, 477];
const L_EYE_OUT = 33, L_EYE_IN = 133, L_EYE_TOP = 159, L_EYE_BOT = 145;
const R_EYE_IN = 362, R_EYE_OUT = 263, R_EYE_TOP = 386, R_EYE_BOT = 374;
const L_BROW = 105, R_BROW = 334;
const MOUTH_L = 61, MOUTH_R = 291, LIP_TOP = 13, LIP_BOT = 14;
const CHEEK_L = 234, CHEEK_R = 454, FACE_TOP = 10, CHIN = 152;

// palette sampled from the reference sheet
const BG = ['#1d8a4e', '#e8442e', '#e08a7d', '#e8612a', '#2aa3c2', '#1d8a4e'];
const ACCENT = ['#c0392b', '#5fb6c8', '#e08a7d', '#1d8a4e', '#e8442e'];
const SKIN = ['#f3e8cf', '#7fc3d6', '#e08a7d', '#e8612a'];
const FEATURE = '#27409e';   // blue ink for brows, eyes, nose, mouth
const CHEEK = ['#e8442e', '#e8612a'];

const BORDER_NONE = 0, BORDER_DOTS = 1, BORDER_SCALLOP = 2, BORDER_ZIGZAG = 3;

let char = null;

function preload() {
  faceMesh = ml5.faceMesh({ maxFaces: 1, refineLandmarks: true, flipped: true });
  handPose = ml5.handPose({ flipped: true, maxHands: 1 });
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  video = createCapture(VIDEO, { flipped: true });
  video.size(640, 480);
  video.hide();
  faceMesh.detectStart(video, (r) => (faces = r));
  handPose.detectStart(video, (r) => (hands = r));

  fx = width / 2;
  fy = height / 2;
  fScale = baseScale();
  reroll();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function baseScale() {
  return min(width, height) / 900;
}

function reroll() {
  const pick = (a) => a[floor(random(a.length))];
  const border = floor(random(4));
  char = {
    bg: pick(BG),
    accent: pick(ACCENT),
    cheek: pick(CHEEK),
    border,
    // dotted / zigzag frames eat into the square, so shrink the face inside
    inner: border === BORDER_DOTS ? 0.62 : border === BORDER_ZIGZAG ? 0.74 : 0.9,
    // scallop & zigzag get an inner skin patch; plain/dots sit on the bg
    skin: border === BORDER_SCALLOP || border === BORDER_ZIGZAG ? pick(SKIN) : null,
  };
}

// ---------------------------------------------------------------- draw

function draw() {
  background('#f3efe7');
  drawVideoBackground();

  // face target: idle = centered, resting expression
  let tx = width / 2, ty = height / 2, ts = baseScale();
  let tGazeX = 0, tGazeY = 0, tBrow = 0, tSmile = 0, tOpen = 0;

  const face = faces[0];
  if (face && face.box && face.keypoints && face.keypoints.length >= 478) {
    const kp = face.keypoints;
    tx = vOffX + (face.box.xMin + face.box.width / 2) * vScale;
    ty = vOffY + (face.box.yMin + face.box.height / 2) * vScale;
    ts = constrain((face.box.height * vScale) / 300, baseScale() * 0.4, baseScale() * 2.5);

    const m = measure(kp);
    tGazeX = m.gx; tGazeY = m.gy; tBrow = m.brow; tSmile = m.smile; tOpen = m.open;
  }

  fx = lerp(fx, tx, 0.12);
  fy = lerp(fy, ty, 0.12);
  fScale = lerp(fScale, ts, 0.1);
  gazeX = lerp(gazeX, tGazeX, 0.35);
  gazeY = lerp(gazeY, tGazeY, 0.35);
  browRaise = lerp(browRaise, tBrow, 0.25);
  smile = lerp(smile, tSmile, 0.2);
  mouthOpen = lerp(mouthOpen, tOpen, 0.3);

  const S = 560 * fScale;
  drawBahoo(fx, fy, S);

  handleHand();
  drawHUD();
}

// Cover-fit: fill the canvas, crop the overflow — no stretching.
function drawVideoBackground() {
  vScale = max(width / video.width, height / video.height);
  vOffX = (width - video.width * vScale) / 2;
  vOffY = (height - video.height * vScale) / 2;
  image(video, vOffX, vOffY, video.width * vScale, video.height * vScale);
}

// ---------------------------------------------------------------- measure

function avgPoint(kp, idx) {
  let x = 0, y = 0;
  for (const i of idx) { x += kp[i].x / idx.length; y += kp[i].y / idx.length; }
  return { x, y };
}

function normBetween(v, a, b) {
  return (v - a) / (b - a || 1);
}

// Read gaze, brow-raise and smile from one face's landmarks.
function measure(kp) {
  const faceH = dist(kp[FACE_TOP].x, kp[FACE_TOP].y, kp[CHIN].x, kp[CHIN].y) || 1;

  // gaze: iris center relative to eye corners / lids, both eyes averaged
  const li = avgPoint(kp, L_IRIS), ri = avgPoint(kp, R_IRIS);
  const lx = normBetween(li.x, kp[L_EYE_OUT].x, kp[L_EYE_IN].x);
  const rx = normBetween(ri.x, kp[R_EYE_IN].x, kp[R_EYE_OUT].x);
  const ly = normBetween(li.y, kp[L_EYE_TOP].y, kp[L_EYE_BOT].y);
  const ry = normBetween(ri.y, kp[R_EYE_TOP].y, kp[R_EYE_BOT].y);
  const gx = constrain((((lx - 0.5) + (rx - 0.5)) / 2) * -GAZE_GAIN, -1, 1);
  const gy = constrain((((ly - 0.5) + (ry - 0.5)) / 2) * GAZE_GAIN * 0.8, -1, 1);

  // brow raise: gap from brow to eye top, normalized; ~0.07 rest, grows raised
  const bGap = ((kp[L_EYE_TOP].y - kp[L_BROW].y) + (kp[R_EYE_TOP].y - kp[R_BROW].y)) / 2;
  const brow = constrain(map(bGap / faceH, 0.06, 0.12, 0, 1), 0, 1);

  // smile: mouth corners above the lip-center line => happy, below => sad
  const lipMidY = (kp[LIP_TOP].y + kp[LIP_BOT].y) / 2;
  const cornerY = (kp[MOUTH_L].y + kp[MOUTH_R].y) / 2;
  const sm = constrain(((lipMidY - cornerY) / faceH) * 14, -1, 1);

  const open = constrain((dist(kp[LIP_TOP].x, kp[LIP_TOP].y, kp[LIP_BOT].x, kp[LIP_BOT].y) / faceH) * 6, 0, 1);

  return { gx, gy, brow, smile: sm, open };
}

// ---------------------------------------------------------------- character

function drawBahoo(x, y, S) {
  push();
  translate(x, y);
  rectMode(CENTER);
  noStroke();

  // square base (features unchanged)
  const D = S * 0.95;
  fill(char.bg);
  rect(0, 0, D, D);
  drawBorder(D);

  // optional inner skin patch (scallop blob / zigzag square)
  if (char.skin) {
    fill(char.skin);
    if (char.border === BORDER_SCALLOP) scallopBlob(D * 0.78);
    else rect(0, 0, D * 0.82, D * 0.82);
  }

  const I = S * char.inner; // feature cluster reference size
  const ex = I * 0.17;      // eye spacing from center
  const ey = -I * 0.08;

  drawCheeks(I, ex, ey);
  drawBrows(I, ex, ey);
  drawEyes(I, ex, ey);
  drawNose(I, ey);
  drawMouth(I);
  pop();
}

// decorate the square base edge (side D)
function drawBorder(D) {
  if (char.border === BORDER_NONE) return;
  fill(char.accent);
  const h = D / 2;

  if (char.border === BORDER_DOTS) {
    const n = 9;
    const d = D / n;
    for (let i = 0; i < n; i++) {
      const t = -h + d / 2 + i * d;
      circle(t, -h + d / 2, d * 0.92); // top
      circle(t, h - d / 2, d * 0.92);  // bottom
      circle(-h + d / 2, t, d * 0.92); // left
      circle(h - d / 2, t, d * 0.92);  // right
    }
  } else if (char.border === BORDER_SCALLOP) {
    // ring of half-circle bumps just inside each edge
    const n = 8;
    const d = D / n;
    const r = d * 0.55;
    for (let i = 0; i < n; i++) {
      const t = -h + d / 2 + i * d;
      semi(t, -h, r, 0);          // top, opening down
      semi(t, h, r, PI);          // bottom
      semi(-h, t, r, -HALF_PI);   // left
      semi(h, t, r, HALF_PI);     // right
    }
  } else if (char.border === BORDER_ZIGZAG) {
    const n = 7;
    const d = D / n;
    const k = d * 0.72; // tooth depth
    edgeTeeth(n, d, h, k, 0);
    edgeTeeth(n, d, h, k, PI);
    edgeTeeth(n, d, h, k, -HALF_PI);
    edgeTeeth(n, d, h, k, HALF_PI);
  }
}

// triangle teeth biting inward along one edge, rotated to the chosen side
function edgeTeeth(n, d, h, k, rot) {
  push();
  rotate(rot);
  beginShape();
  for (let i = 0; i <= n; i++) {
    const xx = -h + i * d;
    vertex(xx, -h);
    if (i < n) vertex(xx + d / 2, -h + k);
  }
  vertex(h, -h);
  endShape(CLOSE);
  pop();
}

// scalloped square (rounded bumpy edge) centered at origin
function scallopBlob(size) {
  const n = 7;
  const r = size / 2;
  const bump = r / n;
  beginShape();
  for (let i = 0; i < n * 4 + 3; i++) {
    const a = (TWO_PI * (i % (n * 4))) / (n * 4);
    curveVertex(cos(a) * r, sin(a) * r);
  }
  endShape();
  // overlay bumps as circles around the perimeter for a true scallop look
  for (let i = 0; i < n * 4; i++) {
    const a = (TWO_PI * i) / (n * 4);
    circle(cos(a) * r, sin(a) * r, bump * 2.1);
  }
}

// half disc at (cx,cy), flat side rotated by `rot` (0 = flat on top)
function semi(cx, cy, r, rot) {
  push();
  translate(cx, cy);
  rotate(rot);
  arc(0, 0, r * 2, r * 2, 0, PI);
  pop();
}

function drawCheeks(I, ex, ey) {
  noStroke();
  fill(char.cheek);
  const cy = ey + I * 0.12;
  circle(-ex * 1.15, cy, I * 0.2);
  circle(ex * 1.15, cy, I * 0.2);
}

function drawBrows(I, ex, ey) {
  noStroke();
  fill(FEATURE);
  // brows rise with the real brows; cloud = three overlapping discs
  const by = ey - I * 0.14 - browRaise * I * 0.06;
  cloud(-ex, by, I * 0.13);
  cloud(ex, by, I * 0.13);
}

// a small bumpy cloud (three circles) centered at (cx,cy)
function cloud(cx, cy, w) {
  circle(cx - w * 0.55, cy + w * 0.1, w * 0.8);
  circle(cx, cy - w * 0.15, w);
  circle(cx + w * 0.55, cy + w * 0.1, w * 0.8);
  rectMode(CENTER);
  rect(cx, cy + w * 0.25, w * 1.4, w * 0.5, w * 0.25);
}

function drawEyes(I, ex, ey) {
  noStroke();
  const r = I * 0.14;
  // white
  fill(255);
  circle(-ex, ey, r);
  circle(ex, ey, r);
  // blue pupil slides with gaze
  fill(FEATURE);
  const px = gazeX * r * 0.22;
  const py = gazeY * r * 0.22;
  circle(-ex + px, ey + py, r * 0.5);
  circle(ex + px, ey + py, r * 0.5);
}

function drawNose(I, ey) {
  noStroke();
  fill(FEATURE);
  rectMode(CENTER);
  const top = ey + I * 0.02;
  const len = I * 0.18;
  rect(0, top + len / 2, I * 0.022, len, I * 0.011); // shaft
  rect(0, top + len, I * 0.07, I * 0.05, I * 0.02);  // little foot
}

function drawMouth(I) {
  noStroke();
  fill(FEATURE);
  const my = I * 0.3;

  if (mouthOpen > 0.4) {
    // open mouth: blue rounded rect, taller the more it's open
    rectMode(CENTER);
    rect(0, my, I * 0.13, I * (0.05 + mouthOpen * 0.12), I * 0.04);
    return;
  }

  const w = I * 0.16;
  const th = I * 0.05; // stroke thickness drawn as a filled curve band
  if (smile > 0.25) {
    happyArc(0, my - I * 0.01, w, I * 0.13, th); // smile up
  } else if (smile < -0.25) {
    happyArc(0, my + I * 0.06, w, I * 0.13, th, true); // frown down
  } else {
    rectMode(CENTER);
    rect(0, my, w * 0.9, th, th / 2); // flat
  }
}

// a thick filled arc (smile or, when flip, frown)
function happyArc(cx, cy, w, h, th, flip) {
  push();
  translate(cx, cy);
  if (flip) scale(1, -1);
  noFill();
  stroke(FEATURE);
  strokeWeight(th);
  strokeCap(ROUND);
  arc(0, 0, w, h, 0.12 * PI, 0.88 * PI);
  pop();
}

// ---------------------------------------------------------------- hand

function handleHand() {
  const hand = hands[0];
  if (!hand) { pinching = false; return; }

  const kp = hand.keypoints.map((k) => ({
    x: vOffX + k.x * vScale,
    y: vOffY + k.y * vScale,
  }));
  const handSize = dist(kp[0].x, kp[0].y, kp[9].x, kp[9].y);
  const thumbTip = kp[4];
  const indexTip = kp[8];
  const isPinching =
    dist(thumbTip.x, thumbTip.y, indexTip.x, indexTip.y) < handSize * PINCH_RATIO;

  if (isPinching && !pinching) {
    pinching = true;
    pinchStartFrame = frameCount;
  } else if (!isPinching && pinching) {
    pinching = false;
    if (frameCount - pinchStartFrame <= TAP_FRAMES) reroll();
  }

  // dot helpers
  stroke(isPinching ? color(39, 64, 158) : color(0, 70));
  strokeWeight(2);
  line(thumbTip.x, thumbTip.y, indexTip.x, indexTip.y);
  noStroke();
  fill(isPinching ? color(39, 64, 158) : color(0, 150));
  circle(thumbTip.x, thumbTip.y, 10);
  circle(indexTip.x, indexTip.y, 10);
}

function drawHUD() {
  noStroke();
  fill(0, 110);
  textAlign(LEFT, BOTTOM);
  textSize(13);
  text('pinch + release: new bahoo face  ·  smile / frown / open your mouth', 14, height - 14);
}
