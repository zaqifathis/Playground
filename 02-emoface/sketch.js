// 02 — emoFace
// A playful character built from three random layers: body shape, eyes,
// mouth. The character mirrors your head (ml5 faceMesh) and a quick
// pinch (thumb + index tap, ml5 handPose) rerolls all three layers.

let faceMesh;
let handPose;
let video;
let faces = [];
let hands = [];

// smoothed face state
let fx = 0;
let fy = 0;
let fScale = 1;

// pinch tap state
let pinching = false;
let pinchStartFrame = 0;

const PINCH_RATIO = 0.18; // thumb-index distance / hand size
const TAP_FRAMES = 20;    // max pinch length that counts as a tap

const PALETTE = [
  '#FFD233', // yellow
  '#169F4E', // green
  '#F7A0CD', // pink
  '#2747D4', // blue
  '#F04A38', // red
  '#5BA8E8', // sky blue
  '#9B59D0', // purple
  '#F47C20', // orange
];

// current combo
let current = {
  shape: 0,
  eyes: 0,
  mouth: 0,
  color: '#FFD233',
  blob: [],   // per-vertex radius wobble for blobby shapes
  look: { x: 0, y: 0 }, // pupil direction
};

const SHAPE_COUNT = 6;
const EYE_COUNT = 5;
const MOUTH_COUNT = 6;

