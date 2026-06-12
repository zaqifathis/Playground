// 01 — Magnetic Field
// Interactive vector field driven by hand tracking (p5.js + ml5 handPose).
//
// Gestures:
//   - Pinch tap (thumb tip + index tip, quick release) -> create a new node
//   - Bunch ALL five fingertips together near a node   -> grab it and move it
//   - Drag a node outside the frame                    -> node is deleted
//   - Pinch with BOTH hands near a node                -> select it, then pull
//     the pinches apart / together to grow / shrink (min = base size)

let video;
let handPose;
let hands = [];

let nodes = [];
let grabbedNode = null;
let resizing = null; // { node, startDist, startRadius }
let pinchStates = {}; // per-handedness pinch tracking for tap detection

// video cover-fit transform (computed every frame)
let vScale = 1;
let vOffX = 0;
let vOffY = 0;

const NODE_RADIUS = 16; // base = minimum radius
const NODE_RADIUS_MAX = 130;
const GRAB_RADIUS = 90;          // fingertip-bunch-to-node distance to grab (px)
const RESIZE_SELECT_RADIUS = 160; // two-hand pinch midpoint-to-node distance
const PINCH_RATIO = 0.18;        // pinch threshold, relative to hand size (tight)
const BUNCH_RATIO = 0.22;        // all-fingertips-together threshold
const TAP_FRAMES = 20;           // pinch shorter than this = tap = create
const EDGE_MARGIN = 8;           // node dragged past this margin -> deleted

const SEEDS_PER_NODE = 24; // field lines emitted per node
const MAX_STEPS = 800;     // hard cap; adaptive steps reach the edge long before

function preload() {
  handPose = ml5.handPose({ flipped: true, maxHands: 2 });
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  video = createCapture(VIDEO, { flipped: true });
  video.size(640, 480);
  video.hide();
  handPose.detectStart(video, (results) => (hands = results));

  // a couple of starter nodes so the field is visible immediately
  addNode(width * 0.32, height * 0.42);
  addNode(width * 0.68, height * 0.6);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// ---------------------------------------------------------------- nodes

function addNode(x, y) {
  const node = {
    x,
    y,
    radius: NODE_RADIUS,
    swirl: random(-0.6, 0.6), // tangential component -> spiral look
  };
  nodes.push(node);
  return node;
}

// Any node whose center leaves the screen is removed, however it got there
// (dragged out, or stranded off-screen by a window resize).
function cullOffscreenNodes() {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (
      n.x < EDGE_MARGIN ||
      n.x > width - EDGE_MARGIN ||
      n.y < EDGE_MARGIN ||
      n.y > height - EDGE_MARGIN
    ) {
      deleteNode(n);
    }
  }
}

function deleteNode(node) {
  const i = nodes.indexOf(node);
  if (i !== -1) nodes.splice(i, 1);
  if (grabbedNode === node) grabbedNode = null;
  if (resizing && resizing.node === node) resizing = null;
}

// Field vector at (x, y). All nodes are sources (same polarity), so every
// streamline flows outward and can only terminate at the screen edge.
// Bigger nodes push harder.
function fieldAt(x, y) {
  let vx = 0;
  let vy = 0;
  for (const n of nodes) {
    const dx = x - n.x;
    const dy = y - n.y;
    const d2 = dx * dx + dy * dy + 40; // softening to avoid singularity
    const s = n.radius / NODE_RADIUS;  // strength scales with size
    vx += (s * (dx - n.swirl * dy)) / d2;
    vy += (s * (dy + n.swirl * dx)) / d2;
  }
  return { x: vx, y: vy };
}

// ---------------------------------------------------------------- draw

function draw() {
  background(0);
  drawVideoBackground();
  cullOffscreenNodes();
  drawFieldLines();
  drawNodes();

  const parsed = hands.map(readHand);
  handleGestures(parsed);
  for (const h of parsed) drawHandOverlay(h);
  if (parsed.length === 0) {
    grabbedNode = null;
    resizing = null;
    pinchStates = {};
  }

  drawHUD();
}

// Cover-fit: fill the canvas, crop the overflow — no stretching.
function drawVideoBackground() {
  vScale = max(width / video.width, height / video.height);
  vOffX = (width - video.width * vScale) / 2;
  vOffY = (height - video.height * vScale) / 2;
  push();
  tint(255, 130);
  image(video, vOffX, vOffY, video.width * vScale, video.height * vScale);
  pop();
}

