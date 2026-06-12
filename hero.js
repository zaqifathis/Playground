// Landing hero — a minimal line-drawn face that mirrors your face.
// Tracking: ml5 faceMesh (MediaPipe under the hood), webcam stays hidden.
//
// - The face icon follows your head position and scale.
// - Open your mouth: the 'O' mouth grows and the letters of
//   "playground" float out of it one by one, growing as they rise,
//   then dissolve when they get too far.

let faceMesh;
let video;
let faces = [];

// smoothed face state
let fx = 0;
let fy = 0;
let fScale = 1;
let fMouth = 0; // 0 = closed, 1 = wide open

// floating letters
const WORD = 'playground';
let letters = [];
let letterIndex = 0;
let lastEmitFrame = 0;

const MOUTH_OPEN_GAP = 0.035; // lip gap / face height where "open" starts
const MOUTH_WIDE_GAP = 0.12;  // lip gap / face height for fully open
const EMIT_TRIGGER = 0.3;     // mouth amount that starts emitting letters
const EMIT_INTERVAL = 11;     // frames between letters

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
    // face close to webcam -> big icon, far away -> small icon
    ts = constrain((face.box.height * sy) / 300, baseScale() * 0.35, baseScale() * 3);

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

  const mouth = mouthPos(fx, fy, fScale);
  emitLetters(mouth);
  updateAndDrawLetters(mouth);
  drawFace(fx, fy, fScale, fMouth);
}

function mouthPos(x, y, s) {
  return { x: x + 5 * s, y: y + 100 * s };
}

// Minimal face: two arched eyebrows, two dot eyes, a nose stroke that
// starts between the eyes, and an 'O' mouth below the nose.
function drawFace(x, y, s, mouthAmt) {
  const w = 13 * s; // main stroke weight

  push();
  stroke(0);
  strokeWeight(w);
  strokeCap(ROUND);
  strokeJoin(ROUND);
  noFill();

  // eyebrows
  arc(x - 60 * s, y - 95 * s, 110 * s, 70 * s, PI + 0.45, TWO_PI - 0.35);
  arc(x + 55 * s, y - 90 * s, 120 * s, 85 * s, PI + 0.35, TWO_PI - 0.25);

  // eyes
  noStroke();
  fill(0);
  circle(x - 60 * s, y - 45 * s, 34 * s);
  circle(x + 50 * s, y - 40 * s, 34 * s);

  // nose: starts between the eyes, sweeps down-left, short flat base
  noFill();
  stroke(0);
  strokeWeight(w);
  beginShape();
  vertex(x - 5 * s, y - 50 * s);
  quadraticVertex(x - 12 * s, y + 5 * s, x - 42 * s, y + 50 * s);
  endShape();
  line(x - 42 * s, y + 50 * s, x + 18 * s, y + 42 * s);

  // 'O' mouth below the nose — grows with mouth opening
  const m = mouthPos(x, y, s);
  const mouthD = lerp(20 * s, 90 * s, mouthAmt);
  strokeWeight(max(w * 0.65, lerp(w * 0.65, w, mouthAmt)));
  circle(m.x, m.y, mouthD);
  pop();
}

// ---------------------------------------------------------------- letters

// While the mouth is open, the letters p-l-a-y-g-r-o-u-n-d stream out
// one at a time — one word per opening. Close and reopen the mouth to
// say it again.
function emitLetters(mouth) {
  if (fMouth < EMIT_TRIGGER) {
    letterIndex = 0; // mouth closed: rearm for the next opening
    return;
  }
  if (letterIndex >= WORD.length) return; // word finished for this opening
  if (frameCount - lastEmitFrame < EMIT_INTERVAL) return;
  lastEmitFrame = frameCount;

  letters.push({
    char: WORD[letterIndex],
    x: mouth.x,
    y: mouth.y,
    vx: random(-0.6, 0.6),
    vy: random(-2.6, -1.8),
    wobble: random(TWO_PI),
  });
  letterIndex++;
}

function updateAndDrawLetters(mouth) {
  const maxTravel = height * 0.5; // letters dissolve after rising this far

  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  noStroke();

  for (let i = letters.length - 1; i >= 0; i--) {
    const L = letters[i];
    L.y += L.vy;
    L.x += L.vx + sin(frameCount * 0.06 + L.wobble) * 0.6;

    const travel = constrain(dist(L.x, L.y, mouth.x, mouth.y) / maxTravel, 0, 1);
    if (travel >= 1) {
      letters.splice(i, 1);
      continue;
    }

    // small near the mouth, bigger as it floats away; fade out at the end
    const size = lerp(13, 72, travel) * fScale;
    const alpha = travel > 0.75 ? map(travel, 0.75, 1, 255, 0) : 255;

    fill(0, alpha);
    textSize(size);
    text(L.char, L.x, L.y);
  }
}
