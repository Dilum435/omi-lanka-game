# OMI Lanka — ශ්‍රී ලංකා ඕමි

A fully playable, self-hosted, account-free browser version of classic **Sri Lankan Omi**, featuring live private rooms and computer players. Built with **vanilla HTML, CSS, JavaScript and Node.js**. No API keys, databases, or npm package downloads are needed.

## Requirements

- Node.js 20 or later (`node --version`)
- A modern browser (Chrome, Edge, Firefox, Safari)

## Start

```bash
cd omi-lanka
npm start
```

Open **http://localhost:3000** in your browser.

Run tests:

```bash
npm test
```

Development mode: `npm run dev`.

To choose a port, run `PORT=8080 npm start` on macOS/Linux or `$env:PORT=8080; npm start` in PowerShell.

## How to play

**Computer mode:** Enter a player name, click **Play vs Computer**, and the game starts immediately with 3 computer opponents.

**Multiplayer mode:** Enter a name, click **Create friend room**, share the generated URL or six-character code. Friends click the link, enter their names, then the host clicks **Start**. Any empty seats are filled by bots, so 1–4 human participants can play. Teammates occupy opposite seats (1 and 3, 2 and 4).

**On the same home network:** Other devices should open `http://YOUR_COMPUTER_LAN_IP:3000`. To share rooms across the internet, deploy the Node server to any Node.js hosting provider, or provide a secure HTTPS tunnel. `localhost` links will only work on the hosting computer.

## Traditional rules included

- Four seats and two opposing partnerships (seats 1 + 3 versus 2 + 4).
- 32-card playing deck: 7, 8, 9, 10, J, Q, K, A of each suit, Ace high.
- Counterclockwise play. The player on the dealer's right calls trump after the first 4 cards are dealt. Then the remaining 4 are dealt to everyone.
- Trump caller leads the first trick. Follow suit whenever possible; otherwise play any card.
- The highest trump wins a trick, or the highest led-suit card if no trump was played. Trick winner leads the next trick.
- After 8 tricks, if the trump-calling team won 5–7, they score +1 token. Defenders who win 5–7 score +2. Sweeping all 8 is a **Kapothi** (+3). A 4–4 tie scores nothing and carries +1 bonus to the next decisive hand, stacking if needed.
- First team to earn 10 tokens wins the match. Dealer rotates one seat counterclockwise at each hand.

This edition uses **automatic Kapothi** (a full 8-trick sweep automatically earns 3 tokens). **Announced Kapothi** is an optional regional house-rule variation and is not implemented here.

## Project layout

```
omi-lanka/
  package.json          # No dependencies
  server.js             # HTTP server, real-time room events, bots, access control
  core.js               # Rule engine, card validation, scoring, AI
  public/
    index.html          # Pages and overlays
    styles.css          # Desktop & mobile visual design
    app.js              # Browser UI, SSE, private player views
    favicon.svg
  tests/
    game.test.js        # Rules engine tests
```

## Server architecture

The Node server is authoritative: the browser sends moves, while the server verifies turns, ownership and mandatory follow-suit. A player's network response reveals **only their own hand** and other players' card counts, not the other hands. Computer players use an in-server heuristic that generally follows suit, conserves trumps and tries not to trump a teammate's winning card. Gameplay updates are pushed using **Server-Sent Events (SSE)** and standard JSON POST actions (so no external WebSocket library is needed).

Lobby/game rooms are held **in memory** for a zero-setup install. Restarting the Node process clears games. Idle rooms are removed after six hours with no connected browsers. This is a complete playable project, **not** an account system or persistent tournament service.

## Public deployment considerations

For production hosting: run on an HTTPS domain using a reverse proxy, use a process manager, enforce request rate limits, add persistent storage/Redis and session expiry if scaling beyond one server process, and add health checks. For classroom/friends this self-contained single-process version works as provided. **No wagers or purchases** are implemented.

## References

- https://www.pagat.com/whist/omi.html — rules and regional variations
- https://www.sundaytimes.lk/180128/magazine/lankan-omi-app-introduces-a-local-game-to-a-new-generation-card-game-app-278305.html — local game context

Made as an independent educational adaptation, not affiliated with a commercial Omi application.
