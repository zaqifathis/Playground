// Landing hero — a minimal line-drawn face that mirrors your face.
// Tracking: ml5 faceMesh (MediaPipe under the hood), webcam stays hidden.
//
// - The face icon follows your head position and scale.
// - Open your mouth: the 'O' mouth grows and a "PLAYGROUND" speech
//   bubble pops in; close it and the bubble fades out smoothly.

let faceMesh;
let video;
let faces = [];

// smoothed face state
let fx = 0;
let fy = 0;
let fScale = 1;
let fMouth = 0; // 0 = closed, 1 = wide open

let bubbleAlpha = 0;

const MOUTH_OPEN_GAP = 0.035; // lip gap / face height where "open" starts
const MOUTH_WIDE_GAP = 0.12;  // lip gap / face height for fully open
const BUBBLE_TRIGGER = 0.35;  // mouth amount that shows the bubble

function preload() {
  faceMesh = ml5.faceMesh({ maxFaces: 1, refineLandmarks: false, flipped: true });
}

function setup() {
  const hero = document.getElementById('hero');
  const c = createCanvas(hero.offsetWidth, hero.offsetHeight);
  c.parent('hero-canvas');

  video = createCapture(VIDEO, { flipped: true });
  video.size(640, 480);
  video.hide();
  faceMesh.detectStart(video, (results) => (faces = results));

  fx = width / 2;
  fy = height / 2;
  fScale = baseScale();
}

function windowResized() {
  const hero = document.getElementById('hero');
  resizeCanvas(hero.offsetWidth, hero.offsetHeight);
}

function baseScale() {
  return min(width, height) / 420;
}

function draw() {
  background(255);

  // targets: idle = centered, closed mouth
  let tx = width / 2;
  let ty = height / 2;
  let ts = baseScale();
  let tm = 0;

  const face = faces[0];
  if (face && face.box) {
    const sx = width / video.width;
    const sy = height / video.height;
    tx = (face.box.xMin + face.box.width / 2) * sx;
    ty = (face.box.yMin + face.box.height / 2) * sy;
    ts = max((face.box.height * sy) / 340, baseScale() * 0.5);

    // mouth opening: gap between upper (13) and lower (14) lip landmarks,
    // normalized by face height so distance to camera doesn't matter
    const top = face.keypoints[13];
    const bot = face.keypoints[14];
    if (top && bot) {
      const gap = dist(top.x, top.y, bot.x, bot.y) / face.box.height;
      tm = constrain(map(gap, MOUTH_OPEN_GAP, MOUTH_WIDE_GAP, 0, 1), 0, 1);
    }
  }

  fx = lerp(fx, tx, 0.12);
  fy = lerp(fy, ty, 0.12);
  fScale = lerp(fScale, ts, 0.1);
  fMouth = lerp(fMouth, tm, 0.25);

  const bubbleTarget = fMouth > BUBBLE_TRIGGER ? 255 : 0;
  bubbleAlpha = lerp(bubbleAlpha, bubbleTarget, 0.12);

  drawFace(fx, fy, fScale, fMouth);
  if (bubbleAlpha > 2) drawBubble(fx, fy, fScale, bubbleAlpha);
}

// Minimal face: two arched eyebrows, two dot eyes, a "2"-shaped
// nose-to-chin stroke, and an 'O' mouth that grows when you open yours.
function drawFace(x, y, s, mouthAmt) {
  const w = 13 * s; // main stroke weight

  push();
  stroke(0);
  strokeWeight(w);
  strokeCap(ROUND);
  strokeJoin(ROUND);
  noFill();

  // eyebrows
  arc(x - 70 * s, y - 80 * s, 110 * s, 70 * s, PI + 0.45, TWO_PI - 0.35);
  arc(x + 45 * s, y - 75 * s, 130 * s, 90 * s, PI + 0.35, TWO_PI - 0.25);

  // eyes
  noStroke();
  fill(0);
  circle(x - 65 * s, y - 30 * s, 34 * s);
  circle(x + 15 * s, y - 18 * s, 34 * s);

  // nose-to-chin "2" stroke: diagonal down-left, then a flat base
  noFill();
  stroke(0);
  strokeWeight(w);
  beginShape();
  vertex(x + 55 * s, y - 60 * s);
  quadraticVertex(x + 30 * s, y + 10 * s, x - 55 * s, y + 95 * s);
  endShape();
  line(x - 55 * s, y + 95 * s, x + 25 * s, y + 82 * s);

  // 'O' mouth — grows with mouth opening
  const mouthD = lerp(20 * s, 95 * s, mouthAmt);
  strokeWeight(max(w * 0.65, lerp(w * 0.65, w, mouthAmt)));
  circle(x + 60 * s, y + 55 * s, mouthD);
  pop();
}

// Speech bubble with "PLAYGROUND", anchored near the mouth.
function drawBubble(x, y, s, alpha) {
  const a = alpha / 255;
  const popScale = 0.85 + 0.15 * a; // small pop-in scale
  const bx = x + 150 * s;
  const by = y - 60 * s - 20 * s * a;

  push();
  translate(bx, by);
  scale(popScale * s);

  textSize(34);
  textStyle(BOLD);
  const tw = textWidth('PLAYGROUND');
  const padX = 28;
  const padY = 20;
  const bw = tw + padX * 2;
  const bh = 34 + padY * 2;

  stroke(0, alpha);
  strokeWeight(5);
  fill(255, alpha);

  // tail pointing back at the mouth
  beginShape();
  vertex(-bw / 2 + 30, bh / 2 - 2);
  vertex(-bw / 2 - 25, bh / 2 + 45);
  vertex(-bw / 2 + 75, bh / 2 - 2);
  endShape(CLOSE);

  rectMode(CENTER);
  rect(0, 0, bw, bh, 18);

  noStroke();
  fill(0, alpha);
  textAlign(CENTER, CENTER);
  text('PLAYGROUND', 0, 2);
  pop();
}
