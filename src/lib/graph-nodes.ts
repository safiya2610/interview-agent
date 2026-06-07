/**
 * graph-nodes.ts
 * ──────────────
 * Each export is a "node" in the interview graph.
 * A node receives the current InterviewGraphState + the latest user input,
 * makes a focused Gemini call (if needed), and returns the mutated state.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  InterviewGraphState,
  ChatMessage,
  ApproachEvaluation,
} from "./graph-state";

/* ================================================================== */
/*  Gemini helpers                                                     */
/* ================================================================== */

function getGenAI(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(key);
}

/** Model fallback chain — tries each until one works. */
function getModelCandidates(): string[] {
  const preferred = process.env.GEMINI_MODEL;
  return [
    preferred,
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-flash-lite-latest",
    "gemini-flash-latest",
    "gemini-pro-latest",
  ].filter(Boolean) as string[];
}

/**
 * Send a single prompt to Gemini with optional conversation history.
 * Returns the raw text response.
 */
async function callGemini(
  systemPrompt: string,
  history: ChatMessage[],
  responseJson = false
): Promise<string> {
  const genAI = getGenAI();
  const candidates = getModelCandidates();

  let lastErr: any = null;

  for (const modelName of candidates) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: responseJson
          ? { responseMimeType: "application/json" }
          : undefined,
      });

      // Build safe history (Gemini requires alternating user/model, starting with user)
      let safeHistory = history.map((m) => ({
        role: m.role === "user" ? "user" as const : "model" as const,
        parts: [{ text: m.content }],
      }));

      if (safeHistory.length > 0 && safeHistory[0].role === "model") {
        safeHistory.unshift({ role: "user", parts: [{ text: "Hello" }] });
      }

      const chat = model.startChat({ history: safeHistory });
      const result = await chat.sendMessage(systemPrompt);
      return result.response.text();
    } catch (e: any) {
      lastErr = e;
      const status = e?.status ?? e?.response?.status;
      if (status === 404 || status === 429) continue;
      break;
    }
  }

  throw lastErr ?? new Error("All Gemini models failed");
}

/* ================================================================== */
/*  Node handlers                                                      */
/* ================================================================== */

/**
 * INTRODUCTION node
 * ─────────────────
 * First contact. AI greets the candidate and asks for a self-introduction.
 * If this is the very first call (no user input yet), generate a greeting.
 * If the user has already introduced themselves, acknowledge and move on.
 */
export async function introductionNode(
  state: InterviewGraphState,
  userInput: string
): Promise<InterviewGraphState> {
  const isFirstCall = state.messages.length === 0 && !userInput.trim();

  if (isFirstCall) {
    // Generate a warm greeting
    const prompt = `You are a friendly technical interviewer at ${state.company || "a top tech company"}.
Greet the candidate warmly and ask them to briefly introduce themselves — their name, background, and what they're preparing for.
Keep it conversational, 2-3 sentences max. Be encouraging.
Do NOT mention any coding question yet.`;

    const response = await callGemini(prompt, []);

    return {
      ...state,
      phase: "introduction",
      messages: [{ role: "model", content: response }],
      aiSpeechText: response,
      aiStatusText: "Introduce yourself to begin...",
      shouldSpeak: true,
    };
  }

  // User has spoken their introduction — acknowledge and transition
  const updatedMessages: ChatMessage[] = [
    ...state.messages,
    { role: "user", content: userInput },
  ];

  const prompt = `You are a technical interviewer at ${state.company || "a top tech company"}.
The candidate just introduced themselves. Here's what they said:
"${userInput}"

Acknowledge their introduction briefly and warmly (1-2 sentences).
Then say something like: "Great! Let's get started. I'm going to present you with a coding problem now."
Do NOT describe or mention any specific question. Keep it short and natural.`;

  const response = await callGemini(prompt, updatedMessages);

  return {
    ...state,
    phase: "present_question",
    messages: [...updatedMessages, { role: "model", content: response }],
    aiSpeechText: response,
    aiStatusText: "Preparing your question...",
    shouldSpeak: true,
    shouldFetchQuestion: true,
  };
}

/**
 * PRESENT_QUESTION node
 * ─────────────────────
 * No Gemini call. The question was fetched by the route layer.
 * AI simply tells the candidate to read the question below.
 */
