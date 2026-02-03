
import { createClient } from "@supabase/supabase-js";
import 'dotenv/config'; // Loads .env from root or current dir

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if(!supabaseUrl || !supabaseKey) {
  console.error("Missing env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testRpc() {
  console.log("Calling pick_random_dsa_question with p_company='Google'...");
  
  const { data, error } = await supabase.rpc('pick_random_dsa_question', {
    p_company: 'Google',
    p_difficulty: 'Medium',
    p_include_topics: [],
    p_exclude_topics: []
  });

  if (error) {
    console.error("RPC Error:", error);
  } else {
    console.log("RPC Success. Raw Data:", JSON.stringify(data, null, 2));
    if (Array.isArray(data)) {
        console.log("Array length:", data.length);
        if (data.length > 0) console.log("First item keys:", Object.keys(data[0]));
    }
  }
}

testRpc();
