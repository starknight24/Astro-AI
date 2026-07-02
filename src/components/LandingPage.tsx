import { useState, useEffect, useRef } from "react";
import SpaceScene from "./SpaceScene";
import {
  Orbit, GraduationCap, Compass, BookOpen, Trophy, Palette,
  ClipboardList, ChevronDown, ArrowRight, Sparkles,
} from "lucide-react";

const FEATURES = [
  {
    id: "tutor",
    zone: "NEBULA ZONE α-7",
    title: "AI Space Tutor",
    subtitle: "Ask anything. Understand everything.",
    desc: "Deep cosmic intelligence that adapts to your academic level — Bachelor, Master, or PhD. Ask about Kepler's laws, Hohmann transfers, or black hole thermodynamics.",
    icon: GraduationCap,
    accent: "from-indigo-400 via-violet-500 to-purple-600",
    border: "border-indigo-500/30",
    glow: "indigo",
    tag: "AI TUTOR",
  },
  {
    id: "calc",
    zone: "ORBITAL RING δ-3",
    title: "Orbit Calculator",
    subtitle: "Simulate the physics of the cosmos.",
    desc: "Compute Hohmann transfer delta-V, orbital periods, escape velocities, and launch windows with precision. Real orbital mechanics in real time.",
    icon: Orbit,
    accent: "from-cyan-400 via-blue-500 to-indigo-600",
    border: "border-cyan-500/30",
    glow: "cyan",
    tag: "CALCULATOR",
  },
  {
    id: "problems",
    zone: "ASTEROID FIELD ζ-11",
    title: "Problem Sets",
    subtitle: "Challenge your orbital intuition.",
    desc: "AI-generated practice problems from Kepler's equation to multi-stage rocketry. Worked solutions with LaTeX equations and step-by-step derivations.",
    icon: ClipboardList,
    accent: "from-orange-400 via-red-500 to-rose-600",
    border: "border-orange-500/30",
    glow: "orange",
    tag: "PROBLEMS",
  },
  {
    id: "nasa",
    zone: "DEEP SPACE SECTOR 9",
    title: "NASA Explorer",
    subtitle: "Live data from the edge of the solar system.",
    desc: "Browse NASA's Astronomy Picture of the Day, Mars rover imagery, mission archives, and real telemetry from spacecraft across the heliosphere.",
    icon: Compass,
    accent: "from-emerald-400 via-teal-500 to-cyan-600",
    border: "border-emerald-500/30",
    glow: "emerald",
    tag: "NASA API",
  },
  {
    id: "rag",
    zone: "DATA NEBULA Ω-2",
    title: "Research Papers",
    subtitle: "Query the literature of the cosmos.",
    desc: "Ask natural language questions across curated astrophysics research. Get cited, structured answers from arXiv papers and mission reports.",
    icon: BookOpen,
    accent: "from-violet-400 via-purple-500 to-fuchsia-600",
    border: "border-violet-500/30",
    glow: "violet",
    tag: "RAG",
  },
  {
    id: "quiz",
    zone: "BINARY STAR SYSTEM τ",
    title: "Quiz Mode",
    subtitle: "Test your knowledge. Track your trajectory.",
    desc: "Adaptive quizzes across every astronomy topic. Score history, difficulty tiers, and detailed explanations after every question.",
    icon: Trophy,
    accent: "from-yellow-400 via-amber-500 to-orange-600",
    border: "border-yellow-500/30",
    glow: "yellow",
    tag: "QUIZ",
  },
  {
    id: "artist",
    zone: "ARTIST GALAXY M-81",
    title: "Space Artist",
    subtitle: "Imagine it. Generate it. Own it.",
    desc: "Conjure stunning AI-generated cosmic art — alien worlds, supernova remnants, deep-field galaxies — with a single descriptive prompt.",
    icon: Palette,
    accent: "from-pink-400 via-rose-500 to-red-600",
    border: "border-pink-500/30",
    glow: "pink",
    tag: "AI ART",
  },
];

interface Props {
  onEnter: () => void;
}

