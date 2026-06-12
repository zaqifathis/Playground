# 03 — Kamehameha

Two-hand energy attack powered by ml5 handPose (MediaPipe), Dragon Ball style. One or two players.

## How to play

1. Show **both hands** to the camera.
2. Bring your **palms close together** — a glowing energy blob forms between them and grows from small to full power in ~3 seconds.
3. **Open your fingers** (or pull your hands apart) — the ball erupts into a jagged beam, Goku style.
4. The beam fires along the average **palm → middle-fingertip** direction of both hands, so you can aim it.
5. The beam drains the charge; cup your hands again to recharge.

### Two players

With four hands in view, hands are paired by proximity into two players. First player fires **blue**, second fires **red**. Each player has an independent charge/fire state, so you can duel.

## Tech

- p5.js for rendering (additive-blend layered glow: dark halo → bright mid → white core, noise-wobbled blob + jagged beam edges).
- ml5 handPose with `maxHands: 4`; palm center = wrist + four knuckles, hand "openness" = mean fingertip distance / hand size. Hands are paired closest-first; poses stick to the player whose ball they're nearest, so colors don't swap mid-game.
- Per-player state machine: `idle → charging → firing`, all thresholds relative to detected hand size so it works at any distance from the camera.
