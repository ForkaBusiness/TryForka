// A meal-prep session that fits about an hour by overlapping tasks: while the oven and the
// hob do their work, the cook chops, mixes and packs. Pure and deterministic, no imports.
//
// Model: one cook. A hands-on task keeps the cook busy for its `minutes`. A hands-off task
// (oven, simmering, chilling, marinating) keeps the cook busy for `startMinutes` to get it
// going, then runs on its own until `minutes` have passed. A task starts only when every
// task in its `after` list has finished.
//
// Scheduling is greedy list scheduling: whenever the cook is free, start the ready
// hands-off task with the longest remaining chain first (so long oven and simmer times
// begin early), otherwise the ready hands-on task with the longest remaining chain. The
// remaining chain is the task's own minutes plus the longest chain of tasks waiting on it,
// which is plain "longest first" for tasks nothing depends on. Ties go to input order.

export interface PrepTask {
  id: string;
  /** "Roast the sweet potatoes" */
  title: string;
  recipeId: number | null;
  minutes: number;
  /** false for oven, simmering, chilling, marinating: it runs on its own after `startMinutes` of your time. */
  handsOn: boolean;
  /** Your time to get a hands-off task going (default 3). Ignored for hands-on tasks. */
  startMinutes?: number;
  /** Task ids that must finish first. */
  after?: string[];
  /** "Keeps 4 days in the fridge" */
  storage?: string;
}

export interface ScheduledStep {
  task: PrepTask;
  /** minutes from the start */
  start: number;
  end: number;
  /** your time on it */
  busyUntil: number;
  /** "While the rice simmers" when it overlaps a running hands-off task, else null */
  during: string | null;
}

export interface PrepPlan {
  steps: ScheduledStep[];
  totalMinutes: number;
  handsOnMinutes: number;
  fits: boolean;
  /** set when it can't fit the budget: a calm sentence on what would make it fit */
  note: string | null;
}

export const DEFAULT_START_MINUTES = 3;
export const DEFAULT_BUDGET_MINUTES = 60;

// ── Checking the tasks ─────────────────────────────────────────────────────

function validate(tasks: readonly PrepTask[]): void {
  const ids = new Set<string>();
  for (const t of tasks) {
    if (ids.has(t.id)) throw new Error(`Two prep tasks share the id "${t.id}". Each task needs its own id.`);
    ids.add(t.id);
    if (!Number.isFinite(t.minutes) || t.minutes < 0) throw new Error(`Prep task "${t.id}" needs a time of 0 minutes or more.`);
    if (!t.handsOn && t.startMinutes !== undefined && (!Number.isFinite(t.startMinutes) || t.startMinutes < 0)) {
      throw new Error(`Prep task "${t.id}" needs a start time of 0 minutes or more.`);
    }
  }
  for (const t of tasks) for (const dep of t.after ?? []) {
    if (!ids.has(dep)) throw new Error(`Prep task "${t.id}" waits on "${dep}", which is not in this session.`);
    if (dep === t.id) throw new Error(`Prep task "${t.id}" waits on itself.`);
  }
  // Depth-first search for a loop of dependencies.
  const byId = new Map(tasks.map(t => [t.id, t]));
  const state = new Map<string, 'open' | 'done'>();
  const path: string[] = [];
  const visit = (id: string): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      const loop = [...path.slice(path.indexOf(id)), id];
      throw new Error(`These prep tasks wait on each other in a loop: ${loop.join(' then ')}.`);
    }
    state.set(id, 'open');
    path.push(id);
    for (const dep of byId.get(id)!.after ?? []) visit(dep);
    path.pop();
    state.set(id, 'done');
  };
  for (const t of tasks) visit(t.id);
}

const cookTime = (t: PrepTask): number => (t.handsOn ? t.minutes : Math.min(t.startMinutes ?? DEFAULT_START_MINUTES, t.minutes));

// ── Scheduling ─────────────────────────────────────────────────────────────