export default function LandingPage({ onEnter }: Props) {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [visibleSections, setVisibleSections] = useState<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const progress = el.scrollTop / (el.scrollHeight - el.clientHeight || 1);
      setScrollProgress(Math.min(1, Math.max(0, progress)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Intersection observer for section entrance animations
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const idx = Number(entry.target.getAttribute("data-idx"));
          if (entry.isIntersecting) {
            setVisibleSections((prev) => new Set(prev).add(idx));
          }
        });
      },
      { threshold: 0.25 }
    );
    sectionRefs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const scrollDown = () => {
    containerRef.current?.scrollBy({ top: window.innerHeight, behavior: "smooth" });
  };

  return (
    <div
      ref={containerRef}
      className="landing-scroll-container"
      style={{ position: "fixed", inset: 0, overflowY: "auto", overflowX: "hidden", zIndex: 1 }}
    >
      {/* Fixed 3D background */}
      <SpaceScene scrollProgress={scrollProgress} />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section
        className="relative min-h-screen flex flex-col items-center justify-center text-center px-6"
        style={{ zIndex: 10 }}
      >
        {/* Cosmic grid overlay */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: "radial-gradient(circle at 50% 50%, rgba(60,40,160,0.08) 0%, transparent 70%)",
        }} />

        {/* Version badge */}
        <div className="mb-6 inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 backdrop-blur-md text-indigo-300 text-xs font-mono tracking-widest">
          <Sparkles className="w-3 h-3" />
          ASTRONOMICAL INTELLIGENCE · v1.1
        </div>

        {/* Hero wordmark */}
        <h1 className="hero-title font-display font-black tracking-tighter text-white leading-none mb-4 select-none"
          style={{ fontSize: "clamp(4rem, 14vw, 13rem)", textShadow: "0 0 120px rgba(80,60,255,0.5), 0 0 40px rgba(60,100,255,0.3)" }}>
          ASTRO
          <span style={{ display: "block", WebkitTextStroke: "2px rgba(100,120,255,0.8)", color: "transparent" }}>
            AI
          </span>
        </h1>

        <p className="text-slate-300 text-lg md:text-2xl font-light max-w-2xl mx-auto mb-3 leading-relaxed"
          style={{ textShadow: "0 2px 20px rgba(0,0,0,0.8)" }}>
          Journey through the cosmos.{" "}
          <span className="text-indigo-300 font-medium">Learn astrophysics</span> the way it was meant to be explored.
        </p>

        <p className="text-slate-500 text-sm font-mono mb-10 tracking-wider">
          7 LEARNING MODULES · AI-POWERED · REAL NASA DATA
        </p>

        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <button
            onClick={onEnter}
            className="group relative px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-2xl text-base transition-all duration-300 flex items-center gap-3 overflow-hidden"
            style={{ boxShadow: "0 0 40px rgba(99,102,241,0.5), 0 4px 20px rgba(0,0,0,0.4)" }}
          >
            <span className="relative z-10">Launch Platform</span>
            <ArrowRight className="w-5 h-5 relative z-10 group-hover:translate-x-1 transition-transform" />
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-violet-600 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>

          <button
            onClick={scrollDown}
            className="px-8 py-4 border border-slate-600 hover:border-indigo-500/60 text-slate-300 hover:text-white font-semibold rounded-2xl text-base transition-all duration-300 backdrop-blur-sm bg-slate-900/20"
          >
            Explore Features
          </button>
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-slate-500 animate-bounce-slow">
          <span className="text-[10px] font-mono tracking-[0.3em]">SCROLL TO EXPLORE</span>
          <ChevronDown className="w-5 h-5" />
        </div>
      </section>

      {/* ── FEATURE SECTIONS ─────────────────────────────────────────────── */}
      {FEATURES.map((f, i) => {
        const Icon = f.icon;
        const isVisible = visibleSections.has(i + 1);
        const isLeft = i % 2 === 0;

        return (
          <section
            key={f.id}
            data-idx={i + 1}
            ref={(el) => { sectionRefs.current[i] = el; }}
            className="relative min-h-screen flex items-center px-6 md:px-16"
            style={{ zIndex: 10 }}
          >
            <div className={`w-full max-w-5xl mx-auto flex ${isLeft ? "justify-start" : "justify-end"}`}>
              <div
                className={`feature-card relative max-w-lg w-full transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-16"}`}
                style={{ backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}
              >
                {/* Glow border */}
                <div className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${f.accent} opacity-10 blur-sm`} />
                <div className={`relative border ${f.border} rounded-3xl bg-slate-950/70 p-8 overflow-hidden`}>

                  {/* Zone label */}
                  <div className="flex items-center gap-2 mb-6">
                    <div className="w-1.5 h-1.5 rounded-full bg-current animate-ping" style={{ color: `var(--${f.glow}-glow)` }} />
                    <span className="text-[10px] font-mono tracking-[0.25em] text-slate-500">{f.zone}</span>
                  </div>

                  {/* Icon */}
                  <div className={`inline-flex p-3 rounded-2xl bg-gradient-to-br ${f.accent} bg-opacity-10 mb-5`}
                    style={{ boxShadow: `0 0 30px rgba(0,0,0,0.5)` }}>
                    <Icon className="w-7 h-7 text-white" />
                  </div>

                  {/* Tag */}
                  <div className="text-[10px] font-mono tracking-[0.3em] text-slate-500 mb-2">{f.tag}</div>

                  {/* Title */}
                  <h2 className="font-display font-bold text-3xl md:text-4xl text-white mb-2 leading-tight">
                    {f.title}
                  </h2>
                  <p className={`font-medium text-sm mb-4 bg-gradient-to-r ${f.accent} bg-clip-text text-transparent`}>
                    {f.subtitle}
                  </p>

                  {/* Description */}
                  <p className="text-slate-400 text-sm leading-relaxed mb-6">{f.desc}</p>

                  {/* CTA */}
                  <button
                    onClick={onEnter}
                    className={`group flex items-center gap-2 text-sm font-semibold bg-gradient-to-r ${f.accent} bg-clip-text text-transparent hover:opacity-80 transition-opacity`}
                  >
                    Open Module
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
                  </button>

                  {/* Decorative corner gradient */}
                  <div className={`absolute -bottom-10 -right-10 w-40 h-40 rounded-full bg-gradient-to-br ${f.accent} opacity-5 blur-2xl pointer-events-none`} />
                </div>
              </div>
            </div>

            {/* Section number */}
            <div className={`absolute ${isLeft ? "right-8 md:right-16" : "left-8 md:left-16"} top-1/2 -translate-y-1/2 text-slate-800 font-display font-black select-none pointer-events-none`}
              style={{ fontSize: "clamp(5rem, 15vw, 12rem)", lineHeight: 1 }}>
              0{i + 1}
            </div>
          </section>
        );
      })}

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      <section
        data-idx={FEATURES.length + 1}
        ref={(el) => { sectionRefs.current[FEATURES.length] = el; }}
        className="relative min-h-screen flex flex-col items-center justify-center text-center px-6"
        style={{ zIndex: 10 }}
      >
        <div className={`transition-all duration-1000 ${visibleSections.has(FEATURES.length + 1) ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>

          <div className="mb-6 text-[10px] font-mono tracking-[0.4em] text-slate-500">
            MISSION CONTROL · SYSTEMS READY
          </div>

          <h2 className="font-display font-black text-white leading-none mb-6 select-none"
            style={{ fontSize: "clamp(3rem, 10vw, 8rem)", textShadow: "0 0 80px rgba(99,102,241,0.4)" }}>
            BEGIN YOUR
            <span className="block text-indigo-400">JOURNEY</span>
          </h2>

          <p className="text-slate-400 text-lg max-w-md mx-auto mb-10 leading-relaxed">
            Seven modules. One platform. Every tool you need to master the cosmos.
          </p>

          <button
            onClick={onEnter}
            className="group relative px-12 py-5 text-white font-bold text-lg rounded-3xl overflow-hidden transition-all duration-300"
            style={{
              background: "linear-gradient(135deg, #4f46e5, #7c3aed, #9333ea)",
              boxShadow: "0 0 60px rgba(99,102,241,0.6), 0 0 120px rgba(124,58,237,0.3), 0 4px 30px rgba(0,0,0,0.5)",
            }}
          >
            <span className="relative z-10 flex items-center gap-3">
              <Orbit className="w-6 h-6 animate-spin" style={{ animationDuration: "4s" }} />
              Enter AstroAI
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </span>
            <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity" />
          </button>

          {/* Stats row */}
          <div className="mt-16 flex flex-wrap justify-center gap-8 text-center">
            {[["7", "Learning Modules"], ["∞", "AI Conversations"], ["NASA", "Live Data"], ["PhD", "Level Depth"]].map(([num, label]) => (
              <div key={label} className="flex flex-col gap-1">
                <span className="font-display font-black text-3xl text-white" style={{ textShadow: "0 0 20px rgba(99,102,241,0.5)" }}>{num}</span>
                <span className="text-[10px] font-mono text-slate-500 tracking-widest uppercase">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom padding so last section scrolls fully */}
      <div style={{ height: "10vh" }} />
    </div>
  );
}
