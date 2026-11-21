// What Free includes, in one place for the app (src/lib/limits.ts) and the Edge Functions.
// Free never loses anything it has: these only stop adding more beyond the limit.

export const FREE_LIMITS = { saved_recipes: 20, smart_imports: 20, shopping_lists: 2 } as const;

/** "Missing something?" answers from the model per day on Free (the built-in swaps are unlimited). */
export const FREE_HELP_PER_DAY = 3;
/** The server-side abuse cap on cooking help for Pro (per day, per minute). */
export const PRO_HELP_CAP = { perDay: 30, perMinute: 6 } as const;
