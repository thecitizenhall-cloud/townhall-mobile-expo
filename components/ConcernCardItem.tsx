import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { T } from "../lib/theme";
import type { ConcernCard } from "../lib/supabase";

type Props = {
  card: ConcernCard;
  onPress: () => void;
  isWatched?: boolean;
};

export default function ConcernCardItem({ card, onPress, isWatched }: Props) {
  const hasOutcome = !!card.outcome_signal;
  const quote = card.source_quote ?? card.quote;
  const summary = card.summary ?? card.body;
  const dateStr = card.meeting_date ?? card.created_at;

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.8}>
      <View style={s.header}>
        <Text style={s.source}>{(card.source_label || "Council · Jackson Township").toUpperCase()}</Text>
        {hasOutcome && (
          <View style={s.outcomePill}>
            <Text style={s.outcomeText}>Outcome: {card.outcome_signal}</Text>
          </View>
        )}
      </View>

      <Text style={s.title} numberOfLines={3}>{card.title}</Text>

      {quote ? (
        <Text style={s.quote} numberOfLines={2}>"{quote}"</Text>
      ) : summary ? (
        <Text style={s.summary} numberOfLines={2}>{summary}</Text>
      ) : null}

      <View style={s.footer}>
        <Text style={s.date}>
          {dateStr ? new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
        </Text>
        {isWatched && <Text style={s.watchedBadge}>Following</Text>}
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
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  source: {
    color: T.amberHi, fontSize: 10, fontWeight: "600",
    letterSpacing: 0.8, flexShrink: 1,
  },
  outcomePill: {
    backgroundColor: T.tealLo, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  outcomeText: { color: T.teal, fontSize: 10, fontWeight: "600" },
  title: { color: T.cream, fontSize: 15, fontWeight: "500", lineHeight: 22, marginBottom: 8 },
  quote: {
    color: T.creamDim, fontSize: 13, lineHeight: 20, fontStyle: "italic",
    borderLeftWidth: 2, borderLeftColor: T.amberMid, paddingLeft: 10, marginBottom: 10,
  },
  summary: { color: T.creamDim, fontSize: 13, lineHeight: 20, marginBottom: 10 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  date: { color: T.creamFaint, fontSize: 11 },
  watchedBadge: {
    color: T.teal, fontSize: 10, fontWeight: "600",
    textTransform: "uppercase", letterSpacing: 0.6,
  },
});
