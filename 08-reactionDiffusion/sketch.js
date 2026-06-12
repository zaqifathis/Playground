// 08 — Reaction Diffusion
// Gray-Scott reaction-diffusion (black ink on paper), GPU ping-pong shader.
// Random seeds bloom into pattern; typed text is a static obstacle the
// pattern flows around (offset slider = clearance). Style slider morphs
// labyrinth meanders <-> dots. RESTART reseeds.

// ------------------------------------------------------------- tuning
const SIM_SCALE = 0.5;  // sim resolution relative to screen
const STEPS = 16;       // sim iterations per frame

// Gray-Scott parameter presets, morphed by the style slider
const F_WORM = 0.0545, K_WORM = 0.062;  // labyrinth / coral
const F_DOT = 0.0367, K_DOT = 0.0649;   // mitosis / dots

const INK = [16, 16, 18];
const PAPER = [231, 227, 218];

// ------------------------------------------------------------- state
let styleSlider, seedSlider, offSlider, styleVal, seedVal, offVal, textInput;
let textStr = '';
let textSizePx = 0;
let clearedAt = -99999;

let simG, fbA, fbB, simShader, dispShader;
let maskG, seedG;
let simW, simH;
let seedDirty = false;

const VERT = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vUv;
uniform mat4 uProjectionMatrix;
uniform mat4 uModelViewMatrix;
void main() {
  vUv = aTexCoord;
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}`;

const SIM_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tex;
uniform sampler2D maskTex;
uniform sampler2D seedTex;
uniform vec2 res;
uniform float f;
uniform float k;
void main() {
  vec2 px = 1.0 / res;
  vec2 c = texture2D(tex, vUv).rg;
  float u = c.r;
  float v = c.g;

  vec2 sum = -c;
  sum += 0.2 * texture2D(tex, vUv + vec2(px.x, 0.0)).rg;
  sum += 0.2 * texture2D(tex, vUv - vec2(px.x, 0.0)).rg;
  sum += 0.2 * texture2D(tex, vUv + vec2(0.0, px.y)).rg;
  sum += 0.2 * texture2D(tex, vUv - vec2(0.0, px.y)).rg;
  sum += 0.05 * texture2D(tex, vUv + px).rg;
  sum += 0.05 * texture2D(tex, vUv - px).rg;
  sum += 0.05 * texture2D(tex, vUv + vec2(px.x, -px.y)).rg;
  sum += 0.05 * texture2D(tex, vUv + vec2(-px.x, px.y)).rg;

  float uvv = u * v * v;
  u += 1.0 * sum.r - uvv + f * (1.0 - u);
  v += 0.5 * sum.g + uvv - (f + k) * v;

  if (texture2D(seedTex, vUv).a > 0.1) { u = 0.0; v = 1.0; }
  if (texture2D(maskTex, vUv).a > 0.1) { u = 1.0; v = 0.0; }

  gl_FragColor = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
}`;

