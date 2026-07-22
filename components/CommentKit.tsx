// CommentKit — the single, shared comment concept used by BOTH the concern-card
// and civic-issue detail screens, ported from the web components/CommentKit.jsx
// so the two never drift. It combines the three ideas the product grew separately:
//   • sub-issues   (named subsections; "Main discussion" + each sub-issue)
//   • stance lanes (Support / Oppose / Neutral, shown within a subsection)
//   • a plain comment composer with manual stance chips — the AI-assisted
//     "say it in your own words" flow lives on the host screen's dedicated
//     Weigh In card, not here, so the two don't say the same thing twice.
//
// Each host screen owns its data (different tables) and passes adapter callbacks.
// CommentKit owns the look + the flow. The web grid collapses to a vertical
// stack of cards on mobile, which is the native rendering here.
import { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet,
} from "react-native";
import { T } from "../lib/theme";
import ReportButton from "./ReportButton";

export type Stance = "support" | "oppose" | "neutral";

export type KitComment = {
  id: string;
  body: string;
  name?: string | null;
  created_at?: string | null;
  stance?: string | null;
  sub_issue_id?: string | null;
  tag?: string | null;
  // Set by each host screen's adapter so the comment can be reported. A comment
  // may be an issue_reply, a card_event, or a mapped-in post.
  reportType?: "issue_reply" | "card_event" | "post" | null;
  reportId?: string | null;
  authorId?: string | null;
};

export type SubIssue = { id: string; title: string };

const STANCES: { key: Stance; label: string; short?: string; color: string; bg: string; none: string }[] = [
  { key: "support", label: "Support", color: T.tealHi, bg: T.tealLo, none: "No one has spoken in support yet." },
  { key: "oppose", label: "Oppose", color: T.redHi, bg: T.redLo, none: "No one has objected yet." },
  { key: "neutral", label: "Questions & neutral", short: "Neutral", color: T.blueHi, bg: T.blueLo, none: "No questions yet." },
];
const STANCE_KEYS = STANCES.map((s) => s.key);

export function normalizeStance(s?: string | null): Stance {
  const v = String(s || "").toLowerCase().trim();
  if (v === "unsure" || v === "") return "neutral";
  return (STANCE_KEYS as string[]).includes(v) ? (v as Stance) : "neutral";
}

export function groupByStance(comments: KitComment[]): Record<Stance, KitComment[]> {
  const g: Record<Stance, KitComment[]> = { support: [], oppose: [], neutral: [] };
  (comments || []).forEach((c) => {
    g[normalizeStance(c.stance)].push(c);
  });
  return g;
}

