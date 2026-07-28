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
import { apiFetch } from "../lib/api";

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

const eyebrow: React.CSSProperties = {
  fontFamily: "'Space Mono', ui-monospace, monospace",
  fontSize: 10.5,
  letterSpacing: "0.24em",
  textTransform: "uppercase",
  color: "#9aa0bd",
};

const iconChip: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 12,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  background:
    "linear-gradient(135deg, rgba(139,108,255,.25), rgba(94,242,168,.14))",
  border: "1px solid rgba(139,108,255,.35)",
  color: "#c9baff",
};

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
      const response = await apiFetch(`/api/chat`, {
        method: "POST",
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

  // LaTeX-lite: block $$...$$ → glass mono block, inline $...$ → violet chip
  const renderFormattedText = (text: string) => {
    const blocks = text.split(/(\$\$.*?\$\$)/gs);
    return blocks.map((block, idx) => {
      if (block.startsWith("$$") && block.endsWith("$$")) {
        const eq = block.slice(2, -2);
        return (
          <div
            key={idx}
            style={{
              margin: "12px 0",
              padding: "12px 14px",
              background: "rgba(3,5,14,.6)",
              border: "1px solid rgba(94,242,168,.28)",
              borderRadius: 12,
              fontFamily: "'Space Mono', ui-monospace, monospace",
              fontSize: 13,
              color: "#5ef2a8",
              textAlign: "center",
              overflowX: "auto",
            }}
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
                  style={{
                    padding: "2px 6px",
                    margin: "0 2px",
                    background: "rgba(139,108,255,.1)",
                    border: "1px solid rgba(139,108,255,.3)",
                    color: "#c9baff",
                    borderRadius: 6,
                    fontFamily: "'Space Mono', ui-monospace, monospace",
                    fontSize: 12.5,
                  }}
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 10rem)",
        borderRadius: 22,
        overflow: "hidden",
        background:
          "linear-gradient(180deg, rgba(14,17,34,.72), rgba(8,10,22,.8))",
        border: "1px solid rgba(139,108,255,.2)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow:
          "0 30px 90px rgba(2,3,10,.5), 0 0 60px rgba(139,108,255,.08)",
      }}
    >
      {/* Panel header */}
      <div
        style={{
          padding: "18px 22px",
          borderBottom: "1px solid rgba(139,108,255,.16)",
          background: "rgba(6,8,18,.5)",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            minWidth: 0,
          }}
        >
          <div style={iconChip}>
            <GraduationCap size={22} />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              minWidth: 0,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontFamily: "'Archivo Expanded', 'Archivo', sans-serif",
                fontWeight: 800,
                fontSize: 17,
                color: "#eef0fb",
                letterSpacing: "0.04em",
              }}
            >
              Academic Concept Explainer
            </h2>
            <span style={eyebrow}>
              Conversational STEM tutor · orbital mechanics
            </span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
          }}
        >
          {/* Segmented academic level */}
          <div
            role="group"
            aria-label="Academic level"
            style={{
              display: "inline-flex",
              padding: 3,
              borderRadius: 100,
              background: "rgba(3,5,14,.5)",
              border: "1px solid rgba(255,255,255,.14)",
            }}
          >
            {(["Bachelor", "Master", "PhD"] as AcademicLevel[]).map((level) => {
              const active = degreeLevel === level;
              return (
                <button
                  key={level}
                  onClick={() => setDegreeLevel(level)}
                  style={{
                    padding: "6px 14px",
                    border: "none",
                    borderRadius: 100,
                    cursor: "pointer",
                    fontFamily: "'Archivo', sans-serif",
                    fontWeight: 600,
                    fontSize: 12,
                    letterSpacing: "0.02em",
                    color: active ? "#06121a" : "#9aa0bd",
                    background: active
                      ? "linear-gradient(120deg,#8b6cff,#5ef2a8)"
                      : "transparent",
                    boxShadow: active
                      ? "0 10px 40px rgba(139,108,255,.35)"
                      : "none",
                    transition: "color .15s ease",
                  }}
                >
                  {level}
                </button>
              );
            })}
          </div>

          {/* Simplicity toggle */}
          <button
            onClick={() => setExplainSimply(!explainSimply)}
            className="aurora-ghost"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 100,
              cursor: "pointer",
              fontFamily: "'Archivo', sans-serif",
              fontWeight: 600,
              fontSize: 12,
              letterSpacing: "0.02em",
              color: explainSimply ? "#5ef2a8" : "#9aa0bd",
              background: explainSimply
                ? "rgba(94,242,168,.08)"
                : "rgba(255,255,255,.04)",
              border: explainSimply
                ? "1px solid rgba(94,242,168,.35)"
                : "1px solid rgba(255,255,255,.14)",
            }}
          >
            <Brain size={13} />
            {explainSimply ? "Analogy mode" : "Rigorous mode"}
          </button>

          <button
            onClick={handleReset}
            title="Reset conversation"
            className="aurora-ghost"
            style={{
              width: 36,
              height: 36,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 100,
              background: "rgba(255,255,255,.04)",
              border: "1px solid rgba(255,255,255,.14)",
              color: "#9aa0bd",
              cursor: "pointer",
            }}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      {/* Body: preset column + chat feed */}
      <div
        style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}
      >
        {/* Preset topics */}
        <div
          className="aurora-scroll"
          style={{
            display: "flex",
            flexDirection: "column",
            width: 280,
            flex: "0 0 auto",
            padding: 18,
            gap: 12,
            overflowY: "auto",
            borderRight: "1px solid rgba(139,108,255,.14)",
            background: "rgba(3,5,14,.35)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BookOpen size={14} style={{ color: "#8b6cff" }} />
            <span style={eyebrow}>Quick lesson topics</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {PRESET_TOPICS.map((topic, idx) => (
              <button
                key={idx}
                disabled={loading}
                onClick={() => handleSend(topic.query)}
                className="aurora-card"
                style={{
                  textAlign: "left",
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: "rgba(8,10,22,.6)",
                  border: "1px solid rgba(255,255,255,.1)",
                  color: "#eef0fb",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.5 : 1,
                  fontFamily: "'Archivo', sans-serif",
                  fontSize: 12.5,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <ChevronRight
                  size={14}
                  style={{ color: "#8b6cff", marginTop: 2, flexShrink: 0 }}
                />
                <span style={{ minWidth: 0 }}>{topic.title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Chat feed + composer */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            className="aurora-scroll"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 22,
            }}
          >
            {messages.map((msg) => {
              const user = msg.role === "user";
              return (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    maxWidth: "min(760px, 100%)",
                    marginLeft: user ? "auto" : 0,
                    marginRight: user ? 0 : "auto",
                    flexDirection: user ? "row-reverse" : "row",
                    alignItems: "flex-start",
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      background: user
                        ? "rgba(139,108,255,.15)"
                        : "linear-gradient(135deg,#8b6cff,#5ef2a8)",
                      border: user
                        ? "1px solid rgba(139,108,255,.35)"
                        : "1px solid transparent",
                      color: user ? "#c9baff" : "#06121a",
                      boxShadow: user
                        ? "none"
                        : "0 8px 26px rgba(139,108,255,.35)",
                      fontFamily: "'Space Mono', ui-monospace, monospace",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {user ? degreeLevel[0] : <Sparkles size={16} />}
                  </div>

                  <div
                    style={{
                      position: "relative",
                      padding: "14px 16px",
                      borderRadius: 16,
                      background: "rgba(10,12,26,.7)",
                      border: "1px solid rgba(139,108,255,.22)",
                      color: "#eef0fb",
                      minWidth: 0,
                      flex: "0 1 auto",
                    }}
                  >
                    <div
                      style={{
                        ...eyebrow,
                        fontSize: 10,
                        color: "#8b6cff",
                        marginBottom: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span>{user ? "Student" : "AstroAI Tutor"}</span>
                      <span style={{ color: "#5c6180" }}>·</span>
                      <span style={{ color: "#5c6180" }}>
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: 13.5,
                        lineHeight: 1.6,
                        color: "#eef0fb",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {renderFormattedText(msg.text)}
                    </div>

                    {!user && (
                      <button
                        onClick={() => copyToClipboard(msg.text, msg.id)}
                        title="Copy"
                        className="aurora-ghost"
                        style={{
                          position: "absolute",
                          top: 10,
                          right: 10,
                          width: 26,
                          height: 26,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: 100,
                          background: "rgba(3,5,14,.6)",
                          border: "1px solid rgba(255,255,255,.14)",
                          color: "#9aa0bd",
                          cursor: "pointer",
                        }}
                      >
                        {copiedId === msg.id ? (
                          <Check size={13} style={{ color: "#5ef2a8" }} />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  maxWidth: 480,
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    background: "linear-gradient(135deg,#8b6cff,#5ef2a8)",
                    color: "#06121a",
                    boxShadow: "0 8px 26px rgba(139,108,255,.35)",
                  }}
                >
                  <Sparkles size={16} />
                </div>
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 16,
                    background: "rgba(10,12,26,.7)",
                    border: "1px solid rgba(139,108,255,.22)",
                  }}
                >
                  <div
                    style={{ display: "flex", gap: 4, alignItems: "center" }}
                  >
                    <Dot delay={0} />
                    <Dot delay={0.2} />
                    <Dot delay={0.4} />
                  </div>
                  <p
                    style={{
                      margin: "8px 0 0",
                      ...eyebrow,
                      fontSize: 10,
                      color: "#9aa0bd",
                    }}
                  >
                    Synthesizing textbook equations…
                  </p>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Composer */}
          <div
            style={{
              padding: 16,
              borderTop: "1px solid rgba(139,108,255,.16)",
              background: "rgba(3,5,14,.4)",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                maxWidth: 900,
                margin: "0 auto",
              }}
            >
              <input
                className="aurora-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
                disabled={loading}
                placeholder="Ask about orbital parameters, launch vehicles, orbital decay, specific impulse…"
                style={{
                  flex: "1 1 260px",
                  minWidth: 0,
                  padding: "12px 16px",
                  borderRadius: 100,
                  background: "rgba(3,5,14,.6)",
                  border: "1px solid rgba(255,255,255,.12)",
                  color: "#eef0fb",
                  fontFamily: "'Archivo', sans-serif",
                  fontSize: 13.5,
                  outline: "none",
                  transition: "border-color .15s ease, box-shadow .15s ease",
                }}
              />
              <button
                onClick={() => handleSend()}
                disabled={loading || !input.trim()}
                className="aurora-primary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "12px 22px",
                  borderRadius: 100,
                  border: "none",
                  cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                  fontFamily: "'Archivo', sans-serif",
                  fontWeight: 700,
                  fontSize: 13,
                  letterSpacing: "0.02em",
                  color: "#06121a",
                  background: "linear-gradient(120deg,#8b6cff,#5ef2a8)",
                  boxShadow: "0 10px 40px rgba(139,108,255,.35)",
                  opacity: loading || !input.trim() ? 0.55 : 1,
                  flex: "0 0 auto",
                }}
              >
                <Send size={14} />
                <span>Transmit</span>
              </button>
            </div>
            <p
              style={{
                margin: "10px 0 0",
                textAlign: "center",
                ...eyebrow,
                fontSize: 10,
                color: "#5c6180",
              }}
            >
              AstroAI STEM Core · Response tuned for {degreeLevel} students
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: "#c9baff",
        display: "inline-block",
        animation: `aurora-bounce 1s ${delay}s infinite ease-in-out`,
      }}
    >
      <style>{`
        @keyframes aurora-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: .55; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </span>
  );
}
