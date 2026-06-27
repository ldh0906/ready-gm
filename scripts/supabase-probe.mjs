// Connectivity + schema probe for Supabase. Run: node --env-file=.env scripts/supabase-probe.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("MISSING_ENV");
  process.exit(2);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await supabase.from("scenarios").select("id").limit(5);
if (error) {
  console.log("QUERY_ERROR", JSON.stringify({ code: error.code, message: error.message }));
  process.exit(0);
}
console.log("OK", JSON.stringify(data));
