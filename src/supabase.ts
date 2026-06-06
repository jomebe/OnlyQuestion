import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://tjdeqxpvqwliflabwxfm.supabase.co";
const supabasePublishableKey = "sb_publishable_eKnJL12-Ru3BIw9u6usF2Q_vXD1If4r";

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
