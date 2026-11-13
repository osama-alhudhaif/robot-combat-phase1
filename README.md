# Robot Combat

A browser game for a private group of friends: build a robot from parts, write its control
program in JavaScript, and drive it in real-time fights.

**Status: Phase 1 (workshop and local testing).** Online private rooms are Phase 2 and are not
built yet. The full specification is in `docs/robot-combat-game-spec.md`.

## Run it locally

Needs Node.js 20 or newer.

```bash
npm install
npm run dev        # opens on http://localhost:5173 (also reachable from a phone on the same network)
```

Other commands:

```bash
npm test           # headless checks of the shared simulation (drive, weapons, damage, energy)
npm run typecheck
npm run build      # static files in client/dist
npm run preview    # serve the built files locally
```

## Deploy (Phase 1)

Phase 1 has no server. `npm run build` writes a static site to `client/dist`. Upload that
folder to any static host (Nginx, GitHub Pages, Cloudflare Pages, Netlify) and link to it from
the club site. Routing uses the URL hash, so no rewrite rules are needed. If the site is served
from a sub-path, build with `npx vite build --base=/your/path/` inside `client/`.

Do not add a Content Security Policy that forbids `blob:` workers or inline scripts in
`srcdoc` iframes: the isolated program runtime needs both.

Phase 2 adds a single Node.js process in `server/`, with its address and port read from
environment variables.

## Layout

```
client/   React app: screens, builder, code editor, renderer, input, program runtime
server/   Phase 2: rooms, match simulation, WebSocket API (empty for now)
shared/   Part catalog and config, robot validation, simulation, training target
```

| Where | What |
|---|---|
| `shared/src/config.ts` | **Every tunable value**: build rules, arena, physics, damage, program limits, and the part catalog |
| `shared/src/sim/simulation.ts` | The fight itself. Takes commands in, gives snapshots and sensor readings out. Never runs player code. The server will run this same file in Phase 2. |
| `shared/src/validate.ts` | Build rules and robot file import/export |
| `client/src/runtime/` | The sandbox that runs player programs |
| `client/src/i18n/` | All interface text, English and Arabic |

## How player code is isolated

Each program runs in a Web Worker created inside a hidden iframe with `sandbox="allow-scripts"`
and a Content Security Policy of `default-src 'none'`. That gives it an opaque origin (no access
to the page, cookies or storage) and no network. The game exchanges messages with it 30 times a
second. If it stops answering, or keeps exceeding the per-tick time budget, the iframe is removed,
which kills the worker; the robot's commands are reset to zero.

## Balancing

Change numbers only in `shared/src/config.ts`. The Guide and the part palette read their numbers
from the same file. Run `npm test` afterwards: it checks that robots still drive and every weapon
still damages the training target.

## Implementation notes

- A robot is one rigid body. Wheels push it through a grip model at each wheel's contact point,
  so weight, centre of mass and tipping all come from the part layout.
- Positive motor power on a wheel always drives towards the robot's FRONT, whichever side the
  motor is on.
- For the size limit, a wheel or spinning weapon counts only the cell at its hub. Its rim or
  blade may reach past the build grid.
- The arena walls look 1.5 m high but an invisible barrier continues above them.
- Robots are stored in `localStorage` under `rc.robots.v1`.
