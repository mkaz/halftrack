import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  addWorkout,
  deleteWorkout,
  displayWorkout,
  emptyStore,
  formatPace,
  initializeStore,
  listWorkouts,
  parseDuration,
  readStore,
  updateWorkout,
  workoutCalendar,
  workoutStats,
  writeStore,
} from "../trainer/lib/storage.mjs";

test("parses workout durations and formats running pace", () => {
  assert.equal(parseDuration("36:00"), 2160);
  assert.equal(parseDuration("1:02:03"), 3723);
  assert.equal(formatPace(2160, 3), "12:00 /mi");
  assert.throws(() => parseDuration("3:72"), /seconds must be less than 60/i);
});

test("logs a mixed workout and calculates run statistics", () => {
  const store = emptyStore();
  const workout = addWorkout(
    store,
    {
      date: "2026-08-30",
      activities: [
        {
          category: "run",
          name: "treadmill run",
          duration: "36:00",
          distance_miles: 3,
        },
        { category: "strength", name: "legs" },
      ],
      notes: "gym",
    },
    new Date("2026-08-30T19:00:00-07:00"),
  );

  const stats = workoutStats(store, { end_date: "2026-08-30", weeks: 2 });
  const displayed = displayWorkout(workout);

  assert.equal(workout.id, 1);
  assert.equal(workout.activities[0].duration_seconds, 2160);
  assert.equal(displayed.activities[0].pace, "12:00 /mi");
  assert.equal(stats.workout_count, 1);
  assert.equal(stats.run_count, 1);
  assert.equal(stats.total_miles, 3);
  assert.equal(stats.average_pace, "12:00 /mi");
  assert.equal(stats.activity_session_counts.strength, 1);
  assert.deepEqual(stats.weekly_mileage, [
    { week_of: "2026-08-17", miles: 0 },
    { week_of: "2026-08-24", miles: 3 },
  ]);
});

test("lists newest workouts and supports update and delete", () => {
  const store = emptyStore();
  addWorkout(store, {
    date: "2026-08-20",
    activities: [{ category: "run", name: "road run", distance_miles: 2 }],
  });
  addWorkout(store, {
    date: "2026-08-22",
    activities: [{ category: "strength", name: "upper body" }],
  });

  assert.deepEqual(listWorkouts(store).map(({ id }) => id), [2, 1]);
  updateWorkout(store, 1, { notes: "easy effort" });
  assert.equal(store.workouts[0].notes, "easy effort");
  assert.equal(deleteWorkout(store, 2).id, 2);
  assert.deepEqual(store.workouts.map(({ id }) => id), [1]);
});

test("returns calendar dates with workout categories", () => {
  const store = emptyStore();
  addWorkout(store, {
    date: "2026-03-04",
    activities: [{ category: "run", name: "easy run", distance_miles: 3 }],
  });
  addWorkout(store, {
    date: "2026-03-04",
    activities: [{ category: "mobility", name: "stretching" }],
  });

  assert.deepEqual(workoutCalendar(store, { year: 2026, month: 3 }), {
    year: 2026,
    month: 3,
    dates: {
      "2026-03-04": { workout_count: 2, categories: ["run", "mobility"] },
    },
  });
});

test("writes readable JSON and reads it back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "halftrack-test-"));
  const path = join(directory, "halftrack.json");
  const store = emptyStore();
  addWorkout(store, {
    date: "2026-07-27",
    activities: [{ category: "run", name: "trail run", distance_miles: 2.5 }],
  });

  await writeStore(path, store);

  assert.deepEqual(await readStore(path), store);
  assert.match(await readFile(path, "utf8"), /\n  "workouts": \[/);
});

test("imports the legacy SQLite run log once", async (t) => {
  try {
    execFileSync("sqlite3", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("sqlite3 is not installed");
    return;
  }

  const directory = await mkdtemp(join(tmpdir(), "halftrack-migration-"));
  const databasePath = join(directory, "halftrack.db");
  const jsonPath = join(directory, "halftrack.json");
  execFileSync("sqlite3", [
    databasePath,
    `CREATE TABLE runs (
      id INTEGER PRIMARY KEY,
      date TEXT,
      miles REAL,
      duration_sec INTEGER,
      run_type TEXT,
      notes TEXT,
      created_at TEXT
    );
    INSERT INTO runs VALUES (
      7, '2026-08-04', 3.2, 1800, 'easy', 'treadmill', '2026-08-04T08:00:00-07:00'
    );`,
  ]);

  const first = await initializeStore(jsonPath, databasePath);
  const second = await initializeStore(jsonPath, databasePath);

  assert.equal(first.migrated, 1);
  assert.equal(second.migrated, 0);
  assert.equal(second.store.workouts[0].id, 7);
  assert.equal(second.store.workouts[0].activities[0].distance_miles, 3.2);
  assert.equal(second.store.workouts[0].notes, "treadmill");
});
