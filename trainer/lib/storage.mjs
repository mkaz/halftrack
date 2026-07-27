import { execFile } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const STORE_VERSION = 1;
export const ACTIVITY_CATEGORIES = [
  "run",
  "strength",
  "cardio",
  "mobility",
  "sport",
  "other",
];

const categorySet = new Set(ACTIVITY_CATEGORIES);

export function emptyStore() {
  return { version: STORE_VERSION, workouts: [] };
}

export function localDate(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function localTimestamp(now = new Date()) {
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const offsetRemainder = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 19);
  return `${local}${sign}${offsetHours}:${offsetRemainder}`;
}

export function validateDate(value, label = "Date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a real calendar date.`);
  }
  return value;
}

export function parseDuration(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^\d+:\d{2}(?::\d{2})?$/.test(value)) {
    throw new Error("Duration must be MM:SS or HH:MM:SS.");
  }
  const values = value.split(":").map(Number);
  if (values.length === 2) {
    const [minutes, seconds] = values;
    if (seconds >= 60) throw new Error("Duration seconds must be less than 60.");
    return minutes * 60 + seconds;
  }
  const [hours, minutes, seconds] = values;
  if (minutes >= 60 || seconds >= 60) {
    throw new Error("Duration minutes and seconds must be less than 60.");
  }
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatDuration(seconds) {
  if (seconds === undefined || seconds === null) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function formatPace(durationSeconds, miles) {
  if (durationSeconds === undefined || durationSeconds === null || !miles) return null;
  const seconds = Math.round(durationSeconds / miles);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} /mi`;
}

function normalizeActivity(activity) {
  if (!activity || typeof activity !== "object") throw new Error("Each activity must be an object.");
  if (!categorySet.has(activity.category)) {
    throw new Error(`Activity category must be one of: ${ACTIVITY_CATEGORIES.join(", ")}.`);
  }
  const name = typeof activity.name === "string" ? activity.name.trim() : "";
  if (!name) throw new Error("Each activity needs a name.");

  const durationSeconds = parseDuration(activity.duration);
  const distanceMiles = activity.distance_miles;
  if (distanceMiles !== undefined && (!Number.isFinite(distanceMiles) || distanceMiles <= 0)) {
    throw new Error("Activity distance_miles must be greater than zero.");
  }
  if (activity.category === "run" && distanceMiles === undefined) {
    throw new Error("A run activity requires distance_miles.");
  }

  const normalized = { category: activity.category, name };
  if (durationSeconds !== undefined) normalized.duration_seconds = durationSeconds;
  if (distanceMiles !== undefined) normalized.distance_miles = distanceMiles;
  if (activity.details?.trim()) normalized.details = activity.details.trim();
  return normalized;
}

function validateStoredActivity(activity) {
  if (!activity || typeof activity !== "object" || !categorySet.has(activity.category)) {
    throw new Error("Stored workout has an invalid activity category.");
  }
  if (typeof activity.name !== "string" || !activity.name.trim()) {
    throw new Error("Stored workout has an activity without a name.");
  }
  if (
    activity.duration_seconds !== undefined &&
    (!Number.isInteger(activity.duration_seconds) || activity.duration_seconds < 0)
  ) {
    throw new Error("Stored workout has an invalid duration_seconds value.");
  }
  if (
    activity.distance_miles !== undefined &&
    (!Number.isFinite(activity.distance_miles) || activity.distance_miles <= 0)
  ) {
    throw new Error("Stored workout has an invalid distance_miles value.");
  }
  if (activity.category === "run" && activity.distance_miles === undefined) {
    throw new Error("Stored run activity has no distance_miles value.");
  }
  if (activity.details !== undefined && typeof activity.details !== "string") {
    throw new Error("Stored workout has invalid activity details.");
  }
}

export function validateStore(store) {
  if (!store || store.version !== STORE_VERSION || !Array.isArray(store.workouts)) {
    throw new Error(`Halftrack data must use schema version ${STORE_VERSION}.`);
  }
  const ids = new Set();
  for (const workout of store.workouts) {
    if (!Number.isInteger(workout.id) || workout.id < 1 || ids.has(workout.id)) {
      throw new Error("Stored workouts must have unique positive integer IDs.");
    }
    ids.add(workout.id);
    validateDate(workout.date, "Stored workout date");
    if (!Array.isArray(workout.activities) || workout.activities.length === 0) {
      throw new Error(`Stored workout #${workout.id} has no activities.`);
    }
    workout.activities.forEach(validateStoredActivity);
    if (typeof workout.notes !== "string" || typeof workout.created_at !== "string") {
      throw new Error(`Stored workout #${workout.id} has invalid metadata.`);
    }
  }
  return store;
}

