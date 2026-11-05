#!/usr/bin/env node
// Builds a castmd brand file (.castmd-brand.json) from a spec that points at
// local logo and font files. The output embeds everything as data URLs, so a
// teammate imports one file in the export page and gets the logo, colors,
// typefaces and contact details. Not part of the extension package.
//
//   node scripts/build-brand-file.mjs path/to/brand-spec.json out.castmd-brand.json
//
// Spec = brand file shape (see lib/brand-preset.js) with file paths instead of
// data URLs, resolved relative to the spec:
//   "logo":  { "file": "logo.svg", "alt": "Acme", "aspect"?: 2.35 }
//   "fonts": { "heading": { "family"?: "Acme Sans", "files": { "regular": "AcmeSans.ttf", "bold": "AcmeSans-Bold.ttf" } } }
// aspect is read from the SVG viewBox / PNG header when not given; family is
// read from the font file, and a spec family that disagrees is an error.
//
// Keep brand specs and their output out of this repo: logos and commercial
// fonts are the brand owner's to distribute, not castmd's.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [specPath, outPath] = process.argv.slice(2);
if (!specPath || !outPath) {
  console.error('usage: build-brand-file.mjs <brand-spec.json> <out.castmd-brand.json>');
  process.exit(2);
}

const specDir = path.dirname(path.resolve(specPath));
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const read = (rel) => fs.readFileSync(path.resolve(specDir, rel));
const LOGO_TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const FONT_TYPES = { '.ttf': 'font/ttf', '.otf': 'font/otf' };

function dataUrl(rel, types) {
  const type = types[path.extname(rel).toLowerCase()];
  if (!type) throw new Error(`${rel}: unsupported type (use ${Object.keys(types).join(', ')})`);
  return `data:${type};base64,${read(rel).toString('base64')}`;
}

// Same readers and validator the extension uses (IIFE libs attached to window).
globalThis.window = globalThis;
const libDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib');
for (const lib of ['brand-asset-readers.js', 'brand-preset.js']) new Function(fs.readFileSync(path.join(libDir, lib), 'utf8')).call(globalThis);
const { readFontFamily, svgAspect, pngAspect } = globalThis.BrandAssetReaders;

function logoAspect(rel) {
  const bytes = read(rel);
  const aspect = rel.toLowerCase().endsWith('.svg') ? svgAspect(bytes.toString('utf8')) : pngAspect(new Uint8Array(bytes));
  if (!aspect) throw new Error(`${rel}: cannot read the logo size, set "aspect" (width / height) in the spec`);
  return aspect;
}

const brand = { ...spec, castmdBrand: 1 };
if (spec.logo) {
  brand.logo = { src: dataUrl(spec.logo.file, LOGO_TYPES), alt: spec.logo.alt, aspect: spec.logo.aspect || logoAspect(spec.logo.file) };
}
if (spec.fonts) {
  brand.fonts = {};
  for (const [role, font] of Object.entries(spec.fonts)) {
    const files = {};
    let family = font.family;
    for (const [slot, rel] of Object.entries(font.files || {})) {
      files[slot] = dataUrl(rel, FONT_TYPES);
      // Word matches embedded fonts by the font's own family name.
      const inFile = readFontFamily(new Uint8Array(read(rel)));
      if (!family) family = inFile;
      else if (inFile && inFile !== family) throw new Error(`${rel}: font calls itself "${inFile}", spec says "${family}"`);
    }
    brand.fonts[role] = { family, files };
  }
}

globalThis.BrandPreset.validateBrand(brand);

fs.writeFileSync(outPath, JSON.stringify(brand));
const kb = Math.round(fs.statSync(outPath).size / 1024);
console.log(`${outPath}: ${brand.name}, ${brand.fields?.length || 0} fields, ` +
  `${Object.keys(brand.fonts || {}).length} font roles, logo ${brand.logo ? 'yes' : 'no'}, ${kb} KB`);
