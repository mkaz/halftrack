import { StringEnum } from "@earendil-works/pi-ai";
import {
  truncateHead,
  type ExtensionAPI,
  type ExtensionContext,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  HStack,
  isViewportTUI,
  Text,
  truncateToWidth,
  visibleWidth,
  type Component,
  type OverlayHandle,
  type OverlayOptions,
  type TUI,
} from "@earendil-works/pi-tui";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Type } from "typebox";

import {
  ACTIVITY_CATEGORIES,
  addWorkout,
  deleteWorkout,
  displayWorkout,
  getWorkout,
  initializeStore,
  listWorkouts,
  localDate,
  readStore,
  updateWorkout,
  workoutCalendar,
  workoutStats,
  writeStore,
} from "../lib/storage.mjs";

const dataFile = resolve(
  process.env.HALFTRACK_DATA_FILE ?? resolve(process.cwd(), "halftrack.json"),
);
const legacyDatabaseFile = process.env.HALFTRACK_LEGACY_DB
  ? resolve(process.env.HALFTRACK_LEGACY_DB)
  : undefined;
const skillsDirectory = resolve(
  process.env.HALFTRACK_SKILLS_DIR ?? resolve(process.cwd(), "trainer/skills"),
);

const categorySchema = StringEnum(ACTIVITY_CATEGORIES);
const activitySchema = Type.Object({
  category: categorySchema,
  name: Type.String({
    minLength: 1,
    maxLength: 200,
    description: "Plain name such as treadmill run, legs, cycling, or yoga",
  }),
  duration: Type.Optional(
    Type.String({ description: "Elapsed time as MM:SS or HH:MM:SS" }),
  ),
  distance_miles: Type.Optional(
    Type.Number({ exclusiveMinimum: 0, description: "Distance in miles; required for runs" }),
  ),
  details: Type.Optional(
    Type.String({ maxLength: 1000, description: "Exercises, sets, conditions, or other details" }),
  ),
});

const dateProperty = Type.Optional(
  Type.String({ description: "Local calendar date as YYYY-MM-DD; omit for today" }),
);
const notesProperty = Type.Optional(Type.String({ maxLength: 2000 }));

function textResult(text: string, details: unknown = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

function quietToolRendering(name: string) {
  return {
    renderShell: "self" as const,
    renderCall(args: unknown, _theme: unknown, context: { expanded: boolean }) {
      if (!context.expanded) return new Container();
      return new Text(`${name}\n${JSON.stringify(args, null, 2)}`, 0, 0);
    },
    renderResult(
      result: { content: Array<{ type: string; text?: string }> },
      options: { expanded: boolean },
    ) {
      if (!options.expanded) return new Container();
      const output = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join("\n");
      return new Text(output, 0, 0);
    },
  };
}

function workoutSummary(workout: ReturnType<typeof displayWorkout>) {
  const activities = workout.activities
    .map((activity) => {
      const metrics = [
        activity.distance_miles !== undefined ? `${activity.distance_miles} mi` : null,
        activity.duration,
        activity.pace,
      ].filter(Boolean);
      return `${activity.name}${metrics.length ? ` (${metrics.join(", ")})` : ""}`;
    })
    .join("; ");
  return `#${workout.id} · ${workout.date} · ${activities}${workout.notes ? ` · ${workout.notes}` : ""}`;
}

interface RecentRun {
  date: string;
  miles: number;
  pace: string | null;
}

interface DashboardSnapshot {
  thisWeekMiles: number;
  longestMiles: number | null;
  workoutCount: number;
  latest: string;
  recentRuns: RecentRun[];
  calendarYear: number;
  calendarMonth: number;
  workoutDates: Set<string>;
  today: string;
}

function shortDate(value: string) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, month, day] = value.split("-").map(Number);
  return `${months[month - 1]} ${day}`;
}