function drawFieldLines() {
  stroke(255, 230);
  strokeWeight(1.5);
  noFill();

  for (const n of nodes) {
    for (let i = 0; i < SEEDS_PER_NODE; i++) {
      const a = (TWO_PI * i) / SEEDS_PER_NODE;
      let x = n.x + cos(a) * (n.radius - 2);
      let y = n.y + sin(a) * (n.radius - 2);
      let lastVx = cos(a);
      let lastVy = sin(a);

      beginShape();
      vertex(x, y);
      for (let s = 0; s < MAX_STEPS; s++) {
        const v = fieldAt(x, y);
        let m = sqrt(v.x * v.x + v.y * v.y);
        let dx, dy;
        if (m < 1e-7) {
          // stagnation point: keep going in the last direction so the
          // line never dies in the middle of the screen
          dx = lastVx;
          dy = lastVy;
        } else {
          dx = v.x / m;
          dy = v.y / m;
          lastVx = dx;
          lastVy = dy;
        }

        // adaptive step: fine near nodes (smooth spirals), coarse far away
        let nearest = Infinity;
        for (const o of nodes) {
          const od = (x - o.x) * (x - o.x) + (y - o.y) * (y - o.y);
          if (od < nearest) nearest = od;
        }
        const step = constrain(sqrt(nearest) * 0.08, 2, 14);

        x += dx * step;
        y += dy * step;
        vertex(x, y);
        if (x < -20 || x > width + 20 || y < -20 || y > height + 20) break;
      }
      endShape();
    }
  }
}

function drawNodes() {
  for (const n of nodes) {
    if (n === grabbedNode) {
      stroke(80, 220, 130);
      fill(80, 220, 130, 60);
    } else if (resizing && resizing.node === n) {
      stroke(255, 230, 80);
      fill(255, 230, 80, 60);
    } else {
      stroke(255);
      fill(0, 0, 0, 140);
    }
    strokeWeight(2);
    circle(n.x, n.y, n.radius * 2);
  }
}

// ---------------------------------------------------------------- hand

// Convert ml5 keypoints (video coords) to canvas coords using the same
// cover-fit transform as the background, and derive gesture state.
function readHand(hand) {
  const kp = hand.keypoints.map((k) => ({
    x: vOffX + k.x * vScale,
    y: vOffY + k.y * vScale,
  }));

  const wrist = kp[0];
  const middleMcp = kp[9];
  const handSize = dist(wrist.x, wrist.y, middleMcp.x, middleMcp.y);

  // palm center: average of wrist + finger base knuckles
  const palmPts = [kp[0], kp[5], kp[9], kp[13], kp[17]];
  const palm = {
    x: palmPts.reduce((s, p) => s + p.x, 0) / palmPts.length,
    y: palmPts.reduce((s, p) => s + p.y, 0) / palmPts.length,
  };

  const thumbTip = kp[4];
  const indexTip = kp[8];
  const pinchDist = dist(thumbTip.x, thumbTip.y, indexTip.x, indexTip.y);
  const isPinching = pinchDist < handSize * PINCH_RATIO;
  const pinchPoint = {
    x: (thumbTip.x + indexTip.x) / 2,
    y: (thumbTip.y + indexTip.y) / 2,
  };

  // grab: ALL fingertips bunched close to each other
  const tips = [kp[4], kp[8], kp[12], kp[16], kp[20]];
  const tipCenter = {
    x: tips.reduce((s, t) => s + t.x, 0) / tips.length,
    y: tips.reduce((s, t) => s + t.y, 0) / tips.length,
  };
  const avgSpread =
    tips.reduce((s, t) => s + dist(t.x, t.y, tipCenter.x, tipCenter.y), 0) /
    tips.length;
  const isGrabbing = avgSpread < handSize * BUNCH_RATIO;

  return {
    handedness: hand.handedness || 'unknown',
    kp,
    palm,
    tips,
    tipCenter,
    thumbTip,
    indexTip,
    pinchPoint,
    isPinching,
    isGrabbing,
    handSize,
  };
}

