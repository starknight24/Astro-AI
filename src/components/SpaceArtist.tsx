import React, { useState, useRef } from "react";
import { Image, Sparkles, Sliders, Layers, Download, Check, Eye, ChevronRight, Loader2, ArrowRight, Upload, Palette } from "lucide-react";
import { GeneratedImage } from "../types";

interface SpaceArtistProps {
  onActivityAdded: (type: "chat" | "problem" | "calculator" | "quiz" | "image", desc: string) => void;
  savedImages: GeneratedImage[];
  setSavedImages: React.Dispatch<React.SetStateAction<GeneratedImage[]>>;
}

const PRESET_ART_PROMPTS = [
  "A detailed 3D render of a modular Mars research colony under a dusty red sunset, photorealistic, cinematic lighting",
  "An astronaut floating in high orbit above Earth looking at a glowing spiral galaxy, cosmic background, gorgeous digital art",
  "A futuristic space telescope with large hexagonal gold mirrors capturing infrared emission of a distant stellar nursery",
];

export default function SpaceArtist({ onActivityAdded, savedImages, setSavedImages }: SpaceArtistProps) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("gemini-3-pro-image-preview");
  const [size, setSize] = useState("1K"); // Supports "1K", "2K", "4K"
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [loading, setLoading] = useState(false);

  // Active / selected image
  const [activeImage, setActiveImage] = useState<GeneratedImage | null>(savedImages[0] || null);

  // Editing image state
  const [editPrompt, setEditPrompt] = useState("");
  const [editing, setEditing] = useState(false);
  const [customUpload, setCustomUpload] = useState<string | null>(null);

  const generateImage = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    try {
      const response = await fetch("/api/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model,
          size,
          aspectRatio,
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      const newImg: GeneratedImage = {
        id: `img-${Date.now()}`,
        prompt,
        imageUrl: data.imageUrl,
        model,
        size,
        aspectRatio,
        info: data.info,
        timestamp: new Date()
      };

      setSavedImages(prev => [newImg, ...prev]);
      setActiveImage(newImg);
      onActivityAdded("image", `Generated Space Art: "${prompt.substring(0, 25)}..."`);
    } catch (err: any) {
      alert(`Stellar Art Error: ${err.message || "Failed to generate cosmic image. Please verify your billing settings."}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEditImage = async () => {
    const sourceImage = customUpload || activeImage?.imageUrl;
    if (!sourceImage || !editPrompt.trim() || editing) return;

    setEditing(true);
    try {
      const response = await fetch("/api/image/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64Image: sourceImage,
          prompt: editPrompt
        })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      const editedImg: GeneratedImage = {
        id: `img-${Date.now()}`,
        prompt: `Edited: ${editPrompt}`,
        imageUrl: data.imageUrl,
        model: "gemini-3.1-flash-image-preview",
        size: activeImage?.size || "1K",
        aspectRatio: activeImage?.aspectRatio || "1:1",
        info: data.info,
        timestamp: new Date()
      };

      setSavedImages(prev => [editedImg, ...prev]);
      setActiveImage(editedImg);
      setEditPrompt("");
      setCustomUpload(null);
      onActivityAdded("image", `Edited Space Art: "${editPrompt.substring(0, 25)}..."`);
    } catch (err: any) {
      alert(`Stellar Edit Error: ${err.message || "Failed to edit. Make sure image and prompt are clean."}`);
    } finally {
      setEditing(false);
    }
  };

  const handleCustomImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        setCustomUpload(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const downloadImage = (url: string, filename: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 min-h-[calc(100vh-8rem)]">
      
      {/* Control panel - Left Col (Col 5) */}
      <div className="lg:col-span-5 flex flex-col gap-6">
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col gap-5 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Palette className="w-5 h-5 text-indigo-400 animate-pulse" />
              <h3 className="font-display font-semibold text-white">AI Space Artist Console</h3>
            </div>
            <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 border border-indigo-500/20 rounded-full uppercase tracking-wider">
              Gemini Image Core
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Generate high-resolution space illustrations, custom telescope vistas, Mars colony concepts, or space-station blueprints.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 font-mono uppercase tracking-wider">Describe your Cosmic Art</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. A gorgeous watercolor painting of planetary rings surrounding a deep blue gas giant, orbital spacecraft orbiting nearby..."
                rows={3}
                className="w-full bg-slate-950 hover:bg-slate-900 focus:bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl p-3.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none transition-all resize-none"
              />
            </div>

            {/* Quick topics */}
            <div className="flex flex-wrap gap-2">
              {PRESET_ART_PROMPTS.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => setPrompt(p)}
                  className="px-2.5 py-1.5 bg-slate-950 hover:bg-slate-900 text-[10px] rounded-lg text-slate-400 hover:text-slate-200 border border-slate-800/80 text-left line-clamp-1 max-w-full"
                >
                  Preset {idx + 1}
                </button>
              ))}
            </div>

            {/* Config lines */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 font-mono uppercase tracking-wider">Creation Engine</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="gemini-3-pro-image-preview">gemini-3-pro-image (High Quality)</option>
                  <option value="gemini-3.1-flash-image-preview">gemini-3.1-flash-image (Standard)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 font-mono uppercase tracking-wider">Aspect Ratio</label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none font-mono"
                >
                  <option value="1:1">1:1 (Square)</option>
                  <option value="16:9">16:9 (Landscape)</option>
                  <option value="4:3">4:3 (Card)</option>
                  <option value="3:4">3:4 (Portrait)</option>
                  <option value="9:16">9:16 (Mobile)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 font-mono uppercase tracking-wider">Output Resolution</label>
              <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 justify-between font-mono text-xs">
                {["1K", "2K", "4K"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    className={`flex-1 py-1 text-xs rounded-lg font-medium transition-all ${
                      size === s
                        ? "bg-indigo-600 text-white shadow-md"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-1 font-mono uppercase text-center">4K resolution output is fully supported by pro cores</p>
            </div>

            <button
              onClick={generateImage}
              disabled={loading || !prompt.trim()}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/10 animate-pulse"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" /> Launching Cosmic Creation...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-white" /> Create New Cosmic Art
                </>
              )}
            </button>
          </div>
        </div>

        {/* Saved gallery history list */}
        {savedImages.length > 0 && (
          <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-2xl flex flex-col gap-3 backdrop-blur-md">
            <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block">Your Historic Studio</span>
            <div className="grid grid-cols-4 gap-3 max-h-[140px] overflow-y-auto pr-1">
              {savedImages.map(img => (
                <button
                  key={img.id}
                  onClick={() => {
                    setActiveImage(img);
                    setCustomUpload(null);
                  }}
                  className={`relative aspect-square rounded-lg overflow-hidden border transition-all hover:scale-105 shrink-0 ${
                    activeImage?.id === img.id && !customUpload
                      ? "border-indigo-500 ring-2 ring-indigo-500/30"
                      : "border-slate-800"
                  }`}
                >
                  <img
                    src={img.imageUrl}
                    alt={img.prompt}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Interactive Render Canvas & Image Editor - Right Col (Col 7) */}
      <div className="lg:col-span-7 flex flex-col gap-6">
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col gap-5 backdrop-blur-md flex-1 justify-between">
          
          <div className="flex justify-between items-center pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Sliders className="w-5 h-5 text-indigo-400" />
              <h3 className="font-display font-semibold text-white">Active Studio Viewport</h3>
            </div>
            
            {/* Custom Upload as base */}
            <label className="cursor-pointer px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg hover:bg-slate-900 text-[10px] text-slate-400 hover:text-slate-200 transition-all font-mono flex items-center gap-1">
              <Upload className="w-3.5 h-3.5" /> Upload Custom Photo to Edit
              <input type="file" accept="image/*" onChange={handleCustomImageUpload} className="hidden" />
            </label>
          </div>

          {/* Large Screen display */}
          <div className="relative w-full aspect-square bg-slate-950 border border-slate-800/80 rounded-xl overflow-hidden flex items-center justify-center p-2 shadow-inner">
            {customUpload || activeImage ? (
              <div className="relative w-full h-full flex items-center justify-center">
                <img
                  src={customUpload || activeImage?.imageUrl}
                  alt={activeImage?.prompt || "Workspace canvas"}
                  referrerPolicy="no-referrer"
                  className="max-w-full max-h-full object-contain rounded-lg"
                />

                {/* Info labels */}
                {activeImage && !customUpload && (
                  <div className="absolute bottom-3 left-3 bg-slate-950/90 border border-slate-800 px-2.5 py-1.5 rounded text-[9px] font-mono text-slate-400 max-w-[80%] flex flex-col gap-0.5 shadow">
                    <span className="text-[8px] text-indigo-400 uppercase font-bold">ACTIVE PROMPT:</span>
                    <span className="line-clamp-1">{activeImage.prompt}</span>
                  </div>
                )}

                {customUpload && (
                  <div className="absolute bottom-3 left-3 bg-indigo-500/10 border border-indigo-500/30 px-2.5 py-1.5 rounded text-[10px] font-mono text-indigo-300 shadow">
                    Active upload base ready for Gemini Image Editing
                  </div>
                )}

                {/* Download */}
                {activeImage && !customUpload && (
                  <button
                    onClick={() => downloadImage(activeImage.imageUrl, `${activeImage.id}.png`)}
                    className="absolute top-3 right-3 p-2 bg-slate-950/80 hover:bg-slate-900 border border-slate-800 text-slate-300 hover:text-white rounded-lg transition-all shadow"
                    title="Download high-res artwork"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center flex flex-col items-center gap-3">
                <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-2xl text-slate-500">
                  <Image className="w-8 h-8" />
                </div>
                <p className="text-xs text-slate-500 font-mono uppercase tracking-wide">Studio Canvas Empty</p>
                <p className="text-[11px] text-slate-600 max-w-xs font-sans">Describe a prompt and launch cosmic creations above to populate this workspace.</p>
              </div>
            )}
          </div>

          {/* Image Editor modified section */}
          {(customUpload || activeImage) && (
            <div className="border-t border-slate-800 pt-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-indigo-400 font-mono">GEMINI IMAGE EDITOR SUITE</span>
                <span className="text-[9px] text-slate-500 font-mono">powered by gemini-3.1-flash-image</span>
              </div>

              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="Describe your edits (e.g. 'Can you add a research satellite next to the moon?', 'Make the sky orange')..."
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none placeholder-slate-600"
                />

                <button
                  onClick={handleEditImage}
                  disabled={editing || !editPrompt.trim()}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center gap-1.5 transition-all shrink-0 shadow-md shadow-indigo-600/5"
                >
                  {editing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Editing...
                    </>
                  ) : (
                    <>
                      Modify Image <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

    </div>
  );
}
