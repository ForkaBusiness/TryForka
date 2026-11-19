// Durations written in steps become timer buttons: minutes, hours, ranges (the timer
// starts at the lower number and the label shows the range), and words for numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepTimers } from '../supabase/functions/_shared/catalog/steps.ts';

const one = (text: string) => {
  const t = stepTimers(text);
  assert.equal(t.length, 1, `one timer in "${text}", got ${JSON.stringify(t)}`);
  return t[0];
};

test('durations: minutes', () => {
  assert.deepEqual(one('Simmer for 10 minutes.'), { seconds: 600, maxSeconds: null, label: 'Simmer 10 min' });
  assert.equal(one('Rest the dough 15 mins.').seconds, 900);
  assert.equal(one('Whisk for five minutes until pale.').seconds, 300);
});

test('durations: ranges start at the lower number and show the range', () => {
  assert.deepEqual(one('Bake 25 to 30 minutes, until golden.'), { seconds: 1500, maxSeconds: 1800, label: 'Bake 25-30 min' });
  assert.deepEqual(one('Roast for 20-25 mins.'), { seconds: 1200, maxSeconds: 1500, label: 'Roast 20-25 min' });
  assert.deepEqual(one('Cook for 8–10 minutes.'), { seconds: 480, maxSeconds: 600, label: 'Cook 8-10 min' });
  assert.deepEqual(one('Braise for 2 to 3 hours.'), { seconds: 7200, maxSeconds: 10800, label: 'Braise 2-3 hr' });
});

test('durations: hours, alone and with minutes', () => {
  assert.deepEqual(one('Marinate for 1 hour.'), { seconds: 3600, maxSeconds: null, label: 'Marinate 1 hr' });
  assert.equal(one('Chill for an hour.').seconds, 3600);
  assert.equal(one('Leave to rise for half an hour.').seconds, 1800);
  assert.equal(one('Simmer for 1½ hours.').seconds, 5400);
  assert.equal(one('Slow cook for 1 hour 15 minutes.').seconds, 4500);
  assert.equal(one('Slow cook for 1 hr and 15 mins.').label, 'Cook 1 hr 15 min');
  assert.equal(one('Roast for 2 hours.').label, 'Roast 2 hr');
});

test('durations: several in one step, each its own button', () => {
  const t = stepTimers('Soften the onion for 5 minutes, add the wine and simmer for 10 minutes.');
  assert.deepEqual(t.map(x => x.label), ['Soften 5 min', 'Simmer 10 min']);
});

test('durations: things that are not timers', () => {
  assert.deepEqual(stepTimers('After 20 minutes, turn the chicken.'), []);
  assert.deepEqual(stepTimers('Add a second layer of pasta.'), []);
  assert.deepEqual(stepTimers('Heat the oven to 400°F.'), []);
  assert.deepEqual(stepTimers('Serve with 2 cups of rice.'), []);
  assert.deepEqual(stepTimers('Ferment for 3 days.'), []);
});
