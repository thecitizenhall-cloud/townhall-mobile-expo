// ReportButton — shared flag-and-report control for every content surface in the
// mobile app (posts, issue replies, card comments). Writes to the unified
// content_reports table (web migration 051). NCII/CSAM are priority for the
// TAKE IT DOWN Act 48h fast-path. Mirrors web components/ReportControl.jsx.
import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { supabase } from "../lib/supabase";
import { T } from "../lib/theme";

type ContentType = "post" | "issue_reply" | "card_event" | "concern_card" | "civic_issue";

const REASONS: { key: string; label: string; priority: boolean }[] = [
  { key: "ncii", label: "Nonconsensual intimate imagery", priority: true },
  { key: "csam", label: "Child sexual abuse material", priority: true },
  { key: "threat", label: "Threat of violence", priority: false },
  { key: "doxxing", label: "Doxxing / private information", priority: false },
  { key: "harassment", label: "Harassment", priority: false },
  { key: "impersonation", label: "Impersonation", priority: false },
  { key: "spam", label: "Spam or misleading", priority: false },
  { key: "other", label: "Other", priority: false },
];

export default function ReportButton({
  contentType, contentId, currentUserId,
}: {
  contentType: ContentType;
  contentId: string;
  currentUserId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!currentUserId) return null;

  async function file(reason: string, priority: boolean) {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    const { error } = await supabase.from("content_reports").insert({
      reporter_id: currentUserId,
      content_type: contentType,
      content_id: contentId,
      reason,
      priority,
    });
    if (!error || error.code === "23505") setReported(true);
    setBusy(false);
  }

  return (
    <View>
      <Pressable onPress={() => setOpen((o) => !o)} disabled={reported} hitSlop={8}>
        <Text style={[s.flag, reported && { color: T.amberHi }]}>⚑</Text>
      </Pressable>
      {open && !reported && (
        <View style={s.menu}>
          <Text style={s.menuHead}>Report reason</Text>
          {REASONS.map((r) => (
            <Pressable key={r.key} onPress={() => file(r.key, r.priority)} style={s.item}>
              <Text style={[s.itemText, r.priority && { color: T.redHi }]}>{r.label}</Text>
            </Pressable>
          ))}
          <Text style={s.note}>Intimate imagery is removed within 48 hours. You can also email ncii@townhallcafe.org.</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  flag: { fontSize: 14, color: T.creamFaint, paddingHorizontal: 2 },
  menu: { position: "absolute", top: 22, right: 0, zIndex: 50, minWidth: 220, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 9, paddingVertical: 6 },
  menuHead: { paddingHorizontal: 12, paddingBottom: 6, fontSize: 10, color: T.creamFaint, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.8 },
  item: { paddingHorizontal: 14, paddingVertical: 8 },
  itemText: { fontSize: 13, color: T.creamDim },
  note: { borderTopWidth: 1, borderTopColor: T.border, marginTop: 6, paddingHorizontal: 14, paddingTop: 8, fontSize: 11, color: T.creamFaint, lineHeight: 16 },
});
