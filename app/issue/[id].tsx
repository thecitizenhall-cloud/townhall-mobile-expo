import { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  ActivityIndicator, Modal,
  KeyboardAvoidingView,
} from "react-native";
import { useLocalSearchParams, router, Stack } from "expo-router";
import { supabase } from "../../lib/supabase";
import { getCurrentUser } from "../../lib/sessionUser";
import { getResidencyProof, validateProof } from "../../lib/residency";
import { T } from "../../lib/theme";
import { SITE_URL } from "../../lib/config";
import { timeAgo, daysSince, dayLabel, initials, simpleHash, nextCouncilMeeting } from "../../lib/format";
import CommentKit, { KitComment, Stance, normalizeStance } from "../../components/CommentKit";
import IssueTimeline from "../../components/IssueTimeline";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  open: { bg: T.blueLo, color: T.blueHi, label: "Open" },
  escalated: { bg: T.amberLo, color: T.amberHi, label: "Escalated" },
  expert: { bg: T.purpleLo, color: T.purpleHi, label: "Expert review" },
  city_wide: { bg: T.tealLo, color: T.tealHi, label: "City-wide" },
  resolved: { bg: "#1A2A1A", color: T.tealHi, label: "Resolved" },
};

const getToken = async () => (await supabase.auth.getSession()).data.session?.access_token ?? null;

