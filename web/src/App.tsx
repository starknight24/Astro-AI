import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Orbit,
  Compass,
  ClipboardList,
  BookOpen,
  GraduationCap,
  Clock,
  Trash2,
  Activity,
  Menu,
  X,
  LogOut,
} from "lucide-react";

import { AcademicLevel, SavedNote, StudentStats } from "./types";
import ConceptExplainer from "./components/ConceptExplainer";
import OrbitalCalculator from "./components/OrbitalCalculator";
import ProblemGenerator from "./components/ProblemGenerator";
import NasaExplorer from "./components/NasaExplorer";
import PaperRag from "./components/PaperRag";
import SpaceBackdrop from "./components/SpaceBackdrop";
import { useAuth } from "./lib/AuthContext";

// Pre-seeded local bookmarks for immediate student exploration
const INITIAL_NOTES: SavedNote[] = [
  {
    id: "note-1",
    type: "calculation",
    title: "Tsiolkovsky rocket delta-V limits",
    content:
      "Ideal Rocket Equation: delta-V = Isp * g0 * ln(m0 / mf).\nFor Isp = 450s (LH2/LOX engine), g0 = 9.80665 m/s²:\nIf mass ratio (m0/mf) = 10, total delta-v is roughly 10,150 m/s, sufficient for Earth orbital insertion.",
    timestamp: new Date(),
  },
  {
    id: "note-2",
    type: "concept",
    title: "JWST Orbit and sunshield alignment",
    content:
      "Why L2 is selected: Constant alignment of sunshield blocking Sun, Earth, and Moon simultaneously. Minimizes thermal adjustments and payload cooling needs.",
    timestamp: new Date(),
  },
];

const eyebrow: React.CSSProperties = {
  fontFamily: "'Space Mono', ui-monospace, monospace",
  fontSize: 10.5,
  letterSpacing: "0.24em",
  textTransform: "uppercase",
  color: "#9aa0bd",
};

