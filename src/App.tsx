import React, { useState, useEffect } from "react";
import {
  Orbit, Sparkles, Compass, ClipboardList, BookOpen, Trophy,
  Palette, GraduationCap, Clock, Save, Trash2, Calendar,
  Activity, ArrowUpRight, CheckCircle2, ChevronRight, Menu, X
} from "lucide-react";

import { AcademicLevel, SavedNote, GeneratedImage, StudentStats } from "./types";
import ConceptExplainer from "./components/ConceptExplainer";
import OrbitalCalculator from "./components/OrbitalCalculator";
import ProblemGenerator from "./components/ProblemGenerator";
import NasaExplorer from "./components/NasaExplorer";
import PaperRag from "./components/PaperRag";
import QuizMode from "./components/QuizMode";
import SpaceArtist from "./components/SpaceArtist";
import LandingPage from "./components/LandingPage";

// Pre-seeded local bookmarks for immediate student exploration
const INITIAL_NOTES: SavedNote[] = [
  {
    id: "note-1",
    type: "calculation",
    title: "Tsiolkovsky rocket delta-V limits",
    content: "Ideal Rocket Equation: delta-V = Isp * g0 * ln(m0 / mf).\nFor Isp = 450s (LH2/LOX engine), g0 = 9.80665 m/s²:\nIf mass ratio (m0/mf) = 10, total delta-v is roughly 10,150 m/s, sufficient for Earth orbital insertion.",
    timestamp: new Date()
  },
  {
    id: "note-2",
    type: "concept",
    title: "JWST Orbit and sunshield alignment",
    content: "Why L2 is selected: Constant alignment of sunshield blocking Sun, Earth, and Moon simultaneously. Minimizes thermal adjustments and payload cooling needs.",
    timestamp: new Date()
  }
];

// Pre-seeded generated cosmic art assets
const INITIAL_IMAGES: GeneratedImage[] = [
  {
    id: "img-pre-1",
    prompt: "Golden hour modular research outpost on Mars surface, highly detailed, photorealistic",
    imageUrl: "https://images.unsplash.com/photo-1614728894747-a83421e2b9c9?auto=format&fit=crop&q=80&w=600",
    model: "gemini-3-pro-image-preview",
    size: "1K",
    aspectRatio: "1:1",
    info: "Extravagant volumetric lighting of Martian dunes.",
    timestamp: new Date()
  },
  {
    id: "img-pre-2",
    prompt: "An astronaut floating in high orbit looking back at Earth with detailed space station layout",
    imageUrl: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&q=80&w=600",
    model: "gemini-3-pro-image-preview",
    size: "1K",
    aspectRatio: "16:9",
    info: "Stunning wide angle orbital perspectives.",
    timestamp: new Date()
  }
];

