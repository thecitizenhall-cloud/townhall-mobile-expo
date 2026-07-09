import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { T } from "../lib/theme";
import type { CivicItem } from "../lib/supabase";

type Props = {
  item: CivicItem;
  onPress: () => void;
};

// Human-readable label per source. The route prefixes titles with emoji, so the
// label here is the small caps tag above the title (matches the web feed).
const SOURCE_LABEL: Record<CivicItem["source"], string> = {
  civic_engine: "Council",
  seeclickfix: "311 · SeeClickFix",
  township: "Township",
  township_news: "Township News",
  noaa: "Weather Alert",
};

export default function CivicFeedItem({ item, onPress }: Props) {
  const isAlert = item.source === "noaa";
  const label = SOURCE_LABEL[item.source] ?? item.source;

  return (
    <TouchableOpacity
      style={[s.card, isAlert && s.cardAlert]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={s.header}>
        <Text style={[s.source, isAlert && s.sourceAlert]}>
          {label.toUpperCase()}
        </Text>
        {item.outcome_signal && (
          <View style={s.outcomePill}>
            <Text style={s.outcomeText}>Outcome: {item.outcome_signal}</Text>
          </View>
        )}
      </View>

      <Text style={s.title} numberOfLines={3}>{item.title}</Text>

      {item.body ? (
        <Text style={s.body} numberOfLines={3}>{item.body}</Text>
      ) : null}

      <View style={s.footer}>
        <Text style={s.date}>
          {new Date(item.created_at).toLocaleDateString("en-US", {
            month: "short", day: "numeric",
          })}
        </Text>
        {typeof item._dist === "number" && (
          <Text style={[s.date, { color: T.tealHi, fontWeight: "600" }]}>
            · {item._dist < 0.1 ? "<0.1" : item._dist.toFixed(1)} mi away
          </Text>
        )}
        {item._inDistrict && (
          <Text style={[s.date, { color: T.tealHi, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 }]}>
            · Your district
          </Text>
        )}
        {item.address ? (
          <Text style={s.address} numberOfLines={1}>{item.address}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  cardAlert: { borderColor: T.red, backgroundColor: T.redLo },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  source: {
    color: T.amberHi, fontSize: 10, fontWeight: "600",
    letterSpacing: 0.8, flexShrink: 1,
  },
  sourceAlert: { color: T.red },
  outcomePill: {
    backgroundColor: T.tealLo, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  outcomeText: { color: T.teal, fontSize: 10, fontWeight: "600" },
  title: { color: T.cream, fontSize: 15, fontWeight: "500", lineHeight: 22, marginBottom: 8 },
  body: { color: T.creamDim, fontSize: 13, lineHeight: 20, marginBottom: 10 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  date: { color: T.creamFaint, fontSize: 11 },
  address: { color: T.creamFaint, fontSize: 11, flexShrink: 1, textAlign: "right" },
});