export async function presentQuestionNode(
  state: InterviewGraphState,
  _userInput: string
): Promise<InterviewGraphState> {
  const questionTitle = state.currentQuestion?.title ?? "the problem";
  
  const speechText = state.questionsAsked === 0
    ? `Alright, I've put up a coding problem for you below. Take a moment to read through it carefully. Once you've understood the problem, walk me through how you'd approach solving it. Don't jump to code just yet, I'd like to hear your thought process first.`
    : `Here's your next problem. Take a look at it below and when you're ready, tell me your approach.`;

  return {
    ...state,
    phase: "evaluate_approach",
    messages: [
      ...state.messages,
      { role: "model", content: `[Question presented: ${questionTitle}] ${speechText}` },
    ],
    aiSpeechText: speechText,
    aiStatusText: "Read the question below, then explain your approach",
    shouldSpeak: true,
    shouldFetchQuestion: false,
    editorUnlocked: false,
    approachAttempts: 0,
    approachEval: null,
    questionsAsked: state.questionsAsked + 1,
  };
}

/**
 * EVALUATE_APPROACH node
 * ──────────────────────
 * The candidate explains their approach. AI evaluates:
 * - Is it correct?
 * - Is it optimal?
 * - What's the time/space complexity?
 * If wrong → gives hint, loops back.
 * If correct + optimal → transitions to coding.
 * After maxApproachAttempts wrong attempts → reveals optimal and moves to coding.
 */
export async function evaluateApproachNode(
  state: InterviewGraphState,
  userInput: string
): Promise<InterviewGraphState> {
  const updatedMessages: ChatMessage[] = [
    ...state.messages,
    { role: "user", content: userInput },
  ];

  const attempt = state.approachAttempts + 1;
  const maxAttempts = state.maxApproachAttempts;
  const isLastAttempt = attempt >= maxAttempts;

  const questionText = state.currentQuestion
    ? `${state.currentQuestion.title}: ${state.currentQuestion.prompt || state.currentQuestion.description || ""}`
    : "Unknown question";

  const prompt = `You are a technical interviewer evaluating a candidate's approach to a DSA problem.

PROBLEM: ${questionText}

CANDIDATE'S APPROACH:
"${userInput}"

Evaluate the approach and respond in strict JSON format:
{
  "correct": boolean,        // Is the approach logically correct (would produce right answers)?
  "optimal": boolean,        // Is it the optimal solution (best time/space complexity)?
  "timeComplexity": "O(...)", // The time complexity of their approach
  "spaceComplexity": "O(...)", // The space complexity of their approach
  "feedback": "string",      // Your spoken feedback to the candidate (2-4 sentences, conversational)
  "hint": "string or null"   // If not correct/optimal: a helpful hint. If correct+optimal: null
}

RULES:
- If the approach is CORRECT and OPTIMAL: praise them, confirm the complexity, and tell them to go ahead and start coding.
- If the approach is CORRECT but NOT OPTIMAL: acknowledge it works, mention the complexity, and hint at a better approach. Ask them to think of a more optimal solution.
- If the approach is WRONG: explain briefly why it won't work (without giving away the answer), provide a conceptual hint, and ask them to try again.
${isLastAttempt ? "- This is the candidate's LAST attempt. If wrong or suboptimal, briefly explain the optimal approach and tell them to start coding with whatever approach they're comfortable with." : ""}
- Keep feedback conversational and encouraging — like a real interviewer.
- Do NOT write any code in your feedback.
- Do NOT mention attempt numbers or hint numbers like "hint 1" or "attempt 2/3". Just give the feedback naturally.`;

  const responseText = await callGemini(prompt, updatedMessages, true);
  
  let evaluation: ApproachEvaluation;
  try {
    evaluation = JSON.parse(responseText);
  } catch {
    // If JSON parsing fails, treat as a generic response
    evaluation = {
      correct: false,
      optimal: false,
      feedback: responseText.replace(/```json|```/g, "").trim(),
      hint: "Try thinking about what data structure would help you look up values quickly.",
    };
  }

  const shouldUnlock = (evaluation.correct && evaluation.optimal) || isLastAttempt;

  const nextPhase = shouldUnlock ? "coding" : "evaluate_approach";

  let speechText = evaluation.feedback;
  if (shouldUnlock && !evaluation.optimal && isLastAttempt) {
    speechText += " Let me unlock the editor for you now. Go ahead and code your solution.";
  } else if (shouldUnlock) {
    speechText += " The editor is now unlocked. Go ahead and code your solution!";
  }

  const statusText = shouldUnlock
    ? "Code your solution — ask if you need help"
    : "Think about the hint and try again";

  return {
    ...state,
    phase: nextPhase,
    messages: [...updatedMessages, { role: "model", content: speechText }],
    aiSpeechText: speechText,
    aiStatusText: statusText,
    shouldSpeak: true,
    editorUnlocked: shouldUnlock,
    approachAttempts: attempt,
    approachEval: evaluation,
  };
}

