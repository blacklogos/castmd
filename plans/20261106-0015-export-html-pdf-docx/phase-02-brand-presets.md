# Phase 02: brand presets (BiPlus first)

Decisions (Tri, 2026-11-06): generic importable brand file, no brand shipped in the
public repo; fonts travel inside the brand file; BiPlus preset carries HQ, HCMC,
website and email, each switchable.

- Brand file `castmdBrand: 1`: logo (data URL + aspect), colors, heading/body fonts
  (TTF data URLs), fields with line numbers, default header/footer templates.
- Print: margin boxes (logo top-left, header top-right, contact bottom-left, page
  bottom-right), prototype-verified in Chrome before building.
- DOCX: logo header with right tab stop, contact footer, brand fonts in styles,
  fonts embedded as obfuscated .odttf (ECMA-376 §17.8).
- BiPlus spec + built file live outside the repo:
  `~/projects/tasks/castmd-chrome-webstore/working/brand-presets/biplus/`.
- Facts source: biplus.com.vn contact page (web-biplus info-box), design.md tokens.

## Brand style viewer and editor (Tri, 2026-11-06: "Both")

- View style: read-only dialog with logo, swatches, specimens (Vietnamese
  sample), every contact field, and a page mock using the real templates.
- Editor: New/Edit dialog; Browse… for logo (SVG/PNG/JPEG) and TTF/OTF fonts,
  family read from the font's name table; save runs `validateBrand`; editing
  keeps the id and the off toggles. Export downloads the preset.
- Shared readers in `lib/brand-asset-readers.js`, also used by the build script.
