# Sabotage Sprint — Two Circuits v1.2

Play: https://sabotage-sprint.onrender.com/

An anonymous multiplayer browser combat racer for 2–8 people, plus one-player practice against a clearly labeled Rival CPU. No player account or installation. Internet access required.

## New game experience

Choose Switchyard XL or the new Marina Rush before creating a room or starting solo. The host can change the course in the lobby for everyone; course geometry is isolated per room and cannot be changed during a countdown or race. Marina Rush has 14 turns, sunset water, islands, palms, boats, a lighthouse and pier bends. Switchyard XL keeps its 12-turn warehouse course.

Switchyard XL is an 8,220-unit lap with 12 turns, compared with the previous compact roughly 2,600-unit loop. Lanes are 150 units wide. A smooth following camera fills the playfield; the minimap shows the complete circuit and every racer. Choose 2, 5 or 7 laps, with 12 ordered checkpoints per lap on Switchyard (14 on Marina), and a real finish line are validated by the server. No cutting across the infield. The fixed barriers from the old course are removed.

Hold WASD/arrows to drive and steer. Direction changes turn quickly with automatic corner speed reduction. Release to coast; Shift brakes. Touch players use the directional pad and Brake. Space uses the selected ability; Q/E changes it. Keys 1/2/3 or ability buttons select and fire directly. The large Space / Tap button also fires the selected ability.

- **Shoot / Pulse Shot:** a bright projectile uses forward aim assistance within 30 degrees and 850 units, with a target marker and a larger hit area. The server checks line of sight and leads moving rivals slightly. Shots can still miss or stop at walls. A hit-confirmation banner tells the shooter when a tag lands.
- **Bomb / Drop Bomb:** a bomb drops behind the car, with a visible 1.4-second fuse and a larger 125-unit blast. The explosion slows rivals by 45% for 1.8 seconds without disabling controls. A shockwave and distinct bomb-hit banner make the result clear.
- **Nitro:** a visible blue trail accompanies a 30% speed boost lasting 1.8 seconds.

Each of the four abilities starts with 3 separate charges, capped at 5 per skill. Every skill card shows its remaining charges. Shared single-use lightning pickups refill one charge of your lowest-stocked skill (ties use Shoot, Bomb, Nitro, Wall order). All abilities share a 3-second cooldown. Weapons cannot hit their owner. Shots slow by 20% for 0.7 seconds. Bombs slow by 45% for 1.8 seconds. Recovery protection prevents repeat hits for at least 2.4 seconds, preventing repeated hits from permanently stopping a racer. No vehicle destruction or elimination. Race limits scale with the chosen lap count: 4, 10 or 14 minutes. After a first finisher, remaining racers have up to 150, 225 or 315 seconds respectively, bounded by the overall limit. Rematch and return to lobby work in both modes.

## Architecture

One Node 22 process serves the Canvas frontend and Socket.IO backend, with no database, API secrets or AI API. Server simulation runs at 20Hz; clients send bounded input, predict their own movement and smooth remote cars. Only the server awards progress, finishes, pickups and weapon hits. Room codes and shareable URLs, maximum eight seats, 15-second reconnect reservations, host migration, stale-input protection and idle cleanup are retained. Multiplayer contains real connected humans only. The CPU exists only in private solo mode and uses normal movement/ability requests.

Only the host can change lap count in a multiplayer lobby. Solo players choose on the welcome screen or in their lobby. The server validates 2/5/7, locks the count at race start, awards the finish only after the chosen number of legal laps, and preserves it for rematches. The CPU route and progress bar use that same count.

## Run and verify

```
npm ci
npm start
npm test
```

An eight-second synchronized start shows a quick Shoot / Bomb / Nitro guide, then the final 3–2–1 countdown. Hit effects never disable throttle or steering.

The tests cover the long track, all twelve checkpoints, responsive steering, finish ordering and ties, weapon hits/misses/warnings/expiry/immunity, shared pickups, malformed requests, disconnects/reconnects/host migration, solo/rematches, and full eight-independent-client races. These are automated network clients, not eight human Internet players. Physical-phone and browser-family tests must be reported separately.

## Hosting

One existing Render Free Node web service serves both the frontend and multiplayer backend. `npm ci`, then `npm start`, with `NODE_ENV=production` and Node 22. Render supplies `PORT`; the server binds `0.0.0.0`. No new dependency, secret, database or paid plan is needed. Public source updates use a deliberate deploy (auto-deploy is off). Rooms are in memory and disappear on restart/deploy. Free hosting may sleep when idle and take time to wake.

Source: https://github.com/sidharthsssu-alt/sabotage-sprint.

The submission cover and submission notes are delivered separately. No contest submission is made automatically.

## v1.3 combat clarity

Shoot uses a plus-shaped crosshair: a gold reticle and LOCKED label mark the server-selected rival; cyan means no lock. Aim assist rules and projectile collisions remain authoritative.

Breakaway Wall (4, or select with Q/E and press Space) drops a striped barrier 66 units behind the car, centered on the road. It warns for 0.8 seconds, lasts 4 seconds, and breaks on the first rival contact, slowing that rival 50% for 1.1 seconds. It does not stop steering, harm its owner, or form a permanent blockade. Recovery-protected rivals break through without another slowdown. Unsafe corner placements and overlapping walls are rejected without consuming a charge.

## v1.4 visual identity

The welcome page uses real track photography by Wes Tindel (Unsplash License), locally hosted with attribution, and locally hosted Barlow Condensed racing typography (SIL OFL 1.1). Asset provenance and font license are in public/assets/CREDITS.txt and OFL-Barlow.txt. Asphalt black, warm ivory and racing red replace the former welcome palette; the same interface colors carry into the lobby/HUD. Track geometry, controls, physics, inventory, sabotage and networking are unchanged. The photo is promotional welcome artwork; gameplay remains top-down Canvas racing.

## v1.6 large car background

The race window uses one oversized real racing-car photograph behind the road and racers. It is a viewport background, without billboard frames, panels or trackside photo captions. A light ivory or pale blue wash keeps it decorative while the road, hazards and cars stay clear. The road cache has transparent off-road pixels; a separate background cache updates only on viewport/course/image changes. The warm-white dashboard is retained. No track geometry, controls, collisions, abilities or networking logic changed. Photo attribution and license remain in public/assets/CREDITS.txt.
