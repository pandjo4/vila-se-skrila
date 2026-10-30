# MYSTERY MANSION

Multiplayer browser detective game built with Node.js, Express, Socket.IO, HTML, CSS and vanilla JavaScript.

## Local run

1. Install Node.js (current LTS recommended).
2. Open a terminal in this folder.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000` in multiple browser tabs/devices.

## Render deployment

- Create a **Web Service** connected to this GitHub repository.
- Runtime: **Node**.
- Build command: `npm install`.
- Start command: `npm start`.
- No environment variables are required; Render's `PORT` is used automatically.

## Current game rules

- 2–8 human players.
- One hidden solution containing one location, suspect, weapon and time card.
- The hidden solution is randomly selected from each category at the start of every game.
- The remaining cards form the draw pile.
- First entry into each room gives that player one private card and locks that room for that player's current exploration cycle.
- After all eight rooms are explored, the player receives a bonus card and their room exploration cycle resets.
- Each human turn starts with 8 energy. Movement costs 1 energy per cell; one private card interrogation costs 6 energy; using the tunnel costs 4 energy.
- There are exactly two tunnel entrances. They form one bidirectional pair.
- The active player can ask another connected player about one specific card. The selected player must answer privately with YES or NO. The server validates the answer against the player's current hand; historical discoveries are not treated as current possession.
- A truthful YES automatically marks that card as known in the asking player's notebook. NO does not create a false confirmation.
- Cards discovered by a player are automatically recorded as known in that player's notebook.
- Notebook statuses: Unknown, Suspected and Confirmed. Confirmed cards are protected from accidental manual removal because they are established evidence.
- The player may make one final accusation per game.
- 80 completed human turns maximum. If the deadline is reached, the case ends without a winner.

## Multiplayer and privacy

- The server validates movement, turn ownership, energy, tunnel use, accusations and interrogation responses.
- Private hands and private interrogation responses are sent only to the relevant player socket.
- Public game state does not include private cards.
- A disconnected player can reconnect with the same room code and the identity stored in that browser's local storage, provided the Render process and in-memory room still exist.

## Persistence limitation

This release does not use a database. Rooms, player hands, the hidden solution and active game state live in server memory and are lost if the Render service restarts, redeploys or its process is replaced. Reconnection restores a player only while that in-memory room still exists. A database or persistent store would be required for recovery across server restarts.

Personal free-text notes are saved locally in the browser that created them; they are not synchronized between devices.

## Quality assurance notes

The source was checked for JavaScript syntax errors, missing static DOM IDs, duplicate HTML IDs and the exact two tunnel coordinates. A full live multiplayer/browser test against Render could not be performed in this environment. Before publishing, test with at least two separate devices and verify room creation/joining, all turn transitions, both tunnel directions, YES/NO interrogation, notebook updates, reconnection and mobile touch controls.
