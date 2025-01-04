import dotenv from "dotenv"
dotenv.config()
export const SUPABASE_CONFIG = {
  URL: process.env.SUPABASE_URL,
  ANON_KEY: process.env.SUPABASE_ANON_KEY
} as const;
