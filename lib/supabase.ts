import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Singleton — prevents multiple client instances competing for the auth lock
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  neighborhood_id: string | null;
  neighborhood: string | null;
  onboarded: boolean;
  first_session_completed_at: string | null;
  last_session_at: string | null;
  posting_suspended_until: string | null;
};

// Mirrors the live concern_cards columns the web app reads (summary / source_quote
// / meeting_date / affected_area / impact_type), with the older guessed names kept
// optional so nothing that referenced them breaks.
export type ConcernCard = {
  id: string;
  title: string;
  summary: string | null;
  source_quote: string | null;
  source_url: string | null;
  outcome_signal: string | null;
  impact_type: string | null;
  affected_area: string | null;
  meeting_date: string | null;
  next_action_date: string | null;
  created_at: string;
  municipality_id: string;
  official_response?: string | null;
  // legacy/optional
  body?: string | null;
  quote?: string | null;
  source_label?: string | null;
  scope?: string | null;
  is_bot_post?: boolean;
};

// Unified item shape returned by the web app's /api/civic-feed route. The route
// aggregates the civic engine's concern cards plus SeeClickFix, township agendas,
// township news bulletins, and NOAA alerts — so the mobile feed reuses the exact
// same source list and relevance logic as the web feed instead of re-querying.
export type CivicItem = {
  source: "civic_engine" | "seeclickfix" | "township" | "township_news" | "noaa";
  external_id: string;
  concern_card_id?: string;
  _dist?: number;   // miles from the resident (opt-in "Near me" only)
  _inDistrict?: boolean;    // card is in the resident's election district (B4)
  _districtName?: string;
  _onRoute?: string | null; // road name matched from the resident's saved routes
  tag: string;
  title: string;
  body: string;
  url: string | null;
  address: string | null;
  created_at: string;
  image_url: string | null;
  outcome_signal?: string | null;
  impact_type?: string | null;
  relevance_score?: number;
};

export type CivicIssue = {
  id: string;
  title: string;
  body: string;
  status: "open" | "escalated" | "expert" | "resolved";
  scope: string | null;
  neighborhood_id: string | null;
  created_at: string;
  support_count: number;
  oppose_count: number;
  stake_count: number;
};
