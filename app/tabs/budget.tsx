// The Budget room (mobile) — where the money goes, and what it costs YOUR
// house. Port of web components/BudgetScreen.jsx: NJ Municipal User-Friendly
// Budget data (budgets + budget_lines, seeded from the official filing).
//
// Same chart rules as web (dataviz method): the 5 stacked-segment hues are
// the validated categorical set; segments carry 2px surface gaps and every
// one is direct-labeled in the legend list. Bars are single-series magnitude
// → one hue, direct value labels in text ink. No hover on a phone — tapping
// a segment or line shows the exact-figures readout instead.
import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking } from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { getCurrentUser } from "../../lib/sessionUser";
import { T } from "../../lib/theme";

// Validated categorical slots (dataviz reference palette, dark steps) against
// T.surface — do not reorder: the ordering is the CVD-safety mechanism.
const SEG_COLORS = ["#3987E5", "#199E70", "#C98500", "#008300", "#9085E9"];

const fmtUSD = (n: any, digits = 0) =>
  n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: digits });
const fmtCompact = (n: any) => {
  if (n == null) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (Math.abs(v) >= 1e3) return "$" + Math.round(v / 1e3) + "K";
  return "$" + Math.round(v);
};

function townLabelFromMuni(muniId?: string | null) {
  const base = String(muniId || "").split("_")[0];
  return base ? base.charAt(0).toUpperCase() + base.slice(1) + " Township" : "your town";
}

// Fold the 8 UFB taxing entities into 5 segments (series soft-cap).
function foldBreakdown(rows: any[]) {
  const keep = ["Local School District", "Municipal Purpose Tax", "County Purposes", "Fire Districts"];
  const main = keep.map((k) => rows.find((r) => r.label === k)).filter(Boolean);
  const rest = rows.filter((r) => !keep.includes(r.label));
  if (!rest.length) return main;
  return [...main, {
    label: "Open space, library & health",
    avg_home: rest.reduce((n, r) => n + (r.avg_home || 0), 0),
    pct: rest.reduce((n, r) => n + (r.pct || 0), 0),
    levy: rest.reduce((n, r) => n + (r.levy || 0), 0),
  }];
}

const SHORT: Record<string, string> = {
  "Local School District": "Schools",
  "Municipal Purpose Tax": "Township",
  "County Purposes": "County",
  "Fire Districts": "Fire districts",
};

