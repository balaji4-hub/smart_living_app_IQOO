# Smart Living

A smart-home app with a real-time 3D house, device controls, scenes, automations,
energy analytics and a local AI assistant — backed by a Node/SQLite house
simulator that models realistic device behaviour.

```
smart_home_app/
├── mobile/     React Native + Expo client (the app)
├── server/     Express + SQLite simulator (the house)
└── tests/      API smoke tests and a headless 3D scene suite
```

## Quick start

Requires Node 24+.

```bash
# 1. Install
npm install --prefix server
npm install --prefix mobile

# 2. Start the house simulator (seeds itself on first run)
npm run server

# 3. Start the app
npm run mobile
```

Then open the app in **Expo Go** and sign in:

```
demo@smartliving.app / demo1234
```

## How the pieces connect

The mobile app reads the API location from the environment:

| Variable | Purpose | Default |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | Full API base URL | `http://10.0.2.2:4000` (Android emulator) |
| `EXPO_PUBLIC_HOST` | Host only; app appends `:4000` | `localhost` |
| `SL_SECRET` | JWT signing secret | dev fallback — **set this in production** |
| `SL_LLM_URL` / `SL_LLM_KEY` / `SL_LLM_MODEL` | Optional external LLM | unset; local intent parser is used |

To test on a physical phone, set the address the phone can actually reach:

```bash
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:4000 npm run mobile
```

## Scripts

| Command | Does |
| --- | --- |
| `npm run server` | Start the simulator API |
| `npm run mobile` | Start the Expo dev server |
| `npm run typecheck` | Typecheck server and mobile |
| `npm test` | Full suite |
| `npm run test:api` | 51 API and WebSocket assertions |
| `npm run test:scene` | 17 headless three.js scene assertions |
| `npm run bundle:check` | Verify the Android bundle builds |

## The simulator

Seeds a 7-room house with 27 devices, 6 scenes and 6 automations. The simulation
loop models solar position, weather, occupancy and device physics, so power
draw, temperature, motion and air quality evolve plausibly instead of randomly.

Energy history is backfilled across the simulated past, and the local AI answers
questions about the house without any external API.

## Notes

- The 3D house uses `expo-gl` + three.js. `expo-gl` is native-only, so the 3D
  view does not render in a web browser.
- `server/data/` holds the generated SQLite database and is gitignored. Delete it
  to force a clean reseed.
- Expo Go only supports the SDK it was built for; this project targets SDK 57.