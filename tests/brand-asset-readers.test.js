// Brand editor helpers: font family from the TTF name table (what Word matches
// embedded fonts by), logo aspect from SVG/PNG, slug ids.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './setup.js';
import { fakeFontBytes } from './e2e/helpers/fake-font.js';

loadLib('lib/brand-asset-readers.js');
const { readFontFamily, svgAspect, pngAspect, slugId } = globalThis.BrandAssetReaders;

test('readFontFamily reads nameID 1, including Vietnamese characters', () => {
  assert.equal(readFontFamily(fakeFontBytes('UTM Avo')), 'UTM Avo');
  assert.equal(readFontFamily(fakeFontBytes('Phông Chữ')), 'Phông Chữ');
});

test('readFontFamily returns null for non-fonts and truncated files', () => {
  assert.equal(readFontFamily(new Uint8Array([1, 2, 3])), null);
  assert.equal(readFontFamily(new TextEncoder().encode('<svg></svg> not a font at all')), null);
  assert.equal(readFontFamily(fakeFontBytes('Cut').slice(0, 40)), null);
});

test('logo aspect from SVG viewBox, SVG size attributes, and PNG header', () => {
  assert.equal(svgAspect('<svg viewBox="372 313 1435 610">'), 1435 / 610);
  assert.equal(svgAspect("<svg width='300' height='100'>"), 3);
  assert.equal(svgAspect('<svg width="100%" height="100%">'), null);
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4E, 0x47]);
  new DataView(png.buffer).setUint32(16, 400);
  new DataView(png.buffer).setUint32(20, 200);
  assert.equal(pngAspect(png), 2);
  assert.equal(pngAspect(new Uint8Array(24)), null);
});

test('slugId folds Vietnamese and stays unique', () => {
  assert.equal(slugId('Hồ Chí Minh Đô thị'), 'ho-chi-minh-do-thi');
  assert.equal(slugId('Web', new Set(['web'])), 'web-2');
  assert.equal(slugId('!!!'), 'item');
});
