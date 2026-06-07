/**
 * interview-graph.ts
 * ──────────────────
 * LangGraph-style state machine for the interview agent.
 * Defines nodes, edges, and conditional routing.
 *
 * Usage:
 *   const graph = createInterviewGraph();
 *   const newState = await graph.step(currentState, userInput);
 */

import type { InterviewGraphState, InterviewPhase } from "./graph-state";
import {
  introductionNode,
  presentQuestionNode,
  evaluateApproachNode,
  codingNode,
  reviewSolutionNode,
  checkContinueNode,
  endInterviewNode,
} from "./graph-nodes";

/* ── Types ─────────────────────────────────────────────────────────── */

/** A node handler: takes state + user input → returns updated state */
type NodeHandler = (
  state: InterviewGraphState,
  userInput: string
) => Promise<InterviewGraphState>;

/** A conditional edge router: inspects state and returns the next phase */
type EdgeRouter = (state: InterviewGraphState) => InterviewPhase;

interface NodeDefinition {
  handler: NodeHandler;
}

interface EdgeDefinition {
  /** Fixed target phase (for unconditional edges) */
  target?: InterviewPhase;
  /** Conditional routing function (takes priority over `target` if set) */
  router?: EdgeRouter;
}

/* ── Graph class ───────────────────────────────────────────────────── */

export class InterviewGraph {
  private nodes = new Map<InterviewPhase, NodeDefinition>();
  private edges = new Map<InterviewPhase, EdgeDefinition>();

  /** Register a graph node */
  addNode(phase: InterviewPhase, handler: NodeHandler): this {
    this.nodes.set(phase, { handler });
    return this;
  }

  /** Register a fixed edge: from → to */
  addEdge(from: InterviewPhase, to: InterviewPhase): this {
    this.edges.set(from, { target: to });
    return this;
  }

  /** Register a conditional edge: from → router decides */
  addConditionalEdge(from: InterviewPhase, router: EdgeRouter): this {
    this.edges.set(from, { router });
    return this;
  }

  /**
   * Execute one step of the graph.
   *
   * 1. Look up the node handler for `state.phase`
   * 2. Execute it → get updated state
   * 3. The node itself sets the next `phase` on the state
   *
   * Some nodes (like check_continue, present_question) are "pass-through" —
   * they run automatically without needing user input. The graph will
   * chain them together in a single step call.
   */
  async step(
    state: InterviewGraphState,
    userInput: string
  ): Promise<InterviewGraphState> {
    const MAX_CHAIN = 5; // Safety limit to prevent infinite loops
    let current = { ...state };
    let chainCount = 0;

    // Run the current node
    const node = this.nodes.get(current.phase);
    if (!node) {
      throw new Error(`No handler registered for phase: ${current.phase}`);
    }

    current = await node.handler(current, userInput);

    // Auto-chain pass-through nodes (nodes that don't need user input)
    const autoChainPhases: Set<InterviewPhase> = new Set([
      "present_question",
      "check_continue",
      "end_interview",
    ]);

    while (autoChainPhases.has(current.phase) && chainCount < MAX_CHAIN) {
      // But don't auto-chain if we just ran this phase (the node already set the phase)
      // Only auto-chain if the PREVIOUS node transitioned us here
      const nextNode = this.nodes.get(current.phase);
      if (!nextNode) break;

      // For present_question: only auto-chain if the question has already been set
      // (the route layer fetches the question between present_question and evaluate_approach)
      if (current.phase === "present_question" && current.shouldFetchQuestion) {
        // Stop here — the route needs to fetch the question first
        break;
      }

      // For check_continue and end_interview: auto-run
      const prevPhase = current.phase;
      current = await nextNode.handler(current, "");
      chainCount++;

      // If the phase didn't change, stop to prevent infinite loops
      if (current.phase === prevPhase) break;
    }

    return current;
  }
}

/* ── Factory: creates a wired-up interview graph ──────────────────── */

export function createInterviewGraph(): InterviewGraph {
  const graph = new InterviewGraph();

  // Register all nodes
  graph.addNode("introduction", introductionNode);
  graph.addNode("present_question", presentQuestionNode);
  graph.addNode("evaluate_approach", evaluateApproachNode);
  graph.addNode("coding", codingNode);
  graph.addNode("review_solution", reviewSolutionNode);
  graph.addNode("check_continue", checkContinueNode);
  graph.addNode("end_interview", endInterviewNode);

  /*
   * Edge definitions (for documentation / future expansion).
   * Currently, nodes handle their own transitions by setting `state.phase`.
   * These edges document the valid transitions:
   *
   * introduction → present_question
   * present_question → evaluate_approach
   * evaluate_approach → coding (if correct + optimal, or max attempts)
   * evaluate_approach → evaluate_approach (if wrong, loop with hint)
   * coding → review_solution (when user says done)
   * coding → coding (when user asks questions during coding)
   * review_solution → check_continue
   * check_continue → present_question (if time ≥ 15 min)
   * check_continue → end_interview (if time < 15 min)
   * end_interview → END
   */

  return graph;
}
