import type { RaidNotifierConfig } from './types';

export const RAID_NOTIFIER_CONFIG: RaidNotifierConfig = {
  API_BASE_URL: process.env.API_BASE_URL!,
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY!,
};