function handleGestures(parsed) {
  // drop pinch state for hands that left the frame
  const present = new Set(parsed.map((h) => h.handedness));
  for (const key of Object.keys(pinchStates)) {
    if (!present.has(key)) delete pinchStates[key];
  }

  // --- two-hand pinch: select + resize ---
  const bothPinching = parsed.length === 2 && parsed.every((h) => h.isPinching);
  if (bothPinching) {
    const p1 = parsed[0].pinchPoint;
    const p2 = parsed[1].pinchPoint;
    const d = dist(p1.x, p1.y, p2.x, p2.y);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

    if (!resizing) {
      let nearest = null;
      let nearestDist = RESIZE_SELECT_RADIUS;
      for (const n of nodes) {
        const nd = dist(n.x, n.y, mid.x, mid.y);
        if (nd < nearestDist) {
          nearest = n;
          nearestDist = nd;
        }
      }
      if (nearest) resizing = { node: nearest, startDist: d, startRadius: nearest.radius };
    }
    if (resizing) {
      resizing.node.radius = constrain(
        resizing.startRadius + (d - resizing.startDist) * 0.6,
        NODE_RADIUS,
        NODE_RADIUS_MAX
      );
    }
    // resize pinches are not taps
    for (const h of parsed) trackPinchTap(h, true);
    return;
  }
  resizing = null;

  const primary = parsed[0];
  if (!primary) return;

  // --- dragging: all five fingertips bunched, node follows the bunch ---
  if (grabbedNode) {
    if (primary.isGrabbing) {
      grabbedNode.x = primary.tipCenter.x;
      grabbedNode.y = primary.tipCenter.y;
      if (
        grabbedNode.x < EDGE_MARGIN ||
        grabbedNode.x > width - EDGE_MARGIN ||
        grabbedNode.y < EDGE_MARGIN ||
        grabbedNode.y > height - EDGE_MARGIN
      ) {
        deleteNode(grabbedNode);
      }
      for (const h of parsed) trackPinchTap(h, true);
      return;
    }
    grabbedNode = null; // bunch released
  }

  // --- grab start: bunched fingertips close to a node ---
  if (primary.isGrabbing) {
    let nearest = null;
    let nearestDist = GRAB_RADIUS;
    for (const n of nodes) {
      const d = dist(n.x, n.y, primary.tipCenter.x, primary.tipCenter.y);
      if (d < nearestDist + n.radius) {
        nearest = n;
        nearestDist = d;
      }
    }
    if (nearest) {
      grabbedNode = nearest;
      for (const h of parsed) trackPinchTap(h, true);
      return;
    }
  }

  // --- create: quick pinch tap ---
  for (const h of parsed) trackPinchTap(h, h.isGrabbing);
}

// Edge-detect pinches per hand; a short pinch (tap) that wasn't part of a
// grab/resize creates a node where the pinch started.
function trackPinchTap(h, suppress) {
  const st =
    pinchStates[h.handedness] ||
    (pinchStates[h.handedness] = {
      pinching: false,
      startFrame: 0,
      startPos: null,
      suppress: false,
    });

  if (h.isPinching && !st.pinching) {
    st.pinching = true;
    st.startFrame = frameCount;
    st.startPos = { ...h.pinchPoint };
    st.suppress = suppress;
  } else if (h.isPinching && st.pinching) {
    if (suppress) st.suppress = true;
  } else if (!h.isPinching && st.pinching) {
    st.pinching = false;
    const duration = frameCount - st.startFrame;
    if (!st.suppress && duration <= TAP_FRAMES && st.startPos) {
      addNode(st.startPos.x, st.startPos.y);
    }
    st.suppress = false;
  }
}

function drawHandOverlay(h) {
  // markers on all five fingertips
  noStroke();
  fill(h.isGrabbing ? color(80, 220, 130, 220) : color(255, 160));
  for (const t of h.tips) circle(t.x, t.y, 10);

  // fingertip-bunch center while grabbing
  if (h.isGrabbing) {
    noFill();
    stroke(80, 220, 130, 180);
    strokeWeight(2);
    circle(h.tipCenter.x, h.tipCenter.y, 24);
  }

  // pinch indicator
  stroke(h.isPinching ? color(255, 230, 80) : color(255, 70));
  strokeWeight(2);
  line(h.thumbTip.x, h.thumbTip.y, h.indexTip.x, h.indexTip.y);
}

function drawHUD() {
  noStroke();
  fill(255, 140);
  textAlign(LEFT, BOTTOM);
  textSize(13);
  text(
    'pinch + release: new node  |  bunch all fingers on node: grab + move  |  drag off-screen: delete  |  both hands pinch: resize',
    14,
    height - 14
  );
  textAlign(RIGHT, BOTTOM);
  text(`nodes: ${nodes.length}`, width - 14, height - 14);
}
