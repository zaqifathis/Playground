# 07 — Differential Growth

Hand-drawn lines that grow into space-filling meanders (differential growth), driven by ml5 handPose.

## Gestures

| Gesture | Action |
|---|---|
| Quick thumb+index pinch (tap) | Drop a circle |
| Pinch + hold and move | Draw a curve along the pinch point |
| Release pinch | The line starts growing |

## Controls (top center)

- **FLIP** — drawn shapes stop growing and become static obstacles; random seeds spawn *outside* the drawn lines and grow around them instead.
- **text** field — type a word and it appears in the center as a static obstacle the growth flows around.
- **spacing** slider — distance the growing strands keep from each other.
- **seeds** slider — number of random seeds (FLIP mode only).
- **offset** slider — extra clearance the growth keeps around the static obstacle lines (FLIP mode only).
- **hide** checkbox — hide the obstacles (text + static drawn lines) so they appear as negative space in the growth.
- **RESTART** button — delete everything and start over (respawns seeds in FLIP mode).

## Growth

Classic differential growth: each line is a chain of nodes with neighbor attraction, midpoint alignment, and repulsion from every nearby node (any line — so lines never intersect). Edges that stretch past a threshold split and insert a node. The screen edge is the outer boundary; a line freezes once it can't move anymore (no space left), and there's a global node budget for performance.
