import React, { useState, useRef, useEffect } from "react";
import {
  Send,
  Sparkles,
  Copy,
  Check,
  RotateCcw,
  Brain,
  BookOpen,
  GraduationCap,
  ChevronRight,
} from "lucide-react";
import { ChatMessage, AcademicLevel } from "../types";
import { API_URL } from "../lib/api";

interface ConceptExplainerProps {
  degreeLevel: AcademicLevel;
  setDegreeLevel: (level: AcademicLevel) => void;
  onActivityAdded: (
    type: "chat" | "problem" | "calculator" | "quiz" | "image",
    desc: string,
  ) => void;
}

const PRESET_TOPICS = [
  {
    title: "Kepler's Laws of Planetary Motion",
    query:
      "Explain Kepler's Three Laws of Planetary Motion with their respective mathematical equations and derivation.",
  },
  {
    title: "Tsiolkovsky Rocket Equation",
    query:
      "Explain the Tsiolkovsky Rocket Equation, its derivation, and how Delta-v relates to structural mass and exhaust velocity.",
  },
  {
    title: "Hohmann Transfer Trajectories",
    query:
      "What is a Hohmann Transfer? Explain the double-impulse burn sequence and how we calculate the total delta-V requirement.",
  },
  {
    title: "Lagrange Equilibrium Points",
    query:
      "Explain the physics of Lagrange points (L1 through L5) for the Sun-Earth-Moon system. Why is L2 ideal for space telescopes?",
  },
];

