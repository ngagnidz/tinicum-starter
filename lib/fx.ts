// EUR->USD conversion for comparing confirmed prices against USD PO
// prices. Loads historical rates from Beacon's ERP fx_rate table (stored
// in Supabase). Rates are indexed by month (YYYY-MM format) to match the
// PO date, eliminating false positives from exchange rate movement after
// purchase order dates.

import { createClient } from "@supabase/supabase-js";

export interface FxRate {
  rate: number;
  month: string;
  source: string;
}

export async function getFxRate(
  month: string,
  currency: string,
): Promise<FxRate | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // This project's anon/publishable key env var (see lib/supabase/client.ts);
  // NEXT_PUBLIC_SUPABASE_ANON_KEY doesn't exist here, so the lookup below
  // would silently and permanently return null without this.
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing Supabase environment variables");
    return null;
  }

  try {
    const client = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await client
      .from("fx_rate")
      .select("rate_to_usd")
      .eq("month", month)
      .eq("currency", currency)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      rate: data.rate_to_usd,
      month,
      source: `Beacon ERP (${month})`,
    };
  } catch {
    return null;
  }
}
