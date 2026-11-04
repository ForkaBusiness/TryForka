// The maintained ingredient -> allergen map. Pure TypeScript (Deno, Vite, Node).
// Computed once per recipe at sync time and stored in recipes.allergens / recipes.diets;
// the app filters on those columns in SQL (safe_recipes), so this is the one place the
// matching rules live. When unsure we over-flag: hiding a safe meal beats showing an
// unsafe one.

export const ALLERGENS = ['dairy', 'egg', 'gluten', 'peanut', 'tree_nut', 'soy', 'fish', 'shellfish', 'sesame'] as const;
export type Allergen = typeof ALLERGENS[number];

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  dairy: 'Dairy', egg: 'Egg', gluten: 'Gluten', peanut: 'Peanut', tree_nut: 'Tree nut',
  soy: 'Soy', fish: 'Fish', shellfish: 'Shellfish', sesame: 'Sesame',
};

// What people call the families in their own words (lowercase, singular). "nut" covers
// peanuts too: someone who writes "nuts" as an allergy means both.
export const ALLERGEN_ALIASES: Record<string, Allergen[]> = {
  dairy: ['dairy'], milk: ['dairy'], lactose: ['dairy'],
  egg: ['egg'],
  gluten: ['gluten'], wheat: ['gluten'],
  peanut: ['peanut'], groundnut: ['peanut'],
  'tree nut': ['tree_nut'], nut: ['peanut', 'tree_nut'],
  soy: ['soy'], soya: ['soy'], soybean: ['soy'],
  fish: ['fish'], shellfish: ['shellfish'], seafood: ['fish', 'shellfish'],
  sesame: ['sesame'],
};

export const DIETS = ['vegetarian', 'vegan', 'pescatarian'] as const;
export type Diet = typeof DIETS[number];

// Keywords match ingredient names. "word" = whole word with optional plural;
// "word*" = word prefix. `except` strips look-alike phrases before matching.
interface Group { keywords: string[]; except?: string[] }

