# 10 — Sosis Bakar

Two-player face-tracked 8-bit fire cannon powered by ml5 faceMesh (MediaPipe). Charge fire with your mouth and grill a flock of pixel sausages — *sosis bakar*.

## How to play

1. Two players, side by side — show both **faces** to the camera. The left person is **P1** (red), the right is **P2** (blue).
2. **Close your mouth** — an 8-bit flame charges on your lips (~0.9 s to full).
3. **Open your mouth** — it spits a jet of pixel fire.
4. The jet flies along the **mouth → forehead** vector **frozen at the instant you open** (the last aim before the shot), so line up before you open. Tilt your head to aim.
5. A flock of 8-bit sausages drifts across the top of the screen at different speeds, each with a **target dot** at its center. Torch a target and the sausage chars black and tumbles down; a fresh one spawns from the side.
6. Each player's **kill count**, in an 8-bit font, sits in its corner (P1 top-left, P2 top-right).

## Tech

- p5.js for rendering. Charge flame, fire jet, and sausages are all hand-drawn pixel-grid sprites; the jet uses additive blend for glow. The live webcam shows through untinted behind the action.
- ml5 faceMesh (`maxFaces: 2`, refined landmarks). Faces are split left → right into P1 / P2. Per-player origin = mouth center; mouth openness = lip gap / face height; aim = normalized mouth → forehead vector, **frozen on the closed→open edge** so head movement after opening doesn't curve the shot.
- Multiple sausages, each with its own speed and sine-wobble, mirrored by travel direction.
- Hit test: each flame projectile vs every live sausage's center within a kill radius; the kill is credited to the player who fired it.
- Counters rendered in **Press Start 2P** (8-bit web font).