function buildDashboardSnapshot(store: Awaited<ReturnType<typeof readStore>>): DashboardSnapshot {
  const stats = workoutStats(store, { weeks: 1 });
  const latest = listWorkouts(store, { limit: 1 })[0];
  const today = localDate();
  const [calendarYear, calendarMonth] = today.split("-").map(Number);
  const calendar = workoutCalendar(store, { year: calendarYear, month: calendarMonth });
  let latestLabel = "No workouts yet — give Halftrack something to chase.";

  if (latest) {
    const displayed = displayWorkout(latest);
    const names = displayed.activities.map((activity) => activity.name).join(" + ");
    const run = displayed.activities.find((activity) => activity.category === "run");
    const runDetails = run
      ? [
          run.distance_miles !== undefined ? `${run.distance_miles.toFixed(1)} mi` : null,
          run.pace,
        ].filter(Boolean)
      : [];
    latestLabel = `${shortDate(displayed.date)} · ${names}${runDetails.length ? ` · ${runDetails.join(" @ ")}` : ""}`;
  }

  const recentRuns = listWorkouts(store, { category: "run", limit: 50 })
    .flatMap((workout) => {
      const displayed = displayWorkout(workout);
      return displayed.activities
        .filter((activity) => activity.category === "run")
        .map((activity) => ({
          date: displayed.date,
          miles: activity.distance_miles ?? 0,
          pace: activity.pace,
        }));
    })
    .slice(0, 5);

  return {
    thisWeekMiles: stats.weekly_mileage.at(-1)?.miles ?? 0,
    longestMiles: stats.longest_run?.miles ?? null,
    workoutCount: stats.workout_count,
    latest: latestLabel,
    recentRuns,
    calendarYear,
    calendarMonth,
    workoutDates: new Set(Object.keys(calendar.dates)),
    today,
  };
}

const SIDEBAR_WIDTH = 36;
const MIN_MAIN_WIDTH = 64;

