# MYSTERY MANSION

Multiplayer browser detective game built with Node.js, Express, Socket.IO, HTML, CSS and vanilla JavaScript.

## Run locally
1. Install Node.js.
2. Extract this folder.
3. Open a terminal in the folder.
4. Run `npm install`
5. Run `npm start`
6. Open `http://localhost:3000` in multiple browser tabs/devices.

## Render deployment
- Create a new **Web Service** and connect this GitHub repository.
- Runtime: **Node**
- Build command: `npm install`
- Start command: `npm start`
- Environment variable: `NODE_ENV=production`
- No database or other environment variables required.

## Game rules implemented
- 2–8 human players, one shared secret solution (location, suspect, weapon, time).
- 28 non-solution cards form the draw pile.
- First entry into each room gives that player one private card and locks that room for them.
- On completing all eight rooms, the player gets one bonus card and their room exploration cycle resets.
- When the draw pile is empty, cards held from the current cycle are returned and shuffled. The permanent discovery notebook is retained.
- Each human turn starts with 8 energy. Movement costs 1 per cell; direct card questions cost 6.
- 80 completed human turns maximum. The 80th completed turn ends the game if nobody has won.
- The robot is a passive deadline indicator, not an opponent.

## Notes
This is a playable first release. The server owns the solution, hands, turn order, movement validation, discoveries, questions and accusations. Player notes are stored in the browser and are private to that browser/device.
