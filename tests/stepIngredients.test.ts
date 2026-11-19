// Which ingredients a step uses, so cooking mode can show their amounts beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepIngredients } from '../src/lib/stepIngredients.ts';

const names = (list: string[]) => list.map(name => ({ name, name_us: name }));
const used = (step: string, list: string[]) => stepIngredients(step, names(list)).map(i => list[i]);

const TRAYBAKE = ['Buttermilk', 'Eggs', 'All-purpose flour', 'Butter', 'Chicken thighs', 'Fresh parsley', 'Dry white wine', 'Onion', 'Salt and pepper'];

test('step ingredients: full names, plurals and shortened names', () => {
  assert.deepEqual(used('Whisk the buttermilk and eggs in a large bowl. Add the chicken thighs.', TRAYBAKE), ['Buttermilk', 'Eggs', 'Chicken thighs']);
  assert.deepEqual(used('Season the flour with salt and pepper.', TRAYBAKE), ['All-purpose flour', 'Salt and pepper']);
  assert.deepEqual(used('Lift the chicken from the buttermilk and drizzle with the melted butter.', TRAYBAKE), ['Buttermilk', 'Butter', 'Chicken thighs']);
  assert.deepEqual(used('Soften the onions, add the wine and simmer.', TRAYBAKE), ['Dry white wine', 'Onion']);
  assert.deepEqual(used('Scatter the parsley over and serve.', TRAYBAKE), ['Fresh parsley']);
  assert.deepEqual(used('Heat the oven to 425°F.', TRAYBAKE), []);
});

test('step ingredients: words inside other words never match', () => {
  assert.deepEqual(used('Use unsalted water and bring to the boil.', ['Salt', 'Olive oil']), []);
  assert.deepEqual(used('Pour in the buttermilk.', ['Butter', 'Buttermilk']), ['Buttermilk']);
  assert.deepEqual(used('Add the eggplant.', ['Eggs', 'Eggplant']), ['Eggplant']);
});

test('step ingredients: a longer name claims its words; shared short names are left out', () => {
  const list = ['Black pepper', 'Red pepper', 'Red onion', 'Olive oil'];
  assert.deepEqual(used('Fry the red pepper and red onion in the oil.', list), ['Red pepper', 'Red onion', 'Olive oil']);
  // "pepper" alone could be either.
  assert.deepEqual(used('Season with pepper.', list), []);
  assert.deepEqual(used('Add the black pepper.', list), ['Black pepper']);
  // A whole name wins over another ingredient's shortened one.
  assert.deepEqual(used('Add the chicken, then the stock.', ['Chicken', 'Chicken stock']), ['Chicken', 'Chicken stock']);
  assert.deepEqual(used('Pour in the chicken stock.', ['Chicken', 'Chicken stock']), ['Chicken stock']);
  // The same ingredient listed twice (cubed and ground lamb): both lines are used.
  assert.deepEqual(stepIngredients('Add cubed lamb, ground lamb and the garlic.', names(['Lamb', 'Onion', 'Lamb', 'Garlic'])), [0, 2, 3]);
});

test('step ingredients: weak words cut from a name are not matches on their own', () => {
  assert.deepEqual(used('Spoon the sauce over the fish.', ['Soy sauce', 'White fish fillets']), ['White fish fillets']);
  assert.deepEqual(used('Add the soy sauce.', ['Soy sauce']), ['Soy sauce']);
  assert.deepEqual(used('Squeeze in the lemon juice and add the zest.', ['Lemon juice', 'Lemon zest']), ['Lemon juice']);
});

test('step ingredients: US and original names both count, in recipe order', () => {
  const list = [{ name: 'Coriander', name_us: 'Cilantro' }, { name: 'Aubergine', name_us: 'Eggplant' }];
  assert.deepEqual(stepIngredients('Roast the eggplant, then scatter over the cilantro.', list), [0, 1]);
  assert.deepEqual(stepIngredients('Roast the aubergine.', list), [1]);
  assert.deepEqual(stepIngredients('', list), []);
  assert.deepEqual(stepIngredients('Add everything.', []), []);
});