export default function BudgetScreen() {
  const [budget, setBudget] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [town, setTown] = useState("");
  const [borrowed, setBorrowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<any>(null); // tapped segment/line readout

  useEffect(() => { load(); }, []);
  async function load() {
    setLoadError(null);
    try {
      // Viewer's municipality from their neighborhood slug prefix; guests and
      // towns without a filing fall back to the flagship (Jackson).
      let muni = "jackson_nj";
      const user = await getCurrentUser();
      if (user) {
        const { data: p } = await supabase.from("profiles").select("neighborhood_id").eq("id", user.id).maybeSingle();
        if (p?.neighborhood_id) {
          const { data: hood } = await supabase.from("neighborhoods").select("slug").eq("id", p.neighborhood_id).maybeSingle();
          const prefix = hood?.slug?.split("-")[0];
          if (prefix) muni = `${prefix}_nj`;
        }
      }
      let { data: b } = await supabase.from("budgets")
        .select("*").eq("municipality_id", muni)
        .order("year", { ascending: false }).limit(1).maybeSingle();
      if (!b && muni !== "jackson_nj") {
        ({ data: b } = await supabase.from("budgets")
          .select("*").eq("municipality_id", "jackson_nj")
          .order("year", { ascending: false }).limit(1).maybeSingle());
        setBorrowed(!!b);
      }
      if (!b) { setBudget(null); return; }
      setTown(townLabelFromMuni(b.municipality_id));
      const { data: ls } = await supabase.from("budget_lines")
        .select("*").eq("budget_id", b.id).order("sort");
      setBudget(b); setLines(ls || []);
    } catch (e) {
      console.error("Budget load error:", e);
      setLoadError("Couldn't load the budget — tap to retry.");
    } finally {
      setLoading(false);
    }
  }

  const header = (
    <View style={s.head}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/tabs/feed"))}
        accessibilityLabel="Back to your town" style={s.backBtn}>
        <Text style={s.backBtnText}>←</Text>
      </Pressable>
      <Text style={s.headTitle}>Where the money goes</Text>
    </View>
  );

  if (loading) return <View style={s.root}>{header}<View style={s.center}><ActivityIndicator color={T.amber} /></View></View>;
  if (loadError) return (
    <View style={s.root}>{header}
      <Pressable onPress={() => { setLoading(true); load(); }} style={s.loadErr}>
        <Text style={s.loadErrText}>{loadError}</Text>
      </Pressable>
    </View>
  );
  if (!budget) return (
    <View style={s.root}>{header}
      <Text style={s.emptyText}>No budget filing is loaded for your town yet — it appears here as soon as the User-Friendly Budget is ingested.</Text>
    </View>
  );

  const meta = budget.meta || {};
  const breakdown = foldBreakdown(meta.tax_breakdown || []);
  const totalAvg = Number(budget.avg_res_total_tax);
  const approps = lines.filter((l) => l.kind === "appropriation" && Number(l.amount) > 0);
  const revenues = lines.filter((l) => l.kind === "revenue");
  const appropTotal = approps.reduce((n, l) => n + Number(l.amount), 0);
  const revTotal = revenues.reduce((n, l) => n + Number(l.amount), 0);
  const maxApprop = Math.max(...approps.map((l) => Number(l.amount)), 1);
  const maxRev = Math.max(...revenues.map((l) => Number(l.amount)), 1);
  const avgMunicipal = meta.avg_home_municipal || null;

  const BarRow = ({ line, max, color, yourShare }: { line: any; max: number; color: string; yourShare: number | null }) => {
    const amt = Number(line.amount);
    return (
      <Pressable onPress={() => setPicked({ kind: "line", ...line })} style={s.barRow}>
        <View style={s.barLabels}>
          <Text style={s.barLabel} numberOfLines={1}>{line.label}</Text>
          <Text style={s.barAmt}>{fmtCompact(amt)}</Text>
          {yourShare != null && <Text style={s.barShare}>≈ {fmtUSD(yourShare)}/yr</Text>}
        </View>
        <View style={s.barTrack}>
          <View style={[s.barFill, { width: `${Math.max((amt / max) * 100, 0.5)}%`, backgroundColor: color }]} />
        </View>
      </Pressable>
    );
  };

  return (
    <View style={s.root}>
      {header}
      <ScrollView contentContainerStyle={s.content}>
        {borrowed && (
          <View style={s.borrowed}>
            <Text style={s.borrowedText}>Your town hasn't been ingested yet — showing {town}, the flagship. Yours lands with its next filing.</Text>
          </View>
        )}

        {/* 1 · Hero — the number that pertains to you */}
        <Text style={s.sectionLabel}>{town.toUpperCase()} · {meta.breakdown_year || budget.year} PROPERTY TAXES</Text>
        <Text style={s.heroLead}>The average {town} home paid</Text>
        <Text style={s.hero}>{fmtUSD(totalAvg)}</Text>
        <Text style={s.heroSub}>
          across every entity that taxes property here.
          {budget.avg_res_assessment ? ` Average residential assessment: ${fmtUSD(budget.avg_res_assessment)}.` : ""}
        </Text>

        {/* 2 · The split — stacked bar + direct-labeled legend list */}
        <View style={s.card}>
          <View style={s.stack}>
            {breakdown.map((seg: any, i: number) => (
              <Pressable key={seg.label} onPress={() => setPicked({ kind: "seg", ...seg })}
                style={{
                  width: `${(seg.avg_home / totalAvg) * 100}%`,
                  backgroundColor: SEG_COLORS[i],
                  height: "100%",
                  marginRight: i < breakdown.length - 1 ? 2 : 0,
                }} />
            ))}
          </View>
          <Text style={[s.readout, picked?.kind === "seg" && s.readoutActive]}>
            {picked?.kind === "seg"
              ? `${picked.label}: ${fmtUSD(picked.avg_home, 2)} of the average bill · ${picked.pct?.toFixed(1)}% · ${fmtCompact(picked.levy)} town-wide`
              : "Tap a segment for the exact figures."}
          </Text>
          {breakdown.map((seg: any, i: number) => (
            <View key={seg.label} style={s.legendRow}>
              <View style={[s.swatch, { backgroundColor: SEG_COLORS[i] }]} />
              <Text style={s.legendLabel}>{SHORT[seg.label] || seg.label}</Text>
              <Text style={s.legendAmt}>{fmtUSD(seg.avg_home)}</Text>
              <Text style={s.legendPct}>{seg.pct?.toFixed(1)}%</Text>
            </View>
          ))}
        </View>

        {/* 3 · The municipal slice — appropriations with YOUR share */}
        <Text style={s.sectionLabel}>THE TOWNSHIP'S SLICE — {budget.year} MUNICIPAL BUDGET</Text>
        <Text style={s.blurb}>
          {avgMunicipal ? <>Of your bill, <Text style={s.blurbStrong}>{fmtUSD(avgMunicipal)}</Text> a year runs the township</> : "The township budget"}
          {" — "}{fmtCompact(appropTotal)} in all{meta.positions_ft ? `, ${meta.positions_ft} full-time and ${meta.positions_pt} part-time employees` : ""}.
          The amber figure is each line's share of that {avgMunicipal ? fmtUSD(avgMunicipal) : "bill"} (proportional estimate).
        </Text>
        <View style={s.card}>
          {approps.map((l) => (
            <BarRow key={l.id} line={l} max={maxApprop} color={T.amber}
              yourShare={avgMunicipal ? (Number(l.amount) / appropTotal) * avgMunicipal : null} />
          ))}
          <Text style={[s.readout, picked?.kind === "line" && s.readoutActive]}>
            {picked?.kind === "line"
              ? `${picked.label}: ${fmtUSD(Number(picked.amount))}` +
                (picked.prior_amount != null && Number(picked.prior_amount) > 0
                  ? ` · ${Number(picked.amount) >= Number(picked.prior_amount) ? "+" : "−"}${fmtCompact(Math.abs(Number(picked.amount) - Number(picked.prior_amount)))} vs prior year` : "") +
                (picked.ft_positions != null ? ` · ${Number(picked.ft_positions)} FT${picked.pt_positions ? ` / ${Number(picked.pt_positions)} PT` : ""} staff` : "")
              : "Tap a line for exact figures and year-over-year change."}
          </Text>
        </View>

        {/* 4 · How it's paid for */}
        <Text style={s.sectionLabel}>HOW THE {fmtCompact(revTotal)} IS PAID FOR</Text>
        <View style={s.card}>
          {revenues.map((l) => (
            <BarRow key={l.id} line={l} max={maxRev} color="#199E70" yourShare={null} />
          ))}
          <Text style={s.readout}>Property tax is only part of it — surplus, state aid, and fees carry the rest.</Text>
        </View>

        <Text style={s.source}>
          Every figure is transcribed from the official {budget.year} Municipal User-Friendly Budget filing
          {budget.source_url ? <Text style={s.sourceLink} onPress={() => Linking.openURL(budget.source_url)}> (view the document ↗)</Text> : null}
          . "Your share" figures are proportional estimates for the average assessed home, not a bill line.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: T.border },
  backBtn: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center" },
  backBtnText: { color: T.creamDim, fontSize: 15, lineHeight: 18 },
  headTitle: { color: T.amberHi, fontSize: 18, fontWeight: "600", fontStyle: "italic" },
  content: { padding: 16, paddingBottom: 48 },
  loadErr: { margin: 16, padding: 12, borderWidth: 1, borderColor: T.redHi + "55", backgroundColor: T.redLo, borderRadius: 10 },
  loadErrText: { color: T.redHi, fontSize: 13, lineHeight: 18 },
  emptyText: { margin: 16, color: T.creamDim, fontSize: 13, lineHeight: 20 },
  borrowed: { padding: 10, borderWidth: 1, borderColor: T.border, borderRadius: 9, marginBottom: 14 },
  borrowedText: { color: T.creamDim, fontSize: 12, lineHeight: 17 },
  sectionLabel: { color: T.creamFaint, fontSize: 10, fontWeight: "600", letterSpacing: 1, marginTop: 18, marginBottom: 8 },
  heroLead: { color: T.creamDim, fontSize: 13 },
  hero: { color: T.cream, fontSize: 44, fontWeight: "600", marginVertical: 2 },
  heroSub: { color: T.creamDim, fontSize: 12.5, lineHeight: 18, marginBottom: 4 },
  card: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 14, padding: 14, marginTop: 10 },
  stack: { flexDirection: "row", height: 18, borderRadius: 5, overflow: "hidden" },
  readout: { color: T.creamFaint, fontSize: 12, lineHeight: 17, marginTop: 8, minHeight: 17 },
  readoutActive: { color: T.cream },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3, marginTop: 2 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { color: T.cream, fontSize: 12.5, flex: 1 },
  legendAmt: { color: T.creamDim, fontSize: 12.5, fontVariant: ["tabular-nums"] },
  legendPct: { color: T.creamFaint, fontSize: 11, width: 44, textAlign: "right", fontVariant: ["tabular-nums"] },
  blurb: { color: T.creamDim, fontSize: 13, lineHeight: 20 },
  blurbStrong: { color: T.cream, fontWeight: "600" },
  barRow: { paddingVertical: 7 },
  barLabels: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 4 },
  barLabel: { color: T.cream, fontSize: 12.5, flex: 1 },
  barAmt: { color: T.creamDim, fontSize: 12, fontVariant: ["tabular-nums"] },
  barShare: { color: T.amberHi, fontSize: 12, width: 86, textAlign: "right", fontVariant: ["tabular-nums"] },
  barTrack: { height: 6, backgroundColor: T.border + "55", borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
  source: { color: T.creamFaint, fontSize: 11.5, lineHeight: 17, marginTop: 18 },
  sourceLink: { color: T.blueHi },
});
