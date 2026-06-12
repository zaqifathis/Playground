# 06 — Glass Segments

Webcam seen through segmented glass — a WEBGL shader remaps the image so every segment holds its own squeezed copy (reeded / privacy-glass look).

Effects (toolbar or keys **1–4**):

- **Fluted ▕▕** — vertical strips, whole image squeezed into each strip
- **Fluted ▁** — same, horizontal
- **Tiles** — square grid, squeezed in both axes
- **Dots** — hex-packed micro lenses, each magnifies its neighborhood

Sliders: **Density** (segments across), **Distortion** (0 = clean image, 1 = full repetition + glass shading), **Frost** (grainy sampling jitter).

Color modes: **Color**, **Mono** (b/w), **Sepia**, **Duotone** (blue shadows → pink highlights).

**Capture**: round button at the bottom (or **S**) saves the frame as PNG/JPG (format select in the toolbar).

Open `index.html` via a local server (camera needs it), e.g. `npx serve ..` from this folder.
