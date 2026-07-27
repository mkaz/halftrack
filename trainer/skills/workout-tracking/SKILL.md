---
name: workout-tracking
description: Log, list, summarize, edit, delete, and show calendars for Halftrack running and gym workouts. Use whenever the user reports a completed workout or asks about workout history, mileage, pace, consistency, or records.
---

# Workout tracking

Use Halftrack's workout tools as the source of truth. Do not infer stored history from the conversation.

## Log a completed workout

1. Treat one visit or training session as one workout.
2. Represent each part as an activity. For example, “ran on the treadmill and worked on legs” becomes:
   - `run`: name `treadmill run`, with distance and duration
   - `strength`: name `legs`
3. Omit `date` when the user says today. Use the current local date supplied in the system prompt for relative dates such as yesterday.
4. Pass durations to tools as `MM:SS` or `HH:MM:SS`. Preserve the user's elapsed time exactly; do not convert `36:00` to `00:36`.
5. A run requires `distance_miles`. Do not invent missing mileage, time, exercises, sets, or intensity.
6. Use `details` for activity-specific information. Use workout `notes` for information about the whole session.
7. If the completed workout has enough required data, log it without asking for optional fields. Then confirm the workout ID, date, activities, mileage, time, and calculated pace concisely.
8. Ask one focused question only when a required fact is missing or two interpretations would create materially different records.

Do not log planned or hypothetical workouts as completed workouts.

## Read and answer questions

- Use `list_workouts` for session details, recent workouts, category filters, and locating IDs.
- Use `workout_stats` for totals, average pace, longest runs, category counts, and weekly mileage. Weeks run Monday through Sunday and include zero-mile weeks.
- Use both tools when analysis needs aggregate trends and the underlying sessions.
- Distinguish facts from the records, calculations from those facts, and coaching interpretation.
- Keep units explicit. Pace is minutes per mile.

## Show a calendar

Use `workout_calendar` with a month and year for one month, or only a year for all twelve months. Render a compact text calendar or date list and identify the activity categories on logged days.

## Correct a workout

1. Use `list_workouts` if the ID or current contents are not already known.
2. Call `update_workout` with only changed top-level fields.
3. If changing activities, send the complete corrected activity list because the tool replaces that list.
4. Confirm the resulting record.

## Delete a workout

Locate the workout ID, then call `delete_workout`. The tool—not the conversation—must obtain explicit interactive confirmation. Never claim a deletion succeeded if the tool says it was cancelled.