export default function App() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [degreeLevel, setDegreeLevel] = useState<AcademicLevel>("Bachelor");
  const [activeTab, setActiveTab] = useState<
    "tutor" | "calc" | "problems" | "nasa" | "rag"
  >("tutor");

  // Dashboard drawer / mobile toggle
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Saved student notes/bookmarks
  const [savedNotes, setSavedNotes] = useState<SavedNote[]>(INITIAL_NOTES);

  // Telemetry statistics
  const [stats, setStats] = useState<StudentStats>({
    queriesRun: 3,
    problemsSolved: 0,
    calculatorsUsed: 2,
    quizzesTaken: 0,
    avgQuizScore: 0,
    topicsExplored: ["Hohmann Transfers", "Kepler's Laws"],
    recentActivity: [
      {
        id: "act-1",
        type: "chat",
        description: "Inquired about Keplerian orbital periods.",
        timestamp: new Date(),
      },
      {
        id: "act-2",
        type: "calculator",
        description: "Simulated GEO transfer on Earth.",
        timestamp: new Date(),
      },
    ],
  });

  // System clock
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleActivityAdded = (
    type: "chat" | "problem" | "calculator" | "quiz" | "image",
    desc: string,
  ) => {
    setStats((prev) => {
      let queries = prev.queriesRun;
      let solved = prev.problemsSolved;
      let calc = prev.calculatorsUsed;
      let quizes = prev.quizzesTaken;

      if (type === "chat") queries++;
      if (type === "problem") solved++;
      if (type === "calculator") calc++;
      if (type === "quiz") quizes++;

      const newActivity = {
        id: `act-${Date.now()}`,
        type,
        description: desc,
        timestamp: new Date(),
      };

      return {
        ...prev,
        queriesRun: queries,
        problemsSolved: solved,
        calculatorsUsed: calc,
        quizzesTaken: quizes,
        recentActivity: [newActivity, ...prev.recentActivity].slice(0, 10),
      };
    });
  };

  const handleSaveNote = (note: {
    type: "concept" | "problem" | "mission" | "calculation";
    title: string;
    content: string;
  }) => {
    const newNote: SavedNote = {
      id: `note-${Date.now()}`,
      ...note,
      timestamp: new Date(),
    };
    setSavedNotes((prev) => [newNote, ...prev]);
  };

  const handleDeleteNote = (id: string) => {
    setSavedNotes((prev) => prev.filter((n) => n.id !== id));
  };

  const handleSignOut = async () => {
    navigate("/", { replace: true });
    await signOut();
  };

  const tabs = [
    { id: "tutor", label: "Space Tutor", icon: GraduationCap },
    { id: "calc", label: "Orbit Calculator", icon: Orbit },
    { id: "problems", label: "Problem Sets", icon: ClipboardList },
    { id: "nasa", label: "NASA Explorer", icon: Compass },
    { id: "rag", label: "RAG Workspace", icon: BookOpen },
  ] as const;

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        overflow: "clip",
        color: "#eef0fb",
        fontFamily: "'Archivo', system-ui, sans-serif",
        background: "#03040a",
      }}
    >
      <style>{`
        ::selection { background: rgba(94,242,168,.3); color: #06121a; }
        .aurora-input::placeholder { color: #5c6180; }
        .aurora-input:focus {
          border-color: rgba(139,108,255,.65) !important;
          box-shadow: 0 0 0 3px rgba(139,108,255,.18);
        }
        .aurora-tab { transition: background .15s ease, border-color .15s ease, color .15s ease, transform .15s ease; }
        .aurora-tab.inactive:hover {
          background: rgba(255,255,255,.06);
          border-color: rgba(255,255,255,.22);
          color: #eef0fb;
        }
        .aurora-ghost { transition: background .15s ease, border-color .15s ease, color .15s ease; }
        .aurora-ghost:hover:not(:disabled) {
          background: rgba(255,255,255,.06);
          border-color: rgba(255,255,255,.22);
          color: #eef0fb;
        }
        .aurora-primary { transition: transform .15s ease, filter .15s ease; }
        .aurora-primary:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
        .aurora-card { transition: background .15s ease, border-color .15s ease; }
        .aurora-card:hover {
          background: rgba(139,108,255,.08);
          border-color: rgba(139,108,255,.45);
        }
        .aurora-danger:hover { color: #ff7d7d !important; background: rgba(255,125,125,.08); }
        .aurora-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .aurora-scroll::-webkit-scrollbar-thumb {
          background: rgba(139,108,255,.28);
          border-radius: 8px;
        }
        .aurora-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      <SpaceBackdrop />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* HUD Top Bar */}
        <header
          style={{
            height: 64,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
            background: "rgba(6,8,18,.6)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            borderBottom: "1px solid rgba(139,108,255,.16)",
            zIndex: 20,
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
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="aurora-ghost"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                borderRadius: 100,
                background: "rgba(255,255,255,.04)",
                border: "1px solid rgba(255,255,255,.14)",
                color: "#9aa0bd",
                cursor: "pointer",
                flexShrink: 0,
              }}
              aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <OrbitMark />
              <span
                style={{
                  fontFamily: "'Archivo Expanded', 'Archivo', sans-serif",
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  fontSize: 15,
                  color: "#eef0fb",
                }}
              >
                Astro&nbsp;AI
              </span>
              <span
                style={{
                  ...eyebrow,
                  fontSize: 9.5,
                  letterSpacing: "0.18em",
                  padding: "3px 9px",
                  color: "#c9baff",
                  border: "1px solid rgba(139,108,255,.4)",
                  background: "rgba(139,108,255,.09)",
                  borderRadius: 100,
                }}
              >
                v1.1 · Core
              </span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <div
              className="hud-inclination"
              style={{
                ...eyebrow,
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingRight: 18,
                borderRight: "1px solid rgba(255,255,255,.08)",
              }}
            >
              <span style={{ color: "#5c6180" }}>Telescope incl.</span>
              <span style={{ color: "#5ef2a8", fontWeight: 700 }}>
                51.6° LEO
              </span>
            </div>
            <div
              style={{
                ...eyebrow,
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "#c9baff",
              }}
            >
              <Clock size={14} style={{ color: "#8b6cff" }} />
              <span style={{ color: "#eef0fb" }}>
                UTC {time.toISOString().substring(11, 19)}
              </span>
            </div>
            <button
              onClick={handleSignOut}
              title={user?.email ?? "Sign out"}
              className="aurora-ghost"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderRadius: 100,
                background: "rgba(255,255,255,.04)",
                border: "1px solid rgba(255,255,255,.14)",
                color: "#9aa0bd",
                cursor: "pointer",
                fontFamily: "'Space Mono', ui-monospace, monospace",
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              <LogOut size={13} />
              <span>Sign out</span>
            </button>
          </div>
        </header>

        {/* Main Structural Layout */}
        <div
          style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}
        >
          {/* Sidebar */}
          {sidebarOpen && (
            <aside
              className="aurora-scroll"
              style={{
                width: 320,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                overflowY: "auto",
                background: "rgba(5,7,16,.55)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                borderRight: "1px solid rgba(139,108,255,.14)",
                zIndex: 10,
              }}
            >
              {/* Profile / stats */}
              <div
                style={{
                  padding: 20,
                  borderBottom: "1px solid rgba(139,108,255,.14)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={iconChipStyle}>
                    <GraduationCap size={22} style={{ color: "#c9baff" }} />
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 3 }}
                  >
                    <h3
                      style={{
                        margin: 0,
                        fontFamily: "'Archivo Expanded', 'Archivo', sans-serif",
                        fontWeight: 800,
                        fontSize: 14,
                        color: "#eef0fb",
                        letterSpacing: "0.06em",
                      }}
                    >
                      Academic Workspace
                    </h3>
                    <span style={eyebrow}>{degreeLevel} level</span>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                  }}
                >
                  <StatTile label="Tutor runs" value={stats.queriesRun} />
                  <StatTile
                    label="Problems solved"
                    value={stats.problemsSolved}
                  />
                  <StatTile label="Calc runs" value={stats.calculatorsUsed} />
                  <StatTile
                    label="Avg grade"
                    value={`${stats.avgQuizScore}%`}
                    positive
                  />
                </div>
              </div>

              {/* Bookmarks */}
              <div
                style={{
                  padding: 20,
                  borderBottom: "1px solid rgba(139,108,255,.14)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <span style={eyebrow}>Your saved equations</span>
                {savedNotes.length === 0 ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 11.5,
                      color: "#5c6180",
                      fontStyle: "italic",
                      lineHeight: 1.5,
                    }}
                  >
                    No bookmarks recorded. Save from a calculator or word
                    problem.
                  </p>
                ) : (
                  <div
                    className="aurora-scroll"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      maxHeight: 240,
                      overflowY: "auto",
                      paddingRight: 4,
                    }}
                  >
                    {savedNotes.map((n) => (
                      <div
                        key={n.id}
                        className="aurora-card"
                        style={{
                          padding: 12,
                          background: "rgba(8,10,22,.6)",
                          border: "1px solid rgba(255,255,255,.1)",
                          borderRadius: 14,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 600,
                              color: "#eef0fb",
                              fontSize: 12.5,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {n.title}
                          </span>
                          <p
                            style={{
                              margin: 0,
                              fontSize: 10.5,
                              color: "#9aa0bd",
                              lineHeight: 1.45,
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {n.content}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeleteNote(n.id)}
                          title="Delete bookmark"
                          className="aurora-danger"
                          style={{
                            flexShrink: 0,
                            width: 26,
                            height: 26,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "transparent",
                            border: "none",
                            borderRadius: 8,
                            color: "#5c6180",
                            cursor: "pointer",
                            transition: "color .15s ease, background .15s ease",
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Activity */}
              <div
                style={{
                  padding: 20,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <span style={eyebrow}>Telemetry timeline</span>
                <div
                  className="aurora-scroll"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    maxHeight: 200,
                    overflowY: "auto",
                    paddingRight: 4,
                  }}
                >
                  {stats.recentActivity.map((act) => (
                    <div
                      key={act.id}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        fontFamily: "'Space Mono', ui-monospace, monospace",
                        fontSize: 11,
                        lineHeight: 1.5,
                      }}
                    >
                      <Activity
                        size={13}
                        style={{
                          color: "#8b6cff",
                          flexShrink: 0,
                          marginTop: 2,
                        }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <span style={{ color: "#eef0fb" }}>
                          {act.description}
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontSize: 9.5,
                            color: "#5c6180",
                            letterSpacing: "0.14em",
                            marginTop: 2,
                            textTransform: "uppercase",
                          }}
                        >
                          {new Date(act.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          )}

          {/* Workspace */}
          <main
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Tab pill bar */}
            <nav
              className="aurora-scroll"
              style={{
                height: 60,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                padding: "0 24px",
                gap: 8,
                overflowX: "auto",
                background: "rgba(6,8,18,.55)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                borderBottom: "1px solid rgba(139,108,255,.14)",
                zIndex: 10,
              }}
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`aurora-tab ${active ? "active" : "inactive"}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 16px",
                      borderRadius: 100,
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                      fontFamily: "'Archivo', sans-serif",
                      fontWeight: 600,
                      fontSize: 12.5,
                      letterSpacing: "0.02em",
                      color: active ? "#06121a" : "#9aa0bd",
                      background: active
                        ? "linear-gradient(120deg,#8b6cff,#5ef2a8)"
                        : "rgba(255,255,255,.04)",
                      border: active
                        ? "1px solid transparent"
                        : "1px solid rgba(255,255,255,.14)",
                      boxShadow: active
                        ? "0 10px 40px rgba(139,108,255,.35)"
                        : "none",
                    }}
                  >
                    <Icon size={14} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Active pane */}
            <div
              className="aurora-scroll"
              style={{
                flex: 1,
                overflowY: "auto",
                padding: 24,
              }}
            >
              <div style={{ maxWidth: 1280, margin: "0 auto", height: "100%" }}>
                {activeTab === "tutor" && (
                  <ConceptExplainer
                    degreeLevel={degreeLevel}
                    setDegreeLevel={setDegreeLevel}
                    onActivityAdded={handleActivityAdded}
                  />
                )}

                {activeTab === "calc" && (
                  <OrbitalCalculator
                    onActivityAdded={handleActivityAdded}
                    onSaveNote={handleSaveNote}
                  />
                )}

                {activeTab === "problems" && (
                  <ProblemGenerator
                    onActivityAdded={handleActivityAdded}
                    onSaveNote={handleSaveNote}
                  />
                )}

                {activeTab === "nasa" && (
                  <NasaExplorer onActivityAdded={handleActivityAdded} />
                )}

                {activeTab === "rag" && (
                  <PaperRag onActivityAdded={handleActivityAdded} />
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

const iconChipStyle: React.CSSProperties = {
  width: 46,
  height: 46,
  borderRadius: 14,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  background:
    "linear-gradient(135deg, rgba(139,108,255,.25), rgba(94,242,168,.14))",
  border: "1px solid rgba(139,108,255,.35)",
  color: "#c9baff",
};

function StatTile({
  label,
  value,
  positive = false,
}: {
  label: string;
  value: number | string;
  positive?: boolean;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        background: positive ? "rgba(94,242,168,.05)" : "rgba(139,108,255,.05)",
        border: positive
          ? "1px solid rgba(94,242,168,.2)"
          : "1px solid rgba(139,108,255,.2)",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: "'Space Mono', ui-monospace, monospace",
          fontSize: 9,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "#5c6180",
        }}
      >
        {label}
      </span>
      <strong
        style={{
          fontFamily: "'Archivo Expanded', 'Archivo', sans-serif",
          fontWeight: 800,
          fontSize: 18,
          color: positive ? "#5ef2a8" : "#eef0fb",
          letterSpacing: "0.02em",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function OrbitMark() {
  return (
    <svg
      viewBox="0 0 32 32"
      style={{ width: 26, height: 26, flex: "none" }}
      aria-hidden
    >
      <circle
        cx="16"
        cy="16"
        r="7.5"
        fill="none"
        stroke="#eef0fb"
        strokeWidth="1.5"
      />
      <ellipse
        cx="16"
        cy="16"
        rx="14"
        ry="5"
        fill="none"
        stroke="#5ef2a8"
        strokeWidth="1.3"
        transform="rotate(-24 16 16)"
      />
      <circle cx="27.5" cy="9.5" r="1.6" fill="#8b6cff" />
    </svg>
  );
}
