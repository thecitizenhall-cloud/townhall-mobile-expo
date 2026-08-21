import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Linking, ActivityIndicator } from "react-native";
import { T } from "../lib/theme";
import { goVerify } from "../lib/residency";
import {
  CONDITIONS, conditionSentence, receiptFor, resolutionSentence, returnPromise,
  askQuestion, getCardQuestions, withdrawQuestion,
  type StandingQuestion, type ConditionKind, type Condition,
} from "../lib/standingQuestions";

// The ask surface, and the questions already standing on a matter.
//
// This is the round trip's expression leg. Following a matter says "tell me when
// it moves"; asking says "tell me when THIS is settled." The second field is the
// whole point — a question that doesn't state what would answer it can't come
// back, which is why every comment thread ever built stays open forever.
//
// Nothing here decides a receipt. Resolution belongs to the ingest-side worker,
// which cites the appearance that settled it; this surface only asks, lists, and
// reports what the record has said so far.
//
// Ported from the web components/StandingQuestions.jsx. The one deliberate
// difference: web shows an inline "sign in and verify" hint because that screen
// has no modal gate, while mobile already routes residency through goVerify(),
// so the unverified state is a button that starts verification rather than a
// sentence telling the resident to go find it.

type Props = {
  card: { id: string; municipality_id: string; next_action_date?: string | null };
  user?: { id: string } | null;
  verified?: boolean;
};

function fmt(d?: string | null): string {
  if (!d) return "";
  try {
    return new Date(String(d).length === 10 ? `${d}T12:00:00` : d)
      .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return ""; }
}

const TONE = {
  neutral: { color: T.creamDim, bg: "transparent", border: T.border },
  teal:    { color: T.tealHi,   bg: T.tealLo,     border: "#17402F" },
  amber:   { color: T.amberHi,  bg: T.amberLo,    border: "#4A3410" },
} as const;

