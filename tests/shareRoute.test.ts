// Sharing into Forka: one entry decides what the import starts with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLink, handleIncomingShare } from '../src/lib/shareRoute.ts';

const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

test('shared photos import as photos (HEIC included, at most six, empty ones dropped)', () => {
  const s = handleIncomingShare({ files: [file('a.jpg', 'image/jpeg'), file('b.HEIC', ''), file('c.pdf', 'application/pdf'), file('d.png', 'image/png', 0)] });
  assert.equal(s?.name, 'import');
  assert.deepEqual(s?.name === 'import' ? s.files?.map(f => f.name) : null, ['a.jpg', 'b.HEIC']);
  const many = handleIncomingShare({ files: Array.from({ length: 9 }, (_, i) => file(`${i}.jpg`, 'image/jpeg')) });
  assert.equal(many?.name === 'import' ? many.files?.length : 0, 6);
});

test('a shared link is found in the URL field or in the text, as share sheets differ', () => {
  assert.deepEqual(handleIncomingShare({ url: 'https://www.tiktok.com/@a/video/1' }), { name: 'import', url: 'https://www.tiktok.com/@a/video/1' });
  assert.deepEqual(handleIncomingShare({ title: 'Look at this', text: 'Check this out! https://example.com/pasta-recipe/.' }), { name: 'import', url: 'https://example.com/pasta-recipe/' });
});

test('shared text without a link imports as recipe text; too little text is nothing', () => {
  const text = 'Pancakes: 2 cups flour, 2 eggs, 1 cup milk. Whisk and fry.';
  assert.deepEqual(handleIncomingShare({ text }), { name: 'import', text });
  assert.equal(handleIncomingShare({ text: 'hi' }), null);
  assert.equal(handleIncomingShare({}), null);
});

test('links are cut cleanly out of surrounding text', () => {
  assert.equal(findLink('(see https://site.example/r?id=4).'), 'https://site.example/r?id=4');
  assert.equal(findLink('no link here'), null);
});
