// Read aloud: amounts said the way a person says them, the step script, and the voice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickVoice, sentences, speakable, stepScript } from '../src/lib/speech.ts';

test('spoken amounts: whole numbers, mixed numbers and units', () => {
  assert.equal(speakable('1 1/2 c'), 'one and a half cups');
  assert.equal(speakable('1 1/2 cups'), 'one and a half cups');
  assert.equal(speakable('1½ cups'), 'one and a half cups');
  assert.equal(speakable('2 tbsp'), 'two tablespoons');
  assert.equal(speakable('1 tbsp'), 'one tablespoon');
  assert.equal(speakable('1 T'), 'one tablespoon');
  assert.equal(speakable('2 t'), 'two teaspoons');
  assert.equal(speakable('2 1/4 tsp'), 'two and a quarter teaspoons');
  assert.equal(speakable('3 2/3 cups'), 'three and two thirds cups');
  assert.equal(speakable('200 g'), '200 grams');
  assert.equal(speakable('1 kg'), 'one kilogram');
  assert.equal(speakable('1.5 kg'), 'one and a half kilograms');
  assert.equal(speakable('16 oz'), 'sixteen ounces');
  assert.equal(speakable('2 lb'), 'two pounds');
  assert.equal(speakable('250 ml'), '250 milliliters');
  assert.equal(speakable('4 fl oz'), 'four fluid ounces');
});

test('spoken amounts: fractions on their own', () => {
  assert.equal(speakable('1/2 cup'), 'half a cup');
  assert.equal(speakable('½ tsp'), 'half a teaspoon');
  assert.equal(speakable('1/4 cup'), 'a quarter of a cup');
  assert.equal(speakable('3/4 cup'), 'three quarters of a cup');
  assert.equal(speakable('1/3 cup'), 'a third of a cup');
  assert.equal(speakable('1/2 oz'), 'half an ounce');
  assert.equal(speakable('1/2'), 'half');
});

test('spoken amounts: ranges, counts, temperatures and times in step text', () => {
  assert.equal(speakable('1-2 tbsp'), 'one to two tablespoons');
  assert.equal(speakable('Bake for 25 to 30 minutes.'), 'Bake for 25 to 30 minutes.');
  assert.equal(speakable('Simmer for 10 mins.'), 'Simmer for ten minutes.');
  assert.equal(speakable('Heat the oven to 425°F.'), 'Heat the oven to 425 degrees Fahrenheit.');
  assert.equal(speakable('Heat the oven to 200°C (180°C fan).'), 'Heat the oven to 200 degrees Celsius (180 degrees Celsius fan).');
  assert.equal(speakable('Marinate for 1 hr.'), 'Marinate for one hour.');
  assert.equal(speakable('Whisk 2 eggs with 1/2 cup milk.'), 'Whisk two eggs with half a cup milk.');
  assert.equal(speakable('Cut into 2-inch pieces.'), 'Cut into two inch pieces.');
  assert.equal(speakable('Cook them in 2 batches in a pan.'), 'Cook them in two batches in a pan.');
  assert.equal(speakable('Roll out to 5 mm thick.'), 'Roll out to five millimeters thick.');
  assert.equal(speakable('Cut into 1/2-inch pieces.'), 'Cut into half inch pieces.');
  assert.equal(speakable('Roll to 1/4" thick.'), 'Roll to a quarter inch thick.');
  assert.equal(speakable('Use a 9x13 pan.'), 'Use a nine by thirteen pan.');
  assert.equal(speakable('Add 2 x 400g tins of tomatoes.'), 'Add two x 400 grams tins of tomatoes.');
  assert.equal(speakable('Cut into 3/4-in. slices.'), 'Cut into three quarters inch slices.');
  assert.equal(speakable('Cut into 2 inch cubes.'), 'Cut into two inch cubes.');
  assert.equal(speakable('Cut into 1-2 inch pieces.'), 'Cut into one to two inch pieces.');
  assert.equal(speakable('Add 1 c. flour and 2 tbsp. sugar.'), 'Add one cup flour and two tablespoons sugar.');
  assert.equal(speakable('Stir in 2 tbsp.'), 'Stir in two tablespoons.');
});

test('step script: number, text, then the amounts it needs', () => {
  const script = stepScript(1, 6, 'Whisk the buttermilk and eggs.', [
    { name: 'Buttermilk', amount: '1 1/2 cups' },
    { name: 'Eggs', amount: '3' },
    { name: 'Salt and pepper', amount: 'to taste' },
    { name: 'Parsley', amount: '' },
  ]);
  assert.equal(script, "Step 1 of 6. Whisk the buttermilk and eggs. You'll need one and a half cups buttermilk; three eggs; salt and pepper, to taste; parsley.");
  assert.equal(stepScript(4, 6, 'Bake for 25 to 30 minutes, until golden.', []), 'Step 4 of 6. Bake for 25 to 30 minutes, until golden.');
  assert.deepEqual(sentences(script), ['Step 1 of 6.', 'Whisk the buttermilk and eggs.', "You'll need one and a half cups buttermilk;", 'three eggs;', 'salt and pepper, to taste;', 'parsley.']);
});

test('voice: the device language, the best quality, never a novelty voice', () => {
  const v = (name: string, lang: string, localService = true, isDefault = false) => ({ name, lang, localService, default: isDefault });
  const voices = [v('Albert', 'en-US'), v('Samantha', 'en-US', true, true), v('Ava (Enhanced)', 'en-US'), v('Daniel', 'en-GB'), v('Amélie', 'fr-CA'), v('Google US English', 'en-US', false)];
  assert.equal(pickVoice(voices, 'en-US')?.name, 'Ava (Enhanced)');
  assert.equal(pickVoice(voices, 'en-GB')?.name, 'Daniel');
  assert.equal(pickVoice(voices, 'en-AU')?.name, 'Ava (Enhanced)', 'same language, another region');
  assert.equal(pickVoice(voices, 'fr-FR')?.name, 'Amélie');
  assert.equal(pickVoice(voices, 'de-DE'), null);
  assert.equal(pickVoice([v('Albert', 'en-US'), v('Fred', 'en-US')], 'en-US')?.name, 'Albert', 'only novelty voices: one still speaks');
  assert.equal(pickVoice([v('Karen', 'en_AU')], 'en-au')?.name, 'Karen');
  assert.equal(pickVoice([], 'en-US'), null);
});
