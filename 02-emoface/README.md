# 02 — emoFace

A playful character made of three random layers — body shape, eyes, mouth — in a bright palette (inspired by blob-character sticker sheets). The character mirrors your head, and a pinch rerolls its look.

## Layers

- **Shape** (6): blob, clover, soft star, squircle, arch, wavy stack
- **Eyes** (5): dots, googly, sleepy, bored, stressed
- **Mouth** (6): smile, O, flat, zigzag, open smile, frown

Color comes from an 8-color palette. Every combination is picked at random.

## Interaction

| Gesture | Action |
|---------|--------|
| Move your head | Character follows, scales with distance to webcam |
| Pinch + quick release (thumb + index) | Randomize shape, eyes, mouth, color |

## Run

Needs a local server for camera access:

```sh
npx serve .
```

Open the served URL, allow camera.

## Stack

- [p5.js](https://p5js.org/) 1.11 — rendering, webcam capture
- [ml5.js](https://ml5js.org/) 1.x — faceMesh (head tracking) + handPose (pinch)
