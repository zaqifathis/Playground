# 05 — Pixface

Pixelated face character from face tracking (ml5 faceMesh / MediaPipe, with iris refinement).

The camera image is never shown. Each detected face gets a randomly generated blob of soft gradient pixels that follows the head on a white background — each reroll builds a new ragged silhouette, picks 2–4 anchor colors, and blends them in one of three styles (vertical stripes, radial, horizontal bands). The two pixel-eyes are white slots with a black pupil that slides to follow the actual eyeballs (iris landmarks).

- Up to 4 faces, tracked by proximity so everyone keeps their own character; lead colors stay distinct.
- **Click / R** — reroll all shapes + palettes
- **V** — toggle small webcam preview

Open `index.html` via a local server (camera needs it), e.g. `npx serve ..` from this folder.
