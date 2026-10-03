import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Loader2,
  Quote,
  Save,
  ShieldAlert,
  Sigma,
  Wrench,
  XCircle,
} from "lucide-react";
import type { AgentResult, AgentStatus, AgentTraceEntry } from "../types";
import { apiFetch } from "../lib/api";

interface AgentSolverProps {
  onActivityAdded: (
    type: "chat" | "problem" | "calculator" | "quiz" | "image",
    desc: string,
  ) => void;
  onSaveNote: (note: {
    type: "concept" | "problem" | "mission" | "calculation";
    title: string;
    content: string;
  }) => void;
}

const EXAMPLES = [
  "Calculate the orbital period of a satellite at 400 km and tell me when the ISS next passes over Toronto",
  "How much delta-v does a Hohmann transfer from a 300 km parking orbit to GEO need, and how long does it take?",
  "What is today's NASA picture of the day, and how close is the nearest asteroid this week?",
  "What is the escape velocity at the surface of the Earth compared with the orbital velocity at 400 km?",
];

const STATUS_STYLE: Record<
  AgentStatus,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  answered: {
    label: "Answered",
    className: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
    Icon: CheckCircle2,
  },
  insufficient_data: {
    label: "Insufficient data",
    className: "bg-amber-500/10 border-amber-500/30 text-amber-300",
    Icon: AlertTriangle,
  },
  refused: {
    label: "Refused — out of domain",
    className: "bg-slate-500/10 border-slate-500/30 text-slate-300",
    Icon: ShieldAlert,
  },
  rejected: {
    label: "Rejected",
    className: "bg-rose-500/10 border-rose-500/30 text-rose-300",
    Icon: XCircle,
  },
  error: {
    label: "Error",
    className: "bg-rose-500/10 border-rose-500/30 text-rose-300",
    Icon: XCircle,
  },
};

function Section({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string;
  icon: typeof Cpu;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl backdrop-blur-md overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-5 py-3.5 text-left hover:bg-slate-900/80 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-500" />
        )}
        <Icon className="w-4 h-4 text-indigo-400" />
        <span className="font-display font-semibold text-white text-sm">
          {title}
        </span>
        {badge && (
          <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-slate-400 bg-slate-950/60 border border-slate-800 rounded-full px-2.5 py-1">
            {badge}
          </span>
        )}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