const GROUPS: Record<Allergen | 'meat' | 'honey', Group> = {
  gluten: {
    keywords: ['wheat*', 'flour', 'bread*', 'pasta', 'spaghetti', 'macaroni', 'penne', 'linguine', 'tagliatelle',
      'fettuccine', 'lasagne', 'lasagna', 'orzo', 'gnocchi', 'ravioli', 'tortellini', 'cannelloni', 'rigatoni',
      'fusilli', 'farfalle', 'noodle', 'udon', 'ramen', 'couscous', 'bulgur', 'semolina', 'barley', 'rye', 'spelt',
      'malt*', 'pastry', 'filo', 'phyllo', 'tortilla', 'pitta', 'pita', 'naan', 'bun', 'brioche', 'croissant',
      'baguette', 'ciabatta', 'biscuit', 'cookie', 'cracker', 'digestive', 'cake', 'cereal', 'wafer', 'pretzel',
      'beer', 'ale', 'stout', 'soy sauce', 'seitan', 'crouton', 'egg roll', 'wonton', 'dumpling', 'gyoza', 'muffin',
      'crumpet', 'bagel', 'waffle', 'crepe', 'scone', 'sponge', 'ladyfinger', 'savoiardi', 'dough', 'pizza', 'panko',
      'matzo', 'freekeh', 'farro', 'kamut', 'krispies', 'oat*', 'gravy', 'stock cube', 'bouillon', 'graham cracker',
      'vermicelli', 'fideo', 'breadcrumb*', 'puff pastry', 'shortcrust', 'roux', 'teriyaki', 'hoisin',
      // Added after the 2026-10-16 audit (docs/allergen-audit): wheat in disguise.
      'toast', 'knafeh', 'kataifi', 'sevaiiya', 'mars bar', 'christmas pudding', 'shaoxing', 'black pudding', 'falafel',
      'sausage', 'chilli bean paste', 'chili bean paste'],
    except: ['rice noodle', 'rice stick noodle', 'rice vermicelli', 'rice flour', 'corn flour', 'cornflour',
      'chickpea flour', 'gram flour', 'almond flour', 'coconut flour', 'potato flour', 'tapioca flour', 'cassava flour',
      'buckwheat flour', 'corn tortilla', 'rice paper', 'breadfruit', 'tamari', 'cream of tartar', 'oyster sauce',
      'gluten-free sausage'],
  },
  peanut: { keywords: ['peanut', 'groundnut', 'ground nut', 'satay', 'monkey nut'] },
  tree_nut: {
    keywords: ['almond', 'walnut', 'cashew', 'pecan', 'hazelnut', 'hazlenut', 'pistachio', 'macadamia',
      'brazil nut', 'pine nut', 'chestnut', 'praline', 'marzipan', 'nutella', 'frangipane', 'nut', 'amaretti', 'pesto', 'nougat*', 'gianduja'],
    except: ['chestnut mushroom', 'water chestnut', 'nutmeg', 'butternut', 'coconut', 'peanut', 'doughnut', 'ground nut', 'donut'],
  },
  soy: { keywords: ['soy*', 'tofu', 'edamame', 'miso', 'tempeh', 'tamari', 'hoisin', 'teriyaki', 'bean curd', 'doubanjiang', 'gochujang',
    'fermented black bean', 'black bean sauce', 'chilli bean paste', 'chili bean paste', 'natto', 'kecap manis'] },
  sesame: { keywords: ['sesame*', 'tahini', 'hummus', 'houmous', 'halva', 'halvah', "za'atar", 'zaatar', 'furikake', 'gomasio'] },
  shellfish: {
    keywords: ['prawn', 'shrimp', 'crab', 'lobster', 'crayfish', 'langoustine', 'scampi', 'mussel', 'clam', 'oyster',
      'scallop', 'cockle', 'whelk', 'squid', 'calamari', 'octopus', 'cuttlefish', 'conch', 'oyster sauce',
      // Thai curry pastes are traditionally made with shrimp paste.
      'shrimp paste', 'belacan', 'bagoong', 'curry paste'],
    except: ['oyster mushroom', 'madras curry paste', 'madras paste', 'tikka curry paste', 'korma curry paste', 'balti curry paste', 'jamaican curry paste'],
  },
  dairy: {
    keywords: ['milk', 'butter', 'buttermilk', 'cheese', 'cream', 'yogurt', 'yoghurt', 'ghee', 'mozzarella', 'mozarella',
      'parmesan', 'parmigiano*', 'pecorino', 'grana padano', 'manchego', 'provolone', 'burrata', 'queso', 'quark',
      'cheddar', 'feta', 'ricotta', 'mascarpone', 'paneer', 'brie', 'camembert', 'gruyere', 'gruyère', 'halloumi',
      'gouda', 'emmental*', 'stilton', 'labneh', 'kefir', 'skyr', 'creme fraiche', 'crème fraîche', 'custard', 'whey',
      'curd', 'white chocolate', 'milk chocolate', 'caramel', 'toffee', 'fudge', 'dulce de leche', 'malai', 'khoa', 'ice cream',
      'fromage', 'chocolate chips', 'mars bar', 'knafeh', 'garlic sauce', 'crema'],
    except: ['coconut milk', 'almond milk', 'soya milk', 'soy milk', 'oat milk', 'rice milk', 'coconut cream',
      'peanut butter', 'almond butter', 'cocoa butter', 'vegan butter', 'palm butter', 'butter bean', 'butternut',
      'bean curd', 'cream of tartar', 'vegan cheese', 'vegetable milk', 'cream crackers'],
  },
  egg: {
    keywords: ['egg', 'mayonnaise', 'mayo', 'meringue', 'aioli', 'aïoli', 'hollandaise', 'lemon curd', 'custard', 'mars bar',
      'christmas pudding', 'garlic sauce'],
    except: ['egg plant', 'eggplant', 'flax egg', 'chia egg', 'vegan egg', 'custard powder', 'custard cup', 'consistency of custard',
      'similar to custard', 'like custard'],
  },
  fish: {
    keywords: ['fish', 'seafood', 'salmon', 'cod', 'tuna', 'haddock', 'mackerel', 'sardine', 'anchov*', 'trout',
      'tilapia', 'bass', 'monkfish', 'halibut', 'hake', 'pollock', 'plaice', 'kipper', 'swordfish', 'snapper',
      'herring', 'pilchard', 'catfish', 'bonito', 'dashi', 'caviar', 'roe', 'worcestershire', 'sole', 'bream', 'mullet',
      'saltfish', 'codfish', 'whitefish', 'dogfish', 'stockfish', 'bacalao', 'bacalhau', 'barramundi', 'fish sauce', 'nam pla',
      'prahok', 'fish paste', 'bagoong', 'belacan', 'shrimp paste'],
    except: ['fish-free'],
  },
  // Not allergens: used for the diet columns.
  meat: {
    keywords: ['chicken', 'beef', 'pork', 'lamb', 'mutton', 'goat', 'veal', 'venison', 'bacon', 'lardon', 'ham',
      'sausage', 'chorizo', 'salami', 'pepperoni', 'prosciutto', 'pancetta', 'gammon', 'kabanos', 'mince', 'mincemeat',
      'meat', 'steak', 'sirloin', 'brisket', 'oxtail', 'turkey', 'duck', 'goose', 'rabbit', 'pheasant', 'quail', 'partridge',
      'liver', 'kidney', 'tripe', 'black pudding', 'morcilla', 'gelatin*', 'lard', 'suet', 'dripping', 'bone broth', 'kielbasa',
      'doner', 'frogs legs', 'trotters', 'shank', 'ribs', 'chops', 'pigeon', 'guanciale', 'speck', 'mortadella'],
    except: ['kidney bean', 'goats cheese', "goat's cheese", 'goat cheese', "lamb's lettuce", 'lambs lettuce',
      'beef tomato', 'beefsteak tomato', 'duck sauce', 'meat-free', 'meatless', 'vegan sausage', 'vegetarian sausage',
      'veggie sausage', 'vegan mince', 'vegetable stock', 'vegetarian mince', 'quorn', 'mushroom stock'],
  },
  honey: { keywords: ['honey', 'honeycomb'] },
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One regex for a whole keyword list (one pass per text keeps the sync inside its CPU limit). */
function keywordsRe(keywords: string[], flags: string): RegExp | null {
  if (!keywords.length) return null;
  const alts = keywords
    .map(k => (k.endsWith('*') ? escapeRe(k.slice(0, -1)) : `${escapeRe(k)}(?:e?s)?\\b`))
    .sort((a, b) => b.length - a.length); // longest first, so phrases win over their words
  return new RegExp(`\\b(?:${alts.join('|')})`, flags);
}

const RULES = Object.fromEntries(Object.entries(GROUPS).map(([name, g]) => [name, {
  match: keywordsRe(g.keywords, 'i')!,
  except: keywordsRe(g.except ?? [], 'gi'),
}])) as Record<keyof typeof GROUPS, { match: RegExp; except: RegExp | null }>;

function matches(group: keyof typeof GROUPS, text: string): boolean {
  const rule = RULES[group];
  // Strip only the look-alike phrases ("water chestnut"), so a text that also contains
  // the real allergen ("chestnut puree") is still caught.
  const rest = rule.except ? text.replace(rule.except, ' ') : text;
  return rule.match.test(rest);
}

/** The allergens one ingredient name contains. */
export function ingredientAllergens(name: string): Allergen[] {
  return ALLERGENS.filter(a => matches(a, name));
}

const MEAT_CATEGORIES = ['Beef', 'Chicken', 'Lamb', 'Pork', 'Goat'];

/**
 * Allergens and diets for a recipe. Ingredient names (original and US), the recipe name
 * and the instructions are all checked: TheMealDB's ingredient lists have gaps ("Egg Drop
 * Soup" lists no egg; "Singapore noodles" only mention peanuts in the method). Matching
 * the instructions over-flags some recipes, which is the safe direction for allergies.
 */
export function classifyRecipe(input: { name: string; category: string; ingredientNames: string[]; instructions?: string | null }): { allergens: Allergen[]; diets: Diet[] } {
  const texts = [input.name, ...input.ingredientNames, input.instructions ?? ''].filter(Boolean);
  const allergens = ALLERGENS.filter(a => texts.some(t => matches(a, t)));
  const meat = MEAT_CATEGORIES.includes(input.category) || texts.some(t => matches('meat', t));
  const fish = input.category === 'Seafood' || allergens.includes('fish') || allergens.includes('shellfish');
  const honey = texts.some(t => matches('honey', t));
  const diets: Diet[] = [];
  if (!meat) diets.push('pescatarian');
  if (!meat && !fish) diets.push('vegetarian');
  if (!meat && !fish && !allergens.includes('dairy') && !allergens.includes('egg') && !honey) diets.push('vegan');
  return { allergens, diets };
}
