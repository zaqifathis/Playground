// 06 — Glass Segments
// Webcam seen through segmented glass, rendered with a WEBGL shader.
// Four effects: fluted vertical / horizontal (reeded glass — the whole image
// is squeezed into every strip), tiles (same in both axes, privacy-glass
// grid), and dots (hex-packed little lenses that magnify locally).
// Toolbar controls effect, density, distortion and frost; round button at the
// bottom (or S) captures the frame as PNG/JPG. Keys 1–4 switch effects.

let video;
let glassShader;
let fallback; // test-pattern texture shown until the camera is allowed
let saveRequested = false;

const params = {
  effect: 0,    // 0 fluted V, 1 fluted H, 2 tiles, 3 dots
  density: 14,  // segments across the width
  strength: 0.85,
  frost: 0.08,
  colorMode: 0, // 0 color, 1 mono, 2 sepia, 3 duotone
  format: 'png',
};

// ---------------------------------------------------------------- shaders

const VERT = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
uniform mat4 uProjectionMatrix;
uniform mat4 uModelViewMatrix;
varying vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D uTex;
uniform vec2 uRes;       // canvas size in px
uniform vec2 uVidScale;  // canvas uv -> video uv (cover fit)
uniform vec2 uVidOff;
uniform int uEffect;
uniform float uDensity;
uniform float uStrength;
uniform float uFrost;
uniform int uColorMode;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 sampleVideo(vec2 uv) {
  vec2 vuv = clamp(uv * uVidScale + uVidOff, 0.001, 0.999);
  return texture2D(uTex, vuv).rgb;
}

// Squeeze the whole image into each segment along one axis.
// At strength 0 the image is untouched; at 1 every segment holds a full,
// edge-stretched copy (classic reeded-glass repetition).
float glassAxis(float u, float cells, out float local) {
  local = fract(u * cells);
  float eased = smoothstep(0.0, 1.0, local);
  return mix(u, eased, uStrength);
}

// Glassy brightness across one segment: highlight in the middle,
// dark seam at the boundaries. Fades out with strength.
float flutedShade(float l) {
  float s = 0.8 + 0.28 * sin(l * 3.14159);
  s *= 0.6 + 0.4 * smoothstep(0.0, 0.06, l) * smoothstep(0.0, 0.06, 1.0 - l);
  return mix(1.0, s, uStrength);
}

