import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { T } from "../lib/theme";
import type { CivicItem } from "../lib/supabase";

type Props = {
  item: CivicItem;
  onPress: () => void;
};

// Human-readable label per source. The route prefixes titles with emoji, so the
// label here is the small caps tag under the title (matches the web feed).
const SOURCE_LABEL: Record<CivicItem["source"], string> = {
  civic_engine: "Council",
  seeclickfix: "311 · SeeClickFix",
  township: "Township",
  township_news: "Township News",
  noaa: "Weather Alert",
};

// Status dot color from the card's outcome — mirrors the web feed. Approved =
// green, denied/rejected = red, deferred/tabled = amber, otherwise neutral.
function dotFor(item: CivicItem): string {
  if (item.source === "noaa") return "#E57373";
  const sig = String(item.outcome_signal || "").toLowerCase();
  if (/approv/.test(sig)) return "#4CAF80";
  if (/deny|denied|reject/.test(sig)) return "#E57373";
  if (/defer|tabl/.test(sig)) return "#F0B84A";
  return "#9A9188";
}

export default function CivicFeedItem({ item, onPress }: Props) {
  const isAlert = item.source === "noaa";
  const label = SOURCE_LABEL[item.source] ?? item.source;
  const dot = dotFor(item);

  return (
    <TouchableOpacity
      style={[s.card, { borderLeftColor: dot }, isAlert && s.cardAlert]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Line 1 — status dot + title (wraps to max 2 lines). */}
      <View style={s.headline}>
        <View style={[s.dot, { backgroundColor: dot }]} />
        <Text style={s.title} numberOfLines={2}>{item.title}</Text>
      </View>

      {/* Line 2 — one compact meta line. */}
      <View style={s.metaRow}>
        <Text style={[s.source, isAlert && s.sourceAlert]}>{label.toUpperCase()}</Text>
        <Text style={s.meta}>
          {" · "}
          {new Date(item.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </Text>
        {typeof item._dist === "number" && (
          <Text style={[s.meta, s.metaHi]}>
            {" · "}{item._dist < 0.1 ? "<0.1" : item._dist.toFixed(1)} mi
          </Text>
        )}
        {item._inDistrict && (
          <Text style={[s.meta, s.district]}> · YOUR DISTRICT</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
    borderLeftWidth: 3,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 12,
  },
  cardAlert: { borderColor: T.red, backgroundColor: T.redLo },
  headline: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  dot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0, marginTop: 5 },
  title: { flex: 1, color: T.cream, fontSize: 15, fontWeight: "500", lineHeight: 20 },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: 4, marginLeft: 19 },
  source: { color: T.amberHi, fontSize: 10, fontWeight: "600", letterSpacing: 0.6 },
  sourceAlert: { color: T.red },
  meta: { color: T.creamFaint, fontSize: 10 },
  metaHi: { color: T.tealHi, fontWeight: "600" },
  district: { color: T.tealHi, fontWeight: "700", letterSpacing: 0.4 },
});
