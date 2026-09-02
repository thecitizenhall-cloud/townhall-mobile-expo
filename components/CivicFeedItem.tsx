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

// A bare "2026-01-07" parsed as UTC midnight renders as January 6th for every
// reader west of Greenwich, and this feed is entirely in New Jersey — so parse
// date-only values at local noon.
function shortDate(value?: string | null): string | null {
  if (!value) return null;
  const day = String(value).split("T")[0];
  const parts = day.split("-");
  if (parts.length !== 3) return null;
  return new Date(+parts[0], +parts[1] - 1, +parts[2])
    .toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// BOTH dates when they disagree. town_feed carries first_seen beside the
// meeting date precisely so a January hearing ingested last week can say so: the
// meeting date alone makes a just-published record look stale, and the
// first-seen date alone makes a seven-month-old hearing look like this week's
// news. Non-council items (bulletins, weather) have only the one date.
function dateLabel(item: any): string {
  const heard = shortDate(item.created_at);
  const seen = shortDate(item._firstSeen);
  if (heard && seen && heard !== seen) return `First appeared ${seen} · heard ${heard}`;
  return heard || seen || "";
}

// One colour per band, from the existing palette. Deliberately not five
// accents: only the two that ask something of the resident — a question you
// asked came back, a matter past its own stated date — carry weight. A feed
// where everything is highlighted highlights nothing.
function bandColor(band: number): string {
  if (band === 0) return T.tealHi;
  if (band === 3) return T.amberHi;
  return T.creamFaint;
}

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

      {/* WHY this matter is in front of you. town_feed computes the band and
          the sentence together so the badge can never state a different reason
          than the one that ranked the card, so this prints the server's words
          rather than deriving its own. Band 5 is the resting state — announcing
          "On the public record" on every card would be noise. */}
      {(item as any)._bandReason != null && (item as any)._band != null && (item as any)._band < 5 && (
        <View style={s.bandRow}>
          <View style={[s.bandDot, { backgroundColor: bandColor((item as any)._band) }]} />
          <Text style={[s.bandText, { color: bandColor((item as any)._band) }]} numberOfLines={1}>
            {(item as any)._bandReason}
          </Text>
        </View>
      )}

      <Text style={s.title} numberOfLines={3}>{item.title}</Text>

      {item.body ? (
        <Text style={s.body} numberOfLines={3}>{item.body}</Text>
      ) : null}

      <View style={s.footer}>
        <Text style={s.date}>{dateLabel(item)}</Text>
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
        {item._onRoute && (
          <Text style={[s.date, { color: T.amberHi, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 }]}>
            · 🚧 {item._onRoute}
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
  // T.red is 3.00:1 to 3.55:1 — fine for a border or a fill, under 4.5:1 as
  // text. redHi (5.46:1 worst) is the text-safe member of the pair.
  sourceAlert: { color: T.redHi },
  outcomePill: {
    backgroundColor: T.tealLo, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  outcomeText: { color: T.teal, fontSize: 10, fontWeight: "600" },
  bandRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  bandDot: { width: 5, height: 5, borderRadius: 2.5 },
  bandText: { fontSize: 10.5, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  title: { color: T.cream, fontSize: 15, fontWeight: "500", lineHeight: 22, marginBottom: 8 },
  body: { color: T.creamDim, fontSize: 13, lineHeight: 20, marginBottom: 10 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  date: { color: T.creamFaint, fontSize: 11 },
  address: { color: T.creamFaint, fontSize: 11, flexShrink: 1, textAlign: "right" },
});
