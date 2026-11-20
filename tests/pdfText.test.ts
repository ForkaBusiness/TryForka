import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfData, pdfText } from '../src/lib/pdfText.ts';

test('characters the PDF fonts lack are spelled out, never printed as gaps', () => {
  assert.equal(pdfText('Heat the oven to 350℉'), 'Heat the oven to 350°F');
  assert.equal(pdfText('180℃ fan'), '180°C fan');
  assert.equal(pdfText('⅕ cup'), '1/5 cup');
  assert.equal(pdfText('cling ﬁlm'), 'cling film');
  assert.equal(pdfText('Crème fraıche'), 'Crème fraıche'.normalize('NFC'));
  assert.equal(pdfText('Enjoy ☺ \u{1F609}'), 'Enjoy ');
  // What the fonts have stays as it is.
  assert.equal(pdfText('½ cup, 200°C, café'), '½ cup, 200°C, café');
});

test('every string in the print data, nothing else touched', () => {
  const data = { title: 'Pie ⅕', servings: 4, steps: ['350℉'], meta: { note: null, ok: true } };
  assert.deepEqual(pdfData(data), { title: 'Pie 1/5', servings: 4, steps: ['350°F'], meta: { note: null, ok: true } });
});