export default function IssueDetail() {
  const { id: issueId } = useLocalSearchParams<{ id: string }>();

  const [issue, setIssue] = useState<any>(null);
  const [watcherCount, setWatcherCount] = useState(0);
  const [replies, setReplies] = useState<any[]>([]);
  const [expertAnswers, setExpertAnswers] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reaction, setReaction] = useState<"yes" | "no" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [showDisagree, setShowDisagree] = useState(false);
  const [showAgree, setShowAgree] = useState(false);
  const [agreeInput, setAgreeInput] = useState("");
  const [agreePosting, setAgreePosting] = useState(false);
  const [recognition, setRecognition] = useState("");
  const [submittingD, setSubmittingD] = useState(false);
  const [disagreements, setDisagreements] = useState<any[]>([]);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [stakes, setStakes] = useState<any[]>([]);
  const [myStake, setMyStake] = useState<any>(null);
  const [stakeInput, setStakeInput] = useState("");

  const [subIssues, setSubIssues] = useState<any[]>([]);
  const [relatedIssues, setRelatedIssues] = useState<any[]>([]);
  const [showStakeInput, setShowStakeInput] = useState(false);
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [stakingOp, setStakingOp] = useState(false);

  // "Say it in your own words" — one free answer → AI structures → resident confirms
  const [showOwnWords, setShowOwnWords] = useState(false);
  const [ownWordsText, setOwnWordsText] = useState("");
  const [interpreting, setInterpreting] = useState(false);
  const [interpretation, setInterpretation] = useState<any>(null);
  const [confirmStance, setConfirmStance] = useState("unsure");
  const [confirmStake, setConfirmStake] = useState("");
  const [confirmRecognition, setConfirmRecognition] = useState("");
  const [committing, setCommitting] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);

  const [distilled, setDistilled] = useState<{ for?: string | null; against?: string | null } | null>(null);

  const [showExpertFlag, setShowExpertFlag] = useState(false);
  const [expertReason, setExpertReason] = useState("");
  const [flaggingExpert, setFlaggingExpert] = useState(false);
  const [expertFlagged, setExpertFlagged] = useState(false);

  const channelRef = useRef<any>(null);
  const toastTimer = useRef<any>(null);

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  useEffect(() => {
    if (!issueId) return;
    load();
    channelRef.current = supabase
      .channel(`issue-${issueId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "issue_replies", filter: `issue_id=eq.${issueId}` },
        async (payload: any) => {
          const { data: prof } = await supabase
            .from("profiles").select("display_name").eq("id", payload.new.author_id).maybeSingle();
          setReplies((prev) =>
            prev.some((r) => r.id === payload.new.id) ? prev : [...prev, { ...payload.new, profiles: prof }]
          );
        }
      )
      .subscribe();
    // removeChannel (not unsubscribe) so a re-mount gets a clean named channel.
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId]);

  // Distill the For/Against lines with Haiku, cached SHARED on the issue row, so
  // all viewers reuse one result. On any failure we keep the raw strongest-
  // statement fallback (computed in render), so this is never worse than no-AI.
  useEffect(() => {
    if (!issueId) return;
    const forSt = disagreements.map((d) => d.recognition_statement).filter(Boolean);
    const againstSt = agreements.map((a) => a.recognition_statement).filter(Boolean);
    if (forSt.length + againstSt.length === 0) { setDistilled(null); return; }

    const sig = simpleHash(JSON.stringify([forSt, againstSt]));
    if (issue?.synthesis && issue?.synthesis_sig === sig) { setDistilled(issue.synthesis); return; }

    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const resp = await fetch(`${SITE_URL}/api/issue/synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            issueId, sig,
            issueTitle: issue?.title,
            issueSummary: issue?.description,
            forStatements: forSt,
            againstStatements: againstSt,
          }),
        });
        if (!resp.ok || cancelled) return;
        const data = await resp.json();
        if (cancelled) return;
        const out = { for: data.for || null, against: data.against || null };
        setDistilled(out);
        setIssue((prev: any) => (prev ? { ...prev, synthesis: out, synthesis_sig: sig } : prev));
      } catch {
        /* keep raw fallback */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId, agreements, disagreements, issue?.title, issue?.synthesis_sig]);

  async function load() {
    setLoading(true);
    try {
      const user = await getCurrentUser();  // local read; no getUser network round-trip on mount
      setCurrentUser(user);

      // ── Phase 1: everything keyed on issueId (+ user), in parallel ──────
      // Only the official-response reaction and related-issues query need the
      // issue body; the rest need just issueId, so batch them.
      const [
        { data: iss },
        { data: vote },
        { count: watchers },
        { data: reps },
        { data: stakeRows },
        { data: answers },
        { data: subs, error: subErr },
        { data: disags },
        { data: agrs },
      ] = await Promise.all([
        supabase.from("civic_issues").select("*").eq("id", issueId).maybeSingle(),
        user
          ? supabase.from("votes").select("id").eq("issue_id", issueId).eq("user_id", user.id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("watched_concern_cards").select("id", { count: "exact", head: true }).eq("issue_id", issueId),
        supabase.from("issue_replies")
          .select("*, profiles(display_name)").eq("issue_id", issueId).is("removed_at", null).order("created_at", { ascending: true }),
        supabase.from("issue_stakes")
          .select("*, profiles:user_id(display_name)").eq("issue_id", issueId)
          .order("created_at", { ascending: false }).limit(20),
        supabase.from("expert_answers_public")
          .select("id, body, helpful_count, created_at, question_id, issue_id, trust_tier, expert_handle, expert_credential, expert_domains")
          .eq("issue_id", issueId).order("created_at", { ascending: true }),
        supabase.from("issue_subissues")
          .select("id, title, created_at").eq("issue_id", issueId).order("created_at", { ascending: true }),
        supabase.from("disagreements")
          .select("*, profiles(display_name)").eq("issue_id", issueId)
          .or("position.eq.disagree,position.is.null").order("created_at", { ascending: false }),
        supabase.from("disagreements")
          .select("*, profiles(display_name)").eq("issue_id", issueId)
          .eq("position", "agree").order("created_at", { ascending: false }),
      ]);

      if (!iss) { router.back(); return; }

      setIssue({ ...iss, user_has_voted: !!vote });
      if (iss.synthesis) setDistilled(iss.synthesis);
      setWatcherCount(watchers || 0);
      setReplies(reps || []);
      setStakes(stakeRows || []);
      if (user) {
        const my = (stakeRows || []).find((sr: any) => sr.user_id === user.id);
        if (my) { setMyStake(my); setStakeInput(my.body); }
      }
      setExpertAnswers(answers || []);
      if (!subErr) setSubIssues(subs || []);
      setDisagreements(disags || []);
      setAgreements(agrs || []);

      // ── Phase 2: the two reads that need the issue body, in parallel ────
      const STOP = new Set(["the","and","for","with","that","this","from","jackson","township","about","issue","there","their","would","could","should"]);
      const words = (iss.title || "").toLowerCase().split(/\W+/).filter((w: string) => w.length > 4 && !STOP.has(w));
      let relQ = supabase.from("civic_issues")
        .select("id, title, status, support_count, voice_count, created_at")
        .neq("id", issueId).order("created_at", { ascending: false }).limit(30);
      relQ = iss.neighborhood_id ? relQ.eq("neighborhood_id", iss.neighborhood_id) : relQ.is("neighborhood_id", null);

      const [{ data: rxn }, { data: relRows }] = await Promise.all([
        (user && iss.official_response)
          ? supabase.from("official_response_reactions")
              .select("addressed").eq("issue_id", issueId).eq("user_id", user.id).maybeSingle()
          : Promise.resolve({ data: null }),
        relQ,
      ]);

      if (rxn) setReaction(rxn.addressed ? "yes" : "no");
      const ranked = (relRows || [])
        .map((r: any) => ({ r, score: words.reduce((n: number, w: string) => n + ((r.title || "").toLowerCase().includes(w) ? 1 : 0), 0) }))
        .filter((x: any) => x.score > 0)
        .sort((a: any, b: any) => b.score - a.score || +new Date(b.r.created_at) - +new Date(a.r.created_at))
        .slice(0, 5).map((x: any) => x.r);
      setRelatedIssues(ranked);
    } catch (e) {
      console.error("IssueDetail load error:", e);
    } finally {
      setLoading(false);
    }
  }

  async function submitAgreement() {
    if (!currentUser || agreeInput.trim().length < 50) return;
    setAgreePosting(true);
    try {
      await supabase.from("disagreements").delete().eq("user_id", currentUser.id).eq("issue_id", issueId);
      const { error } = await supabase.from("disagreements").insert({
        user_id: currentUser.id, issue_id: issueId, recognition_statement: agreeInput.trim(), position: "agree",
      });
      if (error) { showToast("Couldn't record that — " + (error.message || "try again")); return; }
      setDisagreements((prev) => prev.filter((d) => d.user_id !== currentUser.id));
      setAgreements((prev) => prev.filter((a) => a.user_id !== currentUser.id));
      // Reload the row so it surfaces with the author profile.
      const { data: row } = await supabase.from("disagreements")
        .select("*, profiles(display_name)").eq("user_id", currentUser.id).eq("issue_id", issueId).maybeSingle();
      if (row) setAgreements((prev) => [row, ...prev]);
      setShowAgree(false);
      setAgreeInput("");
      showToast("Your perspective has been recorded");
    } catch {
      showToast("Something went wrong");
    } finally {
      setAgreePosting(false);
    }
  }

  async function submitStake() {
    if (!currentUser || stakeInput.trim().length < 10) return;
    setStakingOp(true);
    try {
      if (myStake) {
        const { data } = await supabase.from("issue_stakes")
          .update({ body: stakeInput.trim() }).eq("id", myStake.id)
          .select("*, profiles:user_id(display_name)").single();
        if (data) { setMyStake(data); setStakes((prev) => prev.map((s) => (s.id === data.id ? data : s))); }
      } else {
        const { data } = await supabase.from("issue_stakes")
          .insert({ issue_id: issueId, user_id: currentUser.id, body: stakeInput.trim() })
          .select("*, profiles:user_id(display_name)").single();
        if (data) {
          setMyStake(data);
          setStakes((prev) => [data, ...prev]);
          setIssue((prev: any) => ({ ...prev, stake_count: (prev.stake_count || 0) + 1 }));
        }
      }
    } catch (e) {
      console.error("stake error:", e);
    } finally {
      setStakingOp(false);
    }
  }

  async function interpretOwnWords() {
    if (!currentUser || ownWordsText.trim().length < 3) return;
    setInterpreting(true);
    try {
      const token = await getToken();
      const resp = await fetch(`${SITE_URL}/api/issue/interpret`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ issueTitle: issue?.title, issueSummary: issue?.description, text: ownWordsText.trim() }),
      });
      if (resp.status === 503) {
        setAiUnavailable(true);
        setShowOwnWords(false);
        showToast("Use the options below to share your view");
        return;
      }
      const data = await resp.json();
      if (!resp.ok) { showToast(data.error || "Could not interpret that"); return; }
      setInterpretation(data);
      setConfirmStance(data.stance || "unsure");
      setConfirmStake((data.stake || "").trim());
      setConfirmRecognition((data.recognition || "").trim());
    } catch (e) {
      console.error("interpret error:", e);
      showToast("Could not interpret that");
    } finally {
      setInterpreting(false);
    }
  }

  async function commitOwnWords() {
    if (!currentUser) return;
    setCommitting(true);
    try {
      let wrote = false;
      const stakeBody = confirmStake.trim();
      if (stakeBody.length >= 10) {
        if (myStake) {
          const { data } = await supabase.from("issue_stakes")
            .update({ body: stakeBody }).eq("id", myStake.id).select("*, profiles:user_id(display_name)").single();
          if (data) { setMyStake(data); setStakes((prev) => prev.map((s) => (s.id === data.id ? data : s))); }
        } else {
          const { data } = await supabase.from("issue_stakes")
            .insert({ issue_id: issueId, user_id: currentUser.id, body: stakeBody })
            .select("*, profiles:user_id(display_name)").single();
          if (data) {
            setMyStake(data);
            setStakes((prev) => [data, ...prev]);
            setIssue((prev: any) => ({ ...prev, stake_count: (prev.stake_count || 0) + 1 }));
          }
        }
        wrote = true;
      }

      const rec = confirmRecognition.trim();
      if ((confirmStance === "support" || confirmStance === "oppose") && rec.length >= 50) {
        const position = confirmStance === "support" ? "agree" : "disagree";
        await supabase.from("disagreements").delete().eq("user_id", currentUser.id).eq("issue_id", issueId);
        const { error } = await supabase.from("disagreements").insert({
          user_id: currentUser.id, issue_id: issueId, recognition_statement: rec, position,
        });
        if (!error) {
          const { data: row } = await supabase.from("disagreements")
            .select("*, profiles(display_name)").eq("user_id", currentUser.id)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          setAgreements((prev) => prev.filter((a) => a.user_id !== currentUser.id));
          setDisagreements((prev) => prev.filter((d) => d.user_id !== currentUser.id));
          if (row) {
            if (position === "agree") setAgreements((prev) => [row, ...prev]);
            else setDisagreements((prev) => [row, ...prev]);
          }
          wrote = true;
        }
      }

      const replyBody = ownWordsText.trim();
      if (replyBody.length >= 3) {
        const { data: newReply, error } = await supabase.from("issue_replies")
          .insert({ issue_id: issueId, author_id: currentUser.id, body: replyBody })
          .select("*, profiles(display_name)").single();
        if (error) {
          showToast("Couldn't post your reply — " + (error.message || "try again"));
        } else if (newReply) {
          setReplies((prev) => (prev.some((r) => r.id === newReply.id) ? prev : [...prev, newReply]));
          wrote = true;
        }
      }

      setShowOwnWords(false);
      setInterpretation(null);
      setOwnWordsText("");
      showToast(wrote ? "Shared with your neighbours ✓" : "Nothing recorded — add a bit more");
    } catch (e) {
      console.error("commitOwnWords error:", e);
      showToast("Something went wrong");
    } finally {
      setCommitting(false);
    }
  }

  async function handleVote() {
    if (!currentUser || issue?.user_has_voted) return;
    const residencyProof = await getResidencyProof(currentUser.id);
    const { data: voteProf } = await supabase
      .from("profiles").select("neighborhood_id").eq("id", currentUser.id).maybeSingle();
    const { valid, reason } = validateProof(residencyProof, voteProf?.neighborhood_id ?? null);
    if (!valid) { showToast(reason || "Verify your residency to vote"); return; }
    const token = await getToken();
    if (!token) { showToast("Session expired — please sign in again"); return; }
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/vote-gate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ issueId, proofHash: residencyProof!.proof_hash }),
    });
    const result = await resp.json();
    if (!resp.ok) {
      if (resp.status === 409) setIssue((prev: any) => ({ ...prev, user_has_voted: true }));
      else showToast(result.error || "Vote failed");
      return;
    }
    setIssue((prev: any) => ({
      ...prev,
      user_has_voted: true,
      voice_count: result.voiceCount ?? (prev.voice_count || 0) + 1,
      priority_pct: result.priorityPct ?? prev.priority_pct,
    }));
    showToast("Vote recorded ✓ · private to you");
  }

  async function handleReply() {
    if (!replyText.trim() || !currentUser) return;
    setSubmitting(true);
    const body = replyText.trim();
    setReplyText("");
    const { error } = await supabase.from("issue_replies").insert({ issue_id: issueId, author_id: currentUser.id, body });
    if (error) { showToast("Failed to post reply"); setReplyText(body); }
    setSubmitting(false);
  }

  // CommentKit adapters.
  async function createIssueSubIssue(title: string) {
    if (!currentUser) return;
    const { data, error } = await supabase.from("issue_subissues")
      .insert({ issue_id: issueId, title, created_by: currentUser.id }).select("id, title, created_at").single();
    if (error) { showToast(/exist|relation/i.test(error.message || "") ? "Sub-issues aren't enabled yet." : "Couldn't add sub-issue"); return; }
    if (data) setSubIssues((prev) => [...prev, data]);
  }

  async function postIssueComment({ body, stance, subId }: { body: string; stance: Stance; subId: string | null }) {
    if (!body.trim() || !currentUser) return;
    const { data, error } = await supabase.from("issue_replies")
      .insert({ issue_id: issueId, author_id: currentUser.id, body: body.trim(), stance, sub_issue_id: subId || null })
      .select("*, profiles(display_name)").single();
    if (error) { showToast("Failed to post"); return; }
    if (data) setReplies((prev) => (prev.some((r) => r.id === data.id) ? prev : [...prev, data]));
  }

  async function submitDisagreement() {
    if (!recognition.trim() || !currentUser) return;
    setSubmittingD(true);
    try {
      await supabase.from("disagreements").delete().eq("user_id", currentUser.id).eq("issue_id", issueId);
      const { error } = await supabase.from("disagreements").insert({
        user_id: currentUser.id, issue_id: issueId, recognition_statement: recognition.trim(), position: "disagree",
      });
      if (!error) {
        const { data: newDisag } = await supabase.from("disagreements")
          .select("*, profiles(display_name)").eq("user_id", currentUser.id).eq("issue_id", issueId).maybeSingle();
        setAgreements((prev) => prev.filter((a) => a.user_id !== currentUser.id));
        setDisagreements((prev) => prev.filter((d) => d.user_id !== currentUser.id));
        if (newDisag) setDisagreements((prev) => [newDisag, ...prev]);
        setShowDisagree(false);
        setRecognition("");
        showToast("Your perspective has been recorded");
      } else {
        showToast("Couldn't record that — " + (error.message || "try again"));
      }
    } catch {
      showToast("Failed to submit");
    } finally {
      setSubmittingD(false);
    }
  }

  async function handleReaction(val: "yes" | "no") {
    if (!currentUser || !issue?.official_response) return;
    const addressed = val === "yes";
    await supabase.from("official_response_reactions")
      .upsert({ issue_id: issueId, user_id: currentUser.id, addressed }, { onConflict: "issue_id,user_id" });
    setReaction(val);
    showToast(addressed ? "Thanks for the feedback" : "Noted — we'll track this");
  }

  async function flagForExpert() {
    if (!currentUser || expertReason.trim().length < 10) return;
    setFlaggingExpert(true);
    const { error } = await supabase.from("expert_questions").insert({
      author_id: currentUser.id, issue_id: issueId, neighborhood_id: issue?.neighborhood_id,
      question: expertReason.trim(), domain: "general",
    });
    setFlaggingExpert(false);
    if (!error) { setExpertReason(""); setShowExpertFlag(false); setExpertFlagged(true); showToast("Flagged for expert input"); }
    else showToast("Couldn't flag — " + (error.message || "try again"));
  }

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <Stack.Screen options={{ title: "Issue" }} />
        <ActivityIndicator color={T.amber} />
      </View>
    );
  }
  if (!issue) return null;

  const statusStyle = STATUS_COLORS[issue.status] || STATUS_COLORS.open;
  const description = issue.description ?? issue.body;

  // Shared CommentKit shape: replies (carry stance + sub-issue) + standalone stakes.
  const repliedUserIds = new Set(replies.map((r) => r.author_id));
  const ckComments: KitComment[] = [
    ...replies.map((r) => ({
      id: "r" + r.id, body: r.body, stance: r.stance,
      name: r.profiles?.display_name || "Resident", created_at: r.created_at,
      sub_issue_id: r.sub_issue_id || null,
      reportType: "issue_reply" as const, reportId: r.id, authorId: r.author_id,
    })),
    ...stakes.filter((st) => st.user_id && !repliedUserIds.has(st.user_id)).map((st) => ({
      id: "s" + st.id, body: st.body, stance: "neutral",
      name: st.profiles?.display_name || "Resident", created_at: st.created_at,
      sub_issue_id: null, tag: "what's at stake",
    })),
  ];
  const contributionCount = ckComments.length;

  // "Where this stands" synthesis spine.
  const support = agreements.length;
  const oppose = disagreements.length;
  const total = support + oppose;
  const responded = !!issue.responded_at;
  const awaitingDays = daysSince(issue.created_at);
  const respondedDays = daysSince(issue.responded_at);
  const strongest = (arr: any[]) =>
    [...arr].sort((a, b) => (b.recognition_statement?.length || 0) - (a.recognition_statement?.length || 0))[0]
      ?.recognition_statement || null;
  const forLine = distilled?.for || strongest(disagreements);
  const againstLine = distilled?.against || strongest(agreements);
  const meeting = nextCouncilMeeting();
  const meetingStr = meeting ? meeting.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : null;
  const nextStep =
    issue.status === "resolved" ? "Resolved" :
    issue.status === "expert" ? "Under expert review" :
    issue.status === "escalated" ? (meetingStr ? `Escalated · council typically meets next ${meetingStr}` : "Escalated — awaiting council attention") :
    (meetingStr ? `Council typically meets 2nd & 4th Tuesdays — next: ${meetingStr}` : "Gathering resident input");
  const showStands = !(total === 0 && !forLine && !againstLine && watcherCount === 0 && !responded);

  const featuredDisagree = disagreements.length
    ? [...disagreements].sort((a, b) => (b.recognition_statement?.length || 0) - (a.recognition_statement?.length || 0))[0]
    : null;
  const featuredAgree = agreements.length
    ? [...agreements].sort((a, b) => (b.recognition_statement?.length || 0) - (a.recognition_statement?.length || 0))[0]
    : null;

  const stanceOpts = [
    { key: "support", label: "I support it", color: T.tealHi, bg: T.tealLo, bd: T.teal },
    { key: "unsure", label: "I'm unsure", color: T.amberHi, bg: T.amberLo, bd: T.amber },
    { key: "oppose", label: "I oppose it", color: T.redHi, bg: T.redLo, bd: T.red },
  ];
  const stakeOk = confirmStake.trim().length >= 10;
  const needRec = confirmStance === "support" || confirmStance === "oppose";
  const recOk = confirmRecognition.trim().length >= 50;
  const canRecord = stakeOk || (needRec && recOk);
  const recPrompt = confirmStance === "support"
    ? "What do you think people who oppose this care about?"
    : "What do you think people who support this care about?";

  return (
    <KeyboardAvoidingView style={s.root} behavior="padding">
      <Stack.Screen options={{ title: issue.neighborhoods?.name || "Civic Issue" }} />
      <ScrollView style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.issueTitle}>{issue.title}</Text>

        {/* Where this stands */}
        {showStands && (
          <View style={s.stands}>
            <Text style={s.standsHead}>Where this stands</Text>
            {total > 0 && (
              <>
                <View style={s.standsBar}>
                  <View style={{ flex: support, backgroundColor: T.teal }} />
                  <View style={{ flex: oppose, backgroundColor: T.red }} />
                </View>
                <Text style={s.standsSplit}>{support} support · {oppose} oppose</Text>
              </>
            )}
            {forLine && (
              <View style={s.standsRow}>
                <Text style={s.standsKey}>For</Text>
                <Text style={s.standsVal}>{forLine}</Text>
              </View>
            )}
            {againstLine && (
              <View style={s.standsRow}>
                <Text style={s.standsKey}>Against</Text>
                <Text style={s.standsVal}>{againstLine}</Text>
              </View>
            )}
            <View style={s.standsRow}>
              <Text style={s.standsKey}>Next</Text>
              <Text style={s.standsVal}>{nextStep}</Text>
            </View>
            <View style={[s.standsRow, s.standsClock]}>
              <Text style={s.standsKey}>{responded ? "Answered" : "Awaiting"}</Text>
              <Text style={[s.standsVal, !responded && awaitingDays >= 7 && { color: T.amberHi, fontWeight: "600" }]}>
                {responded
                  ? `Official responded ${respondedDays === 0 ? "today" : `${dayLabel(respondedDays)} ago`}`
                  : `No official response yet · ${dayLabel(awaitingDays)} and counting`}
                {watcherCount > 0 ? ` · ${watcherCount} watching` : ""}
              </Text>
            </View>
          </View>
        )}

        {/* Summary box */}
        <View style={s.summary}>
          <View style={s.summaryTop}>
            <Text style={[s.statusPill, { backgroundColor: statusStyle.bg, color: statusStyle.color, borderColor: statusStyle.color }]}>
              {statusStyle.label}
            </Text>
            {issue.neighborhoods?.name ? <Text style={s.summaryLoc}>{issue.neighborhoods.name}</Text> : null}
          </View>
          <Text style={s.summaryDate}>Raised {timeAgo(issue.created_at)}</Text>
          <View style={s.summaryDiv} />
          <Text style={s.summaryStat}>
            {(issue.voice_count || 0).toLocaleString()} verified resident{(issue.voice_count || 0) === 1 ? "" : "s"} prioritized this
            {watcherCount > 0 ? ` · ${watcherCount} watching` : ""}
          </Text>
          {subIssues.length > 0 && (
            <Text style={[s.summaryStat, { color: T.amberHi }]}>
              {subIssues.length} sub-issue{subIssues.length === 1 ? "" : "s"} in the discussion
            </Text>
          )}
        </View>

        {description ? <Text style={s.description}>{description}</Text> : null}
        {issue.source_label ? <Text style={s.sourceLabel}>{issue.source_label}</Text> : null}

        {/* Vote */}
        <Pressable
          onPress={handleVote}
          disabled={issue.user_has_voted || !currentUser}
          style={[s.voteBtn, issue.user_has_voted && s.voteBtnVoted]}
        >
          <Text style={[s.voteBtnText, issue.user_has_voted && { color: T.tealHi }]}>
            {issue.user_has_voted ? "✓ You've prioritised this" : "▲ Mark as priority"}
          </Text>
        </Pressable>
        {!issue.user_has_voted ? <Text style={s.zkNote}>✓ Private · neighbors can't see your vote</Text> : null}

        {/* Weigh in — say it in your own words */}
        {currentUser && !aiUnavailable && (
          <View style={s.weighinSection}>
            <Text style={s.kicker}>Weigh in</Text>
            {!interpretation && !showOwnWords && (
              <Pressable style={s.weighinCta} onPress={() => { setOwnWordsText(""); setShowOwnWords(true); }}>
                <Text style={s.weighinTitle}>🗣  Say it in your own words</Text>
                <Text style={s.weighinSub}>
                  Write one answer — we'll turn it into your position, your stake, what you recognise in the other side, and add it to the discussion. You confirm before anything is saved.
                </Text>
              </Pressable>
            )}

            {showOwnWords && !interpretation && (
              <View>
                <Text style={s.ownWordsPrompt}>Where do you land on this, and why does it matter to you?</Text>
                <TextInput
                  style={s.stakeInput} autoFocus multiline placeholder="In my own words…"
                  placeholderTextColor={T.creamFaint} value={ownWordsText} maxLength={1500}
                  onChangeText={setOwnWordsText}
                />
                <View style={s.rowBetween}>
                  <Text style={s.counter}>{ownWordsText.length}/1500</Text>
                  <View style={s.rowGap}>
                    <Pressable onPress={() => { setShowOwnWords(false); setOwnWordsText(""); }} style={s.ghostBtn}>
                      <Text style={s.ghostBtnText}>Cancel</Text>
                    </Pressable>
                    <Pressable onPress={interpretOwnWords} disabled={interpreting || ownWordsText.trim().length < 3}
                      style={[s.amberBtn, ownWordsText.trim().length < 3 && s.disabled]}>
                      <Text style={s.amberBtnText}>{interpreting ? "Reading…" : "Continue →"}</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            )}

            {/* Confirm card */}
            {interpretation && (
              <View style={s.confirmCard}>
                <Text style={s.confirmTitle}>Does this capture it?</Text>
                <Text style={s.confirmSub}>Here's how we read your answer. Edit anything — nothing is saved until you confirm.</Text>

                <Text style={s.fieldLabel}>Your position</Text>
                <View style={s.stanceRow}>
                  {stanceOpts.map((o) => {
                    const on = confirmStance === o.key;
                    return (
                      <Pressable key={o.key} onPress={() => setConfirmStance(o.key)}
                        style={[s.stanceBtn, { backgroundColor: on ? o.bg : "transparent", borderColor: on ? o.bd : T.border }]}>
                        <Text style={[s.stanceBtnText, { color: on ? o.color : T.creamDim }]}>{o.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={s.fieldLabel}>What's at stake for you</Text>
                <TextInput style={s.stakeInput} multiline placeholder="What this decision means for me is…"
                  placeholderTextColor={T.creamFaint} value={confirmStake} maxLength={280} onChangeText={setConfirmStake} />
                <Text style={s.fieldHint}>{stakeOk ? "Will be shared with residents" : "Add a sentence to share your stake (optional)"}</Text>

                {needRec && (
                  <>
                    <Text style={s.fieldLabel}>What you recognise in the other side</Text>
                    <Text style={s.recPrompt}>{recPrompt}</Text>
                    <TextInput style={s.stakeInput} multiline placeholder="Even though I disagree, I recognise that…"
                      placeholderTextColor={T.creamFaint} value={confirmRecognition} maxLength={300} onChangeText={setConfirmRecognition} />
                    <Text style={[s.fieldHint, !recOk && { color: T.amberHi }]}>
                      {recOk ? "Recorded alongside your position" : `Needed to register your position (${Math.max(0, 50 - confirmRecognition.trim().length)} more characters)`}
                    </Text>
                  </>
                )}

                <Text style={s.fieldLabel}>Posted to the discussion, in your words</Text>
                <TextInput style={s.stakeInput} multiline value={ownWordsText} maxLength={1500} onChangeText={setOwnWordsText} />
                <Text style={s.fieldHint}>
                  {ownWordsText.trim().length >= 3
                    ? 'This exact text joins "What residents are saying." Edit it, or clear it to skip posting.'
                    : "Empty — no reply will be posted."}
                </Text>

                {interpretation.confidence != null && interpretation.confidence < 0.5 && (
                  <Text style={s.lowConfidence}>Your answer was a little open-ended — double-check the reading above.</Text>
                )}

                <View style={s.rowGap}>
                  <Pressable onPress={() => { setInterpretation(null); setShowOwnWords(true); }} style={s.ghostBtn}>
                    <Text style={s.ghostBtnText}>← Reword</Text>
                  </Pressable>
                  <Pressable onPress={commitOwnWords} disabled={committing || !canRecord} style={[s.amberBtn, { flex: 1 }, !canRecord && s.disabled]}>
                    <Text style={s.amberBtnText}>{committing ? "Saving…" : "Looks right — record it"}</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Guest / fallback prompts */}
        {!currentUser && (
          <Text style={s.guestNote}>Verify your residency to weigh in on this issue.</Text>
        )}

        {/* Manual stake — fallback only */}
        {currentUser && aiUnavailable && (
          <View style={s.weighinSection}>
            <Text style={s.kicker}>What's at stake for you</Text>
            {showStakeInput ? (
              <View>
                <Text style={s.ownWordsPrompt}>{myStake ? "Your stake — edit anytime:" : "In one sentence — what's at stake for you in this decision?"}</Text>
                <TextInput style={s.stakeInput} autoFocus multiline placeholder="What this decision means for me is…"
                  placeholderTextColor={T.creamFaint} value={stakeInput} maxLength={280} onChangeText={setStakeInput} />
                <View style={s.rowBetween}>
                  <Text style={s.counter}>{stakeInput.length}/280 · Visible to all residents</Text>
                  <View style={s.rowGap}>
                    <Pressable onPress={() => { setShowStakeInput(false); setStakeInput(myStake?.body || ""); }} style={s.ghostBtn}>
                      <Text style={s.ghostBtnText}>Cancel</Text>
                    </Pressable>
                    <Pressable onPress={async () => { await submitStake(); setShowStakeInput(false); }}
                      disabled={stakingOp || stakeInput.trim().length < 10} style={[s.amberBtn, stakeInput.trim().length < 10 && s.disabled]}>
                      <Text style={s.amberBtnText}>{stakingOp ? "Saving…" : myStake ? "Update" : "Share stake"}</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : (
              <Pressable onPress={() => { setStakeInput(myStake?.body || ""); setShowStakeInput(true); }} style={s.dashedBtn}>
                <Text style={s.dashedBtnText}>{myStake ? "✎ Edit your stake" : "＋ Add what's at stake for you"}</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Counter-views */}
        {featuredDisagree && (
          <View style={{ marginTop: 12 }}>
            <Text style={s.perspLabel}>
              {disagreements.length === 1 ? "A different perspective" : `Strongest counter-view (${disagreements.length} perspectives registered)`}
            </Text>
            <View style={s.perspCard}>
              <Text style={s.perspBody}>"{featuredDisagree.recognition_statement}"</Text>
              <Text style={s.perspName}>— {featuredDisagree.profiles?.display_name || "Resident"}</Text>
            </View>
          </View>
        )}
        {featuredAgree && (
          <View style={{ marginTop: 10 }}>
            <Text style={s.perspLabel}>
              {agreements.length === 1 ? "A shared perspective" : `Strongest agreement (${agreements.length} perspectives registered)`}
            </Text>
            <View style={[s.perspCard, { backgroundColor: T.tealLo, borderColor: T.teal }]}>
              <Text style={s.perspBody}>"{featuredAgree.recognition_statement}"</Text>
              <Text style={s.perspName}>— {featuredAgree.profiles?.display_name || "Resident"}</Text>
            </View>
          </View>
        )}

        {/* Express position — fallback only */}
        {currentUser && aiUnavailable && !showAgree && !showDisagree && (
          <View style={[s.rowGap, { marginTop: 10 }]}>
            <Pressable onPress={() => setShowDisagree(true)} style={[s.expressBtn, { borderColor: T.border }]}>
              <Text style={[s.expressBtnText, { color: T.creamDim }]}>I see this differently</Text>
            </Pressable>
            <Pressable onPress={() => setShowAgree(true)} style={[s.expressBtn, { borderColor: T.teal }]}>
              <Text style={[s.expressBtnText, { color: T.tealHi }]}>I see this similarly</Text>
            </Pressable>
          </View>
        )}
        {currentUser && showAgree && (
          <View style={s.agreeBox}>
            <Text style={s.agreeTitle}>I see this similarly</Text>
            <Text style={s.agreeSub}>In one sentence — what do you think the people who oppose this care about?</Text>
            <TextInput style={s.stakeInput} multiline placeholder="Even though I agree, I recognize that opponents care about…"
              placeholderTextColor={T.creamFaint} value={agreeInput} maxLength={300} onChangeText={setAgreeInput} />
            <View style={s.rowBetween}>
              <Text style={s.counter}>{agreeInput.length}/300 · min 50</Text>
              <View style={s.rowGap}>
                <Pressable onPress={() => { setShowAgree(false); setAgreeInput(""); }} style={s.ghostBtn}>
                  <Text style={s.ghostBtnText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={submitAgreement} disabled={agreePosting || agreeInput.trim().length < 50}
                  style={[s.tealBtn, agreeInput.trim().length < 50 && s.disabled]}>
                  <Text style={s.tealBtnText}>{agreePosting ? "Saving…" : "Record"}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {/* What residents are saying — CommentKit */}
        <View style={s.window}>
          <View style={s.sectionHead}>
            <Text style={s.sectionHeadText}>💬 What residents are saying</Text>
            {contributionCount > 0 ? <Text style={s.countChip}>{contributionCount}</Text> : null}
          </View>
          {issue?.clustered_stakes?.clusters?.length > 0 && (
            <View style={{ paddingBottom: 8 }}>
              {issue.clustered_stakes.clusters.map((cluster: any, i: number) => (
                <View key={i} style={s.clusterCard}>
                  <Text style={s.clusterTheme}>{cluster.theme}</Text>
                  <Text style={s.clusterSummary}>
                    {cluster.summary}{cluster.count > 1 ? `  · ${cluster.count} residents` : ""}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <CommentKit
            currentUser={currentUser}
            subjectTitle={issue.title}
            subjectSummary={description || ""}
            getToken={getToken}
            comments={ckComments}
            subIssues={subIssues}
            timeAgo={timeAgo}
            onPost={postIssueComment}
            onCreateSubIssue={createIssueSubIssue}
          />
        </View>

        {/* Official response */}
        <View style={s.window}>
          <View style={s.sectionHead}><Text style={s.sectionHeadText}>✅ Official response</Text></View>
          {issue.official_response ? (
            <View style={s.official}>
              <View style={s.officialHead}>
                <View style={s.officialBadge}>
                  <Text style={s.officialBadgeText}>{initials(issue.official_response_name || issue.profiles?.display_name || "OF")}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.officialName}>{issue.official_response_name || issue.profiles?.display_name || "Official"}</Text>
                  <Text style={s.officialRole}>
                    {issue.official_response_verified && issue.official_response_email
                      ? `Responded via ${String(issue.official_response_email).split("@")[1]} · verified by email, not identity`
                      : "Verified Official"}
                  </Text>
                </View>
                <Text style={s.officialTime}>{timeAgo(issue.responded_at)}</Text>
              </View>
              <Text style={s.officialBody}>{issue.official_response}</Text>
              <View style={s.reactionRow}>
                <Pressable onPress={() => handleReaction("yes")}
                  style={[s.reactionBtn, reaction === "yes" && { backgroundColor: T.tealLo, borderColor: T.teal }]}>
                  <Text style={[s.reactionBtnText, reaction === "yes" && { color: T.tealHi }]}>✓ Addresses my concern</Text>
                </Pressable>
                <Pressable onPress={() => handleReaction("no")}
                  style={[s.reactionBtn, reaction === "no" && { backgroundColor: T.redLo, borderColor: T.red }]}>
                  <Text style={[s.reactionBtnText, reaction === "no" && { color: T.redHi }]}>Doesn't address it</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={s.awaiting}>
              <View style={s.pulse} />
              <Text style={s.awaitingText}>Awaiting official response</Text>
            </View>
          )}
        </View>

        {/* Expert input */}
        <View style={s.window}>
          <View style={s.sectionHead}>
            <Text style={s.sectionHeadText}>🎓 Expert input</Text>
            {expertAnswers.length > 0 ? <Text style={s.countChip}>{expertAnswers.length}</Text> : null}
          </View>
          {expertAnswers.length > 0 && (
            <>
              <Text style={s.expertDisclaimer}>
                Credentials are confirmed against public licensing registries. Townhall does not endorse advice — contributors are responsible for their statements.
              </Text>
              {expertAnswers.map((ans) => (
                <View key={ans.id} style={s.expert}>
                  <View style={s.expertHead}>
                    <View style={s.expertBadge}><Text style={s.expertBadgeText}>{initials(ans.expert_handle || "Verified")}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.expertName}>{ans.expert_handle || "Verified contributor"}</Text>
                      <Text style={s.expertDomain}>{ans.expert_credential || "Verified credential"}</Text>
                    </View>
                    <Text style={s.officialTime}>{timeAgo(ans.created_at)}</Text>
                  </View>
                  <Text style={s.expertBody}>{ans.body}</Text>
                </View>
              ))}
            </>
          )}
          {currentUser && (
            expertFlagged ? (
              <Text style={s.expertFlagged}>✓ Flagged for expert input — verified experts have been notified.</Text>
            ) : showExpertFlag ? (
              <View style={{ paddingTop: 4 }}>
                <Text style={s.ownWordsPrompt}>What should an expert clarify about this issue?</Text>
                <TextInput style={s.stakeInput} autoFocus multiline placeholder="e.g. Is this variance allowed under the current zoning code?"
                  placeholderTextColor={T.creamFaint} value={expertReason} maxLength={300} onChangeText={setExpertReason} />
                <View style={s.rowBetween}>
                  <Text style={[s.counter, expertReason.trim().length < 10 && { color: T.amberHi }]}>
                    {expertReason.trim().length >= 10 ? "Sent anonymously to verified experts" : `${Math.max(0, 10 - expertReason.trim().length)} more characters`}
                  </Text>
                  <View style={s.rowGap}>
                    <Pressable onPress={() => { setShowExpertFlag(false); setExpertReason(""); }} style={s.ghostBtn}>
                      <Text style={s.ghostBtnText}>Cancel</Text>
                    </Pressable>
                    <Pressable onPress={flagForExpert} disabled={flaggingExpert || expertReason.trim().length < 10}
                      style={[s.purpleBtn, expertReason.trim().length < 10 && s.disabled]}>
                      <Text style={s.purpleBtnText}>{flaggingExpert ? "Flagging…" : "Flag for expert input"}</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : (
              <Pressable onPress={() => setShowExpertFlag(true)}>
                <Text style={s.flagExpertLink}>✦ Flag this issue for expert input</Text>
              </Pressable>
            )
          )}
        </View>

        {/* Round-trip status */}
        <View style={s.window}>
          <View style={s.sectionHead}><Text style={s.sectionHeadText}>🔄 Round-trip status</Text></View>
          <IssueTimeline issueId={issue.id} stakeCount={issue.stake_count} supportCount={issue.support_count} />
          {subIssues.length > 0 && (
            <View style={{ paddingTop: 4 }}>
              <Text style={[s.kicker, { marginTop: 8 }]}>Sub-issues · {subIssues.length}</Text>
              {subIssues.map((sub) => {
                const n = ckComments.filter((c) => c.sub_issue_id === sub.id).length;
                return (
                  <View key={sub.id} style={s.subRow}>
                    <Text style={s.subRowTitle} numberOfLines={1}>{sub.title}</Text>
                    <Text style={s.subRowCount}>{n} comment{n === 1 ? "" : "s"}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Related civic items */}
        {relatedIssues.length > 0 && (
          <View style={{ marginTop: 8 }}>
            <Text style={[s.kicker, { marginBottom: 8 }]}>Related civic items</Text>
            {relatedIssues.map((r) => {
              const st = STATUS_COLORS[r.status] || STATUS_COLORS.open;
              return (
                <Pressable key={r.id} style={s.relatedItem} onPress={() => router.push({ pathname: "/issue/[id]", params: { id: r.id } })}>
                  <Text style={s.relatedTitle} numberOfLines={2}>{r.title}</Text>
                  <Text style={[s.statusPill, { backgroundColor: st.bg, color: st.color, borderColor: st.color }]}>{st.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Reply compose — fallback only */}
        {currentUser && aiUnavailable && (
          <View style={s.compose}>
            <TextInput style={s.composeInput} placeholder="Reply to this issue…" placeholderTextColor={T.creamFaint}
              value={replyText} onChangeText={setReplyText} multiline onFocus={() => setShowReplyInput(true)} />
            <Pressable onPress={handleReply} disabled={!replyText.trim() || submitting} style={[s.composeSend, (!replyText.trim() || submitting) && s.disabled]}>
              <Text style={s.composeSendText}>{submitting ? "…" : "Send"}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* I see this differently — bottom sheet */}
      <Modal visible={showDisagree} transparent animationType="slide" onRequestClose={() => setShowDisagree(false)}>
        <Pressable style={s.sheetBackdrop} onPress={() => setShowDisagree(false)} />
        <View style={s.sheetPanel}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>I see this differently</Text>
          <Text style={s.sheetSub}>
            Before registering your disagreement, tell us in one sentence what you think the people who support this position care about.
          </Text>
          <Text style={s.fieldHint}>What do supporters of this issue care about? <Text style={{ color: T.amberHi }}>{recognition.length}/300</Text></Text>
          <TextInput style={[s.stakeInput, { minHeight: 80 }]} multiline value={recognition} maxLength={300}
            placeholder="e.g. They care about pedestrian safety and reducing traffic risk near the school…"
            placeholderTextColor={T.creamFaint} onChangeText={setRecognition} />
          <Text style={s.sheetNote}>
            Your disagreement and this recognition will both be shown. The most thoughtful perspectives are surfaced first.
          </Text>
          <Pressable onPress={submitDisagreement} disabled={recognition.trim().length < 50 || submittingD}
            style={[s.sheetBtn, recognition.trim().length < 50 && s.disabled]}>
            <Text style={s.sheetBtnText}>{submittingD ? "Submitting…" : "Register my perspective"}</Text>
          </Pressable>
          {recognition.trim().length < 50 && recognition.length > 0 && (
            <Text style={s.sheetHint}>Keep going — a bit more context helps ({50 - recognition.trim().length} more characters)</Text>
          )}
        </View>
      </Modal>

      {toast && (
        <View style={s.toast} pointerEvents="none">
          <Text style={s.toastText}>{toast}</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  center: { justifyContent: "center", alignItems: "center" },
  content: { padding: 16, paddingBottom: 80 },
  issueTitle: { color: T.cream, fontSize: 21, fontWeight: "600", lineHeight: 29, marginBottom: 12 },

  stands: { borderWidth: 1, borderColor: T.amber, backgroundColor: T.surfaceHi, borderRadius: 12, padding: 14, marginBottom: 14 },
  standsHead: { fontSize: 10, fontWeight: "600", color: T.amberHi, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 },
  standsBar: { flexDirection: "row", height: 7, borderRadius: 99, overflow: "hidden", backgroundColor: T.border, marginBottom: 6 },
  standsSplit: { fontSize: 11, color: T.creamDim, marginBottom: 4 },
  standsRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  standsKey: { color: T.creamFaint, width: 52, textTransform: "uppercase", fontSize: 10, letterSpacing: 0.6, paddingTop: 2 },
  standsVal: { flex: 1, fontSize: 12, color: T.creamDim, lineHeight: 18 },
  standsClock: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: T.border },

  summary: { borderWidth: 1, borderColor: T.border, borderRadius: 12, backgroundColor: T.surface, padding: 14, marginBottom: 14 },
  summaryTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 99, fontSize: 11, fontWeight: "500", borderWidth: 1, overflow: "hidden" },
  summaryLoc: { fontSize: 11, color: T.creamDim, flexShrink: 1, textAlign: "right" },
  summaryDate: { fontSize: 11, color: T.creamFaint, marginTop: 7 },
  summaryDiv: { height: 1, backgroundColor: T.border, marginVertical: 10 },
  summaryStat: { fontSize: 11, color: T.creamFaint, marginTop: 6 },

  description: { fontSize: 13, color: T.creamDim, lineHeight: 22, marginBottom: 14 },
  sourceLabel: { fontSize: 11, color: T.creamFaint, marginBottom: 12 },

  voteBtn: { width: "100%", paddingVertical: 11, borderRadius: 9, borderWidth: 1, borderColor: T.blue, backgroundColor: T.blueLo, alignItems: "center" },
  voteBtnVoted: { backgroundColor: T.tealLo, borderColor: T.teal },
  voteBtnText: { color: T.blueHi, fontSize: 13, fontWeight: "500" },
  zkNote: { fontSize: 10, color: T.creamFaint, marginTop: 6, textAlign: "center" },

  weighinSection: { marginTop: 16, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 14 },
  kicker: { fontSize: 10, fontWeight: "500", color: T.creamFaint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  weighinCta: { padding: 14, borderRadius: 11, backgroundColor: T.surfaceHi, borderWidth: 1, borderColor: T.border },
  weighinTitle: { fontSize: 13, color: T.cream, fontWeight: "500", marginBottom: 3 },
  weighinSub: { fontSize: 11, color: T.creamDim, lineHeight: 17 },
  ownWordsPrompt: { fontSize: 12, color: T.creamDim, marginBottom: 8, lineHeight: 19 },

  stakeInput: { width: "100%", backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: T.cream, lineHeight: 20, minHeight: 56, textAlignVertical: "top" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, flexWrap: "wrap", gap: 8 },
  rowGap: { flexDirection: "row", gap: 8, alignItems: "center" },
  counter: { fontSize: 11, color: T.creamFaint, flexShrink: 1 },
  ghostBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: T.border },
  ghostBtnText: { color: T.creamDim, fontSize: 13 },
  amberBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: T.amber, alignItems: "center" },
  amberBtnText: { color: T.bg, fontSize: 13, fontWeight: "500" },
  tealBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 7, backgroundColor: T.teal },
  tealBtnText: { color: T.bg, fontSize: 12, fontWeight: "500" },
  purpleBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: T.purple },
  purpleBtnText: { color: "#fff", fontSize: 13, fontWeight: "500" },
  disabled: { opacity: 0.4 },

  confirmCard: { borderWidth: 1, borderColor: T.borderHi, borderRadius: 11, backgroundColor: T.surface, padding: 14 },
  confirmTitle: { fontSize: 15, color: T.cream, marginBottom: 3, fontWeight: "600" },
  confirmSub: { fontSize: 11, color: T.creamFaint, marginBottom: 13, lineHeight: 16 },
  fieldLabel: { fontSize: 10, fontWeight: "500", color: T.creamFaint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 7 },
  fieldHint: { fontSize: 10, color: T.creamFaint, marginTop: 4, marginBottom: 13 },
  stanceRow: { flexDirection: "row", gap: 6, marginBottom: 13 },
  stanceBtn: { flex: 1, paddingVertical: 7, paddingHorizontal: 4, borderRadius: 8, borderWidth: 1, alignItems: "center" },
  stanceBtnText: { fontSize: 12, fontWeight: "500" },
  recPrompt: { fontSize: 11, color: T.creamDim, marginBottom: 7, lineHeight: 16 },
  lowConfidence: { fontSize: 10, color: T.amberHi, marginBottom: 10, lineHeight: 15 },

  guestNote: { marginTop: 16, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 14, fontSize: 12, color: T.creamFaint, fontStyle: "italic" },
  dashedBtn: { marginTop: 12, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: T.border, borderStyle: "dashed" },
  dashedBtnText: { color: T.creamDim, fontSize: 13 },

  perspLabel: { fontSize: 10, color: T.creamFaint, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, fontWeight: "500" },
  perspCard: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9, backgroundColor: "#1A1A1A", borderWidth: 1, borderColor: T.border },
  perspBody: { fontSize: 12, color: T.creamDim, lineHeight: 20, fontStyle: "italic" },
  perspName: { fontSize: 10, color: T.creamFaint, marginTop: 4 },

  expressBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, alignItems: "center" },
  expressBtnText: { fontSize: 12 },
  agreeBox: { marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: T.tealLo, borderWidth: 1, borderColor: T.teal },
  agreeTitle: { fontSize: 13, color: T.tealHi, fontWeight: "500", marginBottom: 6 },
  agreeSub: { fontSize: 12, color: T.creamDim, marginBottom: 10, lineHeight: 19 },

  window: { borderWidth: 1, borderColor: T.border, borderRadius: 14, backgroundColor: T.surface, padding: 14, marginTop: 14 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  sectionHeadText: { flex: 1, fontSize: 11, fontWeight: "600", color: T.cream, textTransform: "uppercase", letterSpacing: 0.8 },
  countChip: { backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 1, fontSize: 10, color: T.creamDim, overflow: "hidden" },
  clusterCard: { padding: 10, borderRadius: 8, backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, marginBottom: 6 },
  clusterTheme: { fontSize: 11, fontWeight: "500", color: T.amberHi, marginBottom: 3 },
  clusterSummary: { fontSize: 12, color: T.creamDim, lineHeight: 19 },

  official: { padding: 14, borderRadius: 10, backgroundColor: T.tealLo, borderWidth: 1, borderColor: T.teal },
  officialHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  officialBadge: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#1D9E7333", borderWidth: 1, borderColor: T.teal },
  officialBadgeText: { fontSize: 11, fontWeight: "600", color: T.tealHi },
  officialName: { fontSize: 13, fontWeight: "500", color: T.tealHi },
  officialRole: { fontSize: 10, color: T.tealHi, opacity: 0.7 },
  officialTime: { fontSize: 10, color: T.creamFaint },
  officialBody: { fontSize: 13, color: T.creamDim, lineHeight: 22 },
  reactionRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  reactionBtn: { flex: 1, paddingVertical: 7, borderRadius: 7, borderWidth: 1, borderColor: T.border, alignItems: "center" },
  reactionBtnText: { fontSize: 12, color: T.creamDim },
  awaiting: { padding: 12, borderRadius: 9, backgroundColor: T.bg, borderWidth: 1, borderColor: T.border, flexDirection: "row", alignItems: "center", gap: 8 },
  pulse: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.amberHi },
  awaitingText: { fontSize: 12, color: T.creamFaint },

  expertDisclaimer: { fontSize: 11, color: T.creamFaint, lineHeight: 16, marginBottom: 8 },
  expert: { padding: 13, borderRadius: 10, backgroundColor: T.purpleLo, borderWidth: 1, borderColor: T.purpleMid, marginBottom: 8 },
  expertHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 7 },
  expertBadge: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "#534AB733", borderWidth: 1, borderColor: T.purpleMid },
  expertBadgeText: { fontSize: 10, fontWeight: "600", color: T.purpleHi },
  expertName: { fontSize: 12, fontWeight: "500", color: T.purpleHi },
  expertDomain: { fontSize: 10, color: T.purpleHi, opacity: 0.7 },
  expertBody: { fontSize: 13, color: T.creamDim, lineHeight: 22 },
  expertFlagged: { fontSize: 12, color: T.purpleHi, paddingVertical: 4 },
  flagExpertLink: { color: T.purpleHi, fontSize: 12, paddingVertical: 6 },

  subRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: T.border },
  subRowTitle: { flex: 1, fontSize: 12, color: T.cream },
  subRowCount: { fontSize: 11, color: T.creamFaint },

  relatedItem: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderWidth: 1, borderColor: T.border, borderRadius: 10, backgroundColor: T.surface, marginBottom: 8 },
  relatedTitle: { fontSize: 13, color: T.cream, flex: 1, lineHeight: 18 },

  compose: { flexDirection: "row", gap: 8, alignItems: "flex-end", marginTop: 14, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 10 },
  composeInput: { flex: 1, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, color: T.cream, minHeight: 40, maxHeight: 100 },
  composeSend: { backgroundColor: T.amber, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  composeSendText: { color: T.bg, fontSize: 13, fontWeight: "500" },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)" },
  sheetPanel: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: T.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderTopWidth: 1, borderColor: T.border, padding: 20, paddingBottom: 36 },
  sheetHandle: { width: 36, height: 4, borderRadius: 99, backgroundColor: T.border, alignSelf: "center", marginBottom: 16 },
  sheetTitle: { fontSize: 17, color: T.cream, marginBottom: 6, fontWeight: "600" },
  sheetSub: { fontSize: 12, color: T.creamDim, lineHeight: 19, marginBottom: 14 },
  sheetNote: { fontSize: 11, color: T.creamFaint, marginTop: 6, marginBottom: 14, lineHeight: 17 },
  sheetBtn: { width: "100%", paddingVertical: 12, borderRadius: 9, backgroundColor: T.surfaceHi, borderWidth: 1, borderColor: T.border, alignItems: "center" },
  sheetBtnText: { color: T.cream, fontSize: 14, fontWeight: "500" },
  sheetHint: { fontSize: 11, color: T.creamFaint, textAlign: "center", marginTop: 6 },

  toast: { position: "absolute", bottom: 40, left: 0, right: 0, alignItems: "center" },
  toastText: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 9, fontSize: 13, color: T.cream, overflow: "hidden" },
});