function preload() {
  faceMesh = ml5.faceMesh({ maxFaces: 1, refineLandmarks: false, flipped: true });
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
  randomizeAll();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function baseScale() {
  return min(width, height) / 900;
}

function randomizeAll() {
  current.shape = floor(random(SHAPE_COUNT));
  current.eyes = floor(random(EYE_COUNT));
  current.mouth = floor(random(MOUTH_COUNT));
  current.color = random(PALETTE);
  current.blob = Array.from({ length: 14 }, () => random(0.82, 1.18));
  current.look = { x: random(-1, 1), y: random(-0.6, 0.6) };
}

// ---------------------------------------------------------------- draw

function draw() {
  background('#f3efe7');

  // face target: idle = centered
  let tx = width / 2;
  let ty = height / 2;
  let ts = baseScale();

  const face = faces[0];
  if (face && face.box) {
    const sx = width / video.width;
    const sy = height / video.height;
    tx = (face.box.xMin + face.box.width / 2) * sx;
    ty = (face.box.yMin + face.box.height / 2) * sy;
    ts = constrain((face.box.height * sy) / 300, baseScale() * 0.4, baseScale() * 2.5);
  }

  fx = lerp(fx, tx, 0.12);
  fy = lerp(fy, ty, 0.12);
  fScale = lerp(fScale, ts, 0.1);

  const S = 560 * fScale; // character size
  drawShape(current.shape, fx, fy, S, current.color);
  drawEyes(current.eyes, fx, fy, S);
  drawMouth(current.mouth, fx, fy, S);

  handleHand();
  drawHUD();
}

// ---------------------------------------------------------------- shapes

function drawShape(idx, x, y, S, col) {
  push();
  translate(x, y);
  noStroke();
  fill(col);

  if (idx === 0) {
    // blob: wobbly circle
    beginShape();
    const n = current.blob.length;
    for (let i = 0; i < n + 3; i++) {
      const a = (TWO_PI * i) / n;
      const r = (S / 2) * current.blob[i % n];
      curveVertex(cos(a) * r, sin(a) * r);
    }
    endShape(CLOSE);
  } else if (idx === 1) {
    // clover: lobes around a center
    const lobes = 4;
    for (let i = 0; i < lobes; i++) {
      const a = (TWO_PI * i) / lobes + PI / lobes;
      circle(cos(a) * S * 0.22, sin(a) * S * 0.22, S * 0.52);
    }
    circle(0, 0, S * 0.55);
  } else if (idx === 2) {
    // soft star / flower
    beginShape();
    const points = 8;
    for (let i = 0; i < points * 2 + 3; i++) {
      const a = (PI * i) / points;
      const r = (S / 2) * (i % 2 === 0 ? 1 : 0.62);
      curveVertex(cos(a) * r, sin(a) * r);
    }
    endShape(CLOSE);
  } else if (idx === 3) {
    // squircle
    rectMode(CENTER);
    rect(0, 0, S * 0.92, S * 0.88, S * 0.24);
  } else if (idx === 4) {
    // arch / ghost: round top, flat bottom
    rectMode(CENTER);
    rect(0, S * 0.02, S * 0.84, S * 0.9, S * 0.42, S * 0.42, S * 0.06, S * 0.06);
  } else {
    // wavy stack: three overlapping horizontal pills
    rectMode(CENTER);
    rect(0, -S * 0.26, S * 0.78, S * 0.34, S * 0.17);
    rect(0, 0, S * 0.94, S * 0.36, S * 0.18);
    rect(0, S * 0.26, S * 0.72, S * 0.34, S * 0.17);
  }
  pop();
}

// ---------------------------------------------------------------- eyes

function drawEyes(idx, x, y, S) {
  const ex = S * 0.16; // eye offset from center
  const ey = -S * 0.1;
  const L = { x: x - ex, y: y + ey };
  const R = { x: x + ex, y: y + ey };

  push();
  if (idx === 0) {
    // plain dots
    noStroke();
    fill(0);
    circle(L.x, L.y, S * 0.09);
    circle(R.x, R.y, S * 0.09);
  } else if (idx === 1) {
    // googly: white + pupil looking somewhere
    noStroke();
    fill(255);
    circle(L.x, L.y, S * 0.17);
    circle(R.x, R.y, S * 0.17);
    fill(0);
    const px = current.look.x * S * 0.035;
    const py = current.look.y * S * 0.035;
    circle(L.x + px, L.y + py, S * 0.08);
    circle(R.x + px, R.y + py, S * 0.08);
  } else if (idx === 2) {
    // sleepy: closed happy arcs
    noFill();
    stroke(0);
    strokeWeight(S * 0.022);
    strokeCap(ROUND);
    arc(L.x, L.y, S * 0.13, S * 0.1, 0, PI);
    arc(R.x, R.y, S * 0.13, S * 0.1, 0, PI);
  } else if (idx === 3) {
    // bored: half-lid eyes looking down
    noStroke();
    fill(255);
    arc(L.x, L.y, S * 0.16, S * 0.16, 0, PI, CHORD);
    arc(R.x, R.y, S * 0.16, S * 0.16, 0, PI, CHORD);
    fill(0);
    circle(L.x, L.y + S * 0.03, S * 0.07);
    circle(R.x, R.y + S * 0.03, S * 0.07);
    stroke(0);
    strokeWeight(S * 0.018);
    line(L.x - S * 0.08, L.y, L.x + S * 0.08, L.y);
    line(R.x - S * 0.08, R.y, R.x + S * 0.08, R.y);
  } else {
    // stressed: >< angles
    noFill();
    stroke(0);
    strokeWeight(S * 0.022);
    strokeCap(ROUND);
    line(L.x - S * 0.05, L.y - S * 0.04, L.x + S * 0.05, L.y);
    line(L.x - S * 0.05, L.y + S * 0.04, L.x + S * 0.05, L.y);
    line(R.x + S * 0.05, R.y - S * 0.04, R.x - S * 0.05, R.y);
    line(R.x + S * 0.05, R.y + S * 0.04, R.x - S * 0.05, R.y);
  }
  pop();
}

// ---------------------------------------------------------------- mouths

function drawMouth(idx, x, y, S) {
  const my = y + S * 0.16;

  push();
  if (idx === 0) {
    // smile
    noFill();
    stroke(0);
    strokeWeight(S * 0.022);
    strokeCap(ROUND);
    arc(x, my - S * 0.02, S * 0.22, S * 0.16, 0.15 * PI, 0.85 * PI);
  } else if (idx === 1) {
    // surprised O
    noStroke();
    fill(0);
    ellipse(x, my, S * 0.1, S * 0.12);
  } else if (idx === 2) {
    // flat
    stroke(0);
    strokeWeight(S * 0.022);
    strokeCap(ROUND);
    line(x - S * 0.09, my, x + S * 0.09, my);
  } else if (idx === 3) {
    // stressed zigzag
    noFill();
    stroke(0);
    strokeWeight(S * 0.02);
    strokeJoin(ROUND);
    beginShape();
    for (let i = 0; i <= 6; i++) {
      vertex(x - S * 0.1 + (S * 0.2 * i) / 6, my + (i % 2 === 0 ? -1 : 1) * S * 0.018);
    }
    endShape();
  } else if (idx === 4) {
    // open smile: filled half circle
    noStroke();
    fill(0);
    arc(x, my - S * 0.015, S * 0.22, S * 0.2, 0, PI, CHORD);
  } else {
    // tiny frown
    noFill();
    stroke(0);
    strokeWeight(S * 0.022);
    strokeCap(ROUND);
    arc(x, my + S * 0.04, S * 0.14, S * 0.1, 1.15 * PI, 1.85 * PI);
  }
  pop();
}

// ---------------------------------------------------------------- hand

function handleHand() {
  const hand = hands[0];
  if (!hand) {
    pinching = false;
    return;
  }

  const kp = hand.keypoints.map((k) => ({
    x: (k.x / video.width) * width,
    y: (k.y / video.height) * height,
  }));
  const wrist = kp[0];
  const middleMcp = kp[9];
  const handSize = dist(wrist.x, wrist.y, middleMcp.x, middleMcp.y);
  const thumbTip = kp[4];
  const indexTip = kp[8];
  const isPinching =
    dist(thumbTip.x, thumbTip.y, indexTip.x, indexTip.y) < handSize * PINCH_RATIO;

  // tap = short pinch, randomize on release
  if (isPinching && !pinching) {
    pinching = true;
    pinchStartFrame = frameCount;
  } else if (!isPinching && pinching) {
    pinching = false;
    if (frameCount - pinchStartFrame <= TAP_FRAMES) randomizeAll();
  }

  // small indicator
  stroke(isPinching ? color(240, 74, 56) : color(0, 60));
  strokeWeight(2);
  line(thumbTip.x, thumbTip.y, indexTip.x, indexTip.y);
  noStroke();
  fill(0, 140);
  circle(thumbTip.x, thumbTip.y, 8);
  circle(indexTip.x, indexTip.y, 8);
}

function drawHUD() {
  noStroke();
  fill(0, 110);
  textAlign(LEFT, BOTTOM);
  textSize(13);
  text('pinch + release: new random face', 14, height - 14);
}
