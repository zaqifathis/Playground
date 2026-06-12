# 08 — Reaction Diffusion

Gray-Scott reaction-diffusion patterns (black ink on paper), simulated on the GPU (p5 WEBGL ping-pong framebuffer shader). Random seeds bloom into pattern; typed text is a static obstacle the pattern flows around. No webcam needed.

## Controls (top center)

- **text** field — type a word and it appears in the center as an obstacle the pattern flows around.
- **style** slider — morphs the Gray-Scott feed/kill parameters from labyrinth meanders (left) to dots (right), live.
- **seeds** slider — number of random seed spots (changing it restarts the simulation).
- **offset** slider — extra clearance the pattern keeps around the text, live.
- **hide** checkbox — hide the text so it appears as negative space in the pattern.
- **RESTART** button — clear the simulation and reseed.
