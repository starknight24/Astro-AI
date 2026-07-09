import React, { useState } from "react";
import { Sparkles, Trophy, Award, AlertCircle, Play, ChevronRight, RotateCcw, CheckCircle, HelpCircle, Loader2 } from "lucide-react";
import { QuizQuestion, QuizSession } from "../types";

interface QuizModeProps {
  onActivityAdded: (type: "chat" | "problem" | "calculator" | "quiz" | "image", desc: string) => void;
  quizHistory: { score: number; topic: string; difficulty: string; timestamp: Date }[];
  setQuizHistory: React.Dispatch<React.SetStateAction<{ score: number; topic: string; difficulty: string; timestamp: Date }[]>>;
}

const QUIZ_TOPICS = [
  "Kepler's Laws & Orbit Kinematics",
  "Rocket Propulsion Systems (Isp, thrust)",
  "Atmospheric Entry & Hypervelocity aerodynamics",
  "Lagrange Libration Nodes",
  "Mars Geology & Asteroid Classifications"
];

export default function QuizMode({ onActivityAdded, quizHistory, setQuizHistory }: QuizModeProps) {
  const [topic, setTopic] = useState<string>(QUIZ_TOPICS[0]);
  const [customTopic, setCustomTopic] = useState<string>("");
  const [difficulty, setDifficulty] = useState<string>("Medium");
  
  const [session, setSession] = useState<QuizSession | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const startQuiz = async () => {
    setLoading(true);
    try {
      const selectedTopic = customTopic.trim() || topic;
      const response = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: selectedTopic, difficulty }),
      });
      const questions = await response.json();
      if (questions.error) throw new Error(questions.error);

      setSession({
        topic: selectedTopic,
        difficulty,
        questions,
        currentIndex: 0,
        selectedAnswers: {},
        completed: false,
        timestamp: new Date()
      });
      
      onActivityAdded("quiz", `Began ${difficulty} Quiz on: ${selectedTopic}`);
    } catch (err: any) {
      alert(`Failed to load quiz: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const selectAnswer = (optionIdx: number) => {
    if (!session || session.completed) return;
    
    setSession(prev => {
      if (!prev) return null;
      return {
        ...prev,
        selectedAnswers: {
          ...prev.selectedAnswers,
          [prev.currentIndex]: optionIdx
        }
      };
    });
  };

  const handleNext = () => {
    if (!session) return;
    if (session.currentIndex < session.questions.length - 1) {
      setSession(prev => {
        if (!prev) return null;
        return {
          ...prev,
          currentIndex: prev.currentIndex + 1
        };
      });
    } else {
      // Evaluate score
      let score = 0;
      session.questions.forEach((q, idx) => {
        if (session.selectedAnswers[idx] === q.correctAnswer) {
          score++;
        }
      });

      const finalScorePercentage = Math.round((score / session.questions.length) * 100);

      setSession(prev => {
        if (!prev) return null;
        return {
          ...prev,
          completed: true,
          score: finalScorePercentage
        };
      });

      setQuizHistory(prev => [
        ...prev,
        {
          score: finalScorePercentage,
          topic: session.topic,
          difficulty: session.difficulty,
          timestamp: new Date()
        }
      ]);

      onActivityAdded("quiz", `Completed Quiz on ${session.topic}. Score: ${finalScorePercentage}%`);
    }
  };

  const resetQuiz = () => {
    setSession(null);
  };

  const renderLaTeX = (text?: string) => {
    if (!text) return null;
    const parts = text.split(/(\$.*?\$)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("$") && part.endsWith("$")) {
        return (
          <code key={idx} className="px-1.5 py-0.5 mx-0.5 bg-slate-900 border border-cyan-500/20 text-cyan-400 rounded font-mono text-xs">
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  const activeQuestion = session?.questions[session.currentIndex];
  const hasSelected = session ? session.selectedAnswers[session.currentIndex] !== undefined : false;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[calc(100vh-8rem)]">
      
      {/* Quiz setup & feed - Left Col (Col 8) */}
      <div className="lg:col-span-8 flex flex-col gap-6">
        
        {/* Quiz Launcher */}
        {!session && (
          <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col gap-5 backdrop-blur-md">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500 animate-pulse" />
              <h3 className="font-display font-semibold text-white">Interactive Space Quiz Setup</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 font-mono uppercase tracking-wider">Select Theme</label>
                <select
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  {QUIZ_TOPICS.map((t, idx) => (
                    <option key={idx} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 font-mono uppercase tracking-wider">Custom Focus Topic</label>
                <input
                  type="text"
                  placeholder="e.g. Apollo 11 systems, JWST sunshield material, Jupiter moons..."
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 font-mono uppercase tracking-wider">Difficulty Setting</label>
                <div className="flex bg-slate-950/80 border border-slate-800 rounded-xl p-1 justify-between">
                  {["Easy", "Medium", "Hard (PhD)"].map((diff) => (
                    <button
                      key={diff}
                      onClick={() => setDifficulty(diff)}
                      className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-all ${
                        difficulty === diff
                          ? "bg-indigo-600 text-white shadow"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {diff}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={startQuiz}
                disabled={loading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/10"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Synthesizing customized stellar quiz...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 text-white" /> Launch Academic Evaluation
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Live Active Quiz Panel */}
        {session && !session.completed && activeQuestion && (
          <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col gap-6 backdrop-blur-md">
            
            {/* Header progress info */}
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <div>
                <span className="text-[10px] text-indigo-400 font-mono uppercase block">{session.difficulty} evaluation</span>
                <strong className="text-white text-sm line-clamp-1">{session.topic}</strong>
              </div>
              <span className="text-xs font-mono text-slate-400">
                Question <strong className="text-slate-200">{session.currentIndex + 1}</strong> of <strong className="text-slate-200">{session.questions.length}</strong>
              </span>
            </div>

            {/* Progress line */}
            <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${((session.currentIndex) / session.questions.length) * 100}%` }}
              />
            </div>

            {/* Question title */}
            <p className="text-md text-slate-100 font-semibold font-sans leading-relaxed">
              {activeQuestion.question}
            </p>

            {/* Options list */}
            <div className="space-y-3">
              {activeQuestion.options.map((option, idx) => {
                const isSelected = session.selectedAnswers[session.currentIndex] === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => selectAnswer(idx)}
                    className={`w-full text-left p-4 rounded-xl border text-xs font-semibold font-sans leading-relaxed transition-all flex items-center justify-between group ${
                      isSelected
                        ? "bg-indigo-600/15 border-indigo-500 text-indigo-200"
                        : "bg-slate-950/40 border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white"
                    }`}
                  >
                    <span>{option}</span>
                    <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                      isSelected ? "border-indigo-400 bg-indigo-500" : "border-slate-700 group-hover:border-slate-500"
                    }`}>
                      {isSelected && <span className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Explanation card visible after selecting answer */}
            {hasSelected && (
              <div className="p-4 bg-slate-950/80 rounded-xl border border-indigo-500/15 font-mono text-xs text-slate-400">
                <div className="flex gap-1.5 items-center font-bold text-indigo-300 uppercase tracking-wider mb-2">
                  <AlertCircle className="w-4 h-4 text-indigo-400" /> Explanation / Derivation:
                </div>
                <p className="leading-relaxed text-slate-300 whitespace-pre-wrap">{renderLaTeX(activeQuestion.explanation)}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-between items-center mt-3">
              <button
                onClick={resetQuiz}
                className="px-4 py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:text-white rounded-xl text-xs text-slate-400 transition-all"
              >
                Exit Quiz
              </button>

              <button
                disabled={!hasSelected}
                onClick={handleNext}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center gap-1 transition-all"
              >
                {session.currentIndex < session.questions.length - 1 ? (
                  <>
                    Next Question <ChevronRight className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    Complete & Grade Quiz <CheckCircle className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Quiz Completed scorecard */}
        {session && session.completed && (
          <div className="p-8 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col items-center justify-center text-center gap-5 backdrop-blur-md">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Award className="w-8 h-8 animate-bounce" />
            </div>

            <div>
              <h3 className="font-display font-bold text-2xl text-white">Quiz Evaluation Complete!</h3>
              <p className="text-xs text-slate-400 font-mono mt-1">{session.topic} • {session.difficulty}</p>
            </div>

            <div className="bg-slate-950 rounded-2xl border border-slate-800 px-8 py-5">
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Final academic score</p>
              <p className="text-3xl font-bold font-mono text-emerald-400 mt-1">{session.score}%</p>
            </div>

            <p className="text-xs text-slate-300 max-w-md leading-relaxed font-sans">
              Excellent job! This score has been synchronized to your Student Dashboard stats. Review the performance history on the right to track your progress over time.
            </p>

            <div className="flex gap-4">
              <button
                onClick={resetQuiz}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs flex items-center gap-1.5 transition-all"
              >
                <RotateCcw className="w-4 h-4" /> Start Another Lesson
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Quiz History Analytics - Right Col (Col 4) */}
      <div className="lg:col-span-4 flex flex-col gap-6">
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col gap-4 backdrop-blur-md flex-1">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-indigo-400" />
            <h3 className="font-display font-semibold text-white">Performance Analytics</h3>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Your historic quiz grades. Track your score progression across various space mechanics domains.
          </p>

          {/* Custom SVG Score Chart */}
          <div className="relative aspect-[4/3] bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-inner flex items-center justify-center p-4">
            
            {quizHistory.length === 0 ? (
              <div className="text-center flex flex-col items-center gap-2">
                <HelpCircle className="w-7 h-7 text-slate-600" />
                <p className="text-[10px] text-slate-500 font-mono uppercase">No quiz records found</p>
              </div>
            ) : (
              <svg className="w-full h-full" viewBox="0 0 200 120">
                {/* Horizontal gridlines */}
                <line x1="20" y1="20" x2="190" y2="20" stroke="rgba(148, 163, 184, 0.05)" />
                <line x1="20" y1="50" x2="190" y2="50" stroke="rgba(148, 163, 184, 0.05)" />
                <line x1="20" y1="80" x2="190" y2="80" stroke="rgba(148, 163, 184, 0.05)" />
                <line x1="20" y1="100" x2="190" y2="100" stroke="rgba(148, 163, 184, 0.1)" strokeWidth="1" />

                {/* Left score labels */}
                <text x="14" y="23" fill="rgba(148,163,184,0.4)" fontSize="6" textAnchor="end" fontFamily="monospace">100</text>
                <text x="14" y="53" fill="rgba(148,163,184,0.4)" fontSize="6" textAnchor="end" fontFamily="monospace">60</text>
                <text x="14" y="83" fill="rgba(148,163,184,0.4)" fontSize="6" textAnchor="end" fontFamily="monospace">20</text>
                
                {/* Draw Bar or Line nodes */}
                {quizHistory.slice(-5).map((q, idx) => {
                  const x = 35 + idx * 35;
                  // Map score (0-100) to height (100 is y=20, 0 is y=100)
                  const height = (q.score / 100) * 80;
                  const y = 100 - height;
                  return (
                    <g key={idx}>
                      {/* Bar columns */}
                      <rect
                        x={x - 6}
                        y={y}
                        width="12"
                        height={height}
                        fill="rgba(99, 102, 241, 0.7)"
                        rx="2"
                        className="hover:fill-indigo-400 transition-colors cursor-pointer"
                      />
                      {/* Score values on top */}
                      <text x={x} y={y - 3} fill="#a5b4fc" fontSize="6" textAnchor="middle" fontFamily="monospace" fontWeight="bold">
                        {q.score}%
                      </text>
                      {/* Bottom indicator label index */}
                      <text x={x} y="110" fill="rgba(148,163,184,0.5)" fontSize="5" textAnchor="middle" fontFamily="monospace">
                        Q{idx + 1}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>

          {/* History list */}
          {quizHistory.length > 0 && (
            <div className="flex-1 overflow-y-auto max-h-[140px] space-y-2 pr-1">
              {quizHistory.slice().reverse().map((h, idx) => (
                <div key={idx} className="p-3 bg-slate-950 border border-slate-800/85 rounded-xl flex justify-between items-center text-xs font-mono">
                  <div className="flex flex-col gap-0.5 max-w-[70%]">
                    <span className="font-bold text-slate-200 line-clamp-1">{h.topic}</span>
                    <span className="text-[9px] text-slate-500 uppercase">{h.difficulty} complexity</span>
                  </div>
                  <strong className="text-emerald-400 text-sm font-bold">{h.score}%</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
