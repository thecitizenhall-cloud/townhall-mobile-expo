import { View, Text, StyleSheet } from "react-native";
import { useTheme, useStyles, type Palette } from "../lib/themeContext";

// Coalition threshold bar — the "majority moves things forward" mechanism made
// legible (mobile parity: components/CoalitionBar.jsx on web). Shows the verified
// residents who prioritized an issue (count), a bar toward the per-neighborhood
// line (threshold), and the consequence that fires when it's crossed. RN has no
// CSS gradients, so the web's amber/teal gradients become solid accents.
//
// Props:
//   count     — voice_count (verified residents who prioritized this)
//   threshold — the coalition line for this neighborhood, or null while it is
//               loading or unavailable. Never substitute a number for it: a
//               made-up line ("25 of 8") is a wrong civic fact stated with
//               confidence (web #219).
//   thresholdUnavailable — true once loading the line has failed
//   status    — civic_issues.status ('open' | 'escalated' | 'expert' | 'resolved')
//   council   — label for the body it escalates to, e.g. "Jackson Council"
export default function CoalitionBar({
  count = 0,
  threshold = null,
  thresholdUnavailable = false,
  status = "open",
  council = "the council",
}: {
  count?: number;
  threshold: number | null;
  thresholdUnavailable?: boolean;
  status?: string;
  council?: string;
}) {
  const T = useTheme();
  const s = useStyles(makeStyles);
  const moved     = status === "escalated" || status === "expert" || status === "resolved";
  const reached   = moved || (threshold !== null && count >= threshold);
  const remaining = threshold === null ? null : Math.max(0, threshold - count);
  // No line, no fill: a track filled toward an unknown line would imply a ratio.
  const pct       = moved ? 100 : threshold === null ? null : reached ? 100 : Math.max(4, Math.round((count / threshold) * 100));
  // The placeholders are siblings of the text, never inside it: a View inside
  // a Text lays out differently across Android versions.
  const loading   = threshold === null && !moved && !thresholdUnavailable;
  const countText = threshold !== null ? `${count.toLocaleString()} of ${threshold} residents` : `${count.toLocaleString()} residents`;

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.kicker}>Neighbor coalition</Text>
        <View style={s.countRow} accessible accessibilityLabel={countText}>
          <Text style={s.count}>
            <Text style={s.countNum}>{count.toLocaleString()}</Text>
            {threshold !== null ? ` of ${threshold}` : ""}
            {loading ? "" : " residents"}
          </Text>
          {loading ? (
            <>
              <View style={s.countSlot} accessible={false} importantForAccessibility="no-hide-descendants" />
              <Text style={s.count}>residents</Text>
            </>
          ) : null}
        </View>
      </View>

      <View style={s.track}>
        {pct !== null ? (
          <View
            style={[
              s.fill,
              { width: `${pct}%`, backgroundColor: reached ? T.tealHi : T.amberHi },
            ]}
          />
        ) : null}
      </View>

      {threshold === null && !reached && !thresholdUnavailable ? (
        <View style={s.copySlot} accessible={false} importantForAccessibility="no-hide-descendants" />
      ) : (
        <Text style={[s.copy, { color: reached ? T.tealHi : T.creamDim }]}>
          {reached ? (
            moved ? (
              <Text>✓ Coalition carried this — it stands as a formal request to <Text style={s.copyStrong}>{council}</Text>.</Text>
            ) : (
              <Text>✓ Coalition reached — this becomes a formal request to <Text style={s.copyStrong}>{council}</Text>.</Text>
            )
          ) : threshold === null ? (
            <Text>Coalition line unavailable.</Text>
          ) : count === 0 ? (
            <Text>Be the first. <Text style={s.copyEm}>{threshold} neighbors</Text> makes this a formal request to {council}.</Text>
          ) : remaining === 1 ? (
            <Text><Text style={s.copyEm}>1 more neighbor</Text> makes this a formal request to {council}.</Text>
          ) : (
            <Text><Text style={s.copyEm}>{remaining} more neighbors</Text> make this a formal request to {council}.</Text>
          )}
        </Text>
      )}
    </View>
  );
}

const makeStyles = (T: Palette) => StyleSheet.create({
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
  countRow: { flexDirection: "row", alignItems: "center" },
  count: { fontSize: 12, color: T.creamDim, fontWeight: "500" },
  countSlot: { width: 30, height: 8, borderRadius: 4, backgroundColor: T.border, marginHorizontal: 4 },
  copySlot: { width: "70%", height: 8, borderRadius: 4, backgroundColor: T.border, marginTop: 15, marginBottom: 5 },
  countNum: { color: T.cream, fontWeight: "700", fontSize: 14 },
  track: { height: 10, borderRadius: 99, backgroundColor: T.border, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 99 },
  copy: { fontSize: 12, lineHeight: 18, marginTop: 10 },
  copyStrong: { fontWeight: "700" },
  copyEm: { color: T.cream, fontWeight: "600" },
});
