// Shared, stateless helpers used across the view modules (hairball, adaptive,
// sensemaking, storyline). Keep this file free of EnergyKG / DOM assumptions
// so any view can import from it without pulling in unrelated state.

export function colorFor(hue, l = 0.58, c = 0.15) { return `oklch(${l} ${c} ${hue})`; }

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : (s || ''));

// Stable key for an edge's provenance value (or '∅' when absent).
export const viaKey = v => v ? `${v.prop} ${v.value}` : '∅';

// Stable group-by: keeps input order of groups by first appearance, but makes
// all members sharing the same via value contiguous. Used so bundled edges
// fan out from an adjacent block of children instead of scattered rows.
export function groupByVia(list) {
  const order = [], groups = new Map();
  for (const e of list) {
    const k = viaKey(e.via);
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k).push(e);
  }
  return order.flatMap(k => groups.get(k));
}

// Acronym from a label's significant words (skips connectives) — e.g.
// "Sustainability, Climate & Renewables" → "SCR".
const ACRO_STOP = new Set(['and', 'of', 'the', 'in', 'to', 'for', 'with', 'a', 'an', 'on', 'at', 'by', 'de']);
export function acronymOf(label) {
  const words = String(label).split(/[^A-Za-z0-9]+/).filter(w => w && !ACRO_STOP.has(w.toLowerCase()));
  return words.map(w => w[0].toUpperCase()).join('') || String(label).slice(0, 3).toUpperCase();
}
