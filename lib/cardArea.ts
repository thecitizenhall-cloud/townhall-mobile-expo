// Mirror of the web lib/cardArea.js — turns a concern card's free-text
// affected_area into a clean geocodable query + the external OSM link, so the
// static map (web /api/card-map, reused by mobile) and the fallback link resolve
// the same spot. Keep in sync with the web copy.

// "Town, ST" from a municipality_id like "jackson_nj" or "jackson_nj_zoning".
export function muniLabel(municipalityId?: string | null): string {
  const m = String(municipalityId || "").split("_").filter(Boolean);
  if (!m.length) return "";
  let stateIdx = m.findIndex((sg, i) => i > 0 && /^[a-z]{2}$/i.test(sg));
  if (stateIdx < 0) stateIdx = m.length;
  const town = m.slice(0, stateIdx).map((sg) => sg.charAt(0).toUpperCase() + sg.slice(1)).join(" ");
  const state = stateIdx < m.length ? m[stateIdx].toUpperCase() : "";
  return [town, state].filter(Boolean).join(", ");
}

// "<Town> Township" from a municipality_id — mirrors the web feed's card label
// derivation (TownScreen) so no surface hardcodes a single town.
export function townLabel(municipalityId?: string | null): string {
  const base = String(municipalityId || "").split("_")[0];
  return base ? `${base.charAt(0).toUpperCase() + base.slice(1)} Township` : "";
}

// "Council · <Town> Township" — the small-caps tag above a concern card.
export function councilLabel(municipalityId?: string | null): string {
  const town = townLabel(municipalityId);
  return town ? `Council · ${town}` : "Council";
}

// Clean "street, Town, ST" query from a card's affected_area (drops parentheticals
// and Block/Lot jargon, keeps the first address segment, always attaches a
// locality-with-state so a bare street doesn't geocode to the wrong place).
export function cleanAreaQuery(affectedArea?: string | null, municipalityId?: string | null): string {
  let area = String(affectedArea || "").trim();
  if (!area) return "";
  area = area.replace(/\([^)]*\)/g, " ").replace(/\b(block|lot)\b[\s\S]*$/i, "").trim();
  const primary = (area.split(",")[0] || "").trim() || area;
  let locality = muniLabel(municipalityId);
  if (!locality) {
    const fromText = area.split(",").slice(1).map((sg) => sg.trim()).reverse()
      .find((sg) => /township|borough|\bNJ\b/i.test(sg));
    if (fromText) locality = /\b[A-Z]{2}\b/.test(fromText) ? fromText : `${fromText}, NJ`;
  }
  if (!locality) locality = "Jackson Township, NJ";
  return primary ? `${primary}, ${locality}` : locality;
}

export function osmSearchUrl(query: string): string {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
}