export async function readStore(path) {
  const contents = await readFile(path, "utf8");
  try {
    return validateStore(JSON.parse(contents));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Halftrack data is not valid JSON: ${path}`);
    throw error;
  }
}

export async function writeStore(path, store) {
  validateStore(store);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function migrateLegacyDatabase(path) {
  const query = `
    SELECT id, date, miles, duration_sec, run_type, notes, created_at
    FROM runs
    ORDER BY id
  `;
  let stdout;
  try {
    ({ stdout } = await execFileAsync("sqlite3", ["-json", path, query], {
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (error) {
    throw new Error(`Could not import legacy database ${path}: ${error.message}`);
  }
  const rows = stdout.trim() ? JSON.parse(stdout) : [];
  const workouts = rows.map((row) => {
    const activity = {
      category: "run",
      name: row.run_type || "run",
      distance_miles: Number(row.miles),
    };
    if (row.duration_sec !== null) activity.duration_seconds = Number(row.duration_sec);
    return {
      id: Number(row.id),
      date: row.date,
      activities: [activity],
      notes: row.notes || "",
      created_at: row.created_at || `${row.date}T00:00:00`,
    };
  });
  return validateStore({ version: STORE_VERSION, workouts });
}

export async function initializeStore(path, legacyDatabasePath) {
  if (await exists(path)) {
    const store = await readStore(path);
    return { store, migrated: 0 };
  }

  let store = emptyStore();
  let migrated = 0;
  if (legacyDatabasePath && (await exists(legacyDatabasePath))) {
    store = await migrateLegacyDatabase(legacyDatabasePath);
    migrated = store.workouts.length;
  }
  await writeStore(path, store);
  return { store, migrated };
}

export function addWorkout(store, input, now = new Date()) {
  validateStore(store);
  const activities = input.activities?.map(normalizeActivity) ?? [];
  if (activities.length === 0) throw new Error("A workout needs at least one activity.");
  const workout = {
    id: Math.max(0, ...store.workouts.map(({ id }) => id)) + 1,
    date: validateDate(input.date ?? localDate(now)),
    activities,
    notes: input.notes?.trim() ?? "",
    created_at: localTimestamp(now),
  };
  store.workouts.push(workout);
  return workout;
}

export function updateWorkout(store, id, changes, now = new Date()) {
  validateStore(store);
  const workout = store.workouts.find((item) => item.id === id);
  if (!workout) throw new Error(`No workout with ID ${id}.`);
  if (changes.date === undefined && changes.activities === undefined && changes.notes === undefined) {
    throw new Error("Provide a date, activities, or notes to update.");
  }
  if (changes.date !== undefined) workout.date = validateDate(changes.date);
  if (changes.activities !== undefined) {
    if (changes.activities.length === 0) throw new Error("A workout needs at least one activity.");
    workout.activities = changes.activities.map(normalizeActivity);
  }
  if (changes.notes !== undefined) workout.notes = changes.notes.trim();
  workout.updated_at = localTimestamp(now);
  return workout;
}

export function deleteWorkout(store, id) {
  validateStore(store);
  const index = store.workouts.findIndex((item) => item.id === id);
  if (index === -1) throw new Error(`No workout with ID ${id}.`);
  return store.workouts.splice(index, 1)[0];
}

export function getWorkout(store, id) {
  validateStore(store);
  const workout = store.workouts.find((item) => item.id === id);
  if (!workout) throw new Error(`No workout with ID ${id}.`);
  return workout;
}

export function listWorkouts(store, options = {}) {
  validateStore(store);
  const start = options.start_date ? validateDate(options.start_date, "Start date") : undefined;
  const end = options.end_date ? validateDate(options.end_date, "End date") : undefined;
  if (start && end && start > end) throw new Error("Start date must not be after end date.");
  const category = options.category;
  if (category !== undefined && !categorySet.has(category)) {
    throw new Error(`Category must be one of: ${ACTIVITY_CATEGORIES.join(", ")}.`);
  }
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Limit must be between 1 and 50.");
  }

  return [...store.workouts]
    .filter((workout) => !start || workout.date >= start)
    .filter((workout) => !end || workout.date <= end)
    .filter((workout) => !category || workout.activities.some((a) => a.category === category))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, limit);
}

function dateAdd(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(value) {
  const date = new Date(`${value}T00:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return dateAdd(value, -daysSinceMonday);
}

export function workoutStats(store, options = {}) {
  validateStore(store);
  const start = options.start_date ? validateDate(options.start_date, "Start date") : undefined;
  const end = options.end_date ? validateDate(options.end_date, "End date") : undefined;
  if (start && end && start > end) throw new Error("Start date must not be after end date.");
  const weeks = options.weeks ?? 8;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 104) {
    throw new Error("Weeks must be between 1 and 104.");
  }

  const workouts = store.workouts.filter(
    (workout) => (!start || workout.date >= start) && (!end || workout.date <= end),
  );
  const runs = workouts.flatMap((workout) =>
    workout.activities
      .filter((activity) => activity.category === "run")
      .map((activity) => ({ ...activity, workout_id: workout.id, date: workout.date })),
  );
  const totalMiles = runs.reduce((total, run) => total + (run.distance_miles ?? 0), 0);
  const timedRuns = runs.filter((run) => run.duration_seconds !== undefined);
  const totalDuration = timedRuns.reduce((total, run) => total + run.duration_seconds, 0);
  const timedMiles = timedRuns.reduce((total, run) => total + (run.distance_miles ?? 0), 0);
  const longest = [...runs].sort(
    (a, b) => (b.distance_miles ?? 0) - (a.distance_miles ?? 0) || a.date.localeCompare(b.date),
  )[0];
  const categories = Object.fromEntries(
    ACTIVITY_CATEGORIES.map((category) => [
      category,
      workouts.filter((workout) => workout.activities.some((a) => a.category === category)).length,
    ]),
  );

  const through = end ?? localDate();
  const finalMonday = mondayOf(through);
  const firstMonday = dateAdd(finalMonday, -(weeks - 1) * 7);
  const weeklyMileage = Array.from({ length: weeks }, (_, index) => ({
    week_of: dateAdd(firstMonday, index * 7),
    miles: 0,
  }));
  for (const run of runs) {
    const week = mondayOf(run.date);
    const item = weeklyMileage.find(({ week_of }) => week_of === week);
    if (item) item.miles += run.distance_miles ?? 0;
  }

  return {
    workout_count: workouts.length,
    activity_session_counts: categories,
    run_count: runs.length,
    total_miles: totalMiles,
    total_run_duration_seconds: totalDuration,
    total_run_duration: timedRuns.length ? formatDuration(totalDuration) : null,
    average_pace: timedMiles ? formatPace(totalDuration, timedMiles) : null,
    longest_run: longest
      ? {
          workout_id: longest.workout_id,
          date: longest.date,
          miles: longest.distance_miles,
        }
      : null,
    weekly_mileage: weeklyMileage,
  };
}

export function workoutCalendar(store, options = {}) {
  validateStore(store);
  const now = new Date();
  const year = options.year ?? now.getFullYear();
  const month = options.month ?? (options.year === undefined ? now.getMonth() + 1 : undefined);
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new Error("Year must be between 1 and 9999.");
  }
  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
    throw new Error("Month must be between 1 and 12.");
  }
  const prefix = month === undefined
    ? `${String(year).padStart(4, "0")}-`
    : `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-`;
  const dates = {};
  for (const workout of store.workouts.filter(({ date }) => date.startsWith(prefix))) {
    const current = dates[workout.date] ?? { workout_count: 0, categories: [] };
    current.workout_count += 1;
    current.categories = [
      ...new Set([...current.categories, ...workout.activities.map(({ category }) => category)]),
    ];
    dates[workout.date] = current;
  }
  return { year, month: month ?? null, dates };
}

export function displayWorkout(workout) {
  return {
    ...workout,
    activities: workout.activities.map((activity) => ({
      ...activity,
      duration: formatDuration(activity.duration_seconds),
      pace: formatPace(activity.duration_seconds, activity.distance_miles),
    })),
  };
}
