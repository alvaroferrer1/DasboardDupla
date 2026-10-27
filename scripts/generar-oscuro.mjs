// Genera edge/public/dark-legacy.css: versión oscura automática de las reglas antiguas de style.css
// (las anteriores a la capa DUPLA 6). Fondos claros -> superficie oscura; pastel -> tinte translúcido
// que conserva el color; texto oscuro -> claro; bordes claros -> línea oscura. Uso: node scripts/generar-oscuro.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const css = readFileSync(new URL('../edge/public/style.css', import.meta.url), 'utf8');
const legacy = css.slice(0, css.indexOf('/* DUPLA 6 ·'));
const SKIP = /sidebar|topbar|login|nav-item|brand|side-|h6-|toast|btn\.primary|home-banner|banner|loading|startup|dupla-hero|orb|live-dot|avatar|kbd|sw-|st-toggle/;
const hex = h => { h = h.slice(1); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const sat = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
const out = new Map();
const add = (sel, decl) => { if (!out.has(sel)) out.set(sel, new Set()); out.get(sel).add(decl); };
// Quita @media/@keyframes anidados: se procesan sus reglas internas igual (mismo efecto en oscuro).
const body = legacy.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '').replace(/@media[^{]+\{/g, '');
for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sels = m[1].split(',').map(s => s.trim()).filter(s => s && !SKIP.test(s) && !s.startsWith('@') && !/^(html|:root|\*)/.test(s));
  if (!sels.length) continue;
  const decls = m[2];
  const bg = decls.match(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})\b(?![^;]*gradient)/i);
  const col = decls.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,6})\b/i);
  const bor = decls.match(/border(?:-(?:top|bottom|left|right))?(?:-color)?\s*:[^;]*?(#[0-9a-f]{3,6})\b/i);
  const rules = [];
  if (bg) { const c = hex(bg[1]); if (lum(c) > 0.86) rules.push(sat(c) > 0.06 ? `background:color-mix(in srgb,${bg[1]} 16%,var(--v6-panel))` : 'background:var(--v6-panel)'); }
  if (col) { const c = hex(col[1]); if (lum(c) < 0.45) rules.push(sat(c) > 0.25 ? `color:color-mix(in srgb,${col[1]} 55%,#fff)` : lum(c) < 0.3 ? 'color:var(--v6-ink)' : 'color:var(--v6-muted)'); }
  if (bor) { const c = hex(bor[1]); if (lum(c) > 0.8) rules.push('border-color:var(--v6-line)'); }
  if (rules.length) for (const s of sels) for (const r of rules) add(`:root[data-theme="dark"] ${s}`, r);
}
const START = '/* DUPLA 6 · oscuro automático (generado por scripts/generar-oscuro.mjs, no editar) */\n', END = '/* fin oscuro automático */\n';
let txt = START;
for (const [sel, decls] of out) txt += `${sel}{${[...decls].join(';')}}\n`;
txt += END;
// Va justo antes de las reglas oscuras hechas a mano, para que estas ganen en caso de conflicto.
const anchor = '/* DUPLA 6 · Tema oscuro (Ajustes › Apariencia) */';
const file = new URL('../edge/public/style.css', import.meta.url);
let full = readFileSync(file, 'utf8');
const a = full.indexOf(START), b = full.indexOf(END);
if (a >= 0 && b > a) full = full.slice(0, a) + full.slice(b + END.length);
const at = full.indexOf(anchor);
if (at < 0) throw Error('No encuentro el bloque oscuro manual');
writeFileSync(file, full.slice(0, at) + txt + full.slice(at));
console.log('Oscuro automático:', out.size, 'reglas,', txt.length, 'bytes insertados en style.css');
