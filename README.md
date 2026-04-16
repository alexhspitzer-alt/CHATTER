# CHATTER Prototype

A playable prototype for the surveillance triage game concept in `chatter_game_spec.json`.

## What this prototype demonstrates

- Rotating **hot word** obsession (state-driven, arbitrary focus).
- Dense, constantly moving chatter lanes with oppressive visual tone.
- Hot-word highlighting across live messages.
- Click-to-isolate focus mode that fades all other chatter.
- Time-pressure triage: detain before a line scrolls off-screen.
- Scoring feedback for true positives, false positives, and missed signals.
- Hybrid content generation:
  - noise from merged chatter pools,
  - host/donor runtime corruption,
  - authored rare signal lines.

## Run

Because the app fetches local JSON files, serve the folder over HTTP:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.