/** The schedule itself, without `during` or the note. Tasks must already be valid. */
function place(tasks: readonly PrepTask[]): Array<{ task: PrepTask; start: number; end: number; busyUntil: number }> {
  const index = new Map(tasks.map((t, i) => [t.id, i]));
  const dependents = tasks.map(() => [] as number[]);
  tasks.forEach((t, i) => { for (const dep of t.after ?? []) dependents[index.get(dep)!].push(i); });

  // Longest chain from each task to the end of the session.
  const chain = new Array<number>(tasks.length).fill(-1);
  const chainOf = (i: number): number => {
    if (chain[i] >= 0) return chain[i];
    chain[i] = tasks[i].minutes + Math.max(0, ...dependents[i].map(chainOf));
    return chain[i];
  };
  tasks.forEach((_, i) => chainOf(i));

  const finish = new Array<number | null>(tasks.length).fill(null);
  const placed: Array<{ task: PrepTask; start: number; end: number; busyUntil: number }> = [];
  const better = (a: number, b: number) =>
    chain[a] !== chain[b] ? chain[a] > chain[b] : tasks[a].minutes !== tasks[b].minutes ? tasks[a].minutes > tasks[b].minutes : a < b;

  let now = 0;
  while (placed.length < tasks.length) {
    const ready: number[] = [];
    tasks.forEach((t, i) => {
      if (finish[i] !== null) return;
      if ((t.after ?? []).every(dep => { const f = finish[index.get(dep)!]; return f !== null && f <= now; })) ready.push(i);
    });
    if (ready.length === 0) {
      // The cook waits for the next running task to finish.
      now = Math.min(...finish.filter((f): f is number => f !== null && f > now));
      continue;
    }
    const pick = (pool: number[]) => pool.reduce((best, i) => (better(i, best) ? i : best));
    const handsOff = ready.filter(i => !tasks[i].handsOn);
    const i = handsOff.length ? pick(handsOff) : pick(ready);
    const task = tasks[i];
    const busyUntil = now + cookTime(task);
    const end = now + task.minutes;
    finish[i] = end;
    placed.push({ task, start: now, end, busyUntil });
    now = busyUntil;
  }
  return placed;
}

// ── Words ──────────────────────────────────────────────────────────────────