const DISP_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tex;
uniform vec3 ink;
uniform vec3 paper;
void main() {
  float v = texture2D(tex, vUv).g;
  float t = smoothstep(0.12, 0.32, v);
  gl_FragColor = vec4(mix(paper, ink, t), 1.0);
}`;

function setup() {
  createCanvas(windowWidth, windowHeight);

  styleSlider = document.getElementById('styleSlider');
  seedSlider = document.getElementById('seedSlider');
  offSlider = document.getElementById('offSlider');
  styleVal = document.getElementById('styleVal');
  seedVal = document.getElementById('seedVal');
  offVal = document.getElementById('offVal');
  textInput = document.getElementById('textInput');

  styleSlider.addEventListener('input', () => {
    styleVal.textContent = styleSlider.value;
  });
  seedSlider.addEventListener('input', () => {
    seedVal.textContent = seedSlider.value;
    restart();
  });
  offSlider.addEventListener('input', () => {
    offVal.textContent = offSlider.value;
    rebuildMask();
  });
  textInput.addEventListener('input', () => {
    textStr = textInput.value.trim();
    rebuildText();
    rebuildMask();
    restart();
  });
  document.getElementById('restartBtn').addEventListener('click', () => {
    restart();
    clearedAt = millis();
  });

  initSim();
  respawnSeeds();
}

function initSim() {
  simW = max(8, floor(width * SIM_SCALE));
  simH = max(8, floor(height * SIM_SCALE));

  simG = createGraphics(simW, simH, WEBGL);
  simG.pixelDensity(1);
  simG.noStroke();
  fbA = simG.createFramebuffer({ format: FLOAT, width: simW, height: simH });
  fbB = simG.createFramebuffer({ format: FLOAT, width: simW, height: simH });
  simShader = simG.createShader(VERT, SIM_FRAG);
  dispShader = simG.createShader(VERT, DISP_FRAG);

  maskG = createGraphics(simW, simH);
  maskG.pixelDensity(1);
  seedG = createGraphics(simW, simH);
  seedG.pixelDensity(1);

  clearState();
  rebuildMask();
}

// state = U in red, V in green; start: U=1, V=0 everywhere
function clearState() {
  for (const fb of [fbA, fbB]) {
    fb.begin();
    simG.background(255, 0, 0);
    fb.end();
  }
}

function restart() {
  clearState();
  respawnSeeds();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  rebuildText();
  initSim();
  respawnSeeds();
}

// ---------------------------------------------------------------- draw

function draw() {
  background(PAPER);
  simulate();

  // color-map the current state onto simG's main surface, then blit
  simG.shader(dispShader);
  dispShader.setUniform('tex', fbA.color);
  dispShader.setUniform('ink', INK.map((c) => c / 255));
  dispShader.setUniform('paper', PAPER.map((c) => c / 255));
  simG.rect(-simW / 2, -simH / 2, simW, simH);
  image(simG, 0, 0, width, height);

  drawTextObstacle();

  if (millis() - clearedAt < 800) {
    push();
    textAlign(CENTER, CENTER);
    textSize(34);
    textFont('sans-serif');
    fill(INK[0], INK[1], INK[2], map(millis() - clearedAt, 0, 800, 255, 0));
    noStroke();
    text('RESTARTED', width / 2, height / 2);
    pop();
  }
}

function simulate() {
  const t = +styleSlider.value / 100;
  const f = lerp(F_WORM, F_DOT, t);
  const k = lerp(K_WORM, K_DOT, t);

  for (let i = 0; i < STEPS; i++) {
    fbB.begin();
    simG.shader(simShader);
    simShader.setUniform('tex', fbA.color);
    simShader.setUniform('maskTex', maskG);
    simShader.setUniform('seedTex', seedG);
    simShader.setUniform('res', [simW, simH]);
    simShader.setUniform('f', f);
    simShader.setUniform('k', k);
    simG.rect(-simW / 2, -simH / 2, simW, simH);
    fbB.end();
    [fbA, fbB] = [fbB, fbA];
  }

  if (seedDirty) {
    seedG.clear();
    seedDirty = false;
  }
}

// --------------------------------------------------------- seed / mask

// obstacle mask: the center text, widened by the offset slider
function rebuildMask() {
  maskG.clear();
  if (!textStr) return;

  const off = +offSlider.value;
  maskG.push();
  maskG.scale(SIM_SCALE);
  maskG.fill(255);
  maskG.stroke(255);
  maskG.strokeWeight(max(1, off * 2));
  maskG.textAlign(CENTER, CENTER);
  maskG.textStyle(BOLD);
  maskG.textFont('sans-serif');
  maskG.textSize(textSizePx);
  maskG.text(textStr, width / 2, height / 2);
  maskG.pop();
}

function rebuildText() {
  if (!textStr) {
    textSizePx = 0;
    return;
  }
  push();
  textStyle(BOLD);
  textFont('sans-serif');
  let s = min(height * 0.5, 380);
  textSize(s);
  while (textWidth(textStr) > width * 0.8 && s > 18) {
    s *= 0.93;
    textSize(s);
  }
  pop();
  textSizePx = s;
}

function respawnSeeds() {
  const count = +seedSlider.value;
  maskG.loadPixels();
  seedG.push();
  seedG.scale(SIM_SCALE);
  seedG.noStroke();
  seedG.fill(255);
  for (let k = 0; k < count; k++) {
    for (let tries = 0; tries < 250; tries++) {
      const x = random(30, width - 30);
      const y = random(30, height - 30);
      if (maskBlocked(x, y, 14)) continue;
      seedG.circle(x, y, 12);
      break;
    }
  }
  seedG.pop();
  seedDirty = true;
}

// is (screen x,y) on or near the obstacle mask? (checks a few samples)
function maskBlocked(x, y, r) {
  for (const [ox, oy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
    const xi = ((x + ox) * SIM_SCALE) | 0;
    const yi = ((y + oy) * SIM_SCALE) | 0;
    if (xi < 0 || yi < 0 || xi >= simW || yi >= simH) continue;
    if (maskG.pixels[4 * (yi * simW + xi) + 3] > 30) return true;
  }
  return false;
}

// -------------------------------------------------------------- render

function drawTextObstacle() {
  if (!textStr || document.getElementById('hideChk').checked) return;
  push();
  noStroke();
  fill(INK);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textFont('sans-serif');
  textSize(textSizePx);
  text(textStr, width / 2, height / 2);
  pop();
}