export default function App() {
  const [showLanding, setShowLanding] = useState(true);
  const [fadingOut, setFadingOut] = useState(false);

  const [degreeLevel, setDegreeLevel] = useState<AcademicLevel>("Bachelor");
  const [activeTab, setActiveTab] = useState<"tutor" | "calc" | "problems" | "nasa" | "rag" | "quiz" | "artist">("tutor");
  
  // Dashboard drawer / mobile toggle
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Saved student notes/bookmarks
  const [savedNotes, setSavedNotes] = useState<SavedNote[]>(INITIAL_NOTES);

  // Saved artist images
  const [savedImages, setSavedImages] = useState<GeneratedImage[]>(INITIAL_IMAGES);

  // Quiz grade history
  const [quizHistory, setQuizHistory] = useState<{ score: number; topic: string; difficulty: string; timestamp: Date }[]>([]);

  // Telemetry statistics
  const [stats, setStats] = useState<StudentStats>({
    queriesRun: 3,
    problemsSolved: 0,
    calculatorsUsed: 2,
    quizzesTaken: 0,
    avgQuizScore: 0,
    topicsExplored: ["Hohmann Transfers", "Kepler's Laws"],
    recentActivity: [
      { id: "act-1", type: "chat", description: "Inquired about Keplerian orbital periods.", timestamp: new Date() },
      { id: "act-2", type: "calculator", description: "Simulated GEO transfer on Earth.", timestamp: new Date() }
    ]
  });

  // System clock
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleActivityAdded = (type: "chat" | "problem" | "calculator" | "quiz" | "image", desc: string) => {
    setStats(prev => {
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
        timestamp: new Date()
      };

      return {
        ...prev,
        queriesRun: queries,
        problemsSolved: solved,
        calculatorsUsed: calc,
        quizzesTaken: quizes,
        recentActivity: [newActivity, ...prev.recentActivity].slice(0, 10)
      };
    });
  };

  const handleSaveNote = (note: { type: "concept" | "problem" | "mission" | "calculation"; title: string; content: string }) => {
    const newNote: SavedNote = {
      id: `note-${Date.now()}`,
      ...note,
      timestamp: new Date()
    };
    setSavedNotes(prev => [newNote, ...prev]);
  };

  const handleDeleteNote = (id: string) => {
    setSavedNotes(prev => prev.filter(n => n.id !== id));
  };

  // Re-calculate average quiz scores dynamically
  useEffect(() => {
    if (quizHistory.length === 0) return;
    const total = quizHistory.reduce((acc, q) => acc + q.score, 0);
    setStats(prev => ({
      ...prev,
      avgQuizScore: Math.round(total / quizHistory.length),
      quizzesTaken: quizHistory.length
    }));
  }, [quizHistory]);

  const handleEnterPlatform = () => {
    setFadingOut(true);
    setTimeout(() => setShowLanding(false), 500);
  };

  if (showLanding) {
    return (
      <div style={{ opacity: fadingOut ? 0 : 1, transition: "opacity 0.5s ease" }}>
        <LandingPage onEnter={handleEnterPlatform} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200 animate-fade-in">
      
      {/* HUD Top Bar */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md flex items-center justify-between px-6 z-20 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition-all shrink-0"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex items-center gap-2">
            <Orbit className="w-6 h-6 text-indigo-500 animate-spin" style={{ animationDuration: "12s" }} />
            <div>
              <span className="font-display font-extrabold text-lg text-white tracking-tight">AstroAI</span>
              <span className="hidden sm:inline-block ml-2 text-xs font-mono px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded">v1.1 Core</span>
            </div>
          </div>
        </div>

        {/* Global Dashboard Readouts */}
        <div className="flex items-center gap-6 text-xs font-mono text-slate-400">
          <div className="hidden md:flex items-center gap-2 border-r border-slate-800 pr-5">
            <span className="text-slate-500">TELESCOPE INCLINATION:</span>
            <span className="text-emerald-400 font-bold">51.6° LEO</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-400" />
            <span>UTC: {time.toISOString().substring(11, 19)}</span>
          </div>
        </div>
      </header>

      {/* Main Structural Layout */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Academic telemetry dashboard side bar drawer */}
        {sidebarOpen && (
          <aside className="w-80 border-r border-slate-800 bg-slate-900/20 backdrop-blur-md flex flex-col shrink-0 z-10 overflow-y-auto">
            
            {/* Quick Profile Overview */}
            <div className="p-5 border-b border-slate-800 flex flex-col gap-3 bg-slate-950/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-semibold text-white text-sm">Academic Workspace</h3>
                  <span className="text-xs text-slate-400 font-mono">{degreeLevel} level</span>
                </div>
              </div>

              {/* Quick stats grid */}
              <div className="grid grid-cols-2 gap-2 text-center font-mono text-xs pt-1">
                <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-900">
                  <span className="text-[9px] text-slate-500 block">TUTOR RUNS</span>
                  <strong className="text-md text-slate-200 mt-0.5 block">{stats.queriesRun}</strong>
                </div>
                <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-900">
                  <span className="text-[9px] text-slate-500 block">PROBLEMS SOLVED</span>
                  <strong className="text-md text-slate-200 mt-0.5 block">{stats.problemsSolved}</strong>
                </div>
                <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-900">
                  <span className="text-[9px] text-slate-500 block">CALC RUNS</span>
                  <strong className="text-md text-slate-200 mt-0.5 block">{stats.calculatorsUsed}</strong>
                </div>
                <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-900">
                  <span className="text-[9px] text-slate-500 block">AVG GRADE</span>
                  <strong className="text-md text-emerald-400 mt-0.5 block">{stats.avgQuizScore}%</strong>
                </div>
              </div>
            </div>

            {/* Bookmarks Section */}
            <div className="p-5 border-b border-slate-800 flex flex-col gap-3">
              <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block">Your Saved Equations</span>
              {savedNotes.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No bookmarks recorded. Click Save Parameters in calculators or word problems.</p>
              ) : (
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {savedNotes.map(n => (
                    <div key={n.id} className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl flex justify-between items-start gap-3 text-xs">
                      <div className="flex flex-col gap-1 max-w-[80%]">
                        <span className="font-semibold text-slate-200 line-clamp-1">{n.title}</span>
                        <p className="text-[10px] text-slate-400 line-clamp-2 whitespace-pre-wrap">{n.content}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteNote(n.id)}
                        className="p-1 hover:bg-slate-900 text-slate-500 hover:text-rose-400 rounded transition-all shrink-0"
                        title="Delete Bookmark"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent activity list */}
            <div className="p-5 flex flex-col gap-3">
              <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block">Telemetry Timeline</span>
              <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                {stats.recentActivity.map(act => (
                  <div key={act.id} className="flex gap-2.5 items-start text-[11px] font-mono leading-relaxed">
                    <Activity className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-slate-300">{act.description}</span>
                      <span className="block text-[9px] text-slate-500">{new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </aside>
        )}

        {/* Dynamic Category Panels Workspace */}
        <main className="flex-1 flex flex-col overflow-hidden bg-slate-950">
          
          {/* Internal Navigation Sub-Bar */}
          <nav className="h-14 border-b border-slate-800 bg-slate-900/30 flex items-center justify-between px-6 overflow-x-auto shrink-0 z-10 gap-4">
            <div className="flex gap-1">
              {[
                { id: "tutor", label: "Space Tutor", icon: GraduationCap },
                { id: "calc", label: "Orbit Calculator", icon: Orbit },
                { id: "problems", label: "Problem Sets", icon: ClipboardList },
                { id: "nasa", label: "NASA Explorer", icon: Compass },
                { id: "rag", label: "RAG Workspace", icon: BookOpen },
                { id: "quiz", label: "Quiz Mode", icon: Trophy },
                { id: "artist", label: "Space Artist", icon: Palette },
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold font-sans transition-all flex items-center gap-2 whitespace-nowrap ${
                      activeTab === tab.id
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Active Pane Renders */}
          <div className="flex-1 overflow-y-auto p-6 space-grid">
            <div className="max-w-7xl mx-auto h-full">
              
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
                <NasaExplorer
                  onActivityAdded={handleActivityAdded}
                />
              )}

              {activeTab === "rag" && (
                <PaperRag
                  onActivityAdded={handleActivityAdded}
                />
              )}

              {activeTab === "quiz" && (
                <QuizMode
                  onActivityAdded={handleActivityAdded}
                  quizHistory={quizHistory}
                  setQuizHistory={setQuizHistory}
                />
              )}

              {activeTab === "artist" && (
                <SpaceArtist
                  onActivityAdded={handleActivityAdded}
                  savedImages={savedImages}
                  setSavedImages={setSavedImages}
                />
              )}

            </div>
          </div>

        </main>

      </div>
    </div>
  );
}