/**
 * CODING node
 * ───────────
 * Editor is unlocked. The candidate is writing code.
 * AI only responds if the user asks a question or needs help.
 * Gives small hints without writing code for them.
 */
export async function codingNode(
  state: InterviewGraphState,
  userInput: string
): Promise<InterviewGraphState> {
  const updatedMessages: ChatMessage[] = [
    ...state.messages,
    { role: "user", content: userInput },
  ];

  const questionText = state.currentQuestion
    ? `${state.currentQuestion.title}: ${state.currentQuestion.prompt || state.currentQuestion.description || ""}`
    : "Unknown question";

  const inputLower = userInput.toLowerCase();

  // Check if user says tests passed / all correct → transition to review
  const passedKeywords = ["passed", "accepted", "all tests", "all pass", "tests pass", "all correct", "all cases pass"];
  const hasPassed = passedKeywords.some((kw) => inputLower.includes(kw));

  if (hasPassed) {
    // Tests passed — transition to review
    return {
      ...state,
      phase: "review_solution",
      messages: [...updatedMessages, { role: "model", content: "Great, all test cases passed! Let me review your solution now." }],
      aiSpeechText: "Great, all test cases passed! Let me review your solution now.",
      aiStatusText: "Reviewing your solution...",
      shouldSpeak: true,
    };
  }

  // Check if user says they're done / finished coding
  const doneKeywords = ["done", "finished", "completed", "ready", "i think it's done", "i am done"];
  const isDone = doneKeywords.some((kw) => inputLower.includes(kw));

  if (isDone) {
    // Don't jump to review — ask them to run test cases first
    const speechText = "Nice work! Before I review it, go ahead and run the test cases to make sure your solution handles all the examples correctly. Click Run All in the test panel below.";

    return {
      ...state,
      phase: "coding",
      messages: [...updatedMessages, { role: "model", content: speechText }],
      aiSpeechText: speechText,
      aiStatusText: "Run the test cases to verify your solution",
      shouldSpeak: true,
    };
  }

  // Check if user mentions errors or test failures
  const errorKeywords = ["error", "failed", "wrong answer", "not working", "bug", "compile error", "failing", "wrong output"];
  const hasError = errorKeywords.some((kw) => inputLower.includes(kw));

  if (hasError) {
    const prompt = `You are a technical interviewer. The candidate is having issues with their code.

PROBLEM: ${questionText}

CANDIDATE'S CURRENT CODE:
\`\`\`
${state.userCode || "// No code yet"}
\`\`\`

CANDIDATE SAYS: "${userInput}"

Help them debug:
- Look at their code and identify the likely issue
- Give a conceptual hint about what might be wrong (e.g., "check your loop boundary" or "think about the edge case when the array is empty")
- Do NOT write the corrected code for them
- Encourage them to read the error message carefully and trace through their logic

Keep your response to 2-3 sentences. Be supportive.`;

    const response = await callGemini(prompt, updatedMessages);

    return {
      ...state,
      phase: "coding",
      messages: [...updatedMessages, { role: "model", content: response }],
      aiSpeechText: response,
      aiStatusText: "Fix the issue and try again",
      shouldSpeak: true,
    };
  }

  // General: user is asking a question or making a comment during coding
  const prompt = `You are a technical interviewer. The candidate is coding a solution and has said something to you.

PROBLEM: ${questionText}

CANDIDATE'S CURRENT CODE:
\`\`\`
${state.userCode || "// No code yet"}
\`\`\`

CANDIDATE SAYS: "${userInput}"

Respond helpfully:
- If they're asking for help: give a SMALL conceptual hint, never write code for them
- If they're thinking aloud: acknowledge briefly, maybe guide their thinking
- If they seem stuck: point them toward the key insight without giving it away
- If they mention submitting: tell them to run the test cases first to verify

Keep your response to 2-3 sentences max. Be like a real interviewer — helpful but not hand-holding.
Do NOT write any code in your response.`;

  const response = await callGemini(prompt, updatedMessages);

  return {
    ...state,
    phase: "coding",
    messages: [...updatedMessages, { role: "model", content: response }],
    aiSpeechText: response,
    aiStatusText: "Code your solution — ask if you need help",
    shouldSpeak: true,
  };
}

