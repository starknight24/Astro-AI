import React, { useState } from "react";
import {
  Sparkles,
  Brain,
  Save,
  Eye,
  EyeOff,
  ClipboardList,
  Send,
  Loader2,
} from "lucide-react";
import { PracticeProblem } from "../types";
import { API_URL } from "../lib/api";

interface ProblemGeneratorProps {
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

const PRACTICE_TOPICS = [
  "Orbital Mechanics (Kepler's Laws, Delta-V)",
  "Spacecraft Propulsion (Specific Impulse, Exhaust)",
  "Astrophysics & Solar Physics (Luminosity, Black Holes)",
  "Atmospheric Reentry & Aerodynamics (Heat Shields)",
];

export default function ProblemGenerator({
  onActivityAdded,
  onSaveNote,
}: ProblemGeneratorProps) {
  // Practice Problem Generator state
  const [topic, setTopic] = useState<string>(PRACTICE_TOPICS[0]);
  const [customTopic, setCustomTopic] = useState<string>("");
  const [difficulty, setDifficulty] = useState<string>("Intermediate");
  const [problems, setProblems] = useState<PracticeProblem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // Word Problem Solver state
  const [wordProblem, setWordProblem] = useState<string>("");
  const [solving, setSolving] = useState<boolean>(false);
  const [solvedData, setSolvedData] = useState<{
    problemType?: string;
    parameters?: string;
    recommendedFormula?: string;
    stepByStep?: string;
    finalAnswer?: string;
    similarProblem?: string;
  } | null>(null);

  const generateProblems = async () => {
    setLoading(true);
    try {
      const selectedTopic = customTopic.trim() || topic;
      const response = await fetch(`${API_URL}/api/problems`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: selectedTopic, difficulty, count: 2 }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setProblems(
        data.map((p: PracticeProblem) => ({ ...p, revealed: false })),
      );
      onActivityAdded(
        "problem",
        `Generated ${difficulty} problems about: ${selectedTopic}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      alert(`Error generating problems: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSolveWordProblem = async () => {
    if (!wordProblem.trim() || solving) return;
    setSolving(true);
    try {
      const response = await fetch(`${API_URL}/api/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordProblem }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setSolvedData(data);
      onActivityAdded(
        "problem",
        `Solved custom homework problem: ${wordProblem.substring(0, 30)}...`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      alert(`Error solving homework: ${message}`);
    } finally {
      setSolving(false);
    }
  };

  const toggleReveal = (id: string) => {
    setProblems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, revealed: !p.revealed } : p)),
    );
  };

  const saveProblemToNotes = (prob: PracticeProblem) => {
    const title = `Practice: ${prob.problem.substring(0, 30)}...`;
    const content = `Practice Topic: ${topic} (${difficulty})
Question: ${prob.problem}
Relevant Equations: ${prob.formulas}
Full Resolution: ${prob.solution}`;

    onSaveNote({ type: "problem", title, content });
    onActivityAdded("problem", "Saved practice problem to notes");
  };

  const saveSolvedToNotes = () => {
    if (!solvedData) return;
    const title = `Solved: ${solvedData.problemType}`;
    const content = `User Word Problem: ${wordProblem}
Classified Type: ${solvedData.problemType}
Identified variables: ${solvedData.parameters}
Formulas Recommended: ${solvedData.recommendedFormula}
Detailed Derivation: ${solvedData.stepByStep}
Final Solution: ${solvedData.finalAnswer}`;

    onSaveNote({ type: "problem", title, content });
    onActivityAdded("problem", `Saved solved problem to notes`);
  };

  const renderLaTeX = (text?: string) => {
    if (!text) return null;
    const parts = text.split(/(\$.*?\$)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("$") && part.endsWith("$")) {
        return (
          <code
            key={idx}
            className="px-1.5 py-0.5 mx-0.5 bg-slate-900 border border-cyan-500/20 text-cyan-400 rounded font-mono text-xs"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Practice Problem Generator */}
      <div className="flex flex-col gap-6">
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col gap-5 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-indigo-400" />
            <h3 className="font-display font-semibold text-white">
              Interactive Problem Generator
            </h3>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 font-mono uppercase tracking-wider">
                Select Practice Area
              </label>
              <select
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
              >
                {PRACTICE_TOPICS.map((t, idx) => (
                  <option key={idx} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 font-mono uppercase tracking-wider">
                Custom Topic (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Lagrange stability, Solar Radiation pressure..."
                value={customTopic}
                onChange={(e) => setCustomTopic(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 font-mono uppercase tracking-wider">
                Academic Complexity
              </label>
              <div className="flex bg-slate-950/80 border border-slate-800 rounded-xl p-1 justify-between">
                {["Introductory", "Intermediate", "Advanced (PhD)"].map(
                  (diff) => (
                    <button
                      key={diff}
                      onClick={() => setDifficulty(diff)}
                      className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-all ${
                        difficulty === diff
                          ? "bg-indigo-600 text-white shadow-md"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {diff}
                    </button>
                  ),
                )}
              </div>
            </div>

            <button
              onClick={generateProblems}
              disabled={loading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/10"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Synthesizing
                  custom equations...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-white animate-pulse" />{" "}
                  Generate Practice Sets
                </>
              )}
            </button>
          </div>
        </div>

        {/* Generated problems feed */}
        {problems.length > 0 && (
          <div className="space-y-4">
            {problems.map((prob, index) => (
              <div
                key={prob.id}
                className="p-5 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col gap-4 backdrop-blur-md"
              >
                <div className="flex justify-between items-start gap-4">
                  <div className="flex items-center gap-2">
                    <span className="p-1 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-400 text-xs font-mono font-bold">
                      #{index + 1}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      Academic Problem Set
                    </span>
                  </div>
                  <button
                    onClick={() => saveProblemToNotes(prob)}
                    className="p-1.5 hover:bg-slate-950 text-slate-400 hover:text-white rounded border border-slate-800 transition-all text-xs flex items-center gap-1 font-mono"
                    title="Bookmark Problem"
                  >
                    <Save className="w-3.5 h-3.5" /> Bookmarks
                  </button>
                </div>

                <p className="text-sm text-slate-200 leading-relaxed font-sans">
                  {prob.problem}
                </p>

                {/* Hint expandable */}
                <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/40 text-xs text-slate-400">
                  <span className="font-semibold text-indigo-300">
                    💡 Hint:
                  </span>{" "}
                  {prob.hint}
                </div>

                {/* Show/Hide answer toggler */}
                <div className="border-t border-slate-800 pt-4 flex flex-col gap-3">
                  <button
                    onClick={() => toggleReveal(prob.id)}
                    className="flex items-center gap-2 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    {prob.revealed ? (
                      <>
                        <EyeOff className="w-4 h-4" /> Hide Academic Solution
                      </>
                    ) : (
                      <>
                        <Eye className="w-4 h-4" /> Reveal Fully Detailed
                        Solution
                      </>
                    )}
                  </button>

                  {prob.revealed && (
                    <div className="mt-2 p-4 bg-slate-950/80 rounded-xl border border-indigo-500/20 font-mono text-xs text-slate-300 flex flex-col gap-3 animate-fade-in">
                      <div className="border-b border-slate-900 pb-2">
                        <span className="font-bold text-emerald-400 uppercase tracking-wide">
                          Physics formulas:
                        </span>
                        <div className="text-cyan-400 mt-1">
                          {renderLaTeX(prob.formulas)}
                        </div>
                      </div>
                      <div>
                        <span className="font-bold text-emerald-400 uppercase tracking-wide">
                          Substituted Working:
                        </span>
                        <p className="mt-1 leading-relaxed text-slate-300 whitespace-pre-wrap">
                          {renderLaTeX(prob.solution)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Custom word problem solver */}
      <div className="flex flex-col gap-6">
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col gap-5 backdrop-blur-md flex-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-indigo-400 animate-pulse" />
              <h3 className="font-display font-semibold text-white">
                AI Homework Solver
              </h3>
            </div>
            <div className="text-[10px] text-slate-500 font-mono uppercase">
              Kepler-to-Rocket Math Parser
            </div>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Have a custom textbook question or physics word problem? Paste it
            below. AstroAI will classify the problem type, suggest illustrative
            diagrams, extract given parameters, and calculate a step-by-step
            mathematical substitution.
          </p>

          <div className="flex flex-col gap-3">
            <textarea
              placeholder="e.g. Calculate the orbital period and velocity of a spacecraft in a circular Earth orbit at an altitude of 35,786 km (GEO)."
              rows={4}
              value={wordProblem}
              onChange={(e) => setWordProblem(e.target.value)}
              className="w-full bg-slate-950 hover:bg-slate-900 focus:bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl p-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none transition-all resize-none"
            />

            <button
              onClick={handleSolveWordProblem}
              disabled={solving || !wordProblem.trim()}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/10"
            >
              {solving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Solving
                  Trajectory Equations...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" /> Submit Homework Word Problem
                </>
              )}
            </button>
          </div>

          {/* Solved data details output */}
          {solvedData && (
            <div className="mt-4 border-t border-slate-800 pt-5 flex flex-col gap-4 animate-fade-in font-mono text-xs">
              <div className="flex justify-between items-center bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase">
                    Classified Problem Type:
                  </span>
                  <div className="font-bold text-white mt-0.5">
                    {solvedData.problemType}
                  </div>
                </div>
                <button
                  onClick={saveSolvedToNotes}
                  className="p-1.5 hover:bg-slate-900 border border-slate-800 rounded text-slate-300 hover:text-white flex items-center gap-1 shrink-0"
                  title="Save Solved equations"
                >
                  <Save className="w-3.5 h-3.5" /> Bookmarks
                </button>
              </div>

              {/* Diagrams recommendations */}
              <div className="p-3 bg-slate-950/50 rounded-lg border border-indigo-500/10">
                <span className="text-[10px] text-indigo-400 uppercase tracking-wider font-bold">
                  Illustrative Diagram Guide:
                </span>
                <p className="text-slate-300 mt-1">
                  {solvedData.recommendedFormula}
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase">
                    1. Extracted Given Parameters:
                  </span>
                  <p className="text-slate-300 mt-1 bg-slate-950/30 p-2 rounded">
                    {renderLaTeX(solvedData.parameters)}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase">
                    2. Mathematical Derivations:
                  </span>
                  <div className="text-slate-300 mt-1 whitespace-pre-wrap leading-relaxed bg-slate-950/30 p-3 rounded border border-slate-900 overflow-x-auto">
                    {renderLaTeX(solvedData.stepByStep)}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-emerald-400 uppercase font-bold">
                    3. Calculated Final Answer:
                  </span>
                  <p className="text-md font-bold text-emerald-400 mt-1 bg-slate-950 p-2 rounded border border-emerald-500/20">
                    {renderLaTeX(solvedData.finalAnswer)}
                  </p>
                </div>
                {solvedData.similarProblem && (
                  <div className="p-3 bg-amber-500/5 rounded-lg border border-amber-500/10 mt-3">
                    <span className="text-[10px] text-amber-400 uppercase tracking-wider font-bold">
                      📚 Challenge Yourself:
                    </span>
                    <p className="text-slate-300 mt-1">
                      {solvedData.similarProblem}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