/** One trace entry, rendered so a reader can follow the agent's reasoning. */
function TraceRow({ entry }: { entry: AgentTraceEntry }) {
  const [open, setOpen] = useState(false);

  if (entry.type === "guardrail") {
    return (
      <div className="flex items-start gap-2.5 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="text-xs font-mono text-amber-300">{entry.name}</div>
          <div className="text-xs text-slate-400 mt-1 break-words">
            {entry.detail}
          </div>
        </div>
      </div>
    );
  }

  if (entry.type === "tool_call") {
    return (
      <div
        className={`border rounded-xl ${
          entry.ok
            ? "bg-slate-950/40 border-slate-800"
            : "bg-rose-500/5 border-rose-500/25"
        }`}
      >
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-start gap-2.5 p-3 text-left"
        >
          <Wrench
            className={`w-4 h-4 shrink-0 mt-0.5 ${entry.ok ? "text-indigo-400" : "text-rose-400"}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono font-semibold text-slate-200">
                {entry.tool}
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                round {entry.iteration} · {entry.duration_ms} ms ·{" "}
                {entry.attempts} attempt
                {entry.attempts === 1 ? "" : "s"}
              </span>
              {!entry.ok && (
                <span className="text-[10px] font-mono text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded px-1.5 py-0.5">
                  {entry.error_kind}
                </span>
              )}
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-1 break-all">
              {JSON.stringify(entry.raw_args)}
            </div>
            {entry.error && (
              <div className="text-[11px] text-rose-300 mt-1 break-words">
                {entry.error}
              </div>
            )}
          </div>
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-600 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
          )}
        </button>
        {open && (
          <div className="px-3 pb-3 space-y-2">
            {entry.coercions && entry.coercions.length > 0 && (
              <div className="text-[11px] font-mono text-amber-300 bg-amber-500/5 border border-amber-500/20 rounded-lg p-2">
                argument repairs: {entry.coercions.join("; ")}
              </div>
            )}
            <pre className="text-[10.5px] font-mono text-slate-300 bg-slate-950/70 border border-slate-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(entry.ok ? entry.result : entry.error, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  const label =
    entry.type === "plan"
      ? "planning call"
      : entry.type === "synthesis"
        ? "synthesis call"
        : `tool round ${entry.iteration} — requested ${entry.calls_requested} call(s)`;

  return (
    <div className="flex items-center gap-2.5 p-3 bg-slate-950/40 border border-slate-800 rounded-xl">
      <Cpu className="w-4 h-4 text-slate-500 shrink-0" />
      <span className="text-xs text-slate-300">{label}</span>
      <span className="ml-auto text-[10px] font-mono text-slate-500 shrink-0">
        {entry.duration_ms} ms · {entry.tokens_in ?? "?"}/
        {entry.tokens_out ?? "?"} tok
      </span>
    </div>
  );
}

export default function AgentSolver({
  onActivityAdded,
  onSaveNote,
}: AgentSolverProps) {
  const [problem, setProblem] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const solve = async (text: string) => {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await apiFetch("/api/agent/solve", {
        method: "POST",
        body: JSON.stringify({ problem: text }),
      });
      const data = (await response.json()) as AgentResult & { error?: string };
      if (!response.ok && data.error) throw new Error(data.error);
      setResult(data);
      onActivityAdded("problem", `Agent solved: ${text.substring(0, 32)}...`);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "The agent could not be reached.",
      );
    } finally {
      setLoading(false);
    }
  };

  const saveAnswer = () => {
    if (!result) return;
    onSaveNote({
      type: "problem",
      title: `Agent: ${problem.substring(0, 34)}...`,
      content: [
        `Question: ${problem}`,
        "",
        "Steps:",
        ...result.answer.steps.map(
          (s) =>
            `  ${s.step}. ${s.description}${s.formula ? `\n     ${s.formula}` : ""}${s.result ? `\n     = ${s.result}` : ""}`,
        ),
        "",
        `Answer: ${result.answer.final_answer}`,
        "",
        "Sources:",
        ...result.answer.citations.map(
          (c) => `  [${c.tool}] ${c.source} — ${c.detail}`,
        ),
      ].join("\n"),
    });
  };

  const status = result ? STATUS_STYLE[result.status] : null;

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      {/* Input */}
      <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col gap-5 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-indigo-400" />
          <h3 className="font-display font-semibold text-white">
            Agent Solver
          </h3>
          <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-slate-500">
            plan → tools → synthesis
          </span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Every number comes from the deterministic physics engine, live NASA
          APIs, or SGP4 propagation of the current ISS TLE — never from the
          model. The full tool trace is shown below the answer.
        </p>

        <textarea
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
              void solve(problem);
          }}
          rows={3}
          maxLength={4000}
          placeholder="Ask a space-physics question…  (⌘/Ctrl + Enter to run)"
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-3 text-sm text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none resize-y"
        />

        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setProblem(ex)}
              disabled={loading}
              className="text-[11px] text-slate-400 hover:text-slate-200 bg-slate-950/60 hover:bg-slate-950 border border-slate-800 rounded-full px-3 py-1.5 transition-colors disabled:opacity-40 text-left"
            >
              {ex.length > 64 ? `${ex.slice(0, 64)}…` : ex}
            </button>
          ))}
        </div>

        <button
          onClick={() => void solve(problem)}
          disabled={loading || !problem.trim()}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/10"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Planning, calling
              tools, synthesising…
            </>
          ) : (
            <>
              <Bot className="w-4 h-4" /> Run the agent
            </>
          )}
        </button>

        {loading && (
          <p className="text-[11px] text-slate-500 text-center font-mono">
            Three model calls plus tools — this typically takes 30–120 s.
          </p>
        )}
      </div>

      {error && (
        <div className="p-4 bg-rose-500/5 border border-rose-500/25 rounded-2xl flex items-start gap-2.5">
          <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span className="text-xs text-rose-200">{error}</span>
        </div>
      )}

      {result && status && (
        <>
          {/* Answer */}
          <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col gap-5 backdrop-blur-md">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider border rounded-full px-2.5 py-1 ${status.className}`}
              >
                <status.Icon className="w-3.5 h-3.5" />
                {status.label}
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                {result.meta.tool_calls} tool call(s) · {result.meta.iterations}{" "}
                round(s) · {(result.meta.duration_ms / 1000).toFixed(1)} s
              </span>
              <button
                onClick={saveAnswer}
                className="ml-auto p-1.5 hover:bg-slate-950 text-slate-400 hover:text-white rounded border border-slate-800 transition-all text-xs flex items-center gap-1 font-mono"
                title="Bookmark this answer"
              >
                <Save className="w-3.5 h-3.5" /> Save
              </button>
            </div>

            <p className="text-sm text-slate-100 leading-relaxed">
              {result.answer.final_answer}
            </p>

            {result.answer.quantities.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {result.answer.quantities.map((q, i) => (
                  <div
                    key={`${q.quantity}-${i}`}
                    className="p-3 bg-slate-950/50 border border-slate-800 rounded-xl"
                  >
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                      {q.quantity}
                    </div>
                    <div className="text-sm text-white font-semibold mt-0.5">
                      {q.value}{" "}
                      <span className="text-indigo-300 font-normal">
                        {q.unit}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {result.answer.caveats && result.answer.caveats.length > 0 && (
              <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl space-y-1.5">
                {result.answer.caveats.map((c, i) => (
                  <div
                    key={i}
                    className="text-[11px] text-amber-200/90 leading-relaxed"
                  >
                    ⚠ {c}
                  </div>
                ))}
              </div>
            )}
          </div>

          {result.answer.steps.length > 0 && (
            <Section
              title="Steps"
              icon={Sigma}
              badge={`${result.answer.steps.length} steps`}
            >
              <ol className="space-y-3">
                {result.answer.steps.map((s) => (
                  <li
                    key={s.step}
                    className="p-3.5 bg-slate-950/40 border border-slate-800 rounded-xl"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="shrink-0 w-5 h-5 rounded-md bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 text-[10px] font-mono font-bold flex items-center justify-center">
                        {s.step}
                      </span>
                      <div className="min-w-0 space-y-1.5">
                        <div className="text-xs text-slate-200 leading-relaxed">
                          {s.description}
                        </div>
                        {s.formula && (
                          <div className="text-xs font-mono text-indigo-300 bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-1.5 inline-block">
                            {s.formula}
                          </div>
                        )}
                        {s.substitution && (
                          <div className="text-[11px] font-mono text-slate-400">
                            {s.substitution}
                          </div>
                        )}
                        {s.result && (
                          <div className="text-[11px] font-mono text-emerald-300">
                            = {s.result}
                          </div>
                        )}
                        {s.tool && (
                          <div className="text-[10px] font-mono text-slate-500">
                            via {s.tool}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              {result.answer.formulas.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-800">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-2">
                    Formulas used
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {result.answer.formulas.map((f, i) => (
                      <code
                        key={i}
                        className="text-xs font-mono text-indigo-300 bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-1.5"
                      >
                        {f}
                      </code>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {result.answer.citations.length > 0 && (
            <Section
              title="Citations"
              icon={Quote}
              badge={`${result.answer.citations.length} sources`}
            >
              <ul className="space-y-2">
                {result.answer.citations.map((c, i) => (
                  <li
                    key={i}
                    className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl"
                  >
                    <div className="text-[10px] font-mono text-indigo-300">
                      {c.tool}
                    </div>
                    <div className="text-xs text-slate-300 mt-1">
                      {c.source}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 mt-1 break-words">
                      {c.detail}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {result.plan && (
            <Section
              title="Plan"
              icon={Cpu}
              defaultOpen={false}
              badge={result.plan.in_domain ? "in domain" : "out of domain"}
            >
              <p className="text-xs text-slate-400 leading-relaxed">
                {result.plan.domain_reason}
              </p>
              {result.plan.restated_problem && (
                <p className="text-xs text-slate-300 mt-3 leading-relaxed">
                  <span className="text-slate-500 font-mono text-[10px] uppercase tracking-wider">
                    Restated:{" "}
                  </span>
                  {result.plan.restated_problem}
                </p>
              )}
              {result.plan.steps.length > 0 && (
                <ol className="mt-3 space-y-1.5 list-decimal list-inside">
                  {result.plan.steps.map((s, i) => (
                    <li
                      key={i}
                      className="text-xs text-slate-400 leading-relaxed"
                    >
                      {s}
                    </li>
                  ))}
                </ol>
              )}
              {result.plan.missing_information.length > 0 && (
                <div className="mt-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-amber-300 mb-1">
                    Missing information
                  </div>
                  {result.plan.missing_information.map((m, i) => (
                    <div key={i} className="text-[11px] text-amber-200/90">
                      • {m}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          <Section
            title="Agent trace"
            icon={Wrench}
            defaultOpen={false}
            badge={`${result.trace.length} entries`}
          >
            <div className="space-y-2">
              {result.trace.map((entry, i) => (
                <TraceRow key={i} entry={entry} />
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono">
              {[
                ["model", result.meta.model],
                ["prompt", result.meta.prompt_version],
                [
                  "tokens in/out",
                  `${result.meta.tokens_in ?? "?"}/${result.meta.tokens_out ?? "?"}`,
                ],
                ["tool failures", String(result.meta.tool_failures)],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="p-2 bg-slate-950/50 border border-slate-800 rounded-lg"
                >
                  <div className="text-slate-500 uppercase tracking-wider">
                    {k}
                  </div>
                  <div className="text-slate-200 mt-0.5 break-all">{v}</div>
                </div>
              ))}
            </div>
            {result.meta.guardrails_triggered.length > 0 && (
              <div className="mt-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                <div className="text-[10px] font-mono uppercase tracking-wider text-amber-300 mb-1">
                  Guardrails triggered
                </div>
                <div className="text-[11px] font-mono text-amber-200/90 break-all">
                  {result.meta.guardrails_triggered.join(", ")}
                </div>
              </div>
            )}
            <div className="mt-2 text-[10px] font-mono text-slate-600">
              request_id: {result.request_id}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
