# Sabotage Sprint

A real multiplayer browser racing game for 2–8 players. Two clockwise laps, server-authoritative checkpoints and results, and exactly three visible, avoidable sabotage abilities: Gate Slam, Belt Flip and Oil Slick. No player accounts, bots or downloads.

## Run

Node.js 22 or newer:

```sh
npm ci
npm start
```

Open http://localhost:3000 in separate browser sessions. Create a room, share its code/invite, and start with at least two connected players.

## Controls

Hold WASD or arrows to steer/accelerate; release to coast; Space brakes. Touch uses the on-screen direction pad and Brake. Keys 1/2/3 or the ability buttons activate sabotage. All hazards affect the caster too. Cross checkpoints 1–4 in order and then the finish, twice.

## Tests

```sh
npm test
npm run smoke -- https://YOUR-VERIFIED-GAME-URL
```

21 automated checks cover complete eight-client network races, invalid requests, capacity, reconnection, pickups, hazards and stable finishes. Test-only input drivers are never loaded as game opponents. Physical phones, other browser engines and eight humans still need acceptance testing.

## Hosting

One long-running Node web service serves both the page and Socket.IO. Build `npm ci`, start `npm start`, Node 22, NODE_ENV=production, provider PORT. No API secrets or database required. Keep one instance: rooms are in memory and reset on restart. `/health` returns readiness. `render.yaml` is an optional blueprint; direct service settings are authoritative for this deployment.

The welcome screen uses cream/burgundy/coral racing-poster art and decorative exhibition cars, with reduced-motion support. The actual race remains a dark, readable Canvas circuit. The generated submission cover and detailed submission kit are in the separately delivered release ZIP; they are not runtime assets.
