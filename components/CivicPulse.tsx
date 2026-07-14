import { useState, useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { supabase } from "../lib/supabase";
import { T } from "../lib/theme";

// The Pulse — the feed's opening "feel" (web parity: components/CivicPulse.jsx).
// Reads the town's civic tempo back to the resident in three time-scales:
// this year has been a year of X, the last month has seen Y, this week Z, and
// what's still ahead. Computed from the same surfaced, non-archived cards the
// feed shows (one cheap 3-column query), so it can never overclaim. Approval
// rate is shown only over decided items; no year-over-year (no clean prior year
// of data yet — no invented trend).

type Row = { impact_type: string | null; outcome_signal: string | null; meeting_date: string | null };

const IMPACT: Record<string, { noun: string; chip: string; color: string }> = {
  zoning:         { noun: "land use",       chip: "Land use",       color: T.amber },
  infrastructure: { noun: "infrastructure", chip: "Infrastructure", color: T.blue },
  budget:         { noun: "the budget",     chip: "Budget",         color: T.teal },
  education:      { noun: "the schools",    chip: "Schools",        color: T.purple },
  other:          { noun: "local matters",  chip: "Other",          color: T.creamFaint },
};
const info = (k: string) => IMPACT[k] || IMPACT.other;

function md(s: string | null): Date | null {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export default function CivicPulse({ townId }: { townId: string | null }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!townId) return;
    let cancelled = false;
    (async () => {
      const cols = "impact_type, outcome_signal, meeting_date";
      let { data, error } = await supabase
        .from("concern_cards").select(cols)
        .eq("surfaces_to_feed", true).eq("archived", false).is("removed_at", null)
        .eq("town_id", townId).limit(2000);
      if (error && (error.code === "42703" || /town_id/.test(error.message || ""))) {
        ({ data } = await supabase
          .from("concern_cards").select(cols)
          .eq("surfaces_to_feed", true).eq("archived", false).is("removed_at", null)
          .like("municipality_id", townId + "%").limit(2000));
      }
      if (!cancelled) setRows((data as Row[]) || []);
    })();
    return () => { cancelled = true; };
  }, [townId]);

  if (rows === null || rows.length === 0) return null;

  const now = new Date(); now.setHours(0, 0, 0, 0);
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
  const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
  const DECIDED = new Set(["approved", "denied", "deferred"]);

  const empty = () => ({ total: 0, land: 0, appr: 0, dec: 0 });
  const year = empty(), month = empty(), week = empty();
  const ahead = { total: 0, land: 0, next: null as Date | null };
  const catCount: Record<string, number> = {};

  for (const r of rows) {
    const dt = md(r.meeting_date);
    if (!dt) continue;
    const land = r.impact_type === "zoning";
    const decided = DECIDED.has(r.outcome_signal || "");
    const approved = r.outcome_signal === "approved";
    if (dt > now) {
      ahead.total++; if (land) ahead.land++;
      if (!ahead.next || dt < ahead.next) ahead.next = dt;
      continue;
    }
    const bump = (b: ReturnType<typeof empty>) => { b.total++; if (land) b.land++; if (approved) b.appr++; if (decided) b.dec++; };
    if (dt >= jan1) { bump(year); if (r.impact_type) catCount[r.impact_type] = (catCount[r.impact_type] || 0) + 1; }
    if (dt > d30) bump(month);
    if (dt > d7) bump(week);
  }
  if (year.total === 0) return null;

  const cats = Object.entries(catCount).sort((a, b) => b[1] - a[1]);
  const [topKey, topN] = cats[0];
  const topInfo = info(topKey);
  const topShare = pct(topN, year.total);
  const yearLabel = now.getFullYear();
  const monthShare = pct(month.land, month.total);
  const asOf = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const nextDateStr = ahead.next ? ahead.next.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;

  return (
    <View style={s.wrap}>
      <View style={s.kicker}>
        <View style={s.dot} />
        <Text style={s.kickerTxt}>THE PULSE</Text>
        <Text style={s.asOf}>as of {asOf}</Text>
      </View>

      <Text style={s.lead}>
        {yearLabel} has been a year of <Text style={s.em}>{topInfo.noun}</Text> — {topShare}% of what the town has taken up.
      </Text>

      <View style={s.row}>
        <View style={s.tile}>
          <Text style={s.tileNum}>{year.total}</Text>
          <Text style={s.tileLbl}>items on the docket this year</Text>
        </View>
        <View style={s.tile}>
          <Text style={s.tileNum}>{year.dec > 0 ? `${pct(year.appr, year.dec)}%` : "—"}</Text>
          <Text style={s.tileLbl}>{year.dec > 0 ? `approved of ${year.dec} decided` : "none decided yet"}</Text>
        </View>
        <View style={s.tile}>
          <Text style={s.tileNum}>{topShare}%</Text>
          <Text style={s.tileLbl}>{topInfo.chip.toLowerCase()} share</Text>
        </View>
      </View>

      <View style={s.bar}>
        {cats.map(([k, n]) => (
          <View key={k} style={{ width: `${pct(n, year.total)}%`, backgroundColor: info(k).color }} />
        ))}
      </View>
      <View style={s.legend}>
        {cats.slice(0, 5).map(([k, n]) => (
          <View key={k} style={s.legItem}>
            <View style={[s.swatch, { backgroundColor: info(k).color }]} />
            <Text style={s.legTxt}>{info(k).chip} · {n}</Text>
          </View>
        ))}
      </View>

      <Text style={s.sentence}>
        The last month has seen <Text style={s.strong}>{month.total}</Text> {month.total === 1 ? "item" : "items"} come up
        {month.total > 0 && month.land > 0 ? `, ${monthShare}% of it land use` : ""}
        {month.appr > 0 ? <Text> — <Text style={s.strong}>{month.appr} approved</Text></Text> : null}.{" "}
        {week.total > 0
          ? <Text>This week: <Text style={s.strong}>{week.total}</Text> {week.total === 1 ? "item" : "items"}{week.appr > 0 ? `, ${week.appr} approved` : ""}.</Text>
          : <Text>Quiet week — nothing new on the record.</Text>}
        {ahead.total > 0
          ? <Text> Ahead on the docket: <Text style={s.strong}>{ahead.total}</Text> scheduled{ahead.land === ahead.total ? ", all land use" : ahead.land > 0 ? ` (${ahead.land} land use)` : ""}{nextDateStr ? `, next ${nextDateStr}` : ""}.</Text>
          : null}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginTop: 4, marginBottom: 14, padding: 16, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 14 },
  kicker: { flexDirection: "row", alignItems: "center", marginBottom: 11 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: T.tealHi, marginRight: 8 },
  kickerTxt: { fontSize: 11, fontWeight: "700", letterSpacing: 0.9, color: T.creamDim },
  asOf: { marginLeft: "auto", fontSize: 10.5, color: T.creamFaint },
  lead: { fontSize: 16.5, lineHeight: 24, color: T.cream, fontWeight: "600", marginBottom: 12 },
  em: { color: T.amberHi },
  row: { flexDirection: "row", gap: 8, marginBottom: 12 },
  tile: { flex: 1, backgroundColor: T.surfaceHi, borderWidth: 1, borderColor: T.border, borderRadius: 10, padding: 10 },
  tileNum: { fontSize: 19, fontWeight: "700", color: T.cream, lineHeight: 22 },
  tileLbl: { fontSize: 10, color: T.creamDim, marginTop: 4, lineHeight: 13 },
  bar: { flexDirection: "row", height: 6, borderRadius: 4, overflow: "hidden", marginTop: 2, marginBottom: 9, backgroundColor: T.bg },
  legend: { flexDirection: "row", flexWrap: "wrap", marginBottom: 11 },
  legItem: { flexDirection: "row", alignItems: "center", marginRight: 12, marginBottom: 3 },
  swatch: { width: 8, height: 8, borderRadius: 2, marginRight: 5 },
  legTxt: { fontSize: 10.5, color: T.creamDim },
  sentence: { fontSize: 12.5, lineHeight: 20, color: T.creamDim },
  strong: { color: T.cream, fontWeight: "600" },
});
