# Playground

Collection of small interactive creative-coding projects. Each project lives in its own sub-folder and runs in the browser (p5.js + ml5.js).

The root is a landing page with a face-tracking hero (ml5 faceMesh / MediaPipe): a line-drawn face mirrors your head, and opening your mouth pops a "PLAYGROUND" speech bubble. The project list below it opens each experiment in a new window.

## Projects

| # | Folder | Description |
|---|--------|-------------|
| 01 | [01-magnetic-field](./01-magnetic-field) | Interactive magnetic / vector field controlled by hand tracking |
| 02 | [02-emoface](./02-emoface) | Random blob character (shape + eyes + mouth) that mirrors your head; pinch to reroll |
| 03 | [03-kamehameha](./03-kamehameha) | Charge a glowing energy ball between both palms, open hands to fire a Dragon Ball beam — 2 players (blue vs red) |
| 04 | [04-pixman](./04-pixman) | Body pose rendered as mosaic pixel people on a white tile wall — random outfit colors, click to reroll |
| 05 | [05-pixface](./05-pixface) | Random pixelated face blobs (up to 4 people) that follow heads, pupils track eyeballs — click to reroll |
| 06 | [06-glassSegments](./06-glassSegments) | Webcam through segmented glass (fluted / tiles / dot lenses), shader-based, with capture button |

## Running locally

Camera access requires a local server (not `file://`). From this root folder:

```sh
npx serve .
# or
python -m http.server 8000
```

Then open `http://localhost:8000/` for the landing page, or `http://localhost:8000/01-magnetic-field/` directly.

## Deploying to Vercel

Pure static site — no build step.

1. Import the GitHub repo in [Vercel](https://vercel.com/new).
2. Framework preset: **Other**. Leave build command and output directory empty.
3. Deploy. Camera works because Vercel serves over HTTPS.
