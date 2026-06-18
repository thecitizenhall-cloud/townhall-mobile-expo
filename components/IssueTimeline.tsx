// The public timeline — a concern's journey, rendered from issue_events so a
// resident can see it move: raised → residents weighed in → sent to an official
// → official responded → resolved. The legibility half of the round trip.
// Ported from web components/IssueTimeline.jsx.
import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { supabase } from "../lib/supabase";
import { T } from "../lib/theme";

const STEP: Record<string, { label: string; color: string }> = {
  raised: { label: "Concern raised", color: T.creamDim },
  staked: { label: "Residents weighed in", color: T.blueHi },
  supported: { label: "Residents weighed in", color: T.blueHi },
  dispatched: { label: "Sent to an official", color: T.amberHi },
  acknowledged: { label: "Acknowledged", color: T.amberHi },
  in_progress: { label: "In progress", color: T.amberHi },
  responded: { label: "Official responded", color: T.tealHi },
  resolved: { label: "Resolved", color: T.tealHi },
  reopened: { label: "Reopened", color: T.redHi },
};

type Event = { kind: string; actor?: string; detail?: any; created_at?: string; synthetic?: boolean };

function fmt(d?: string) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function detailText(it: Event): string {
  const d = it.detail || {};
  if (it.kind === "dispatched") {
    const who = [d.official_name, d.official_title].filter(Boolean).join(", ");
    return who ? `to ${who}` : "";
  }
  if (it.kind === "responded" && d.name) return `by ${d.name}`;
  if (it.synthetic && d.count) return `${d.count} resident${d.count === 1 ? "" : "s"}`;
  return "";
}

export default function IssueTimeline({
  issueId, stakeCount = 0, supportCount = 0,
}: {
  issueId: string;
  stakeCount?: number;
  supportCount?: number;
}) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!issueId) return;
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("issue_events")
        .select("kind, actor, detail, created_at")
        .eq("issue_id", issueId)
        .order("created_at", { ascending: true });
      if (!cancel) {
        setEvents(data || []);
        setLoaded(true);
      }
    })();
    return () => { cancel = true; };
  }, [issueId]);

  if (!loaded || events.length === 0) return null;

  // Build display rows: events, with a synthesized "residents weighed in" line
  // right after 'raised' if there is engagement (counts are live, not events).
  const engagement = (stakeCount || 0) + (supportCount || 0);
  const rows: Event[] = [];
  for (const e of events) {
    if (e.kind === "staked" || e.kind === "supported") continue;
    rows.push(e);
    if (e.kind === "raised" && engagement > 0) {
      rows.push({ kind: "staked", synthetic: true, detail: { count: engagement } });
    }
  }

  return (
    <View style={s.root}>
      <Text style={s.head}>The journey</Text>
      {rows.map((it, i) => {
        const step = STEP[it.kind] || { label: it.kind, color: T.creamDim };
        const last = i === rows.length - 1;
        const dt = detailText(it);
        return (
          <View key={i} style={s.row}>
            <View style={s.rail}>
              <View style={[s.node, { backgroundColor: step.color }]} />
              {!last && <View style={s.line} />}
            </View>
            <View style={{ paddingBottom: last ? 0 : 16, flex: 1 }}>
              <Text style={s.label}>
                {step.label}
                {dt ? <Text style={s.labelDim}> · {dt}</Text> : null}
              </Text>
              {it.created_at ? <Text style={s.date}>{fmt(it.created_at)}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  root: { paddingVertical: 16, borderTopWidth: 1, borderTopColor: T.border },
  head: { fontSize: 10, fontWeight: "600", color: T.amberHi, textTransform: "uppercase", letterSpacing: 1.1, marginBottom: 14 },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  rail: { alignItems: "center", alignSelf: "stretch" },
  node: { width: 10, height: 10, borderRadius: 5, marginTop: 2 },
  line: { flex: 1, width: 2, backgroundColor: T.border, minHeight: 18 },
  label: { fontSize: 13, color: T.cream, fontWeight: "500" },
  labelDim: { color: T.creamDim, fontWeight: "400" },
  date: { fontSize: 11, color: T.creamFaint, marginTop: 2 },
});
