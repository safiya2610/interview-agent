import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getUpstreamStatus(err: any): number | undefined {
  const status = err?.status ?? err?.response?.status;
  return typeof status === "number" ? status : undefined;
}

function safeErrorMessage(err: any): string {
  const msg = err?.message ?? err?.toString?.() ?? "Unknown error";
  return typeof msg === "string" ? msg : "Unknown error";
}

function isDev() {
  return process.env.NODE_ENV !== "production";
}

// Initialize Supabase (Server-side)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error: "Server misconfigured",
          detail: "GEMINI_API_KEY is missing",
          hint: "Add GEMINI_API_KEY to interview-agent/.env (or .env.local) and restart the dev server.",
        },
        { status: 500 }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch (e) {
      return NextResponse.json(
        {
          error: "Invalid JSON body",
          detail: "Request body must be valid JSON with Content-Type: application/json",
        },
        { status: 400 }
      );
    }

    const { messages, state, currentQuestion, code, company, topic, difficulty, excludeTopics } = body ?? {};

    // 1. Construct the prompt based on state
    // We strictly follow the user's request:
    // - "It will take the question from the quesion bank from supabase" (Handled in Step 3)
    // - "paste the question from the database... below the mic" (Handled by UI state)
    // - "agent will read ques" (Instructed here)
    // - "ask the logic" -> "speak logic if correct then agent asks to code" (Approach Phase)
    // - "agent should monitor that and when code completed or if stuck give hint than check" (Coding Phase)

    let systemInstruction = `
      You are an expert technical interviewer for a software engineering role at ${company || "a top tech company"}.
      Your goal is to assess the candidate's problem-solving skills, coding ability, and communication.
      
      Current Interview Phase: ${state}
      Current Question: ${currentQuestion ? `${currentQuestion.title}: ${currentQuestion.description}` : "None selected yet."}
      
      Candidate's Code (Live Editor Content):
      \`\`\`
      ${code || "// No code yet"}
      \`\`\`

      Phases & Transitions:
      1. 'intro': 
         - Ask the candidate to introduce themselves.
         - Once they are done, transition to 'approach'. 
         - **Crucial**: When moving to 'approach', set "shouldFetchQuestion": true in the output JSON. **Do NOT generate the question text yourself.** Just say: "I have selected a problem for you. Please read it and explain your approach." The system will append the actual problem text to your message.
      
      2. 'approach': 
         - The candidate has the question. 
         - Ask them to **explain their logic/approach** first. Do NOT let them code yet.
         - If they are silent or ask for the question again, repeat the problem summary.
         - Evaluate their verbal logic.
           - If flawed: Give a conceptual hint.
           - If correct/optimal: Tell them "That sounds like a great plan. Please proceed to the coding editor." and transition internal state to 'coding'.
      
      3. 'coding': 
         - The candidate is now writing code (see "Candidate's Code" above).
         - **Monitor**: Check the code they are writing in real-time.
         - **Stuck?**: If they seem stuck or ask for help, provide a small syntax or logic hint (don't write the code for them).
         - **Completed?**: If they say they are finished, or the code looks complete and correct, analyze it.
           - If correct: "Great job! The code looks correct." -> transition to 'finished'.
           - If buggy: Point out the edge case or bug without being too harsh. Ask them to fix it.
      
      4. 'finished':
         - Wrap up the interview. Give brief feedback on their performance.

      Output strictly in JSON format. Do not use Markdown backticks.
      {
        "message": "Your response to the candidate.",
        "nextState": "The next state (intro, approach, coding, finished).",
        "shouldFetchQuestion": boolean (true ONLY if transitioning from 'intro' to 'approach' OR if currently in 'approach' but no question is assigned yet)
      }
    `;

    // 2. Get response from Gemini
    // NOTE: Model availability/quota differs per key/project. We try a few well-known
    // aliases to avoid hard failures.
    const genAI = new GoogleGenerativeAI(apiKey);
    const preferredModel = process.env.GEMINI_MODEL;
    const modelCandidates = [
      preferredModel,
      "gemini-2.0-flash", // Higher priority for JSON mode reliability
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-flash-lite-latest",
      "gemini-flash-latest",
      "gemini-pro-latest",
    ].filter(Boolean) as string[];

    let responseText: string | null = null;
    let lastErr: any = null;

    for (const modelName of modelCandidates) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: { 
             responseMimeType: "application/json" 
          },
        });

        // Sanitize history: Gemini requires the first message to be from 'user'.
        // If the first message in our stored history is 'model', we must either:
        // 1. Drop it (if not critical), or
        // 2. Prepend a dummy user message to satisfy the API check.
        let safeHistory = (messages ?? []).map((m: any) => ({
            role: m.role === "user" ? "user" : "model",
            parts: [{ text: m.content }],
        }));

        if (safeHistory.length > 0 && safeHistory[0].role === "model") {
             // Inserting a placeholder user message so the conversation is valid [User, Model, User, ...]
             safeHistory.unshift({
               role: "user",
               parts: [{ text: "Hello" }]
             });
        }

        const chat = model.startChat({
          history: safeHistory,
        });

        const result = await chat.sendMessage(systemInstruction);
        responseText = result.response.text();
        break;
      } catch (e: any) {
        lastErr = e;
        // Try the next model on known transient/availability failures.
        const status = getUpstreamStatus(e);
        if (status === 404 || status === 429) continue;
        break;
      }
    }

    if (!responseText) {
      const status = getUpstreamStatus(lastErr);
      const msg = safeErrorMessage(lastErr);
      if (status === 429) {
        return NextResponse.json(
          {
            error: "Gemini quota exceeded",
            detail: msg,
            retryAfterSeconds: 60,
            hint: "Open https://ai.dev/usage?tab=rate-limit and ensure this project has non-zero free-tier quota (or enable billing).",
          },
          { status: 429 }
        );
      }

      if (status === 401 || status === 403) {
        return NextResponse.json(
          {
            error: "Gemini auth failed",
            detail: msg,
            hint: "Check that the API key is valid and not restricted to browser referrers. For server-side use, avoid HTTP-referrer restrictions.",
          },
          { status }
        );
      }

      return NextResponse.json(
        {
          error: "Gemini request failed",
          detail: msg,
          ...(isDev()
            ? {
                debug: {
                  upstreamStatus: status ?? null,
                  modelCandidates,
                },
              }
            : null),
        },
        { status: typeof status === "number" ? status : 502 }
      );
    }

    let parsedResponse;
    
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (e) {
      console.error("Failed to parse JSON from Gemini", responseText);
      return NextResponse.json(
        {
          error: "AI response error",
          detail: "Model returned non-JSON output",
          ...(isDev() ? { debug: { raw: responseText.slice(0, 2000) } } : null),
        },
        { status: 502 }
      );
    }

    let { message, nextState, shouldFetchQuestion } = parsedResponse;
    let newQuestion = null;

    // 3. Handle State Transitions & Data Fetching
    if (shouldFetchQuestion || (nextState === 'approach' && !currentQuestion)) {
      // Fetch a random question from Supabase
      // User Request: "it should not have the topic selected" -> We ignore topic if company is present,
      // or simply pass empty array to widen the search as requested.
      const ignoreTopicFilter = true; 
      
      const { data, error } = await supabase.rpc('pick_random_dsa_question', {
        p_company: company,
        p_difficulty: difficulty,
        // If user wants to ignore topic selection to get broad company questions, pass [].
        // If topic is critical, pass [topic].
        // based on "it should not have the topic selected", we pass [].
        p_include_topics: (ignoreTopicFilter || !topic) ? [] : [topic],
        p_exclude_topics: excludeTopics ?? []
      });

      if (data) {
        // Handle array return from RPC (some postgrest setups return single obj in array for rpc)
        const q = Array.isArray(data) ? data[0] : data;
        if (q) {
            newQuestion = q;
            const descLower = (q.description || q.prompt || "").toLowerCase();
            // If the prompt is just "null" string or very short, fallback or warn
            const hasValidDesc = descLower.length > 5 && descLower !== "null";
            const textToAppend = hasValidDesc ? (q.description || q.prompt) : "(Description not available)";

             message += `\n\n**New Question Assigned: ${q.title}**\n\n${textToAppend}`;
        } else {
             console.warn("RPC returned valid data structure but empty/null inside?", data);
             message += `\n\n(System Error: Database returned empty question result.)`;
        }
      } else {
        console.warn("No question found", error);
        message += "\n\n(System: Could not fetch a question. Please check the database.)";
      }
    }

    return NextResponse.json({
      message,
      nextState,
      newQuestion
    });

  } catch (error) {
    console.error("Agent API Error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        ...(isDev() ? { detail: safeErrorMessage(error) } : null),
      },
      { status: 500 }
    );
  }
}