void main() {
  vec2 uv = vTexCoord;

  float cellsX = uDensity;
  float cellsY = uDensity * uRes.y / uRes.x; // keep segments square

  vec2 suv = uv;
  float shade = 1.0;

  if (uEffect == 0) {
    float lx;
    suv.x = glassAxis(uv.x, cellsX, lx);
    shade = flutedShade(lx);
  } else if (uEffect == 1) {
    float ly;
    suv.y = glassAxis(uv.y, cellsY, ly);
    shade = flutedShade(ly);
  } else if (uEffect == 2) {
    float lx, ly;
    suv.x = glassAxis(uv.x, cellsX, lx);
    suv.y = glassAxis(uv.y, cellsY, ly);
    shade = mix(1.0, flutedShade(lx) * flutedShade(ly), 0.85);
  } else {
    // dots: hex-packed micro lenses, each magnifies its own neighborhood
    float cx = cellsX * 2.5;
    float cy = cx * uRes.y / uRes.x;
    vec2 g = vec2(uv.x * cx, uv.y * cy);
    float rowShift = mod(floor(g.y), 2.0) * 0.5;
    g.x += rowShift;
    vec2 id = floor(g);
    vec2 local = fract(g) - 0.5;
    float r = length(local);
    vec2 center = vec2((id.x + 0.5 - rowShift) / cx, (id.y + 0.5) / cy);
    float lens = uStrength * smoothstep(0.55, 0.0, r);
    suv = mix(uv, center, lens);
    shade = 1.0 + uStrength * (0.3 - r) * 0.7;
  }

  // frost: static per-pixel jitter of the sampling position
  vec2 jitter = vec2(hash(gl_FragCoord.xy), hash(gl_FragCoord.yx + 17.31)) - 0.5;
  suv += jitter * uFrost * 0.05;

  vec3 col = clamp(sampleVideo(suv) * shade, 0.0, 1.0);

  if (uColorMode != 0) {
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    if (uColorMode == 1) {
      col = vec3(luma);
    } else if (uColorMode == 2) {
      col = luma * vec3(1.2, 1.0, 0.78);
    } else {
      // duotone: deep blue shadows -> warm pink highlights
      col = mix(vec3(0.08, 0.11, 0.38), vec3(1.0, 0.78, 0.85), luma);
    }
    col = clamp(col, 0.0, 1.0);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- setup

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  glassShader = createShader(VERT, FRAG);
  video = createCapture(VIDEO, { flipped: true });
  video.size(640, 480);
  video.hide();
  fallback = makeTestPattern(640, 480);
  bindUI();
}

// soft color gradient with a circle, so the effects read before camera starts
function makeTestPattern(w, h) {
  const g = createGraphics(w, h);
  for (let y = 0; y < h; y++) {
    const c = g.lerpColor(g.color('#2747d4'), g.color('#f7a0cd'), y / h);
    g.stroke(c);
    g.line(0, y, w, y);
  }
  g.noStroke();
  g.fill('#ffd233');
  g.circle(w / 2, h / 2, h * 0.55);
  g.fill('#1d7a3c');
  g.circle(w * 0.25, h * 0.4, h * 0.25);
  return g;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function draw() {
  background(0);

  const ready = video.loadedmetadata && video.elt.videoWidth > 0;
  const tex = ready ? video : fallback;

  // cover-fit: canvas uv -> video uv
  const vw = ready ? video.elt.videoWidth : fallback.width;
  const vh = ready ? video.elt.videoHeight : fallback.height;
  const s = Math.max(width / vw, height / vh);
  const ox = (width - vw * s) / 2;
  const oy = (height - vh * s) / 2;

  shader(glassShader);
  glassShader.setUniform('uTex', tex);
  glassShader.setUniform('uRes', [width, height]);
  glassShader.setUniform('uVidScale', [width / (s * vw), height / (s * vh)]);
  glassShader.setUniform('uVidOff', [-ox / (s * vw), -oy / (s * vh)]);
  glassShader.setUniform('uEffect', params.effect);
  glassShader.setUniform('uDensity', params.density);
  glassShader.setUniform('uStrength', params.strength);
  glassShader.setUniform('uFrost', params.frost);
  glassShader.setUniform('uColorMode', params.colorMode);

  noStroke();
  plane(width, height);

  // save inside draw so the buffer is guaranteed fresh
  if (saveRequested) {
    saveRequested = false;
    const t = new Date();
    const stamp = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}`;
    saveCanvas(`glass-segments-${stamp}`, params.format);
  }
}

// ---------------------------------------------------------------- UI

function bindUI() {
  const buttons = document.querySelectorAll('#toolbar .effects button');
  buttons.forEach((b) => {
    b.addEventListener('click', () => setEffect(parseInt(b.dataset.effect, 10)));
  });
  document.getElementById('density').addEventListener('input', (e) => {
    params.density = parseFloat(e.target.value);
  });
  document.getElementById('strength').addEventListener('input', (e) => {
    params.strength = parseFloat(e.target.value) / 100;
  });
  document.getElementById('frost').addEventListener('input', (e) => {
    params.frost = parseFloat(e.target.value) / 100;
  });
  document.getElementById('colorMode').addEventListener('change', (e) => {
    params.colorMode = parseInt(e.target.value, 10);
  });
  document.getElementById('format').addEventListener('change', (e) => {
    params.format = e.target.value;
  });
  document.getElementById('capture').addEventListener('click', captureFrame);
}

function setEffect(i) {
  params.effect = i;
  document.querySelectorAll('#toolbar .effects button').forEach((b) => {
    b.classList.toggle('active', parseInt(b.dataset.effect, 10) === i);
  });
}

function captureFrame() {
  saveRequested = true;
  const flash = document.getElementById('flash');
  flash.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => flash.classList.remove('on')));
}

function keyPressed() {
  if (key >= '1' && key <= '4') setEffect(parseInt(key, 10) - 1);
  if (key === 's' || key === 'S') captureFrame();
}
