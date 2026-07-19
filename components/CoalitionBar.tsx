import { View, Text, StyleSheet } from "react-native";
import { T } from "../lib/theme";

// Coalition threshold bar — the "majority moves things forward" mechanism made
// legible (mobile parity: components/CoalitionBar.jsx on web). Shows the verified
// residents who prioritized an issue (count), a bar toward the per-neighborhood
// line (threshold), and the consequence that fires when it's crossed. RN has no
// CSS gradients, so the web's amber/teal gradients become solid accents.
//
// Props:
//   count     — voice_count (verified residents who prioritized this)
//   threshold — the coalition line for this neighborhood
//   status    — civic_issues.status ('open' | 'escalated' | 'expert' | 'resolved')
//   council   — label for the body it escalates to, e.g. "Jackson Council"
export default function CoalitionBar({
  count = 0,
  threshold = 8,
  status = "open",
  council = "the council",
}: {
  count?: number;
  threshold?: number;
  status?: string;
  council?: string;
}) {
  const moved     = status === "escalated" || status === "expert" || status === "resolved";
  const reached   = moved || count >= threshold;
  const remaining = Math.max(0, threshold - count);
  const pct       = reached ? 100 : Math.max(4, Math.round((count / threshold) * 100));

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.kicker}>Neighbor coalition</Text>
        <Text style={s.count}>
          <Text style={s.countNum}>{count.toLocaleString()}</Text> of {threshold} residents
        </Text>
      </View>

      <View style={s.track}>
        <View
          style={[
            s.fill,
            { width: `${pct}%`, backgroundColor: reached ? T.tealHi : T.amberHi },
          ]}
        />
      </View>

      <Text style={[s.copy, { color: reached ? T.tealHi : T.creamDim }]}>
        {reached ? (
          moved ? (
            <Text>✓ Coalition carried this — it stands as a formal request to <Text style={s.copyStrong}>{council}</Text>.</Text>
          ) : (
            <Text>✓ Coalition reached — this becomes a formal request to <Text style={s.copyStrong}>{council}</Text>.</Text>
          )
        ) : count === 0 ? (
          <Text>Be the first. <Text style={s.copyEm}>{threshold} neighbors</Text> makes this a formal request to {council}.</Text>
        ) : remaining === 1 ? (
          <Text><Text style={s.copyEm}>1 more neighbor</Text> makes this a formal request to {council}.</Text>
        ) : (
          <Text><Text style={s.copyEm}>{remaining} more neighbors</Text> make this a formal request to {council}.</Text>
        )}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: T.amber + "44",
    backgroundColor: T.amberLo,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 },
  kicker: { fontSize: 10, fontWeight: "600", color: T.amberHi, textTransform: "uppercase", letterSpacing: 1.2 },
  count: { fontSize: 12, color: T.creamDim, fontWeight: "500" },
  countNum: { color: T.cream, fontWeight: "700", fontSize: 14 },
  track: { height: 10, borderRadius: 99, backgroundColor: T.border, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 99 },
  copy: { fontSize: 12, lineHeight: 18, marginTop: 10 },
  copyStrong: { fontWeight: "700" },
  copyEm: { color: T.cream, fontWeight: "600" },
});
