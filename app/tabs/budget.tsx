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
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { getCurrentUser } from "../../lib/sessionUser";
import { isVerifiedForCurrentNeighborhood, goVerify } from "../../lib/residency";
import { T } from "../../lib/theme";

// The stable key tying a raised issue back to a budget line (web parity):
// match on (municipality_id, fcoa) — or label when there's no FCOA — not a uuid
// FK, because budgets are re-seeded yearly. Mirrors migration 073's budget_ref.
const lineKey = (muni: string, line: any) => `${muni}::${line.fcoa || line.label}`;

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
  const [school, setSchool] = useState<any>(null);
  const [schoolLines, setSchoolLines] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [verified, setVerified] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);   // lineKey of open drawer
  const [issueCounts, setIssueCounts] = useState<Record<string, number>>({});
  const [raise, setRaise] = useState<any>(null);                   // { line, muni, year, section }
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  // Budget-linked issues are low-volume — fetch all, bucket client-side.
  async function loadIssueCounts() {
    const { data, error } = await supabase.from("civic_issues")
      .select("budget_ref").not("budget_ref", "is", null).is("removed_at", null).limit(1000);
    if (error) return;
    const counts: Record<string, number> = {};
    for (const r of data || []) {
      const br: any = r.budget_ref; if (!br?.municipality_id) continue;
      const k = `${br.municipality_id}::${br.fcoa || br.label}`;
      counts[k] = (counts[k] || 0) + 1;
    }
    setIssueCounts(counts);
  }

  async function submitRaise() {
    if (!raise || submitting) return;
    if (!verified) { setRaise(null); goVerify(); return; }
    setSubmitting(true);
    const { line, muni, year } = raise;
    const { data: prof } = currentUser
      ? await supabase.from("profiles").select("neighborhood_id").eq("id", currentUser.id).maybeSingle()
      : { data: null };
    const q = note.trim();
    const amt = Number(line.amount);
    const title = q ? (q.length > 90 ? q.slice(0, 90) + "…" : q) : `Question on ${line.label} — ${year} budget`;
    const budget_ref = {
      municipality_id: muni, year,
      fcoa: line.fcoa || null, kind: line.kind, label: line.label,
      amount: amt, prior_amount: line.prior_amount != null ? Number(line.prior_amount) : null,
    };
    const { data: issue, error } = await supabase.from("civic_issues").insert({
      neighborhood_id: prof?.neighborhood_id || null,
      title, description: q || null, status: "open", voice_count: 0, priority_pct: 0,
      source_label: `Raised from the ${year} budget`, budget_ref,
    }).select().single();
    setSubmitting(false);
    if (error) {
      const denied = error.code === "42501" || /policy|permission|residen/i.test(error.message || "");
      showToast(denied ? "Verify your residency to raise a civic issue." : "Couldn't raise the issue — try again.");
      return;
    }
    setIssueCounts((c) => { const k = lineKey(muni, line); return { ...c, [k]: (c[k] || 0) + 1 }; });
    setRaise(null); setNote("");
    router.push({ pathname: "/issue/[id]", params: { id: issue.id } });
  }

  useEffect(() => { load(); }, []);
  async function load() {
    setLoadError(null);
    try {
      // Viewer's municipality from their neighborhood slug prefix; guests and
      // towns without a filing fall back to the flagship (Jackson).
      let muni = "jackson_nj";
      const user = await getCurrentUser();
      setCurrentUser(user);
      if (user) {
        isVerifiedForCurrentNeighborhood(user.id).then(setVerified).catch(() => {});
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
      // The school district's budget (biggest slice of the bill) — best-effort.
      const { data: sb } = await supabase.from("budgets")
        .select("*").eq("municipality_id", `${b.municipality_id.split("_")[0]}_schools_nj`)
        .order("year", { ascending: false }).limit(1).maybeSingle();
      if (sb) {
        const { data: sl } = await supabase.from("budget_lines")
          .select("*").eq("budget_id", sb.id).order("sort");
        setSchool(sb); setSchoolLines(sl || []);
      }
      loadIssueCounts();
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

  // ONE source of truth for every "your share" figure: derive it from the same
  // meta.tax_breakdown the split bar draws, so the bar and the per-section headers
  // can never disagree. A separate avg_home_municipal/avg_home_school field used to
  // diverge from the breakdown (different year + filing), visibly for Lakewood
  // ($2,916 vs $3,076). Mirrors web BudgetScreen + the budget_consistency view.
  const muniSeg = (meta.tax_breakdown || []).find((s: any) => /municipal/i.test(s.label || ""));
  const schoolSeg = (meta.tax_breakdown || []).find((s: any) => /school/i.test(s.label || ""));
  const avgMunicipal = (muniSeg?.avg_home ?? meta.avg_home_municipal) || null;
  const breakdownYear = meta.breakdown_year || budget.year;

  const BarRow = ({ line, max, color, yourShare, muni, year, section, shareOfTotal }:
    { line: any; max: number; color: string; yourShare: number | null; muni: string; year: any; section: string; shareOfTotal: number | null }) => {
    const amt = Number(line.amount);
    // Free 2-point trend: year-over-year change where prior_amount is on file
    // (municipal + revenue lines have it; school lines don't, so it just doesn't
    // render). Direction only — up/down spending isn't inherently good or bad.
    const prior = Number(line.prior_amount);
    const delta = prior > 0 ? (amt - prior) / prior : null;
    const k = lineKey(muni, line);
    const count = issueCounts[k] || 0;
    const open = expanded === k;
    return (
      <View style={s.barRow}>
        <Pressable onPress={() => setExpanded(open ? null : k)}>
          <View style={s.barLabels}>
            <Text style={s.barLabel} numberOfLines={1}>{line.label}</Text>
            {count > 0 && <Text style={s.barFlag}>{count} ⚑</Text>}
            {delta != null && Math.abs(delta) >= 0.005 && (
              <Text style={s.barDelta}>{delta >= 0 ? "▲" : "▼"}{Math.abs(delta * 100).toFixed(0)}%</Text>
            )}
            <Text style={s.barAmt}>{fmtCompact(amt)}</Text>
            {yourShare != null && <Text style={s.barShare}>≈ {fmtUSD(yourShare)}/yr</Text>}
          </View>
          <View style={s.barTrack}>
            <View style={[s.barFill, { width: `${Math.max((amt / max) * 100, 0.5)}%`, backgroundColor: color }]} />
          </View>
        </Pressable>

        {open && (
          <View style={s.drawer}>
            <View style={s.drawerRow}><Text style={s.drawerK}>This year</Text><Text style={s.drawerV}>{fmtUSD(amt)}</Text></View>
            {prior > 0 && (<>
              <View style={s.drawerRow}><Text style={s.drawerK}>Prior year</Text><Text style={s.drawerV}>{fmtUSD(prior)}</Text></View>
              <View style={s.drawerRow}><Text style={s.drawerK}>Change</Text>
                <Text style={[s.drawerV, { color: (delta as number) >= 0 ? T.amberHi : T.tealHi }]}>
                  {(delta as number) >= 0 ? "+" : "−"}{fmtUSD(Math.abs(amt - prior))} ({(delta as number) >= 0 ? "+" : "−"}{Math.abs((delta as number) * 100).toFixed(1)}%)
                </Text>
              </View>
            </>)}
            {shareOfTotal != null && (
              <View style={s.drawerRow}><Text style={s.drawerK}>Share of {section}</Text><Text style={s.drawerV}>{(shareOfTotal * 100).toFixed(1)}%</Text></View>
            )}
            {yourShare != null && (
              <View style={s.drawerRow}><Text style={s.drawerK}>Your house, ≈/yr</Text><Text style={[s.drawerV, { color: T.amberHi }]}>{fmtUSD(yourShare)}</Text></View>
            )}
            {line.ft_positions != null && Number(line.ft_positions) > 0 && (
              <View style={s.drawerRow}><Text style={s.drawerK}>Staff</Text><Text style={s.drawerV}>{Number(line.ft_positions)} FT{line.pt_positions ? ` · ${Number(line.pt_positions)} PT` : ""}</Text></View>
            )}
            <View style={s.drawerFoot}>
              <Text style={s.drawerNote}>
                {count > 0 ? `${count} resident${count === 1 ? " is" : "s are"} questioning this line.` : "Something look off? Put it on the record."}
              </Text>
              <Pressable style={s.raiseBtn}
                onPress={() => { if (!verified) { goVerify(); return; } setNote(""); setRaise({ line, muni, year, section }); }}>
                <Text style={s.raiseBtnText}>Raise a question</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
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
          {avgMunicipal ? <>Of your bill, <Text style={s.blurbStrong}>{fmtUSD(avgMunicipal)}</Text> ({breakdownYear} tax) went to municipal purposes</> : "The township budget"}
          {" — the "}{budget.year} budget is {fmtCompact(appropTotal)} in all{meta.positions_ft ? `, ${meta.positions_ft} full-time and ${meta.positions_pt} part-time employees` : ""}.
          The amber figure is each line's share of that {avgMunicipal ? fmtUSD(avgMunicipal) : "bill"} (proportional estimate).
        </Text>
        <View style={s.card}>
          {approps.map((l) => (
            <BarRow key={l.id} line={l} max={maxApprop} color={T.amber}
              muni={budget.municipality_id} year={budget.year} section="the municipal budget"
              shareOfTotal={appropTotal > 0 ? Number(l.amount) / appropTotal : null}
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

        {/* 3b · The schools' slice — the biggest piece of the bill */}
        {school && schoolLines.length > 0 && (() => {
          const sm = school.meta || {};
          const sTotal = schoolLines.reduce((n: number, l: any) => n + Number(l.amount), 0);
          const sMax = Math.max(...schoolLines.map((l: any) => Number(l.amount)), 1);
          // Same one-source rule: school "your share" comes from the split bar's
          // Local School District segment, not a separate avg_home_school.
          const avgSchool = (schoolSeg?.avg_home ?? sm.avg_home_school) || null;
          return (
            <>
              <Text style={s.sectionLabel}>THE SCHOOLS' SLICE — {(sm.school_year || school.year)} DISTRICT BUDGET</Text>
              <Text style={s.blurb}>
                {avgSchool ? <>The biggest piece: <Text style={s.blurbStrong}>{fmtUSD(avgSchool)}</Text> ({breakdownYear} tax) of your bill funds {sm.district || "the school district"}</> : (sm.district || "The school district")}
                {" — a "}{fmtCompact(sTotal)} general fund{sm.per_pupil ? `, ${fmtUSD(sm.per_pupil)} per pupil` : ""}.
                The amber figure is each line's share of that {avgSchool ? fmtUSD(avgSchool) : "share"} (proportional estimate).
              </Text>
              <View style={s.card}>
                {schoolLines.map((l: any) => (
                  <BarRow key={l.id} line={l} max={sMax} color="#3987E5"
                    muni={school.municipality_id} year={sm.school_year || school.year} section="the school budget"
                    shareOfTotal={sTotal > 0 ? Number(l.amount) / sTotal : null}
                    yourShare={avgSchool ? (Number(l.amount) / sTotal) * avgSchool : null} />
                ))}
                <Text style={[s.readout, picked?.kind === "line" && picked?.budget_id === school.id && s.readoutActive]}>
                  {picked?.kind === "line" && picked?.budget_id === school.id
                    ? `${picked.label}: ${fmtUSD(Number(picked.amount))} · ${((Number(picked.amount) / sTotal) * 100).toFixed(1)}% of the general fund`
                    : "District figures from the NJ DOE 2025–26 advertised User-Friendly Budget."}
                </Text>
              </View>
            </>
          );
        })()}

        {/* 4 · How it's paid for */}
        <Text style={s.sectionLabel}>HOW THE {fmtCompact(revTotal)} IS PAID FOR</Text>
        <View style={s.card}>
          {revenues.map((l) => (
            <BarRow key={l.id} line={l} max={maxRev} color="#199E70"
              muni={budget.municipality_id} year={budget.year} section="revenues"
              shareOfTotal={revTotal > 0 ? Number(l.amount) / revTotal : null}
              yourShare={null} />
          ))}
          <Text style={s.readout}>Property tax is only part of it — surplus, state aid, and fees carry the rest.</Text>
        </View>

        <Text style={s.source}>
          Every figure is transcribed from the official {budget.year} Municipal User-Friendly Budget filing
          {budget.source_url ? <Text style={s.sourceLink} onPress={() => Linking.openURL(budget.source_url)}> (view the document ↗)</Text> : null}
          . "Your share" figures are proportional estimates for the average assessed home, not a bill line.
        </Text>
      </ScrollView>

      {/* Raise-a-question composer */}
      <Modal visible={!!raise} transparent animationType="slide" onRequestClose={() => !submitting && setRaise(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.modalWrap}>
          <Pressable style={s.modalBackdrop} onPress={() => !submitting && setRaise(null)} />
          <View style={s.sheet}>
            <Text style={s.sheetKicker}>RAISE A QUESTION</Text>
            {raise && (
              <View style={s.sheetLine}>
                <Text style={s.sheetLineLabel}>{raise.line.label}</Text>
                <Text style={s.sheetLineMeta}>
                  {fmtUSD(Number(raise.line.amount))} · {raise.year} {raise.section}
                  {Number(raise.line.prior_amount) > 0
                    ? ` · ${Number(raise.line.amount) >= Number(raise.line.prior_amount) ? "+" : "−"}${Math.abs(((Number(raise.line.amount) - Number(raise.line.prior_amount)) / Number(raise.line.prior_amount)) * 100).toFixed(0)}% vs prior year`
                    : ""}
                </Text>
              </View>
            )}
            <TextInput value={note} onChangeText={setNote} multiline
              placeholder="What's your question or concern about this line? (optional)"
              placeholderTextColor={T.creamFaint} style={s.sheetInput} />
            <Text style={s.sheetHint}>
              This opens a public civic issue linked to this budget line. Neighbors can weigh in and officials can respond — the figures above are saved as they read today.
            </Text>
            <View style={s.sheetBtns}>
              <Pressable style={s.sheetCancel} onPress={() => !submitting && setRaise(null)}>
                <Text style={s.sheetCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[s.sheetSubmit, submitting && { opacity: 0.7 }]} onPress={submitRaise} disabled={submitting}>
                <Text style={s.sheetSubmitText}>{submitting ? "Raising…" : "Raise this question →"}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {toast && (<View style={s.toast}><Text style={s.toastText}>{toast}</Text></View>)}
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
  barFlag: { color: T.amberHi, backgroundColor: T.amberLo, borderWidth: 1, borderColor: T.amberMid, borderRadius: 99, fontSize: 9, paddingHorizontal: 6, paddingVertical: 1, overflow: "hidden" },
  drawer: { marginTop: 8, marginBottom: 4, padding: 12, backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 11 },
  drawerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3 },
  drawerK: { color: T.creamDim, fontSize: 12, flex: 1 },
  drawerV: { color: T.cream, fontSize: 12, fontVariant: ["tabular-nums"], textAlign: "right" },
  drawerFoot: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: T.border, flexDirection: "row", alignItems: "center", gap: 10 },
  drawerNote: { color: T.creamDim, fontSize: 11.5, flex: 1, lineHeight: 16 },
  raiseBtn: { backgroundColor: T.amberLo, borderWidth: 1, borderColor: T.amberMid, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 7 },
  raiseBtnText: { color: T.amberHi, fontSize: 12, fontWeight: "600" },
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: T.surface, borderTopWidth: 1, borderTopColor: T.border, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 18, paddingBottom: 26 },
  sheetKicker: { color: T.creamFaint, fontSize: 11, fontWeight: "600", letterSpacing: 1, marginBottom: 8 },
  sheetLine: { padding: 10, backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 10, marginBottom: 12 },
  sheetLineLabel: { color: T.cream, fontSize: 13.5, marginBottom: 3 },
  sheetLineMeta: { color: T.creamDim, fontSize: 11.5, fontVariant: ["tabular-nums"] },
  sheetInput: { backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 10, color: T.cream, fontSize: 13, padding: 11, minHeight: 88, textAlignVertical: "top" },
  sheetHint: { color: T.creamFaint, fontSize: 11, lineHeight: 16, marginTop: 8 },
  sheetBtns: { flexDirection: "row", gap: 10, marginTop: 14 },
  sheetCancel: { borderWidth: 1, borderColor: T.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11, justifyContent: "center" },
  sheetCancelText: { color: T.creamDim, fontSize: 13 },
  sheetSubmit: { flex: 1, backgroundColor: T.amberHi, borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  sheetSubmitText: { color: T.bg, fontSize: 13, fontWeight: "600" },
  toast: { position: "absolute", bottom: 24, alignSelf: "center", backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, maxWidth: "90%" },
  toastText: { color: T.cream, fontSize: 12.5 },
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
  barDelta: { color: T.creamFaint, fontSize: 10.5, fontVariant: ["tabular-nums"] },
  barAmt: { color: T.creamDim, fontSize: 12, fontVariant: ["tabular-nums"] },
  barShare: { color: T.amberHi, fontSize: 12, width: 86, textAlign: "right", fontVariant: ["tabular-nums"] },
  barTrack: { height: 6, backgroundColor: T.border + "55", borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
  source: { color: T.creamFaint, fontSize: 11.5, lineHeight: 17, marginTop: 18 },
  sourceLink: { color: T.blueHi },
});
