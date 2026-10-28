# Sabotage Sprint

Play: https://sabotage-sprint.onrender.com/

A browser arcade racer with two modes: Race the Computer for one human versus a clearly labeled Rival CPU, and multiplayer rooms for 2–8 real players. Two clockwise laps, server-authoritative checkpoints/results, and exactly three visible, avoidable sabotage abilities: Gate Slam, Belt Flip and Oil Slick. No player account or download required. Both modes require Internet.

## Play alone or with friends

Enter a nickname. Select **Race the Computer** to start solo immediately; no room code or second human is needed. Select **Create a room** to invite friends by code/link. Multiplayer starts with two connected humans and never adds bots. Solo rooms accept only their original human's reserved reconnect credential.

Hold WASD/arrows to steer and accelerate; release to coast; Shift brakes. Touch uses the directions and Brake. Keys 1/2/3 or ability buttons activate sabotage. Cross checkpoints 1–4 in order and then the finish, twice. Hazards affect the caster too. The host can rematch or return to the lobby after results; Leave room returns to the welcome page.

## Run and test

Node.js 22 or newer:

```sh
npm ci
npm start
npm test
```

26 tests cover complete solo and eight-client multiplayer races, CPU identification/privacy, normal movement/checkpoints/finishes, invalid requests, capacity, reconnection, pickups, sabotage and rematch. computer.js is a server-only practice opponent using ordinary inputs and trusted action validation. Test-only human input drivers remain separate under test/ and are never presented as real players. Physical phones, other browser engines and eight humans still need acceptance testing.

The optional `npm run smoke -- https://YOUR-VERIFIED-GAME-URL` checks two real network clients on your own deployment. It requires an executor that can resolve and connect to the service's WebSocket endpoint; the ChatGPT browser successfully verified public multiplayer, but this executor's public socket test encountered a DNS limitation.

## Hosting

One long-running Node web service serves both the page and Socket.IO. Build npm ci, start npm start, Node 22, NODE_ENV=production, provider PORT. No API secrets, database or extra AI service is required for either mode. Keep one instance: rooms are in memory and reset on restart/deploy. /health returns readiness. render.yaml is an optional blueprint; direct service settings are authoritative for the current deployment. Automatic deploys are off; publish code changes with a deliberate deploy.

The welcome screen has cream/burgundy/coral racing-poster art and decorative exhibition cars with reduced-motion support. The race remains a dark Canvas overview. Submission cover art and judge instructions were delivered separately; they are not runtime downloads.

## Circuit update 0.9.0

The circuit is now 1200 × 800, with 225-pixel straights and 295-pixel side lanes. A full-width track replaces the cramped sidebar layout. Numbered racers match the compact classification strip; your car keeps its white ring.

Keyboard: hold WASD or arrows to drive, Shift to brake. Q/E selects a skill and Space uses it once per press. 1/2/3 still selects and fires directly. Click/tap a skill to fire it. Shared server validation, warning times, charges and cooldowns are unchanged. Touch keeps the steering pad and Brake button.
