// Pro's other meals: what makes a recipe a good school lunch (packable, kid-friendly) or a
// snack, and how much of it to buy. Pure, tested in tests/meals.test.ts. The planner
// (planner.ts) uses these to fill the breakfast, lunch, school lunch and snack slots with
// the same taste, learning and allergy rules as dinner.

export interface MealRecipe { name: string; display_name?: string | null; category?: string | null; meal_role?: string | null; total_minutes?: number | null }

const words = (r: MealRecipe) => ` ${`${r.display_name ?? ''} ${r.name} ${r.category ?? ''}`.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')} `;
const has = (text: string, list: readonly string[]) => list.some(w => text.includes(` ${w} `) || text.includes(` ${w}s `) || text.includes(` ${w}es `));

/** Eaten cold or at room temperature from a lunchbox, without going soggy or unsafe. */
const PACKABLE = ['sandwich', 'wrap', 'pinwheel', 'roll', 'muffin', 'frittata', 'quiche', 'tart', 'pasty', 'empanada', 'samosa', 'pastie',
  'pasta salad', 'couscous', 'quinoa', 'rice salad', 'noodle salad', 'salad', 'onigiri', 'rice ball', 'sushi roll', 'hummus', 'falafel',
  'flapjack', 'bar', 'pita', 'pitta', 'bagel', 'scone', 'cornbread', 'meatball', 'skewer', 'kebab', 'drumstick', 'tortilla', 'quesadilla',
  'pancake', 'fritter', 'spring roll', 'sausage roll', 'pizza', 'bento', 'focaccia', 'bread'];
/** Needs to be eaten hot or straight away, or doesn't travel. */
const NOT_PACKABLE = ['soup', 'stew', 'curry', 'risotto', 'steak', 'souffle', 'ice cream', 'sorbet', 'casserole', 'gravy', 'broth', 'ramen',
  'pho', 'chowder', 'fondue', 'oyster', 'sashimi', 'ceviche', 'tartare', 'poached egg', 'omelette', 'omelet', 'fries', 'tempura', 'crispy'];
/** Strong heat or flavors most children don't take to. */
const NOT_KID_FRIENDLY = ['chili', 'chilli', 'jalapeno', 'spicy', 'hot', 'cayenne', 'sriracha', 'vindaloo', 'harissa', 'jerk', 'diavola',
  'arrabbiata', 'anchovy', 'liver', 'kidney', 'offal', 'tripe', 'oyster', 'mussel', 'octopus', 'squid', 'blue cheese', 'gorgonzola',
  'stilton', 'goat', 'snail', 'escargot', 'brain', 'black pudding', 'haggis', 'wasabi', 'kimchi'];

export function isPackable(r: MealRecipe): boolean {
  const t = words(r);
  return !has(t, NOT_PACKABLE) && has(t, PACKABLE);
}

export function isKidFriendly(r: MealRecipe): boolean {
  if (r.total_minutes != null && r.total_minutes > 45) return false;
  return !has(words(r), NOT_KID_FRIENDLY);
}

/** A school lunch: packable and kid-friendly. */
export const isSchoolLunch = (r: MealRecipe) => (r.meal_role === 'main' || r.meal_role === 'side' || r.meal_role === 'breakfast') && isPackable(r) && isKidFriendly(r);

/** A snack: a quick side, starter or sweet, ready in half an hour. */
export function isSnack(r: MealRecipe): boolean {
  if (r.meal_role !== 'side' && r.meal_role !== 'dessert') return false;
  if (r.total_minutes != null && r.total_minutes > 30) return false;
  return !has(words(r), ['cake', 'pie', 'pudding', 'trifle', 'roast', 'gratin', 'casserole', 'soup', 'curried', 'curry', 'cabbage', 'kumpir', 'chorizo', 'stuffing', 'mash']);
}

/** Recipes as written serve this many (the catalog's assumption; nutrition uses it too). */
export const RECIPE_SERVES = 4;

/** How much of a school lunch to buy: one portion per child who takes one, as a share of the recipe. */
export function schoolLunchShare(children: number): number {
  return children > 0 ? children / RECIPE_SERVES : 0;
}

/** Weekdays only: school lunches aren't planned for Saturday and Sunday. */
export const SCHOOL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;

/** Every meal a week can hold, in the order a day shows them. */
export const MEAL_SLOTS = ['breakfast', 'school_lunch', 'lunch', 'snack', 'dinner'] as const;
export type MealSlot = typeof MEAL_SLOTS[number];

interface SlotPrefs { plan_breakfast: boolean; plan_lunch: boolean; plan_dinner: boolean; plan_snacks?: boolean | null }
type SlotMember = { kind: string; school_lunch?: boolean | null };

/**
 * The meals a week is planned with. Free plans dinners. Pro plans each meal the household
 * switched on: breakfast, lunch, snacks, and a school lunch on weekdays when any child takes
 * one. A plan already holding other meals keeps showing them (nothing is taken away).
 */
export function plannedSlots(prefs: SlotPrefs, plan: 'free' | 'pro' = 'free', members: readonly SlotMember[] = []): MealSlot[] {
  if (plan !== 'pro') return ['dinner'];
  const on: Record<MealSlot, boolean> = {
    breakfast: prefs.plan_breakfast,
    school_lunch: members.some(m => m.kind === 'kid' && !!m.school_lunch),
    lunch: prefs.plan_lunch,
    snack: !!prefs.plan_snacks,
    dinner: prefs.plan_dinner,
  };
  const slots = MEAL_SLOTS.filter(s => on[s]);
  return slots.length ? slots : ['dinner'];
}

/** Children taking a packed school lunch, as a share of the recipe (at least one portion). */
export const schoolLunchShareFor = (members: readonly SlotMember[]) =>
  Math.max(1, members.filter(m => m.kind === 'kid' && !!m.school_lunch).length) / RECIPE_SERVES;

/** School lunches are Monday to Friday; every other meal can be on any day. */
export const slotOnDay = (slot: string, day: string) => slot !== 'school_lunch' || (SCHOOL_DAYS as readonly string[]).includes(day);
