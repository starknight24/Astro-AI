import React, { useState, useRef, useEffect } from "react";
import { Upload, BookOpen, Brain, Send, Loader2, Sparkles } from "lucide-react";
import { ResearchPaper, ChatMessage } from "../types";
import { API_URL } from "../lib/api";

interface PaperRagProps {
  onActivityAdded: (
    type: "chat" | "problem" | "calculator" | "quiz" | "image",
    desc: string,
  ) => void;
}

const PRELOADED_PAPERS: ResearchPaper[] = [
  {
    id: "jwst-l2",
    title:
      "Optical Alignment and Early Calibration of the James Webb Space Telescope at the Sun-Earth L2 Lagrange Point",
    authors:
      "Dr. Elena Vance, Senior Astrophysicist at Space Telescope Science Institute (STScI)",
    abstract:
      "This paper reports the initial optical alignment alignment and mid-infrared calibration results of the JWST primary mirror arrays following deployment to its halo orbit around Sun-Earth L2. We detail the wavefront sensing algorithms and multi-step phase retrieval processes utilized to align the 18 hexagonal beryllium segment mirrors down to diffraction-limited performance at 2 microns. Alignment telemetry indicates stable rms wavefront errors < 150 nm over 48-hour observational cycles.",
    equations:
      "$$WFE_{rms} = \\sqrt{\\frac{1}{A}\\iint_A [W(x,y) - \\bar{W}]^2 dxdy}$$ where $W(x,y)$ represents the wavefront phase map and $A$ is the aperture. Secondary mirror corrective impulse equation is given by: $$\\Delta z = C \\cdot \\vec{\\phi}_k$$",
    methodology:
      "Using primary mirror segment actuator controls in 6 degrees of freedom. Alignment checks performed via phase retrieval on the Near Infrared Camera (NIRCam) focal plane arrays. Hexagonal focus corrections deployed sequentially over a 14-day timeline.",
    findings:
      "The primary mirror array reached diffraction-limited alignment with total wavefront error measuring 137 nm, significantly exceeding the mission's pre-launch requirement of 150 nm. High-contrast coronagraph calibration confirms 10^-5 contrast levels at 1 arcsecond.",
    contentSnippet:
      "James Webb Space Telescope (JWST) is situated in a halo orbit around the Sun-Earth L2 point, approximately 1.5 million kilometers from Earth. This location is dynamically ideal because it isolates the cryogenic telescope from Earth and Solar infrared thermal backgrounds. Optical alignment of the 18 hexagonal primary mirror segments represents one of the greatest mechanical engineering challenges. Segment phasing was achieved using dispersed Hartmann sensing (DHS) and weak lenses on the NIRCam instrument. Telemetry reveals that thermal variations across the sunshield cause a slowly drifting thermal wavefront error of approximately 10 nm over a 24-hour cycle.",
  },
  {
    id: "hohmann-multi",
    title:
      "Optimizing Hohmann Transfer Trajectories with Multi-Impulse Mid-Course Correction Engines",
    authors: "Prof. Arthur Pendelton, Department of Aerospace Engineering, MIT",
    abstract:
      "Traditional Hohmann transfer orbits assume two singular instantaneous burns at periapsis and apoapsis. This paper evaluates the delta-V efficiency gains achieved by integrating small mid-course corrections during low-thrust chemical transfers. Numerical simulations of transfers from Low Earth Orbit (LEO) to Geostationary Transfer Orbit (GTO) indicate that adding a third correction burn at the transfer orbit's true anomaly $\\theta = 90^\\circ$ minimizes inclination correction errors by up to 12.4% under severe launch vector dispersion.",
    equations:
      "$$\\Delta v_{total} = \\Delta v_1 + \\Delta v_2 + \\sum_{i=3}^n \\Delta v_{mid}$$ where $$\\Delta v_1 = v_{tx1} - v_{c1} = \\sqrt{\\mu \\left(\\frac{2}{r_1} - \\frac{1}{a_{tx}}\\right)} - \\sqrt{\\frac{\\mu}{r_1}}$$",
    methodology:
      "Conducted Monte Carlo simulations with 10,000 runs representing launch trajectory dispersion. Engine thrust models implemented using standard Runge-Kutta 4th-order orbital integration parameters with customized gravitational modeling.",
    findings:
      "While total theoretical delta-v remains constrained by standard vis-viva parameters, mid-course corrections decrease orbit correction margins on arrival at GEO. High-eccentricity solar radiation pressure perturbation was successfully mitigated.",
    contentSnippet:
      "Two-impulse Hohmann transfers assume absolute thrust duration equals zero (impulsive approximation). In actual chemical spacecraft execution, finite burn times lead to gravity losses. Mid-course correction maneuvers (MCCs) are scheduled using true anomaly milestones. For high inclination changes, conducting inclination change during the second burn at apoapsis (where speed is minimal) is optimal. Launch dispersion error covariance matrices demonstrate that without active mid-course adjustments, typical navigation systems miss GEO insertion windows by an average of 420 km.",
  },
  {
    id: "m-dwarf-bio",
    title:
      "Spectroscopic Biosignature Analysis and Atmosphere Modeling of Exoplanets Orbiting M-Dwarf Systems",
    authors:
      "Sarah J. Thorne, Department of Astronomy and Astrobiology, York University",
    abstract:
      "M-dwarf stars are the most common hosts for rocky exoplanets, but their stellar flares present astrobiological hazards. This research models the atmospheric ozone and methane concentrations on a terrestrial exoplanet orbiting within the habitable zone of an active M-dwarf star. We simulate high-resolution transmission spectra (0.3 to 5 microns) to assess the detectability of simultaneous $O_3$ and $CH_4$ biosignatures using next-generation space telescope coronagraphs.",
    equations:
      "$$I(\\lambda) = I_0(\\lambda) \\cdot e^{-\\tau(\\lambda)}$$ where $\\tau(\\lambda) = \\int \\rho(z)\\sigma(\\lambda, z)dz$ is the optical depth along the transmission path $z$ with local atmospheric density $\\rho$.",
    methodology:
      "1D radiative-convective-photochemical modeling coupled with synthetic transmission spectra generators. Stellar UV flares modeled based on observations of Proxima Centauri.",
    findings:
      "Simultaneous detection of methane ($CH_4$) at 1.66 microns and ozone ($O_3$) at 9.6 microns represents a robust astrobiological biosignature. Flare events enhance ozone regeneration via high-energy photolysis.",
    contentSnippet:
      "Terrestrial exoplanets around M-dwarf stars are tidally locked, meaning they present the same face to the host star. This produces severe global temperature gradients. Global atmospheric circulation model (GCM) simulations indicate that atmospheric winds redistribute thermal energy to prevent nightside condensation. Spectroscopic observations during transit probe the exoplanet's atmosphere. Chemical networks show that methane, when combined with high ozone levels, cannot exist in thermodynamic equilibrium without active, biological surface emissions.",
  },
];