export default function StandingQuestions({ card, user, verified }: Props) {
  const [questions, setQuestions] = useState<StandingQuestion[]>([]);
  const [loading, setLoading]     = useState(true);
  const [open, setOpen]           = useState(false);
  const [body, setBody]           = useState("");
  const [kind, setKind]           = useState<ConditionKind>("outcome");
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState("");

  const load = useCallback(async () => {
    if (!card?.id) return;
    const { questions: qs } = await getCardQuestions(card.id);
    setQuestions(qs);
    setLoading(false);
  }, [card?.id]);

  useEffect(() => { load(); }, [load]);

  const chosen: Condition | undefined = CONDITIONS.find((c) => c.kind === kind);

  async function submit() {
    setBusy(true);
    setError("");
    const res = await askQuestion({ userId: user?.id, card, body, conditionKind: kind });
    setBusy(false);
    if (!res.ok) { setError(res.error || "Could not put that on the record."); return; }
    setBody("");
    setOpen(false);
    load();
  }

  async function drop(id: string) {
    const res = await withdrawQuestion(id);
    if (res.ok) load();
  }

  return (
    <View style={s.window}>
      <View style={s.windowHead}><Text style={s.windowHeadText}>❓ Standing questions</Text></View>

      {loading ? (
        <ActivityIndicator color={T.amber} style={{ marginVertical: 14 }} />
      ) : questions.length === 0 && !open ? (
        <Text style={s.lede}>
          No one has asked anything about this matter yet. A question here isn’t a comment — you say
          what would answer it, and Townhall brings it back when the record does.
        </Text>
      ) : null}

      {questions.map((q) => {
        const receipt = receiptFor(q);
        const tone = TONE[receipt.tone] || TONE.neutral;
        const line = q.status === "standing" ? conditionSentence(q.condition_kind) : resolutionSentence(q);
        return (
          <View key={q.id} style={s.item}>
            <Text style={s.itemBody}>{q.body}</Text>
            <View style={s.metaRow}>
              <View style={[s.badge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                <Text style={[s.badgeText, { color: tone.color }]}>{receipt.label}</Text>
              </View>
              <Text style={s.metaDate}>
                {q.resolved_at ? fmt(q.resolved_at) : `asked ${fmt(q.created_at)}`}
              </Text>
            </View>
            {line ? <Text style={s.cond}>{line}</Text> : null}
            {receipt.waiting ? <Text style={s.waiting}>{receipt.waiting}</Text> : null}

            {/* The answer itself, where the record contains one. A receipt that
                only names a status makes the resident go find it themselves. */}
            {q.evidence?.source_quote ? (
              <Text style={s.quote}>{q.evidence.source_quote}</Text>
            ) : null}
            {q.evidence?.source_url ? (
              <Pressable onPress={() => Linking.openURL(q.evidence!.source_url!)} hitSlop={6}>
                <Text style={s.evidence}>Read the document that settled it ↗</Text>
              </Pressable>
            ) : null}

            {user?.id === q.asked_by && q.status === "standing" ? (
              <Pressable onPress={() => drop(q.id)} hitSlop={6}>
                <Text style={s.withdraw}>Withdraw this question</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {!user || !verified ? (
        <Pressable style={s.openBtn} onPress={() => goVerify()}>
          <Text style={s.openBtnText}>Verify residency to ask a question</Text>
        </Pressable>
      ) : !open ? (
        <Pressable style={s.openBtn} onPress={() => { setOpen(true); setError(""); }}>
          <Text style={s.openBtnText}>+ Ask a question about this matter</Text>
        </Pressable>
      ) : (
        <View style={s.form}>
          <Text style={s.label}>Your question</Text>
          <Text style={s.hint}>
            Ask the board something the record hasn’t settled. It goes on the public record under your
            verified address.
          </Text>
          <TextInput
            style={s.input}
            value={body}
            onChangeText={setBody}
            maxLength={2000}
            multiline
            placeholder="e.g. Will the applicant be required to complete a traffic study before approval?"
            placeholderTextColor={T.creamFaint}
          />

          <Text style={[s.label, { marginTop: 14 }]}>What would answer it</Text>
          {CONDITIONS.map((c) => (
            <Pressable
              key={c.kind}
              disabled={c.unavailable}
              onPress={() => setKind(c.kind)}
              style={[
                s.choice,
                kind === c.kind && !c.unavailable ? s.choiceOn : null,
                c.unavailable ? s.choiceOff : null,
              ]}>
              <Text style={s.choiceText}>{c.label}</Text>
              <Text style={s.choiceHint}>{c.hint}</Text>
            </Pressable>
          ))}

          {/* Stated before the question is asked, always — not only when the card
              happens to carry a next step. That is the Phase C gate: the system
              states, without a human in the loop, the condition under which the
              question returns. */}
          {chosen && !chosen.unavailable ? (
            <Text style={s.promise}>
              {returnPromise(kind, card?.next_action_date ? fmt(card.next_action_date) : null)}
            </Text>
          ) : null}

          {error ? <Text style={s.error}>{error}</Text> : null}

          <View style={s.actions}>
            <Pressable
              style={[s.submit, (busy || body.trim().length < 3) ? s.submitOff : null]}
              disabled={busy || body.trim().length < 3}
              onPress={submit}>
              <Text style={s.submitText}>{busy ? "Putting it on the record…" : "Ask this question"}</Text>
            </Pressable>
            <Pressable style={s.cancel} onPress={() => { setOpen(false); setError(""); }}>
              <Text style={s.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  window: { borderWidth: 1, borderColor: T.border, borderRadius: 14, backgroundColor: T.surface, padding: 14, marginTop: 14 },
  windowHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  windowHeadText: { flex: 1, fontSize: 11, fontWeight: "600", color: T.cream, textTransform: "uppercase", letterSpacing: 0.8 },
  lede: { fontSize: 13, lineHeight: 20, color: T.creamDim, marginBottom: 12 },

  item: { borderWidth: 1, borderColor: T.border, borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: T.bg },
  itemBody: { fontSize: 14, lineHeight: 21, color: T.cream, marginBottom: 8 },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  metaDate: { fontSize: 12, color: T.creamDim },
  cond: { fontSize: 12, lineHeight: 18, color: T.creamDim, marginTop: 6 },
  waiting: { fontSize: 12, color: T.amberHi, marginTop: 6 },
  quote: { marginTop: 8, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: T.blueHi, fontSize: 13, lineHeight: 20, color: T.cream },
  evidence: { marginTop: 8, fontSize: 12, fontWeight: "600", color: T.blueHi, minHeight: 32, lineHeight: 32 },
  withdraw: { marginTop: 4, fontSize: 12, color: T.creamDim, textDecorationLine: "underline", minHeight: 32, lineHeight: 32 },

  openBtn: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: T.borderHi, borderStyle: "dashed", alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  openBtnText: { color: T.amberHi, fontSize: 14, fontWeight: "600" },

  form: { borderWidth: 1, borderColor: T.border, borderRadius: 10, padding: 14, backgroundColor: T.bg },
  label: { fontSize: 12, fontWeight: "600", color: T.cream, marginBottom: 6 },
  hint: { fontSize: 12, lineHeight: 18, color: T.creamDim, marginBottom: 10 },
  input: { minHeight: 84, borderRadius: 8, borderWidth: 1, borderColor: T.border, backgroundColor: "#141310", color: T.cream, fontSize: 14, lineHeight: 21, padding: 10, textAlignVertical: "top" },

  choice: { borderWidth: 1, borderColor: T.border, borderRadius: 8, padding: 10, marginTop: 8 },
  choiceOn: { borderColor: T.amber, backgroundColor: T.amberLo },
  choiceOff: { opacity: 0.45 },
  choiceText: { fontSize: 13, color: T.cream },
  choiceHint: { fontSize: 11.5, lineHeight: 16, color: T.creamDim, marginTop: 3 },

  promise: { marginTop: 12, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, fontSize: 12.5, lineHeight: 19, color: T.cream },
  error: { marginTop: 10, fontSize: 12, color: "#E57373" },

  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  submit: { minHeight: 44, paddingHorizontal: 18, borderRadius: 8, backgroundColor: T.amber, alignItems: "center", justifyContent: "center" },
  submitOff: { opacity: 0.5 },
  submitText: { color: "#12100B", fontSize: 14, fontWeight: "700" },
  cancel: { minHeight: 44, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center" },
  cancelText: { color: T.creamDim, fontSize: 14 },
});
