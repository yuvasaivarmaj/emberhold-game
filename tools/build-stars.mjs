// Converts the Yale Bright Star Catalog (MIT-licensed JSON by Bretton Wade) into a
// compact binary the game loads: per star [x, y, z, magnitude, temperature K, scorpius].
// x/y/z is the unit vector in the equatorial frame (x: RA 0h, y: RA 6h, z: north pole).
import fs from 'node:fs';
const src = JSON.parse(fs.readFileSync(new URL('./data/bsc5-short.json', import.meta.url)));
const parseRA = (s) => { const m = s.match(/(\d+)h\s*(\d+)m\s*([\d.]+)s/); return ((+m[1] + +m[2] / 60 + +m[3] / 3600) / 24) * Math.PI * 2; };
const parseDec = (s) => { const m = s.match(/([+-])(\d+)°\s*(\d+)′\s*([\d.]+)″/); const v = +m[2] + +m[3] / 60 + +m[4] / 3600; return ((m[1] === '-' ? -v : v) * Math.PI) / 180; };
const out = [];
for (const s of src) {
  if (!s.RA || !s.Dec || s.V === undefined) continue;
  const mag = parseFloat(s.V);
  if (!(mag < 6.6)) continue;
  const a = parseRA(s.RA), d = parseDec(s.Dec);
  const K = parseFloat(s.K) || 6000;
  out.push(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d), mag, K, s.C === 'Sco' ? 1 : 0);
}
fs.writeFileSync(new URL('../public/data/stars.bin', import.meta.url), Buffer.from(new Float32Array(out).buffer));
console.log(`${out.length / 6} stars written`);
