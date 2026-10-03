export type AcademicLevel = "Bachelor" | "Master" | "PhD";

export interface ChatMessage {
  id: string;
  role: "user" | "model" | "system";
  text: string;
  timestamp: Date;
}

export interface PracticeProblem {
  id: string;
  problem: string;
  hint: string;
  formulas: string;
  solution: string;
  revealed?: boolean;
  userAnswer?: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

export interface QuizSession {
  topic: string;
  difficulty: string;
  questions: QuizQuestion[];
  currentIndex: number;
  selectedAnswers: { [key: number]: number };
  completed: boolean;
  score?: number;
  timestamp: Date;
}

export interface SavedNote {
  id: string;
  type: "concept" | "problem" | "mission" | "calculation";
  title: string;
  content: string;
  timestamp: Date;
}

export interface SpaceMission {
  name: string;
  objectives: string;
  orbit: string;
  challenges: string;
  discoveries: string;
  links: string;
}

export interface ResearchPaper {
  id: string;
  title: string;
  authors: string;
  abstract?: string;
  equations?: string;
  methodology?: string;
  findings?: string;
  contentSnippet: string;
}

export interface GeneratedImage {
  id: string;
  prompt: string;
  imageUrl: string;
  model: string;
  size: string;
  aspectRatio: string;
  info?: string;
  timestamp: Date;
}

export interface StudentStats {
  queriesRun: number;
  problemsSolved: number;
  calculatorsUsed: number;
  quizzesTaken: number;
  avgQuizScore: number;
  topicsExplored: string[];
  recentActivity: {
    id: string;
    type: "chat" | "problem" | "calculator" | "quiz" | "image";
    description: string;
    timestamp: Date;
  }[];
}

// ---------- Agent (Week 4) ----------
// Mirrors the server's answer contract in api/src/agent/contract.ts. Kept in
// sync by hand: the packages do not share a types package (ADR-001), so a
// change on either side has to be made on both.

export interface AgentStep {
  step: number;
  description: string;
  formula?: string;
  substitution?: string;
  result?: string;
  tool?: string;
}

export interface AgentCitation {
  tool: string;
  source: string;
  detail: string;
}

export interface AgentQuantity {
  quantity: string;
  value: number;
  unit: string;
}

export type AgentStatus =
  "answered" | "insufficient_data" | "refused" | "rejected" | "error";

export interface AgentAnswer {
  status: "answered" | "insufficient_data" | "refused";
  steps: AgentStep[];
  formulas: string[];
  citations: AgentCitation[];
  quantities: AgentQuantity[];
  final_answer: string;
  caveats?: string[];
}

export interface AgentPlan {
  in_domain: boolean;
  domain_reason: string;
  restated_problem: string;
  steps: string[];
  tools_expected: string[];
  missing_information: string[];
}

export type AgentTraceEntry =
  | { type: "guardrail"; name: string; detail: string; at: string }
  | {
      type: "plan";
      model: string;
      prompt_version: string;
      plan: AgentPlan;
      duration_ms: number;
      tokens_in: number | null;
      tokens_out: number | null;
      at: string;
    }
  | {
      type: "tool_round";
      iteration: number;
      model: string;
      duration_ms: number;
      tokens_in: number | null;
      tokens_out: number | null;
      calls_requested: number;
      at: string;
    }
  | {
      type: "tool_call";
      iteration: number;
      tool: string;
      raw_args: Record<string, unknown>;
      validated_args?: unknown;
      coercions?: string[];
      ok: boolean;
      result?: unknown;
      error?: string;
      error_kind?: string;
      attempts: number;
      duration_ms: number;
      at: string;
    }
  | {
      type: "synthesis";
      model: string;
      prompt_version: string;
      duration_ms: number;
      tokens_in: number | null;
      tokens_out: number | null;
      ungrounded_values: number[];
      at: string;
    };

export interface AgentMeta {
  model: string;
  prompt_version: string;
  iterations: number;
  tool_calls: number;
  tool_failures: number;
  duration_ms: number;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  guardrails_triggered: string[];
}

export interface AgentResult {
  request_id: string;
  status: AgentStatus;
  answer: AgentAnswer;
  plan: AgentPlan | null;
  trace: AgentTraceEntry[];
  meta: AgentMeta;
}

// ---------- Paper RAG (Week 5) ----------
// Mirrors api/src/rag/{pipeline,answer}.ts. Kept in sync by hand (ADR-001: the
// packages do not share a types package).

export interface PaperSummary {
  id: string;
  title: string;
  status: "uploaded" | "processing" | "ready" | "failed";
  page_count: number | null;
  chunk_count: number | null;
  warnings: string[];
  embedding_model: string | null;
  chunk_config: Record<string, number>;
  error: string | null;
  created_at: string;
}

export interface PaperSection {
  index: number;
  path: string;
}

export interface IngestResult {
  paper_id: string;
  title: string;
  status: "ready";
  page_count: number;
  pages_ingested: number;
  chunk_count: number;
  sections: PaperSection[];
  stats: Record<string, number>;
  warnings: string[];
  embedding_model: string;
  deduplicated: boolean;
}

export interface PaperCitation {
  chunk_index: number;
  page: number;
  quote: string;
  section: string | null;
}

export type PaperOutcome = "answered" | "refused_unsupported" | "error";

export interface PaperAnswer {
  outcome: PaperOutcome;
  answer: string;
  citations: PaperCitation[];
  missing: string | null;
  context: {
    chunk_index: number;
    page: number;
    page_end: number;
    section: string | null;
    score: number;
  }[];
  rejected_citations: { chunk_index: number; page: number; reason: string }[];
  model: string;
  prompt_version: string;
  duration_ms: number;
  tokens_in: number | null;
  tokens_out: number | null;
  paper_id: string;
  thread_id: string;
  question: string;
  retrieval: { topK: number; hybrid: boolean; candidates: number };
}

export interface PaperThreadMessage {
  role: "user" | "assistant";
  content: string;
  citations: PaperCitation[];
  outcome: PaperOutcome;
  created_at: string;
}
