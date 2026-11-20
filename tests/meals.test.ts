// Pro's other meals: school lunches that pack and suit kids, snacks, and how much to buy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKidFriendly, isPackable, isSchoolLunch, isSnack, schoolLunchShare } from '../src/lib/meals.ts';

const r = (name: string, meal_role = 'main', total_minutes: number | null = 25, category: string | null = null) => ({ name, meal_role, total_minutes, category });

test('school lunch: packable and kid-friendly', () => {
  for (const name of ['Chicken pasta salad', 'Turkey and cheese wraps', 'Spinach and feta muffins', 'Mini frittatas', 'Ham and cheese pinwheels', 'Falafel pitas'])
    assert.equal(isSchoolLunch(r(name)), true, name);
  // Needs to be hot, or doesn't travel.
  for (const name of ['Tomato soup', 'Beef stew', 'Mushroom risotto', 'Steak frites', 'Crispy tempura prawns'])
    assert.equal(isPackable(r(name)), false, name);
  // Packs, but not for most kids.
  for (const name of ['Spicy chicken wraps', 'Jalapeno cornbread', 'Anchovy and egg sandwiches', 'Gorgonzola pasta salad'])
    assert.equal(isSchoolLunch(r(name)), false, name);
  assert.equal(isKidFriendly(r('Sausage rolls', 'main', 90)), false, 'too long for a school morning');
  assert.equal(isSchoolLunch(r('Pasta salad', 'dessert')), false, 'a lunch, not a dessert');
});

test('snacks: quick sides and sweets, not heavy dishes', () => {
  assert.equal(isSnack(r('Hummus with carrot sticks', 'side', 10)), true);
  assert.equal(isSnack(r('Oat flapjacks', 'dessert', 25)), true);
  assert.equal(isSnack(r('Chocolate cake', 'dessert', 25)), false);
  assert.equal(isSnack(r('Potato gratin', 'side', 25)), false);
  assert.equal(isSnack(r('Roast vegetables', 'side', 50)), false, 'too long');
  assert.equal(isSnack(r('Chicken curry', 'main', 20)), false, 'a main is not a snack');
});

test('school lunch: buy one portion per child who takes one', () => {
  assert.equal(schoolLunchShare(0), 0);
  assert.equal(schoolLunchShare(2), 0.5);
  assert.equal(schoolLunchShare(3), 0.75);
});
