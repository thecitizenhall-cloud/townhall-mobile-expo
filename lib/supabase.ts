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

export type ConcernCard = {
  id: string;
  title: string;
  body: string;
  source_label: string | null;
  source_url: string | null;
  quote: string | null;
  outcome_signal: string | null;
  created_at: string;
  municipality_id: string;
  scope: string | null;
  is_bot_post: boolean;
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
