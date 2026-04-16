# CHATTER
A text game where you must protect order from alleged dissidents.

## Prototype (this repo)
This repository now includes a playable web prototype that demonstrates the game spec's core loop:

- Continuous multi-lane scrolling chatter under time pressure
- Rotating state-assigned hot words limited to the five tuned false-positive sets (culvert, latch, threshold, cinder, spigot)
- Click-to-isolate focus mode that mutes other lanes
- Detain / Release decisions before lines disappear
- Hybrid authored + runtime-corrupted chatter generation
- Oppressive, hostile UI tone consistent with the design brief

### Run locally
From repo root:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.