export default function PaperRag({ onActivityAdded }: PaperRagProps) {
  const [selectedPaper, setSelectedPaper] = useState<ResearchPaper>(
    PRELOADED_PAPERS[0],
  );
  const [papersList, setPapersList] =
    useState<ResearchPaper[]>(PRELOADED_PAPERS);

  // Custom upload state
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);

  // RAG Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "rag-welcome",
      role: "model",
      text: "Welcome to the Scientific Paper RAG Workspace. Ask me any question specifically about the selected research paper. I will generate responses strictly grounded in the paper's actual text findings and formulas.",
      timestamp: new Date(),
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleSelectPaper = (paper: ResearchPaper) => {
    setSelectedPaper(paper);
    setChatMessages([
      {
        id: "rag-welcome-new",
        role: "model",
        text: `Switched RAG workspace context to: "${paper.title}". Ask me any questions about its methodology, equations, or findings!`,
        timestamp: new Date(),
      },
    ]);
    onActivityAdded(
      "chat",
      `Loaded paper for RAG analysis: ${paper.title.substring(0, 30)}...`,
    );
  };

  // Drag and drop handers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processUploadedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await processUploadedFile(e.target.files[0]);
    }
  };

  const processUploadedFile = async (file: File) => {
    setUploading(true);
    try {
      // Simulate reading and parsing content text from the file
      // In web applets, FileReader helps extract textual contents
      const reader = new FileReader();
      reader.onload = async (event) => {
        const text =
          (event.target?.result as string) ||
          `This is parsed research data about space engineering on file ${file.name}`;

        // Let's call the backend to summarize this paper using real Gemini API!
        const response = await fetch(`${API_URL}/api/papers/summarize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paperText: text, title: file.name }),
        });
        const summary = await response.json();
        if (summary.error) throw new Error(summary.error);

        const newPaper: ResearchPaper = {
          id: `uploaded-${Date.now()}`,
          title: file.name.replace(/\.[^/.]+$/, ""),
          authors: "Uploaded Document User Workspace",
          abstract: summary.abstract,
          equations: summary.equations,
          methodology: summary.methodology,
          findings: summary.findings,
          contentSnippet: text,
        };

        setPapersList((prev) => [...prev, newPaper]);
        setSelectedPaper(newPaper);
        setChatMessages([
          {
            id: "rag-uploaded-welcome",
            role: "model",
            text: `Successfully uploaded and analyzed "${file.name}"! I've extracted its scientific abstract, key LaTeX equations, methodology, and discoveries. Ask me anything about this paper.`,
            timestamp: new Date(),
          },
        ]);
        onActivityAdded(
          "chat",
          `Uploaded and RAG-processed custom paper: ${file.name}`,
        );
      };
      reader.readAsText(file);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to parse document";
      alert(`Error reading file: ${message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSendRagChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput;
    setChatInput("");

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      text: msg,
      timestamp: new Date(),
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/papers/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paperText:
            selectedPaper.contentSnippet + " " + (selectedPaper.abstract || ""),
          title: selectedPaper.title,
          message: msg,
          history: chatMessages
            .slice(-8)
            .map((m) => ({ role: m.role, text: m.text })),
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setChatMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "model",
          text: data.text,
          timestamp: new Date(),
        },
      ]);

      onActivityAdded(
        "chat",
        `Queried paper RAG about: "${msg.substring(0, 25)}..."`,
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to synchronize grounding models.";
      setChatMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "model",
          text: `⚠️ **RAG Query Error**: ${message}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const renderLaTeX = (text?: string) => {
    if (!text) return null;
    const blocks = text.split(/(\$\$.*?\$\$)/gs);
    return blocks.map((block, idx) => {
      if (block.startsWith("$$") && block.endsWith("$$")) {
        return (
          <div
            key={idx}
            className="my-2 p-2.5 bg-slate-900 border border-emerald-500/20 rounded font-mono text-emerald-400 overflow-x-auto text-center text-xs"
          >
            {block.slice(2, -2)}
          </div>
        );
      }

      const inlines = block.split(/(\$.*?\$)/g);
      return (
        <span key={idx}>
          {inlines.map((sub, sIdx) => {
            if (sub.startsWith("$") && sub.endsWith("$")) {
              return (
                <code
                  key={sIdx}
                  className="px-1 py-0.5 mx-0.5 bg-slate-900 border border-cyan-500/20 text-cyan-400 rounded font-mono text-xs"
                >
                  {sub.slice(1, -1)}
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
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 h-[calc(100vh-8rem)]">
      {/* Side Papers Library Shelf - Left (Col 3) */}
      <div className="xl:col-span-3 flex flex-col gap-4 border border-slate-800 rounded-2xl bg-slate-950/60 p-4 overflow-y-auto">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
          <BookOpen className="w-5 h-5 text-indigo-400" />
          <h3 className="font-display font-semibold text-white">
            Space Library
          </h3>
        </div>

        {/* Paper selector list */}
        <div className="flex-1 flex flex-col gap-2 overflow-y-auto max-h-[300px] xl:max-h-none">
          {papersList.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelectPaper(p)}
              className={`text-left p-3 rounded-xl border transition-all text-xs flex flex-col gap-1.5 ${
                selectedPaper.id === p.id
                  ? "bg-indigo-600/10 border-indigo-500/40 text-indigo-100"
                  : "bg-slate-900/40 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              <span className="font-bold text-slate-100 line-clamp-2">
                {p.title}
              </span>
              <span className="text-[10px] opacity-80 italic line-clamp-1">
                By: {p.authors}
              </span>
            </button>
          ))}
        </div>

        {/* Drag and Drop Zone */}
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-4 text-center transition-all ${
            dragActive
              ? "border-indigo-500 bg-indigo-500/5 text-indigo-300"
              : "border-slate-800 bg-slate-950 text-slate-500 hover:border-slate-700"
          }`}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
              <span className="text-xs text-indigo-300">
                Extracting PDF text...
              </span>
            </div>
          ) : (
            <label className="cursor-pointer flex flex-col items-center gap-1.5 py-1">
              <Upload className="w-5 h-5 text-slate-400" />
              <span className="text-xs font-semibold text-slate-300">
                Add Scientific PDF / TXT
              </span>
              <span className="text-[10px] text-slate-500 font-mono uppercase">
                Drag-and-drop or click
              </span>
              <input
                type="file"
                accept=".pdf,.txt"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          )}
        </div>
      </div>

      {/* Main Analyzer Paper Reader - Center (Col 5) */}
      <div className="xl:col-span-5 flex flex-col border border-slate-800 rounded-2xl bg-slate-950/60 p-5 overflow-y-auto">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-800 mb-4 justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-400" />
            <h3 className="font-display font-semibold text-white">
              Auto-Extracted Syntheses
            </h3>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 border border-emerald-500/20 rounded">
            RAG Grounding Enabled
          </span>
        </div>

        {/* Analyzed values */}
        <div className="space-y-5 text-sm text-slate-300">
          <div>
            <h4 className="font-display font-bold text-white text-xs uppercase tracking-wider font-mono text-indigo-300 mb-1.5">
              Abstract Summary
            </h4>
            <p className="leading-relaxed bg-slate-900/30 p-3.5 rounded-xl border border-slate-900 text-xs text-slate-300 font-sans">
              {selectedPaper.abstract}
            </p>
          </div>

          <div>
            <h4 className="font-display font-bold text-white text-xs uppercase tracking-wider font-mono text-indigo-300 mb-1.5">
              Core Physics Equations
            </h4>
            <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800">
              {renderLaTeX(selectedPaper.equations)}
            </div>
          </div>

          <div>
            <h4 className="font-display font-bold text-white text-xs uppercase tracking-wider font-mono text-indigo-300 mb-1.5">
              Methodology & Verification
            </h4>
            <p className="leading-relaxed text-xs">
              {selectedPaper.methodology}
            </p>
          </div>

          <div>
            <h4 className="font-display font-bold text-white text-xs uppercase tracking-wider font-mono text-indigo-300 mb-1.5">
              Key Findings & Accomplishments
            </h4>
            <p className="leading-relaxed text-xs text-emerald-300 font-medium">
              ✓ {selectedPaper.findings}
            </p>
          </div>
        </div>
      </div>

      {/* RAG conversational grounding chat - Right (Col 4) */}
      <div className="xl:col-span-4 flex flex-col border border-slate-800 rounded-2xl bg-slate-950/40 overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 bg-slate-900/70 flex items-center gap-2 shrink-0">
          <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
          <div>
            <h3 className="font-display font-semibold text-white text-xs">
              Grounding Peer Reviewer
            </h3>
            <p className="text-[10px] text-slate-400 font-mono">
              Anchored specifically to this paper
            </p>
          </div>
        </div>

        {/* Chat Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/20">
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-2.5 max-w-[90%] ${msg.role === "user" ? "ml-auto justify-end" : "mr-auto"}`}
            >
              <div
                className={`p-3 rounded-xl text-xs border ${
                  msg.role === "user"
                    ? "bg-indigo-600/10 border-indigo-500/30 text-indigo-100 rounded-tr-none"
                    : "bg-slate-900/60 border-slate-800 text-slate-300 rounded-tl-none"
                }`}
              >
                <div className="whitespace-pre-wrap leading-relaxed">
                  {renderLaTeX(msg.text)}
                </div>
              </div>
            </div>
          ))}
          {chatLoading && (
            <div className="flex gap-2 max-w-[80%] mr-auto">
              <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl rounded-tl-none">
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Send panel */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/80 flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSendRagChat();
            }}
            disabled={chatLoading}
            placeholder="Ask about this paper's findings, math errors..."
            className="flex-1 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-0"
          />
          <button
            onClick={handleSendRagChat}
            disabled={chatLoading || !chatInput.trim()}
            className="p-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition-all"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