function padLine(value: string, width: number) {
  const text = truncateToWidth(value, Math.max(0, width), "");
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

function panelLines(title: string, rows: string[], width: number, theme: ExtensionContext["ui"]["theme"]) {
  const innerWidth = Math.max(0, width - 4);
  const titleText = ` ${title} `;
  const fill = Math.max(0, width - visibleWidth(titleText) - 3);
  return [
    theme.fg("borderAccent", `╭─${titleText}${"─".repeat(fill)}╮`),
    ...rows.map((row) =>
      `${theme.fg("border", "│")} ${padLine(row, innerWidth)} ${theme.fg("border", "│")}`,
    ),
    theme.fg("border", `╰${"─".repeat(Math.max(0, width - 2))}╯`),
  ];
}

function recentRunLines(snapshot: DashboardSnapshot, theme: ExtensionContext["ui"]["theme"]) {
  if (snapshot.recentRuns.length === 0) return [theme.fg("dim", "No runs yet")];
  return snapshot.recentRuns.map((run) => {
    const pace = run.pace?.replace(" /mi", "") ?? "—";
    return `${theme.fg("muted", shortDate(run.date).padEnd(6))}  ${theme.fg("success", `${run.miles.toFixed(1)} mi`.padStart(6))}  ${theme.fg("text", `${pace} /mi`)}`;
  });
}

function calendarLines(snapshot: DashboardSnapshot, theme: ExtensionContext["ui"]["theme"]) {
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const firstWeekday = new Date(Date.UTC(snapshot.calendarYear, snapshot.calendarMonth - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(snapshot.calendarYear, snapshot.calendarMonth, 0)).getUTCDate();
  const cells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => {
    if (index < firstWeekday) return "  ";
    const day = index - firstWeekday + 1;
    const date = `${snapshot.calendarYear}-${String(snapshot.calendarMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const label = String(day).padStart(2);
    if (snapshot.workoutDates.has(date)) {
      return theme.fg("error", theme.bold(label));
    }
    if (date === snapshot.today) return theme.fg("accent", theme.bold(label));
    return theme.fg("muted", label);
  });
  while (cells.length % 7 !== 0) cells.push("  ");

  const weeks = Array.from({ length: cells.length / 7 }, (_, index) =>
    cells.slice(index * 7, index * 7 + 7).join("  "),
  );
  return [
    theme.fg("accent", theme.bold(`${monthNames[snapshot.calendarMonth - 1]} ${snapshot.calendarYear}`)),
    theme.fg("dim", "Su  Mo  Tu  We  Th  Fr  Sa"),
    ...weeks,
    "",
    `${theme.fg("error", theme.bold("##"))} ${theme.fg("dim", "workout")}`,
  ];
}

function createSidebarComponent(
  getSnapshot: () => DashboardSnapshot,
  getHeight: () => number,
  theme: ExtensionContext["ui"]["theme"],
): Component {
  return {
    render(width: number) {
      const safeWidth = Math.max(1, width);
      const panelWidth = Math.max(4, safeWidth - 2);
      const rows = [
        ...panelLines("RECENT RUNS", recentRunLines(getSnapshot(), theme), panelWidth, theme),
        "",
        ...panelLines("WORKOUT CALENDAR", calendarLines(getSnapshot(), theme), panelWidth, theme),
      ];
      return Array.from({ length: Math.max(0, getHeight()) }, (_, index) => {
        const content = padLine(rows[index] ?? "", panelWidth);
        return truncateToWidth(`${theme.fg("borderAccent", "│")} ${content}`, safeWidth, "");
      });
    },
    invalidate() {},
  };
}

const REGULAR_RENDER_ADAPTER = Symbol("halftrack.regular-render-adapter");
const FULLSCREEN_LAYOUT_ADAPTER = Symbol("halftrack.fullscreen-layout-adapter");
type RenderFunction = TUI["render"];
type AdaptedTui = TUI & {
  [REGULAR_RENDER_ADAPTER]?: { owner: object; baseRender: RenderFunction };
  [FULLSCREEN_LAYOUT_ADAPTER]?: { owner: object; originalRoot: Component; splitRoot: Component };
  layoutRoot?: Component;
};

function createSidebarController(ctx: ExtensionContext, getSnapshot: () => DashboardSnapshot) {
  const owner = {};
  let tui: TUI | undefined;
  let closeOverlay: (() => void) | undefined;
  let overlayHandle: OverlayHandle | undefined;

  const isVisible = (width: number) => width >= MIN_MAIN_WIDTH + SIDEBAR_WIDTH;
  const overlayOptions: OverlayOptions = {
    anchor: "top-right",
    width: SIDEBAR_WIDTH,
    maxHeight: "100%",
    margin: 0,
    nonCapturing: true,
    visible: (width) => isVisible(width),
  };

  function attach(nextTui: TUI) {
    tui = nextTui;
    const adapted = nextTui as AdaptedTui;
    if (nextTui.mode === "regular" && !adapted[REGULAR_RENDER_ADAPTER]) {
      let prototype = Object.getPrototypeOf(nextTui) as object | null;
      let baseRender: RenderFunction | undefined;
      while (prototype) {
        const candidate = Object.getOwnPropertyDescriptor(prototype, "render")?.value;
        if (typeof candidate === "function") {
          baseRender = candidate as RenderFunction;
          break;
        }
        prototype = Object.getPrototypeOf(prototype) as object | null;
      }
      if (baseRender) {
        adapted[REGULAR_RENDER_ADAPTER] = { owner, baseRender };
        adapted.render = (width: number) =>
          Reflect.apply(baseRender!, nextTui, [isVisible(width) ? width - SIDEBAR_WIDTH : width]);
      }
    } else if (nextTui.mode === "fullscreen" && isViewportTUI(nextTui) && adapted.layoutRoot) {
      const originalRoot = adapted.layoutRoot;
      const splitRoot = new HStack([
        { component: originalRoot, basis: 0, grow: 1, shrink: 1, minSize: MIN_MAIN_WIDTH },
        {
          component: { render: () => [], invalidate() {} },
          basis: SIDEBAR_WIDTH,
          grow: 0,
          shrink: 1,
          visible: ({ width }) => isVisible(width),
        },
      ]);
      nextTui.setLayoutRoot(splitRoot);
      adapted[FULLSCREEN_LAYOUT_ADAPTER] = { owner, originalRoot, splitRoot };
    }
  }

  function dispose() {
    closeOverlay?.();
    closeOverlay = undefined;
    overlayHandle?.hide();
    overlayHandle = undefined;
    if (!tui) return;
    const adapted = tui as AdaptedTui;
    const regular = adapted[REGULAR_RENDER_ADAPTER];
    if (regular?.owner === owner) {
      adapted.render = regular.baseRender;
      adapted[REGULAR_RENDER_ADAPTER] = undefined;
    }
    const fullscreen = adapted[FULLSCREEN_LAYOUT_ADAPTER];
    if (fullscreen?.owner === owner && isViewportTUI(tui) && adapted.layoutRoot === fullscreen.splitRoot) {
      tui.setLayoutRoot(fullscreen.originalRoot);
      adapted[FULLSCREEN_LAYOUT_ADAPTER] = undefined;
    }
    tui.requestRender();
    tui = undefined;
  }

  const pending = ctx.ui.custom<void>(
    (nextTui, theme, _keybindings, done) => {
      attach(nextTui);
      closeOverlay = () => done(undefined);
      return createSidebarComponent(getSnapshot, () => nextTui.terminal.rows, theme);
    },
    {
      overlay: true,
      overlayOptions,
      onHandle: (handle) => {
        overlayHandle = handle;
      },
    },
  );
  void pending.catch((error) => {
    ctx.ui.notify(`Halftrack sidebar failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    dispose();
  });

  return {
    requestRender() {
      tui?.requestRender();
    },
    dispose,
  };
}

export default function halftrack(pi: ExtensionAPI) {
  let initialization: Promise<Awaited<ReturnType<typeof initializeStore>>> | undefined;
  const today = localDate();
  const [calendarYear, calendarMonth] = today.split("-").map(Number);
  let dashboardSnapshot: DashboardSnapshot = {
    thisWeekMiles: 0,
    longestMiles: null,
    workoutCount: 0,
    latest: "No workouts yet — give Halftrack something to chase.",
    recentRuns: [],
    calendarYear,
    calendarMonth,
    workoutDates: new Set(),
    today,
  };
  let requestFooterRender: (() => void) | undefined;
  let sidebar: ReturnType<typeof createSidebarController> | undefined;

  function ensureInitialized() {
    initialization ??= initializeStore(dataFile, legacyDatabaseFile);
    return initialization;
  }

  function updateDashboard(store: Awaited<ReturnType<typeof readStore>>) {
    dashboardSnapshot = buildDashboardSnapshot(store);
    requestFooterRender?.();
    sidebar?.requestRender();
  }

  async function mutateStore<T>(mutation: (store: Awaited<ReturnType<typeof readStore>>) => T) {
    await ensureInitialized();
    return withFileMutationQueue(dataFile, async () => {
      const store = await readStore(dataFile);
      const result = mutation(store);
      await writeStore(dataFile, store);
      updateDashboard(store);
      return result;
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    sidebar?.dispose();
    sidebar = undefined;
    const { migrated, store } = await ensureInitialized();
    updateDashboard(store);
    if (ctx.hasUI) {
      ctx.ui.setTitle("Halftrack · Personal Trainer");
      ctx.ui.setWorkingMessage("Checking the training log...");
      ctx.ui.setToolsExpanded(false);
      if (ctx.mode === "tui") {
        ctx.ui.setHeader((_tui, theme) => ({
          render(width: number) {
            const lines = [
              "",
              theme.fg("accent", theme.bold(" _           _  __ _                  _    ")),
              theme.fg("accent", theme.bold("| |__   __ _| |/ _| |_ _ __ __ _  ___| | __")),
              theme.fg("accent", theme.bold("| '_ \\ / _` | | |_| __| '__/ _` |/ __| |/ /")),
              theme.fg("accent", theme.bold("| | | | (_| | |  _| |_| | | (_| | (__|   < ")),
              theme.fg("accent", theme.bold("|_| |_|\\__,_|_|_|  \\__|_|  \\__,_|\\___|_|\\_\\")),
              "",
            ];
            return lines.map((line) => truncateToWidth(line, Math.max(1, width), ""));
          },
          invalidate() {},
        }));

        ctx.ui.setFooter((tui, theme) => {
          requestFooterRender = () => tui.requestRender();
          return {
            dispose() {
              requestFooterRender = undefined;
            },
            invalidate() {},
            render(width: number) {
              const safeWidth = Math.max(1, width);
              const week = `${dashboardSnapshot.thisWeekMiles.toFixed(1)} MI`;
              const longest = dashboardSnapshot.longestMiles === null
                ? "—"
                : `${dashboardSnapshot.longestMiles.toFixed(1)} MI`;
              const dashboard =
                theme.fg("accent", theme.bold("◆ HALFTRACK // TRAINING DECK")) +
                theme.fg("muted", "   WEEK ") +
                theme.fg("success", theme.bold(week)) +
                theme.fg("muted", "   LONG ") +
                theme.fg("success", theme.bold(longest)) +
                theme.fg("muted", "   WORKOUTS ") +
                theme.fg("success", theme.bold(String(dashboardSnapshot.workoutCount)));
              const latest =
                theme.fg("accent", "↳ LAST  ") + theme.fg("text", dashboardSnapshot.latest);
              return [
                theme.fg("borderAccent", "━".repeat(safeWidth)),
                truncateToWidth(dashboard, safeWidth, ""),
                truncateToWidth(latest, safeWidth, ""),
              ];
            },
          };
        });

        sidebar = createSidebarController(ctx, () => dashboardSnapshot);
      }
      if (migrated > 0) {
        ctx.ui.notify(`Imported ${migrated} runs from the legacy Halftrack database.`, "info");
      }
    }
  });

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\nCurrent local date: ${localDate()}. The workout data file is ready.`,
  }));

  pi.registerTool({
    ...quietToolRendering("load_skill"),
    name: "load_skill",
    label: "Load Halftrack Skill",
    description:
      "Load Halftrack's workout-tracking instructions. Select the workout-tracking skill; do not construct a filesystem path.",
    parameters: Type.Object({
      skill: Type.Optional(StringEnum(["workout-tracking"] as const)),
      path: Type.Optional(
        Type.String({
          description: "Compatibility only: a SKILL.md path supplied by Pi",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const root = await realpath(skillsDirectory);
      const trackingSkill = await realpath(resolve(root, "workout-tracking/SKILL.md"));
      let requested = trackingSkill;
      let usedFallback = false;

      if (params.path) {
        try {
          requested = await realpath(resolve(params.path));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          usedFallback = true;
        }
      }

      if (requested !== root && !requested.startsWith(`${root}${sep}`)) {
        throw new Error("Only Halftrack skill files can be read.");
      }
      if (!requested.endsWith(".md")) throw new Error("Halftrack skills must be Markdown files.");
      const contents = await readFile(requested, "utf8");
      const output = truncateHead(contents, { maxLines: 2000, maxBytes: 50 * 1024 });
      if (output.truncated) throw new Error("The skill is too large to load safely.");
      return textResult(output.content, {
        path: requested,
        requested_path: params.path,
        used_fallback: usedFallback,
      });
    },
  });

  pi.registerTool({
    ...quietToolRendering("log_workout"),
    name: "log_workout",
    label: "Log Workout",
    description:
      "Save one completed workout with one or more activities. A gym visit containing a run and strength work is one workout with two activities. Omit date for today.",
    parameters: Type.Object({
      date: dateProperty,
      activities: Type.Array(activitySchema, { minItems: 1, maxItems: 20 }),
      notes: notesProperty,
    }),
    async execute(_toolCallId, params) {
      const workout = await mutateStore((store) => addWorkout(store, params));
      const displayed = displayWorkout(workout);
      return textResult(`Saved workout ${workoutSummary(displayed)}`, { workout: displayed });
    },
  });

  pi.registerTool({
    ...quietToolRendering("list_workouts"),
    name: "list_workouts",
    label: "List Workouts",
    description:
      "Read workout records newest first. Use before answering questions about specific sessions and before editing by ID.",
    parameters: Type.Object({
      start_date: Type.Optional(Type.String({ description: "Inclusive YYYY-MM-DD" })),
      end_date: Type.Optional(Type.String({ description: "Inclusive YYYY-MM-DD" })),
      category: Type.Optional(categorySchema),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
    }),
    async execute(_toolCallId, params) {
      await ensureInitialized();
      const store = await readStore(dataFile);
      const workouts = listWorkouts(store, params).map(displayWorkout);
      const body = workouts.length
        ? workouts.map(workoutSummary).join("\n")
        : "No matching workouts.";
      return textResult(body, { workouts });
    },
  });

  pi.registerTool({
    ...quietToolRendering("workout_stats"),
    name: "workout_stats",
    label: "Workout Stats",
    description:
      "Calculate workout totals, running mileage and pace, longest run, activity counts, and Monday-through-Sunday weekly mileage including zero-mile weeks.",
    parameters: Type.Object({
      start_date: Type.Optional(Type.String({ description: "Inclusive YYYY-MM-DD" })),
      end_date: Type.Optional(Type.String({ description: "Inclusive YYYY-MM-DD" })),
      weeks: Type.Optional(Type.Integer({ minimum: 1, maximum: 104, default: 8 })),
    }),
    async execute(_toolCallId, params) {
      await ensureInitialized();
      const stats = workoutStats(await readStore(dataFile), params);
      return textResult(JSON.stringify(stats, null, 2), { stats });
    },
  });

  pi.registerTool({
    ...quietToolRendering("workout_calendar"),
    name: "workout_calendar",
    label: "Workout Calendar",
    description:
      "Get workout dates and activity categories for a calendar. Omit both fields for the current month, provide month and year for one month, or provide only year for all twelve months.",
    parameters: Type.Object({
      year: Type.Optional(Type.Integer({ minimum: 1, maximum: 9999 })),
      month: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
    }),
    async execute(_toolCallId, params) {
      await ensureInitialized();
      const calendar = workoutCalendar(await readStore(dataFile), params);
      return textResult(JSON.stringify(calendar, null, 2), { calendar });
    },
  });

  pi.registerTool({
    ...quietToolRendering("update_workout"),
    name: "update_workout",
    label: "Update Workout",
    description:
      "Replace supplied fields on a workout. When replacing activities, send the complete corrected activity list; omitted fields remain unchanged.",
    parameters: Type.Object({
      id: Type.Integer({ minimum: 1 }),
      date: dateProperty,
      activities: Type.Optional(Type.Array(activitySchema, { minItems: 1, maxItems: 20 })),
      notes: notesProperty,
    }),
    async execute(_toolCallId, params) {
      const { id, ...changes } = params;
      const workout = await mutateStore((store) => updateWorkout(store, id, changes));
      const displayed = displayWorkout(workout);
      return textResult(`Updated workout ${workoutSummary(displayed)}`, { workout: displayed });
    },
  });

  pi.registerTool({
    ...quietToolRendering("delete_workout"),
    name: "delete_workout",
    label: "Delete Workout",
    description:
      "Delete a workout by ID. This tool always shows the stored workout and asks the user for explicit confirmation.",
    parameters: Type.Object({ id: Type.Integer({ minimum: 1 }) }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) throw new Error("Deleting a workout requires interactive confirmation.");
      return withFileMutationQueue(dataFile, async () => {
        await ensureInitialized();
        const store = await readStore(dataFile);
        const existing = displayWorkout(getWorkout(store, params.id));
        const confirmed = await ctx.ui.confirm(
          `Delete workout #${params.id}?`,
          `${workoutSummary(existing)}\n\nThis cannot be undone.`,
        );
        if (!confirmed) return textResult("Workout was not deleted.", { deleted: false });
        const deleted = deleteWorkout(store, params.id);
        await writeStore(dataFile, store);
        updateDashboard(store);
        return textResult(`Deleted workout #${deleted.id}.`, {
          deleted: true,
          workout: displayWorkout(deleted),
        });
      });
    },
  });

  pi.on("session_shutdown", () => {
    sidebar?.dispose();
    sidebar = undefined;
    requestFooterRender = undefined;
  });

  pi.registerCommand("data", {
    description: "Show the Halftrack JSON data file",
    handler: async (_args, ctx) => {
      await ensureInitialized();
      ctx.ui.notify(dataFile, "info");
    },
  });
}