/**
 * REVIEW_SOLUTION node
 * ────────────────────
 * AI reviews the submitted code for correctness, edge cases, and complexity.
 */
export async function reviewSolutionNode(
  state: InterviewGraphState,
  _userInput: string
): Promise<InterviewGraphState> {
  const questionText = state.currentQuestion
    ? `${state.currentQuestion.title}: ${state.currentQuestion.prompt || state.currentQuestion.description || ""}`
    : "Unknown question";

  const prompt = `You are a technical interviewer reviewing a candidate's code solution.

PROBLEM: ${questionText}

CANDIDATE'S CODE:
\`\`\`
${state.userCode || "// No code submitted"}
\`\`\`

Review the solution and provide spoken feedback (3-5 sentences):
1. Is the code correct? Does it handle edge cases?
2. What's the time and space complexity?
3. Are there any bugs or improvements?
4. Overall assessment — good job / needs work

Be constructive and specific. If there are bugs, mention them clearly.
If the solution is good, praise the candidate.
Keep it conversational — this is a verbal review, not a written report.`;

  const response = await callGemini(prompt, state.messages);

  return {
    ...state,
    phase: "check_continue",
    messages: [
      ...state.messages,
      { role: "model", content: response },
    ],
    aiSpeechText: response,
    aiStatusText: "Review complete",
    shouldSpeak: true,
  };
}

/**
 * CHECK_CONTINUE node
 * ───────────────────
 * Pure logic — no Gemini call.
 * If enough time remains (AI-driven: ≥ 15 min), present a new question.
 * Otherwise, end the interview.
 */
export async function checkContinueNode(
  state: InterviewGraphState,
  _userInput: string
): Promise<InterviewGraphState> {
  // If ~15 minutes or more remain, there's time for another question
  const hasTimeForMore = state.timeRemainingSeconds >= 15 * 60;

  if (hasTimeForMore) {
    return {
      ...state,
      phase: "present_question",
      shouldFetchQuestion: true,
      aiSpeechText: "Great work on that one! Let's move on to another problem.",
      aiStatusText: "Preparing next question...",
      shouldSpeak: true,
      // Reset per-question state
      editorUnlocked: false,
      approachAttempts: 0,
      approachEval: null,
      currentQuestion: null,
      newQuestion: null,
    };
  }

  // Not enough time — transition to end
  return {
    ...state,
    phase: "end_interview",
    aiSpeechText: "",
    aiStatusText: "Wrapping up...",
    shouldSpeak: false,
  };
}

/**
 * END_INTERVIEW node
 * ──────────────────
 * AI gives final feedback and wraps up.
 */
export async function endInterviewNode(
  state: InterviewGraphState,
  _userInput: string
): Promise<InterviewGraphState> {
  const prompt = `You are a technical interviewer wrapping up a mock interview session.

Company: ${state.company || "a tech company"}
Questions attempted: ${state.questionsAsked}
Time used: approximately ${Math.round((state.timeRemainingSeconds > 0 ? (state.questionsAsked * 15) : 45))} minutes

Give a brief, encouraging wrap-up (3-4 sentences):
1. Thank the candidate for their time
2. Highlight what they did well
3. Mention 1-2 areas for improvement (based on the conversation)
4. Wish them luck

Be warm and professional. This is the last thing they'll hear.`;

  const response = await callGemini(prompt, state.messages);

  return {
    ...state,
    phase: "end_interview",
    messages: [...state.messages, { role: "model", content: response }],
    aiSpeechText: response,
    aiStatusText: "Interview complete",
    shouldSpeak: true,
    editorUnlocked: false,
  };
}
