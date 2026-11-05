// Builds the smallest sfnt that readFontFamily accepts: an offset table with
// one `name` table holding a Windows/Unicode family name (nameID 1). Enough to
// test the brand editor's "family read from the file" path without shipping a
// real font in the repo. Browsers will refuse to render it, which is fine here.

export function fakeFontBytes(family) {
  const str = Buffer.from(family, 'utf16le').swap16();   // UTF-16BE
  const name = Buffer.alloc(18 + str.length);
  name.writeUInt16BE(0, 0);            // format
  name.writeUInt16BE(1, 2);            // count
  name.writeUInt16BE(18, 4);           // string storage offset
  name.writeUInt16BE(3, 6);            // platform: Windows
  name.writeUInt16BE(1, 8);            // encoding: Unicode BMP
  name.writeUInt16BE(0x409, 10);       // language: en-US
  name.writeUInt16BE(1, 12);           // nameID 1: family
  name.writeUInt16BE(str.length, 14);
  name.writeUInt16BE(0, 16);
  str.copy(name, 18);
  const head = Buffer.alloc(28);
  head.writeUInt32BE(0x00010000, 0);   // TrueType
  head.writeUInt16BE(1, 4);            // numTables
  head.write('name', 12, 'latin1');
  head.writeUInt32BE(28, 20);          // table offset
  head.writeUInt32BE(name.length, 24);
  return new Uint8Array(Buffer.concat([head, name]));
}
