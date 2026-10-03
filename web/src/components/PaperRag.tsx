import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Quote,
  Send,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  IngestResult,
  PaperAnswer,
  PaperCitation,
  PaperSection,
  PaperSummary,
  PaperThreadMessage,
} from "../types";
import { apiFetch } from "../lib/api";

interface PaperRagProps {
  onActivityAdded: (
    type: "chat" | "problem" | "calculator" | "quiz" | "image",
    desc: string,
  ) => void;
}

/** Matches the API's own cap. */
const MAX_PDF_BYTES = 15 * 1024 * 1024;

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: PaperCitation[];
  outcome?: "answered" | "refused_unsupported" | "error";
  /** Retrieval detail, shown on demand for the assistant's turns. */
  answer?: PaperAnswer;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(
        result.includes(",") ? result.slice(result.indexOf(",") + 1) : result,
      );
    };
    reader.readAsDataURL(file);
  });
}

function Citations({ citations }: { citations: PaperCitation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
        Sources in this paper
      </div>
      {citations.map((c, i) => (
        <div
          key={`${c.chunk_index}-${c.page}-${i}`}
          className="p-2.5 bg-slate-950/50 border border-slate-800 rounded-xl"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono font-semibold text-indigo-300 bg-indigo-500/10 border border-indigo-500/25 rounded px-1.5 py-0.5">
              p.{c.page}
            </span>
            {c.section && (
              <span className="text-[10px] font-mono text-slate-500">
                {c.section}
              </span>
            )}
          </div>
          {c.quote && (
            <p className="mt-1.5 text-[11px] text-slate-300 italic leading-relaxed">
              “{c.quote}”
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function RetrievalDetail({ answer }: { answer: PaperAnswer }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500 hover:text-slate-300"
      >
        {open ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        retrieval detail
      </button>
      {open && (
        <div className="mt-2 p-3 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2">
          <div className="text-[10px] font-mono text-slate-400">
            {answer.retrieval.hybrid
              ? "hybrid (vector + keyword)"
              : "vector only"}{" "}
            · top_k=
            {answer.retrieval.topK} · {answer.context.length} chunks ·{" "}
            {answer.model} · {(answer.duration_ms / 1000).toFixed(1)}s ·{" "}
            {answer.tokens_in ?? "?"}/{answer.tokens_out ?? "?"} tok
          </div>
          <div className="flex flex-wrap gap-1.5">
            {answer.context.map((c) => (
              <span
                key={c.chunk_index}
                className="text-[10px] font-mono text-slate-400 bg-slate-900/70 border border-slate-800 rounded px-1.5 py-0.5"
                title={c.section ?? undefined}
              >
                #{c.chunk_index} p.{c.page}
                {c.page_end !== c.page ? `-${c.page_end}` : ""} ·{" "}
                {c.score.toFixed(4)}
              </span>
            ))}
          </div>
          {answer.rejected_citations.length > 0 && (
            <div className="text-[10px] font-mono text-amber-300">
              {answer.rejected_citations.length} citation(s) failed verification
              and were dropped:{" "}
              {answer.rejected_citations.map((r) => r.reason).join("; ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PaperRag({ onActivityAdded }: PaperRagProps) {
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [loadingPapers, setLoadingPapers] = useState(true);
  const [selected, setSelected] = useState<PaperSummary | null>(null);
  const [sections, setSections] = useState<PaperSection[]>([]);

  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const loadPapers = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      try {
        const response = await apiFetch("/api/papers");
        if (isCancelled()) return;
        if (!response.ok)
          throw new Error(`Could not load papers (${response.status}).`);
        const data = (await response.json()) as { papers: PaperSummary[] };
        if (isCancelled()) return;
        setPapers(data.papers);
        setSelected(
          (current) =>
            current ?? data.papers.find((p) => p.status === "ready") ?? null,
        );
      } catch (err) {
        if (isCancelled()) return;
        setError(err instanceof Error ? err.message : "Could not load papers.");
      } finally {
        if (!isCancelled()) setLoadingPapers(false);
      }
    },
    [],
  );

  useEffect(() => {
    // Fetch on mount. The state writes happen after the await, so this is a
    // subscription to an external system rather than a synchronous cascade.
    let cancelled = false;
    void (async () => {
      await loadPapers(() => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPapers]);

  /** Load the paper's outline and existing conversation when it changes. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!selected) {
        if (!cancelled) {
          setSections([]);
          setTurns([]);
        }
        return;
      }
      try {
        const [detail, thread] = await Promise.all([
          apiFetch(`/api/papers/${selected.id}`),
          apiFetch(`/api/papers/${selected.id}/thread`),
        ]);
        if (cancelled) return;
        if (detail.ok) {
          const data = (await detail.json()) as { sections: PaperSection[] };
          setSections(data.sections);
        }
        if (thread.ok) {
          const data = (await thread.json()) as {
            messages: PaperThreadMessage[];
          };
          setTurns(
            data.messages.map((m, i) => ({
              id: `${m.created_at}-${i}`,
              role: m.role,
              content: m.content,
              citations: m.citations ?? [],
              outcome: m.outcome,
            })),
          );
        }
      } catch {
        /* a missing outline is not worth an error banner */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const upload = async (file: File) => {
    setError(null);
    setUploadNote(null);
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files can be ingested.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setError(
        `That PDF is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 15 MB.`,
      );
      return;
    }
    setUploading(true);
    try {
      const pdf_base64 = await fileToBase64(file);
      const response = await apiFetch("/api/papers", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, pdf_base64 }),
      });
      const data = (await response.json()) as IngestResult & { error?: string };
      if (!response.ok)
        throw new Error(data.error ?? `Upload failed (${response.status}).`);

      setUploadNote(
        data.deduplicated
          ? `Already ingested — reusing ${data.chunk_count} chunks.`
          : `Ingested ${data.page_count} pages into ${data.chunk_count} chunks across ${data.sections.length} sections.`,
      );
      await loadPapers();
      setSelected({
        id: data.paper_id,
        title: data.title,
        status: "ready",
        page_count: data.page_count,
        chunk_count: data.chunk_count,
        warnings: data.warnings,
        embedding_model: data.embedding_model,
        chunk_config: {},
        error: null,
        created_at: new Date().toISOString(),
      });
      setTurns([]);
      onActivityAdded("chat", `Ingested paper: ${data.title.substring(0, 36)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const ask = async () => {
    const text = question.trim();
    if (!text || asking || !selected) return;
    setQuestion("");
    setError(null);
    setTurns((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: text, citations: [] },
    ]);
    setAsking(true);
    try {
      const response = await apiFetch(`/api/papers/${selected.id}/ask`, {
        method: "POST",
        body: JSON.stringify({ question: text }),
      });
      const data = (await response.json()) as PaperAnswer & { error?: string };
      if (!response.ok)
        throw new Error(data.error ?? `Request failed (${response.status}).`);
      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: data.answer,
          citations: data.citations,
          outcome: data.outcome,
          answer: data,
        },
      ]);
      onActivityAdded("chat", `Asked "${text.substring(0, 28)}" of a paper`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The question could not be answered.",
      );
    } finally {
      setAsking(false);
    }
  };

  const remove = async (paper: PaperSummary) => {
    try {
      const response = await apiFetch(`/api/papers/${paper.id}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        throw new Error(`Could not delete that paper (${response.status}).`);
      }
      if (selected?.id === paper.id) setSelected(null);
      await loadPapers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 h-full">
      {/* Library */}
      <div className="flex flex-col gap-4 min-w-0">
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          className={`p-5 border-2 border-dashed rounded-2xl text-center transition-colors ${
            dragActive
              ? "border-indigo-500 bg-indigo-500/5"
              : "border-slate-800 bg-slate-900/40"
          }`}
        >
          <Upload className="w-5 h-5 text-indigo-400 mx-auto" />
          <p className="mt-2 text-xs text-slate-300">Drop a PDF, or</p>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="mt-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5"
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Extracting &
                embedding…
              </>
            ) : (
              <>choose a file</>
            )}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <p className="mt-2 text-[10px] font-mono text-slate-600">
            PDF with a text layer, ≤15 MB
          </p>
        </div>

        {uploadNote && (
          <div className="p-3 bg-emerald-500/5 border border-emerald-500/25 rounded-xl text-[11px] text-emerald-200">
            {uploadNote}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            Your papers
          </span>
          {loadingPapers ? (
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> loading…
            </div>
          ) : papers.length === 0 ? (
            <p className="text-[11px] text-slate-500 italic leading-relaxed">
              No papers yet. Upload one to start a cited conversation about it.
            </p>
          ) : (
            papers.map((paper) => {
              const active = selected?.id === paper.id;
              return (
                <div
                  key={paper.id}
                  className={`p-3 rounded-xl border transition-colors ${
                    active
                      ? "bg-indigo-500/10 border-indigo-500/40"
                      : "bg-slate-900/50 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => setSelected(paper)}
                      className="min-w-0 flex-1 text-left"
                      disabled={paper.status !== "ready"}
                    >
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <span className="text-xs text-slate-200 font-medium line-clamp-2">
                          {paper.title}
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] font-mono text-slate-500">
                        {paper.status === "ready"
                          ? `${paper.page_count ?? "?"} pages · ${paper.chunk_count ?? "?"} chunks`
                          : paper.status}
                      </div>
                      {paper.error && (
                        <div className="mt-1 text-[10px] text-rose-300">
                          {paper.error}
                        </div>
                      )}
                    </button>
                    <button
                      onClick={() => void remove(paper)}
                      title="Delete paper"
                      className="shrink-0 p-1 text-slate-600 hover:text-rose-300 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {selected && selected.warnings.length > 0 && (
          <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-amber-300">
              <AlertTriangle className="w-3 h-3" /> extraction notes
            </div>
            {selected.warnings.map((w, i) => (
              <div key={i} className="text-[11px] text-amber-200/90">
                {w}
              </div>
            ))}
          </div>
        )}

        {sections.length > 0 && (
          <div className="p-3 bg-slate-900/40 border border-slate-800 rounded-xl">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1.5">
              Sections detected ({sections.length})
            </div>
            <div className="max-h-44 overflow-y-auto space-y-0.5">
              {sections.map((s) => (
                <div
                  key={s.index}
                  className="text-[10.5px] text-slate-400 truncate"
                >
                  {s.path}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Conversation */}
      <div className="flex flex-col gap-4 min-w-0">
        <div className="p-5 bg-slate-900/60 border border-slate-800 rounded-2xl backdrop-blur-md">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-400" />
            <h3 className="font-display font-semibold text-white text-sm">
              {selected ? selected.title : "Paper Q&A"}
            </h3>
          </div>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed">
            Answers come only from the selected paper, with the page each claim
            is on. Every page number is checked against the retrieved text
            before it is shown — and when the paper does not contain the answer,
            you get a refusal rather than a guess.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/5 border border-rose-500/25 rounded-xl text-xs text-rose-200">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
          {!selected ? (
            <p className="text-xs text-slate-500 italic">
              Select or upload a paper to begin.
            </p>
          ) : turns.length === 0 ? (
            <p className="text-xs text-slate-500 italic">
              Ask anything about this paper — its methods, its numbers, its
              conclusions.
            </p>
          ) : (
            turns.map((turn) =>
              turn.role === "user" ? (
                <div key={turn.id} className="flex justify-end">
                  <div className="max-w-[85%] p-3 bg-indigo-600/20 border border-indigo-500/30 rounded-2xl rounded-br-sm">
                    <p className="text-xs text-slate-100 leading-relaxed">
                      {turn.content}
                    </p>
                  </div>
                </div>
              ) : (
                <div key={turn.id} className="flex justify-start">
                  <div
                    className={`max-w-[92%] p-3.5 rounded-2xl rounded-bl-sm border ${
                      turn.outcome === "refused_unsupported"
                        ? "bg-amber-500/5 border-amber-500/25"
                        : turn.outcome === "error"
                          ? "bg-rose-500/5 border-rose-500/25"
                          : "bg-slate-900/70 border-slate-800"
                    }`}
                  >
                    {turn.outcome === "refused_unsupported" && (
                      <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-mono uppercase tracking-wider text-amber-300">
                        <ShieldAlert className="w-3 h-3" /> not supported by
                        this paper
                      </div>
                    )}
                    {turn.outcome === "answered" && (
                      <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-300">
                        <Quote className="w-3 h-3" /> grounded in{" "}
                        {turn.citations.length} passage
                        {turn.citations.length === 1 ? "" : "s"}
                      </div>
                    )}
                    <p className="text-xs text-slate-100 leading-relaxed whitespace-pre-wrap">
                      {turn.content}
                    </p>
                    {turn.answer?.missing && (
                      <p className="mt-2 text-[11px] text-amber-200/90 leading-relaxed">
                        {turn.answer.missing}
                      </p>
                    )}
                    <Citations citations={turn.citations} />
                    {turn.answer && <RetrievalDetail answer={turn.answer} />}
                  </div>
                </div>
              ),
            )
          )}
          {asking && (
            <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> retrieving
              passages and composing a cited answer…
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask();
              }
            }}
            disabled={!selected || asking}
            maxLength={2000}
            placeholder={
              selected
                ? "Ask a question about this paper…"
                : "Select a paper first"
            }
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={() => void ask()}
            disabled={!selected || asking || !question.trim()}
            className="px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl inline-flex items-center justify-center"
            aria-label="Ask"
          >
            {asking ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
