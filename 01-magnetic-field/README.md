# 01 — Magnetic Field

Interactive magnetic / vector field. Webcam video is the background; white field lines spiral around nodes (like iron-filings field-line art). Hand gestures control the nodes via ml5 handPose.

## Gestures

| Gesture | Action |
|---------|--------|
| Pinch + quick release (thumb tip taps index tip) | Create a new node at the pinch point |
| Bunch all five fingertips together on a node | Grab it (turns **green**) and move it with your hand |
| Drag a node outside the frame | Node is deleted |
| Pinch with both hands near a node | Select it (**yellow**), pull pinches apart/together to resize |

All nodes are field sources, so every line flows outward until it leaves the screen. Each node gets a random swirl, which gives the spiral look.

## Run

Needs a local server for camera access:

```sh
npx serve .
# or
python -m http.server 8000
```

Open the served URL, allow camera access, show one hand to the camera.

## Stack

- [p5.js](https://p5js.org/) 1.11 — rendering, webcam capture
- [ml5.js](https://ml5js.org/) 1.x — handPose (21 keypoints, mirrored to match the flipped video)

## Tuning

Top of `sketch.js`:

- `PINCH_RATIO` / `BUNCH_RATIO` — gesture sensitivity (relative to hand size)
- `TAP_FRAMES` — max pinch duration that still counts as a "tap"
- `GRAB_RADIUS` — how close the fingertip bunch must be to grab a node
- `SEEDS_PER_NODE`, `MAX_STEPS` — field line density / length cap (lower if slow)

Node count is unlimited; any node that ends up outside the screen is deleted automatically.
