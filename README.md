# Playground

Collection of small interactive creative-coding projects. Each project lives in its own sub-folder and runs in the browser (p5.js + ml5.js).

The root is a landing page with a face-tracking hero (ml5 faceMesh / MediaPipe): a line-drawn face mirrors your head, and opening your mouth pops a "PLAYGROUND" speech bubble. The project list below it opens each experiment in a new window.

## Projects

| # | Folder | Description |
|---|--------|-------------|
| 01 | [01-magnetic-field](./01-magnetic-field) | Interactive magnetic / vector field controlled by hand tracking |

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