// One comment, rendered uniformly.
function Post({ c, timeAgo, currentUser }: { c: KitComment; timeAgo?: (d?: string | null) => string; currentUser?: any }) {
  const canReport = c.reportType && c.reportId && currentUser && c.authorId !== currentUser.id;
  return (
    <View style={s.post}>
      <Text style={s.postBody}>{c.body}</Text>
      <View style={s.postMeta}>
        <Text style={s.postMetaText}>{c.name || "Resident"}</Text>
        {c.created_at ? <Text style={s.postMetaText}> · {timeAgo ? timeAgo(c.created_at) : ""}</Text> : null}
        {c.tag ? <Text style={[s.postMetaText, { color: T.amberHi }]}> · {c.tag}</Text> : null}
        {canReport ? (
          <View style={{ marginLeft: "auto" }}>
            <ReportButton contentType={c.reportType as any} contentId={c.reportId as string} currentUserId={currentUser.id} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

// The Support / Oppose / Neutral lanes for one subsection's comments.
function StanceLanes({ comments, subIssues, timeAgo, currentUser }: { comments: KitComment[]; subIssues?: { id: string; title: string }[]; timeAgo?: (d?: string | null) => string; currentUser?: any }) {
  const g = groupByStance(comments);
  // The web renders the three stances as side-by-side columns; three columns
  // don't fit a phone, so here the "columns" are segmented chips with counts
  // (the three-way balance stays visible at a glance) and one lane shows at a
  // time — defaulting to where the conversation actually is.
  const busiest = STANCE_KEYS.reduce((a, b) => (g[b].length > g[a].length ? b : a), STANCE_KEYS[0]);
  const [lane, setLane] = useState<Stance>(busiest);
  if (!comments.length) {
    return <Text style={s.none}>No comments yet — be the first neighbor to weigh in.</Text>;
  }
  const active = STANCES.find((st) => st.key === lane) || STANCES[0];
  // Inside the selected position: direct comments first, then a nested
  // sub-section per sub-issue that holds comments at this stance — the
  // positions are the top-level sections, sub-issues live inside them.
  const subs = subIssues || [];
  const items = g[lane];
  const direct = items.filter((c) => !c.sub_issue_id || !subs.some((x) => x.id === c.sub_issue_id));
  const subGroups = subs
    .map((sub) => ({ sub, items: items.filter((c) => c.sub_issue_id === sub.id) }))
    .filter((x) => x.items.length > 0);
  return (
    <>
      <View style={s.laneChips}>
        {STANCES.map((st) => (
          <Pressable key={st.key} onPress={() => setLane(st.key)}
            style={[s.laneChip, lane === st.key && { backgroundColor: st.bg, borderColor: st.color }]}>
            <View style={[s.dot, { backgroundColor: st.color }]} />
            <Text style={[s.laneChipText, lane === st.key && { color: st.color, fontWeight: "600" }]}>
              {st.short || st.label} · {g[st.key].length}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={s.lane}>
        {items.length === 0 ? <Text style={s.none}>{active.none}</Text> : null}
        {direct.map((c) => <Post key={c.id} c={c} timeAgo={timeAgo} currentUser={currentUser} />)}
        {subGroups.map((g2) => (
          <View key={g2.sub.id} style={s.subsec}>
            <Text style={s.subsecTitle}>↳ {g2.sub.title}</Text>
            {g2.items.map((c) => <Post key={c.id} c={c} timeAgo={timeAgo} currentUser={currentUser} />)}
          </View>
        ))}
      </View>
    </>
  );
}

// Plain composer: free text + a manual stance pick → post.
function StanceComposer({
  currentUser, onPost, placeholder,
}: {
  currentUser: any;
  onPost: (args: { body: string; stance: Stance }) => Promise<void>;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [stance, setStance] = useState<Stance>("neutral");
  const [posting, setPosting] = useState(false);

  if (!currentUser) return null;

  async function submit() {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      await onPost({ body, stance });
      setText("");
      setStance("neutral");
    } finally {
      setPosting(false);
    }
  }

  return (
    <View style={s.compose}>
      <TextInput
        style={s.input}
        placeholder={placeholder || "Add a comment…"}
        placeholderTextColor={T.creamFaint}
        value={text}
        onChangeText={(v) => setText(v.slice(0, 1500))}
        multiline
      />
      <View style={s.tools}>
        {STANCES.map((st) => {
          const on = stance === st.key;
          return (
            <Pressable
              key={st.key}
              onPress={() => setStance(st.key)}
              style={[s.chip, { borderColor: on ? st.color : T.border, backgroundColor: on ? st.bg : "transparent" }]}
            >
              <Text style={[s.chipText, { color: on ? st.color : T.creamDim }]}>{st.short || st.label}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={submit} disabled={!text.trim() || posting} style={[s.postBtn, (!text.trim() || posting) && s.disabled]}>
          <Text style={s.postBtnText}>{posting ? "Posting…" : "Post"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// The whole board: Main discussion + a card per sub-issue + a "propose" card.
export default function CommentKit({
  currentUser,
  comments, subIssues, timeAgo, onPost, onCreateSubIssue,
}: {
  currentUser: any;
  comments: KitComment[];
  subIssues: SubIssue[];
  timeAgo?: (d?: string | null) => string;
  onPost: (args: { body: string; stance: Stance; subId: string | null }) => Promise<void>;
  onCreateSubIssue: (title: string) => Promise<void>;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<string | null>(null);   // null = the main flow

  async function createSub() {
    const t = newTitle.trim();
    if (t.length < 3 || creating) return;
    setCreating(true);
    try {
      await onCreateSubIssue(t);
      setNewTitle("");
      setShowAdd(false);
    } finally {
      setCreating(false);
    }
  }

  const composer = (subId: string | null) => (
    <StanceComposer
      currentUser={currentUser}
      onPost={({ body, stance }) => onPost({ body, stance, subId })}
    />
  );

  // Nothing posted anywhere yet → no board, no counts, no sub-issue plumbing.
  // Just the composer; the full organization appears with the first comment.
  const isEmpty = !(comments || []).length && !(subIssues || []).length;
  if (isEmpty) {
    return (
      <View style={s.grid}>
        <View style={s.card}>
          {composer(null)}
        </View>
      </View>
    );
  }

  return (
    <View style={s.grid}>
      <View style={s.card}>
        <Text style={s.cardTitle}>Discussion · {(comments || []).length}</Text>
        <StanceLanes comments={comments || []} subIssues={subIssues || []} timeAgo={timeAgo} currentUser={currentUser} />

        {/* Where the next comment lands — the main flow or a named sub-issue */}
        {currentUser && (subIssues || []).length > 0 ? (
          <View style={s.targetRow}>
            <Text style={s.targetHint}>POST TO</Text>
            <Pressable onPress={() => setTarget(null)}
              style={[s.targetChip, target === null && s.targetChipActive]}>
              <Text style={[s.targetChipText, target === null && s.targetChipTextActive]}>Main</Text>
            </Pressable>
            {(subIssues || []).map((sub) => (
              <Pressable key={sub.id} onPress={() => setTarget(sub.id)}
                style={[s.targetChip, target === sub.id && s.targetChipActive]}>
                <Text style={[s.targetChipText, target === sub.id && s.targetChipTextActive]}>{sub.title}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {showAdd ? (
          <>
            <TextInput
              style={[s.input, { marginTop: 10 }]}
              autoFocus
              placeholder="Name a sub-issue (e.g. Rt 9 crossing safety)…"
              placeholderTextColor={T.creamFaint}
              value={newTitle}
              maxLength={120}
              onChangeText={setNewTitle}
              multiline
            />
            <View style={s.addRow}>
              <Pressable onPress={() => { setShowAdd(false); setNewTitle(""); }} style={s.cancelBtn}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={createSub} disabled={creating || newTitle.trim().length < 3} style={[s.postBtn, (creating || newTitle.trim().length < 3) && s.disabled]}>
                <Text style={s.postBtnText}>{creating ? "Adding…" : "Add"}</Text>
              </Pressable>
            </View>
          </>
        ) : currentUser ? (
          <Pressable onPress={() => setShowAdd(true)}>
            <Text style={[s.proposeText, { paddingTop: 10, textAlign: "left", fontSize: 12 }]}>+ Propose a sub-issue</Text>
          </Pressable>
        ) : null}

        {composer(target)}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  grid: { gap: 14, paddingVertical: 8 },
  laneChips: { flexDirection: "row", gap: 6, marginBottom: 8 },
  laneChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, borderWidth: 1, borderColor: T.border },
  laneChipText: { fontSize: 11, color: T.creamDim },
  subsec: { marginTop: 12, paddingTop: 8, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: T.border },
  subsecTitle: { fontSize: 11, color: T.creamDim, marginBottom: 6 },
  targetRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 12 },
  targetHint: { fontSize: 10, fontWeight: "600", color: T.creamFaint, letterSpacing: 0.8 },
  targetChip: { borderWidth: 1, borderColor: T.border, borderRadius: 16, paddingHorizontal: 11, paddingVertical: 4 },
  targetChipActive: { borderColor: T.amber, backgroundColor: T.amberLo },
  targetChipText: { fontSize: 11, color: T.creamDim },
  targetChipTextActive: { color: T.amberHi, fontWeight: "600" },
  card: { borderWidth: 1, borderColor: T.border, borderRadius: 12, backgroundColor: T.bg, padding: 14 },
  cardAdd: { borderStyle: "dashed", justifyContent: "center" },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 8 },
  cardTitle: { fontSize: 12, fontWeight: "600", color: T.cream, marginBottom: 8 },
  tag: {
    fontSize: 9, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8,
    color: T.amberHi, backgroundColor: T.amberLo, borderWidth: 1, borderColor: T.amberMid,
    borderRadius: 99, paddingHorizontal: 7, paddingVertical: 1, overflow: "hidden",
  },
  lane: { paddingVertical: 6 },
  laneLabel: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  laneLabelText: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  none: { fontSize: 12, color: T.creamFaint, fontStyle: "italic", paddingVertical: 2 },
  post: { paddingVertical: 7, borderTopWidth: 1, borderTopColor: T.border },
  postBody: { fontSize: 13, color: T.creamDim, lineHeight: 21 },
  postMeta: { flexDirection: "row", flexWrap: "wrap", marginTop: 3 },
  postMetaText: { fontSize: 11, color: T.creamFaint },
  compose: { marginTop: 10 },
  input: {
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 9,
    paddingHorizontal: 11, paddingVertical: 9, fontSize: 13, color: T.cream, minHeight: 40,
    textAlignVertical: "top",
  },
  tools: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1 },
  chipText: { fontSize: 11.5, fontWeight: "500" },
  postBtn: { marginLeft: "auto", paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8, backgroundColor: T.amber },
  postBtnText: { color: T.bg, fontSize: 12.5, fontWeight: "600" },
  disabled: { opacity: 0.4 },
  addRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
  cancelBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: T.border },
  cancelBtnText: { color: T.creamDim, fontSize: 12 },
  proposeText: { color: T.amberHi, fontSize: 13, paddingVertical: 14, textAlign: "center" },
});
