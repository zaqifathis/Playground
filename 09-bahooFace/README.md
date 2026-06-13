# 09 — bahooFace

A Bauhaus-style "Bahoo" face: a colored square with a decorated border, blue
cloud eyebrows, white eyes with blue pupils, red cheeks, a blue nose line and a
blue mouth. The square mirrors your head (ml5 faceMesh / MediaPipe) and the
features track your real expression.

## Live tracking

- **Pupils** slide to follow your eyeballs (iris landmarks).
- **Eyebrows** rise and fall with your real brows.
- **Mouth** reshapes between happy / normal / sad from your smile, and opens
  when you open your mouth.

## Character (rerolled on pinch)

A reroll lands on one of six archetypes sampled from the reference sheet, each
a coherent combo of:

- **Border**: plain, dot bead ring, scalloped face, zigzag face
- **Brows**: cloud, tuft, thick bar
- **Eyes**: round, or sleepy (lidded)
- **Mustache**: blue handlebar on some faces
- **Colors**: background, border accent, inner skin (scallop/zigzag), cheeks

## Interaction

| Gesture | Action |
|---------|--------|
| Move your head | The square follows, scales with distance to webcam |
| Smile / frown / open mouth | Mouth changes shape |
| Raise eyebrows | Cloud brows lift |
| Pinch + quick release (thumb + index) | New random character |

A dot helper marks your thumb and index fingertips.

## Run

Needs a local server for camera access:

```sh
npx serve .
```

Open the served URL, allow camera.

## Stack

- [p5.js](https://p5js.org/) 1.11 — rendering, webcam capture
- [ml5.js](https://ml5js.org/) 1.x — faceMesh (head + expression) + handPose (pinch)
