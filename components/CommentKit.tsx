// CommentKit — the single, shared comment concept used by BOTH the concern-card
// and civic-issue detail screens, ported from the web components/CommentKit.jsx
// so the two never drift. It combines the three ideas the product grew separately:
//   • sub-issues   (named subsections; "Main discussion" + each sub-issue)
//   • stance lanes (Support / Oppose / Neutral, shown within a subsection)
//   • "say it in your own words" (one composer; the AI sorts your stance, you can
//                                 override; falls back to manual chips if AI is off)
//
// Each host screen owns its data (different tables) and passes adapter callbacks.
// CommentKit owns the look + the flow. The web grid collapses to a vertical
// stack of cards on mobile, which is the native rendering here.
import { useState } from "react";
import {
  View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet,
} from "react-native";
import { T } from "../lib/theme";
import { SITE_URL } from "../lib/config";
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
function StanceLanes({ comments, timeAgo, currentUser }: { comments: KitComment[]; timeAgo?: (d?: string | null) => string; currentUser?: any }) {
  const g = groupByStance(comments);
  return (
    <>
      {STANCES.map((st) => (
        <View key={st.key} style={s.lane}>
          <View style={s.laneLabel}>
            <View style={[s.dot, { backgroundColor: st.color }]} />
            <Text style={[s.laneLabelText, { color: st.color }]}>
              {st.short || st.label} · {g[st.key].length}
            </Text>
          </View>
          {g[st.key].length === 0 ? (
            <Text style={s.none}>{st.none}</Text>
          ) : (
            g[st.key].map((c) => <Post key={c.id} c={c} timeAgo={timeAgo} currentUser={currentUser} />)
          )}
        </View>
      ))}
    </>
  );
}

// "Say it in your own words" → AI sorts the stance (overridable) → post.
function StanceComposer({
  currentUser, subjectTitle, subjectSummary, getToken, onPost, placeholder,
}: {
  currentUser: any;
  subjectTitle?: string;
  subjectSummary?: string;
  getToken?: () => Promise<string | null | undefined>;
  onPost: (args: { body: string; stance: Stance }) => Promise<void>;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [stance, setStance] = useState<Stance>("neutral");
  const [stake, setStake] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // AI sorting
  const [posting, setPosting] = useState(false);
  const [touched, setTouched] = useState(false); // user picked a chip manually

  if (!currentUser) return null;

  async function aiSort() {
    const body = text.trim();
    if (body.length < 2) return;
    setBusy(true);
    try {
      const token = getToken ? await getToken() : null;
      const r = await fetch(`${SITE_URL}/api/issue/interpret`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ issueTitle: subjectTitle, issueSummary: subjectSummary, text: body }),
      });
      if (r.ok) {
        const d = await r.json();
        setStance(normalizeStance(d.stance));
        setStake(d.stake || null);
        setTouched(true);
      }
    } catch {
      /* leave manual */
    }
    setBusy(false);
  }

  async function submit() {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      await onPost({ body, stance });
      setText("");
      setStance("neutral");
      setStake(null);
      setTouched(false);
    } finally {
      setPosting(false);
    }
  }

  return (
    <View style={s.compose}>
      <TextInput
        style={s.input}
        placeholder={placeholder || "Say it in your own words…"}
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
              onPress={() => { setStance(st.key); setTouched(true); }}
              style={[s.chip, { borderColor: on ? st.color : T.border, backgroundColor: on ? st.bg : "transparent" }]}
            >
              <Text style={[s.chipText, { color: on ? st.color : T.creamDim }]}>{st.short || st.label}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={aiSort} disabled={busy || text.trim().length < 2} style={s.aiBtn}>
          <Text style={s.aiBtnText}>{busy ? "…" : "✨ Let AI sort"}</Text>
        </Pressable>
        <Pressable onPress={submit} disabled={!text.trim() || posting} style={[s.postBtn, (!text.trim() || posting) && s.disabled]}>
          <Text style={s.postBtnText}>{posting ? "Posting…" : "Post"}</Text>
        </Pressable>
      </View>
      {stake ? <Text style={s.stake}>▸ What's at stake: {stake}</Text> : null}
      {!touched ? (
        <Text style={s.hint}>Write naturally — tap "Let AI sort" to place your stance, or pick one yourself.</Text>
      ) : null}
    </View>
  );
}

// The whole board: Main discussion + a card per sub-issue + a "propose" card.
export default function CommentKit({
  currentUser, subjectTitle, subjectSummary, getToken,
  comments, subIssues, timeAgo, onPost, onCreateSubIssue,
}: {
  currentUser: any;
  subjectTitle?: string;
  subjectSummary?: string;
  getToken?: () => Promise<string | null | undefined>;
  comments: KitComment[];
  subIssues: SubIssue[];
  timeAgo?: (d?: string | null) => string;
  onPost: (args: { body: string; stance: Stance; subId: string | null }) => Promise<void>;
  onCreateSubIssue: (title: string) => Promise<void>;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const bySub: Record<string, KitComment[]> = { main: [] };
  (subIssues || []).forEach((sub) => { bySub[sub.id] = []; });
  (comments || []).forEach((c) => {
    (c.sub_issue_id && bySub[c.sub_issue_id] ? bySub[c.sub_issue_id] : bySub.main).push(c);
  });

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
      subjectTitle={subjectTitle}
      subjectSummary={subjectSummary}
      getToken={getToken}
      onPost={({ body, stance }) => onPost({ body, stance, subId })}
    />
  );

  return (
    <View style={s.grid}>
      {/* Main discussion */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Main discussion · {bySub.main.length}</Text>
        <StanceLanes comments={bySub.main} timeAgo={timeAgo} currentUser={currentUser} />
        {composer(null)}
      </View>

      {/* One card per sub-issue */}
      {(subIssues || []).map((sub) => (
        <View key={sub.id} style={s.card}>
          <View style={s.cardTitleRow}>
            <Text style={s.tag}>SUB-ISSUE</Text>
            <Text style={s.cardTitle}>{sub.title} · {bySub[sub.id].length}</Text>
          </View>
          <StanceLanes comments={bySub[sub.id]} timeAgo={timeAgo} currentUser={currentUser} />
          {composer(sub.id)}
        </View>
      ))}

      {/* Propose a sub-issue */}
      {currentUser ? (
        <View style={[s.card, s.cardAdd]}>
          {showAdd ? (
            <>
              <TextInput
                style={s.input}
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
          ) : (
            <Pressable onPress={() => setShowAdd(true)}>
              <Text style={s.proposeText}>+ Propose a sub-issue</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { gap: 14, paddingVertical: 8 },
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
  aiBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1, borderColor: T.border },
  aiBtnText: { color: T.amberHi, fontSize: 11.5 },
  postBtn: { marginLeft: "auto", paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8, backgroundColor: T.amber },
  postBtnText: { color: T.bg, fontSize: 12.5, fontWeight: "600" },
  disabled: { opacity: 0.4 },
  hint: { fontSize: 11, color: T.creamFaint, marginTop: 6 },
  stake: { fontSize: 11.5, color: T.amberHi, marginTop: 6 },
  addRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
  cancelBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: T.border },
  cancelBtnText: { color: T.creamDim, fontSize: 12 },
  proposeText: { color: T.amberHi, fontSize: 13, paddingVertical: 14, textAlign: "center" },
});