const STOP = /\s+(?:in|on|for|with|at|until|till|to|into|over|under|from|by|and|while)\s+|,|\.|;|\(/i;

/** "Roast the sweet potatoes at 200C" -> { verb: "roast", object: "sweet potatoes" }. */
function parseTitle(title: string): { verb: string; object: string | null } {
  const text = title.trim().replace(/^slow[-\s]+(?=cook)/i, '');
  const let_ = /^let\s+(?:the\s+|your\s+)?(.+?)\s+([a-z]+)$/i.exec(text);
  if (let_) return { verb: let_[2].toLowerCase(), object: let_[1] };
  const m = /^([a-z]+)(?:\s+(.*))?$/i.exec(text);
  if (!m) return { verb: '', object: null };
  const rest = (m[2] ?? '').split(STOP)[0].replace(/^(?:the|a|an|some|your)\s+/i, '').trim();
  return { verb: m[1].toLowerCase(), object: rest || null };
}

const isPlural = (noun: string): boolean => {
  const last = noun.toLowerCase().split(/\s+/).pop() ?? '';
  return /s$/.test(last) && !/(ss|us|is|ous)$/.test(last);
};

const thirdPerson = (verb: string): string =>
  /(s|sh|ch|x|z)$/.test(verb) ? `${verb}es` : /[^aeiou]y$/.test(verb) ? `${verb.slice(0, -1)}ies` : `${verb}s`;

// Verbs that read naturally with the food as the subject: "the rice simmers".
const RUNS_ON_ITS_OWN = new Set([
  'roast', 'bake', 'simmer', 'boil', 'braise', 'stew', 'chill', 'marinate', 'cook', 'steam', 'rest',
  'soak', 'rise', 'prove', 'proof', 'cool', 'set', 'freeze', 'thaw', 'defrost', 'brine', 'cure',
  'steep', 'reduce', 'toast', 'poach', 'drain', 'dry', 'infuse', 'pickle', 'ferment', 'smoke', 'grill',
]);

/** "While the rice simmers" for a hands-off task, from its title. */
function whileText(task: PrepTask): string {
  const { verb, object } = parseTitle(task.title);
  if (!object) return 'While that cooks';
  const plural = isPlural(object);
  if (RUNS_ON_ITS_OWN.has(verb)) return `While the ${object} ${plural ? verb : thirdPerson(verb)}`;
  return `While the ${object} ${plural ? 'cook' : 'cooks'}`;
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const upperFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const mins = (n: number) => `${Math.round(n)} min`;
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

function budgetWords(budget: number): string {
  if (budget === 30) return 'half an hour';
  if (budget === 45) return 'three quarters of an hour';
  if (budget === 60) return 'an hour';
  if (budget === 90) return 'an hour and a half';
  if (budget === 120) return 'two hours';
  return `${Math.round(budget)} minutes`;
}

// ── The note when it doesn't fit ───────────────────────────────────────────

/** What would make an over-budget session fit, in one or two calm sentences. */
function overBudgetNote(tasks: readonly PrepTask[], total: number, budget: number): string {
  const about = `This takes about ${Math.ceil(total / 5) * 5} minutes.`;
  // Things that could move: a whole recipe, or a single task that belongs to no recipe.
  const units: PrepTask[][] = [];
  const byRecipe = new Map<number, PrepTask[]>();
  for (const t of tasks) {
    if (t.recipeId === null) units.push([t]);
    else if (byRecipe.has(t.recipeId)) byRecipe.get(t.recipeId)!.push(t);
    else { const group = [t]; byRecipe.set(t.recipeId, group); units.push(group); }
  }
  let best: { unit: PrepTask[]; removed: Set<string>; lost: number } | null = null;
  for (const unit of units) {
    const removed = new Set(unit.map(t => t.id));
    for (let grew = true; grew;) {
      grew = false;
      for (const t of tasks) if (!removed.has(t.id) && (t.after ?? []).some(d => removed.has(d))) { removed.add(t.id); grew = true; }
    }
    const kept = tasks.filter(t => !removed.has(t.id));
    if (kept.length === 0) continue;
    const left = Math.max(0, ...place(kept).map(s => s.end));
    if (left > budget) continue;
    const lost = tasks.filter(t => removed.has(t.id)).reduce((sum, t) => sum + t.minutes, 0);
    if (!best || lost < best.lost) best = { unit, removed, lost };
  }
  const fit = budgetWords(budget);
  if (!best) return `${about} Split it across two sessions, or pick fewer recipes, to fit ${fit}.`;
  const { unit, removed } = best;
  const main = unit.reduce((a, b) => (b.minutes > a.minutes ? b : a));
  const { object } = parseTitle(main.title);
  const name = object ? `the ${object}` : `"${lowerFirst(main.title)}"`;
  const extra = removed.size > unit.length ? ' and the steps that need it' : '';
  return `${about} Move ${name}${extra} to another day to fit ${fit}.`;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Orders the tasks for one cook so hands-off time overlaps hands-on work. Throws a clear
 * Error on duplicate ids, unknown ids in `after`, or tasks that wait on each other in a loop.
 */
export function schedulePrep(tasks: readonly PrepTask[], opts: { budgetMinutes?: number } = {}): PrepPlan {
  validate(tasks);
  const budget = opts.budgetMinutes ?? DEFAULT_BUDGET_MINUTES;
  const placed = place(tasks);

  const steps: ScheduledStep[] = placed.map(step => {
    // A hands-off task already running when this step starts; the one that overlaps it most.
    let during: { start: number; overlap: number; text: string } | null = null;
    for (const other of placed) {
      if (other === step || other.task.handsOn) continue;
      if (!(other.busyUntil <= step.start && other.end > step.start)) continue;
      const overlap = Math.min(other.end, step.busyUntil) - step.start;
      if (!during || overlap > during.overlap || (overlap === during.overlap && other.start < during.start)) {
        during = { start: other.start, overlap, text: whileText(other.task) };
      }
    }
    return { ...step, during: during ? during.text : null };
  });

  const totalMinutes = Math.max(0, ...steps.map(s => s.end));
  const handsOnMinutes = steps.reduce((sum, s) => sum + (s.busyUntil - s.start), 0);
  const fits = totalMinutes <= budget;
  return { steps, totalMinutes, handsOnMinutes, fits, note: fits ? null : overBudgetNote(tasks, totalMinutes, budget) };
}

/**
 * The session as cooking-mode steps: one line per step, e.g.
 * "While the rice simmers: chop the peppers (10 min)." Hands-off steps say when to come back.
 */
export function prepStepTexts(plan: PrepPlan): string[] {
  return plan.steps.map(step => {
    const { task } = step;
    const title = step.during ? `${step.during}: ${lowerFirst(task.title)}` : upperFirst(task.title);
    let text: string;
    if (task.handsOn) text = `${title} (${mins(task.minutes)}).`;
    else {
      const yours = step.busyUntil - step.start;
      const away = step.end - step.busyUntil;
      text = away > 0
        ? `${title} (${mins(task.minutes)}, ${mins(yours)} of your time). Come back to it in ${mins(away)}, at the ${mins(step.end)} mark.`
        : `${title} (${mins(task.minutes)}).`;
    }
    return task.storage ? `${text} ${sentence(upperFirst(task.storage))}` : text;
  });
}
