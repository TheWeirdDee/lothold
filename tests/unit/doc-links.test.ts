// The documentation must not contain links or image paths that lead nowhere.
// Wording is never asserted here — only that each local target exists.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { findBrokenLinks } from '../../scripts/check-doc-links.ts';

it('every local link and image in the documentation resolves to a real file', () => {
  const root = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
  expect(findBrokenLinks(root)).toEqual([]);
});