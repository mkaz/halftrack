# Halftrack

Halftrack is a personal running and workout tracker built as an isolated [Pi](https://pi.dev) instance. Start it and describe workouts in ordinary language; Halftrack stores structured JSON and can answer questions from the log.

## Start Halftrack

Install and authenticate Pi first. Halftrack uses your existing Pi providers and credentials.

```sh
./halftrack.sh
```

Then write naturally:

```text
I went to the gym today and ran on the treadmill for 36:00 and 3.0 miles. We worked on legs.

Show my last five workouts.
How many miles have I run in the last eight weeks?
What was my average pace this month?
Show my workout calendar for August 2026.
Change workout 14 to 3.2 miles.
Delete workout 14.
```

A completed session with a treadmill run and leg work is stored as one workout containing two activities. Halftrack calculates the run's `12:00 /mi` pace.

The launcher accepts Pi options, so a one-shot request also works:

```sh
./halftrack.sh -p "Summarize my running this month"
```

Deleting a workout is available only in interactive mode because Halftrack always asks for confirmation.

## Isolation from coding Pi

`halftrack.sh` retains global Pi authentication and model access, but replaces the coding-agent system prompt and disables discovered:

- context files
- built-in coding tools
- extensions
- skills
- prompt templates
- themes

It explicitly loads only `trainer/extensions/halftrack.ts` and `trainer/skills/workout-tracking/SKILL.md`. Keeping these resources outside the conventional `.pi/` directory prevents an ordinary `pi` session in this repository from auto-loading the trainer. Halftrack sessions are kept under `.halftrack/sessions/` instead of the normal Pi session directory.

Routine skill and workout tool calls are hidden in the interactive transcript. Press `Ctrl+O` to expand them when debugging. The custom footer is a live training dashboard showing this week's mileage, longest run, workout count, and latest session; it intentionally omits coding metrics, token usage, and cost.

In a terminal at least 100 columns wide, Halftrack also shows a right sidebar with the five most recent runs and the current month's workout calendar. Highlighted calendar days contain one or more logged workouts. The sidebar hides automatically in narrower terminals so the conversation keeps enough room.

## Data

The default data file is:

```text
~/Documents/Sync/halftrack.json
```

It is human-readable JSON with this shape:

```json
{
  "version": 1,
  "workouts": [
    {
      "id": 15,
      "date": "2026-08-30",
      "activities": [
        {
          "category": "run",
          "name": "treadmill run",
          "duration_seconds": 2160,
          "distance_miles": 3
        },
        {
          "category": "strength",
          "name": "legs"
        }
      ],
      "notes": "",
      "created_at": "2026-08-30T19:00:00-07:00"
    }
  ]
}
```

On first launch, if the JSON file does not exist and `~/Documents/Sync/halftrack.db` does, Halftrack imports the old SQLite run log. This one-time import requires the `sqlite3` command. The database is left unchanged. Later launches read only the JSON file.

Use `/data` inside Halftrack to display the active JSON path.

### Change local paths

Set these environment variables before launching:

```sh
HALFTRACK_DATA_FILE="$HOME/path/workouts.json" \
HALFTRACK_LEGACY_DB="$HOME/path/halftrack.db" \
HALFTRACK_SESSION_DIR="$HOME/path/sessions" \
HALFTRACK_MODEL="openai-codex/gpt-5.6-luna" \
./halftrack.sh
```

## Development

The storage module uses Node.js built-ins and has no project dependencies. Run the tests with:

```sh
node --test tests/storage.test.mjs
```

Validate that Pi can load the extension without starting a model turn:

```sh
HALFTRACK_DATA_FILE="$(mktemp -d)/halftrack.json" ./halftrack.sh --list-models
```
