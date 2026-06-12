# 04 — Pixman

Mosaic pixel people from full-body pose tracking (ml5 bodyPose / MoveNet multipose).

The camera image is never shown. Each detected person is rasterized onto a white tile wall as a small figure built from colored squares and half-square triangles — like a vintage swimming-pool mosaic. Head, hair, torso, arms, legs get their own colors from a random outfit palette; hands and feet end in triangle tiles pointing along the limb.

- Up to 4 people, each with a distinct outfit palette they keep while moving.
- **Click / R** — reroll outfit colors
- **V** — toggle small webcam preview

Open `index.html` via a local server (camera needs it), e.g. `npx serve ..` from this folder.