export default function ConceptExplainer({
  degreeLevel,
  setDegreeLevel,
  onActivityAdded,
}: ConceptExplainerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "model",
      text: "Greetings, Commander! I am AstroAI, your specialized orbital mechanics and space engineering academic tutor. Ask me any question about astrophysics, spacecraft design, launch trajectories, or satellite constellations.",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [explainSimply, setExplainSimply] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (textToSend?: string) => {
    const queryText = textToSend || input;
    if (!queryText.trim() || loading) return;

    if (!textToSend) setInput("");

    const userMessage: ChatMessage = {
      // eslint-disable-next-line react-hooks/purity -- inside event handler, not render
      id: Date.now().toString(),
      role: "user",
      text: queryText,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: queryText,
          history: messages
            .slice(-10)
            .map((m) => ({ role: m.role, text: m.text })),
          degreeLevel,
          explainSimply,
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "model",
          text: data.text,
          timestamp: new Date(),
        },
      ]);

      onActivityAdded("chat", `Asked: "${queryText.substring(0, 30)}..."`);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to reach AstroAI backend. Please check your Gemini credentials.";
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "model",
          text: `⚠️ **System Error**: ${message}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleReset = () => {
    setMessages([
      {
        id: "welcome",
        role: "model",
        text: "System Reset. Ready for new space science queries, Commander. Specify academic level and ask away!",
        timestamp: new Date(),
      },
    ]);
  };

  // Basic LaTeX highlighting wrapper to render block and inline equations cleanly
  const renderFormattedText = (text: string) => {
    // Splits by block math ($$...$$) first, then inline math ($...$)
    const blocks = text.split(/(\$\$.*?\$\$)/gs);
    return blocks.map((block, idx) => {
      if (block.startsWith("$$") && block.endsWith("$$")) {
        const eq = block.slice(2, -2);
        return (
          <div
            key={idx}
            className="my-3 p-3 bg-slate-900/80 border border-emerald-500/30 rounded-lg font-mono text-emerald-400 overflow-x-auto text-center shadow-inner"
          >
            {eq}
          </div>
        );
      }

      const inlines = block.split(/(\$.*?\$)/g);
      return (
        <span key={idx}>
          {inlines.map((sub, sIdx) => {
            if (sub.startsWith("$") && sub.endsWith("$")) {
              const eq = sub.slice(1, -1);
              return (
                <code
                  key={sIdx}
                  className="px-1.5 py-0.5 mx-0.5 bg-slate-900 border border-cyan-500/20 text-cyan-400 rounded font-mono text-sm"
                >
                  {eq}
                </code>
              );
            }
            return sub;
          })}
        </span>
      );
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] bg-slate-950/60 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-md">
      {/* Header Panel */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/70 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-display font-semibold text-lg text-white">
              Academic Concept Explainer
            </h2>
            <p className="text-xs text-slate-400">
              Conversational STEM tutor for advanced space engineering topics
            </p>
          </div>
        </div>

        {/* Configuration Row */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Academic Level */}
          <div className="flex items-center bg-slate-950/80 border border-slate-800 rounded-lg p-1">
            {(["Bachelor", "Master", "PhD"] as AcademicLevel[]).map((level) => (
              <button
                key={level}
                onClick={() => setDegreeLevel(level)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
                  degreeLevel === level
                    ? "bg-indigo-600 text-white shadow-md"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {level}
              </button>
            ))}
          </div>

          {/* Simplicity Mode Toggle */}
          <button
            onClick={() => setExplainSimply(!explainSimply)}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium border transition-all flex items-center gap-1.5 ${
              explainSimply
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300"
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            {explainSimply ? "Simply Analogy Mode" : "Strict Rigorous Mode"}
          </button>

          {/* Reset */}
          <button
            onClick={handleReset}
            title="Reset Chat History"
            className="p-1.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-lg transition-all"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Preset Topics Column - Desktop only */}
        <div className="hidden lg:flex flex-col w-72 border-r border-slate-800 bg-slate-950/40 p-4 overflow-y-auto">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4 text-indigo-400" />
            <h3 className="font-display font-medium text-xs text-indigo-300 uppercase tracking-wider">
              Quick Lesson Topics
            </h3>
          </div>
          <div className="space-y-2.5">
            {PRESET_TOPICS.map((topic, idx) => (
              <button
                key={idx}
                disabled={loading}
                onClick={() => handleSend(topic.query)}
                className="w-full text-left p-3 rounded-xl bg-slate-900/40 hover:bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all duration-200 text-xs text-slate-300 group disabled:opacity-50"
              >
                <div className="flex items-start gap-2">
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 mt-0.5 shrink-0 transition-colors" />
                  <span className="font-medium group-hover:text-white transition-colors">
                    {topic.title}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Chat Feed */}
        <div className="flex-1 flex flex-col bg-slate-950/20">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-4 max-w-4xl ${msg.role === "user" ? "ml-auto justify-end" : "mr-auto"}`}
              >
                {msg.role !== "user" && (
                  <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
                  </div>
                )}

                <div
                  className={`relative p-4 rounded-2xl border transition-all ${
                    msg.role === "user"
                      ? "bg-indigo-600/10 border-indigo-500/30 text-indigo-100 rounded-tr-none"
                      : "bg-slate-900/60 border-slate-800/80 text-slate-300 rounded-tl-none"
                  }`}
                >
                  <p className="text-xs font-mono text-slate-500 mb-1">
                    {msg.role === "user" ? "Student" : "AstroAI Tutor"} •{" "}
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>

                  <div className="whitespace-pre-wrap leading-relaxed text-sm">
                    {renderFormattedText(msg.text)}
                  </div>

                  {msg.role !== "user" && (
                    <button
                      onClick={() => copyToClipboard(msg.text, msg.id)}
                      className="absolute top-3 right-3 p-1.5 bg-slate-950/80 hover:bg-slate-900 border border-slate-800 rounded text-slate-400 hover:text-slate-200 transition-all opacity-0 group-hover:opacity-100 md:opacity-100"
                      title="Copy formula / text"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>

                {msg.role === "user" && (
                  <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
                    <span className="text-xs font-semibold text-indigo-300">
                      {degreeLevel[0]}
                    </span>
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex gap-4 max-w-lg mr-auto">
                <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
                </div>
                <div className="p-4 bg-slate-900/60 border border-slate-800/80 rounded-2xl rounded-tl-none">
                  <div className="flex items-center gap-1">
                    <span
                      className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    />
                    <span
                      className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    />
                    <span
                      className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1 font-mono">
                    Synthesizing textbook equations...
                  </p>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Box */}
          <div className="p-4 border-t border-slate-800 bg-slate-950/50">
            <div className="flex gap-3 max-w-5xl mx-auto">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
                disabled={loading}
                placeholder="Ask about orbital parameters, launch vehicles, orbital decay, specific impulse..."
                className="flex-1 bg-slate-950 hover:bg-slate-900 focus:bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-all"
              />
              <button
                onClick={() => handleSend()}
                disabled={loading || !input.trim()}
                className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-medium transition-all flex items-center gap-2 shadow-lg shadow-indigo-600/10 shrink-0"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">Transmit</span>
              </button>
            </div>
            <p className="text-center text-[10px] text-slate-500 mt-2 font-mono uppercase tracking-wider">
              AstroAI STEM Core • Response tailored for {degreeLevel} students
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
