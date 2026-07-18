import React, { useState, useEffect, useRef } from "react";
import {
  Orbit,
  Play,
  Pause,
  RotateCcw,
  Save,
  Flame,
  Compass,
} from "lucide-react";

interface OrbitalCalculatorProps {
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

type CentralBody = "Earth" | "Mars" | "Moon";

interface BodyData {
  mass: number; // kg
  radius: number; // km
  mu: number; // km^3/s^2 (gravitational parameter)
  color: string;
}

const BODIES: Record<CentralBody, BodyData> = {
  Earth: { mass: 5.972e24, radius: 6371, mu: 398600.4, color: "#38bdf8" },
  Mars: { mass: 6.39e23, radius: 3389, mu: 42828.3, color: "#f87171" },
  Moon: { mass: 7.347e22, radius: 1737, mu: 4902.8, color: "#94a3b8" },
};

export default function OrbitalCalculator({
  onActivityAdded,
  onSaveNote,
}: OrbitalCalculatorProps) {
  // Circular Orbit Inputs
  const [body, setBody] = useState<CentralBody>("Earth");
  const [altitude, setAltitude] = useState<number>(400); // LEO default

  // Hohmann Transfer Inputs
  const [depAltitude, setDepAltitude] = useState<number>(300);
  const [arrAltitude, setArrAltitude] = useState<number>(35786); // GEO default

  // Simulation controls
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [simSpeed, setSimSpeed] = useState<number>(100); // speed multiplier
  const [isHohmannAnimating, setIsHohmannAnimating] = useState<boolean>(false);
  const [hohmannPhase, setHohmannPhase] = useState<
    "idle" | "burn1" | "coasting" | "burn2" | "circular"
  >("idle");
  const [hohmannTimeLeft, setHohmannTimeLeft] = useState<number>(0);

  const angleRef = useRef<number>(0);
  const hohmannAngleRef = useRef<number>(0);
  const [simAngle, setSimAngle] = useState<number>(0);
  const [hohmannSimAngle, setHohmannSimAngle] = useState<number>(0);

  // Calculate Circular Orbit Parameters
  const bodyData = BODIES[body];
  const r = bodyData.radius + altitude; // Semi-major axis in km
  const v_c = Math.sqrt(bodyData.mu / r); // km/s
  const escape_v = Math.sqrt((2 * bodyData.mu) / r); // km/s
  const period_sec = 2 * Math.PI * Math.sqrt(Math.pow(r, 3) / bodyData.mu); // seconds
  const period_min = period_sec / 60;
  const spec_energy = -bodyData.mu / (2 * r); // MJ/kg

  // Calculate Hohmann Transfer parameters
  const r1 = bodyData.radius + depAltitude;
  const r2 = bodyData.radius + arrAltitude;
  const a_tx = (r1 + r2) / 2;
  const v_c1 = Math.sqrt(bodyData.mu / r1);
  const v_c2 = Math.sqrt(bodyData.mu / r2);
  const v_tx1 = Math.sqrt(bodyData.mu * (2 / r1 - 1 / a_tx));
  const delta_v1 = Math.abs(v_tx1 - v_c1);
  const v_tx2 = Math.sqrt(bodyData.mu * (2 / r2 - 1 / a_tx));
  const delta_v2 = Math.abs(v_c2 - v_tx2);
  const total_delta_v = delta_v1 + delta_v2;
  const tof_sec = Math.PI * Math.sqrt(Math.pow(a_tx, 3) / bodyData.mu);

  // Animation ticks
  useEffect(() => {
    let frameId: number;
    const tick = () => {
      if (isPlaying) {
        // Calculate step based on orbital period (faster orbits rotate faster)
        const angularVelocity = (2 * Math.PI) / (period_sec || 5400); // rad/sec
        const step = angularVelocity * (simSpeed / 60) * 1.5; // rad per frame

        angleRef.current = (angleRef.current + step) % (2 * Math.PI);
        setSimAngle(angleRef.current);

        if (isHohmannAnimating) {
          if (hohmannPhase === "coasting") {
            // Speed of coasting transfer
            const hohmannTofMultiplier =
              (Math.PI / tof_sec) * (simSpeed / 60) * 3;
            hohmannAngleRef.current =
              hohmannAngleRef.current + hohmannTofMultiplier;

            if (hohmannAngleRef.current >= Math.PI) {
              hohmannAngleRef.current = Math.PI;
              setHohmannPhase("burn2");
              setTimeout(() => {
                setHohmannPhase("circular");
              }, 1200);
            }
            setHohmannSimAngle(hohmannAngleRef.current);
            setHohmannTimeLeft((prev) => Math.max(0, prev - simSpeed / 30));
          } else if (hohmannPhase === "circular") {
            const circVelocity =
              (2 * Math.PI) /
              (2 * Math.PI * Math.sqrt(Math.pow(r2, 3) / bodyData.mu));
            const circStep = circVelocity * (simSpeed / 60) * 1.5;
            hohmannAngleRef.current =
              (hohmannAngleRef.current + circStep) % (2 * Math.PI);
            setHohmannSimAngle(hohmannAngleRef.current);
          }
        }
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [
    isPlaying,
    simSpeed,
    period_sec,
    isHohmannAnimating,
    hohmannPhase,
    tof_sec,
    r2,
    bodyData.mu,
  ]);

  const handleStartHohmannTransfer = () => {
    onActivityAdded(
      "calculator",
      `Hohmann Transfer Simulated: ${depAltitude}km to ${arrAltitude}km`,
    );
    setIsHohmannAnimating(true);
    setHohmannPhase("burn1");
    hohmannAngleRef.current = 0;
    setHohmannSimAngle(0);
    setHohmannTimeLeft(tof_sec);

    setTimeout(() => {
      setHohmannPhase("coasting");
    }, 1500);
  };

  const handleStopHohmannTransfer = () => {
    setIsHohmannAnimating(false);
    setHohmannPhase("idle");
    hohmannAngleRef.current = 0;
  };

  const saveCircularNotes = () => {
    const title = `${body} Circular Orbit (${altitude} km)`;
    const content = `Central Body: ${body}
Radius of Body: ${bodyData.radius} km
Altitude: ${altitude} km
Semi-Major Axis (r): ${r.toFixed(2)} km
Calculated Speed (v_c): ${v_c.toFixed(4)} km/s
Formula: v_c = sqrt(mu / r) = sqrt(${bodyData.mu} / ${r.toFixed(2)})
Escape Velocity (v_e): ${escape_v.toFixed(4)} km/s
Orbital Period (T): ${period_min.toFixed(2)} minutes (${(period_min / 60).toFixed(2)} hours)
Specific Orbital Energy: ${spec_energy.toFixed(2)} MJ/kg`;

    onSaveNote({ type: "calculation", title, content });
    onActivityAdded("calculator", `Saved Orbit Parameters to Notes: ${title}`);
  };

  const saveHohmannNotes = () => {
    const title = `${body} Hohmann Transfer (${depAltitude}km -> ${arrAltitude}km)`;
    const content = `Central Body: ${body}
Departure Altitude: ${depAltitude} km (r1 = ${r1.toFixed(2)} km)
Arrival Altitude: ${arrAltitude} km (r2 = ${r2.toFixed(2)} km)
Total Delta-V required: ${total_delta_v.toFixed(4)} km/s
- Delta-V1 (Departure Burn): ${delta_v1.toFixed(4)} km/s
- Delta-V2 (Arrival Circularization): ${delta_v2.toFixed(4)} km/s
Transfer Semi-major Axis: ${a_tx.toFixed(2)} km
Time of Flight: ${(tof_sec / 3600).toFixed(2)} hours (${(tof_sec / 60).toFixed(1)} mins)`;

    onSaveNote({ type: "calculation", title, content });
    onActivityAdded("calculator", `Saved Hohmann calculation to Notes`);
  };

  // Convert orbit dimensions to fitting SVG sizes (scaling factors)
  const maxSimRadius = Math.max(r, r2);
  const scaleRatio = 110 / maxSimRadius; // scale down to fit 300x300 viewBox

  const planetSvgRadius = Math.max(10, bodyData.radius * scaleRatio);
  const orbitSvgRadius = r * scaleRatio;
  const depSvgRadius = r1 * scaleRatio;
  const arrSvgRadius = r2 * scaleRatio;

  // Satellite position calculations
  const satX = 150 + Math.cos(simAngle) * orbitSvgRadius;
  const satY = 150 + Math.sin(simAngle) * orbitSvgRadius;

  // Hohmann Transfer Orbit drawing
  const hohmannEccentricity = (r2 - r1) / (r2 + r1);
  const tx_a = a_tx * scaleRatio;
  const tx_b = tx_a * Math.sqrt(1 - Math.pow(hohmannEccentricity, 2));
  const tx_focus_offset = ((r2 - r1) / 2) * scaleRatio;

  // Hohmann satellite position
  let hSatX = 150;
  let hSatY = 150;

  if (hohmannPhase === "burn1" || hohmannPhase === "idle") {
    hSatX = 150 + depSvgRadius;
    hSatY = 150;
  } else if (hohmannPhase === "coasting") {
    const rx =
      (a_tx * (1 - Math.pow(hohmannEccentricity, 2))) /
      (1 + hohmannEccentricity * Math.cos(hohmannSimAngle));
    const scaledRx = rx * scaleRatio;
    hSatX = 150 + Math.cos(hohmannSimAngle) * scaledRx;
    hSatY = 150 + Math.sin(hohmannSimAngle) * scaledRx;
  } else if (hohmannPhase === "burn2" || hohmannPhase === "circular") {
    hSatX = 150 + Math.cos(hohmannSimAngle) * arrSvgRadius;
    hSatY = 150 + Math.sin(hohmannSimAngle) * arrSvgRadius;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[calc(100vh-8rem)]">
      {/* Inputs and Calculations - Left Col */}
      <div className="lg:col-span-7 flex flex-col gap-6">
        {/* Core parameters */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col gap-5 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Compass className="w-5 h-5 text-indigo-400" />
              <h3 className="font-display font-semibold text-white">
                Orbital Mechanics Setup
              </h3>
            </div>
            <div className="text-xs text-indigo-300 font-mono bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-full">
              {body} Gravitational Kernel Active
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Body Select */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider font-mono">
                Central Celestial Body
              </label>
              <select
                value={body}
                onChange={(e) => setBody(e.target.value as CentralBody)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
              >
                <option value="Earth">🌏 Earth</option>
                <option value="Mars">🔴 Mars</option>
                <option value="Moon">🌑 Moon</option>
              </select>
            </div>

            {/* Circular altitude */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider font-mono">
                Circular Alt. (km)
              </label>
              <input
                type="number"
                value={altitude}
                onChange={(e) =>
                  setAltitude(Math.max(10, parseInt(e.target.value) || 0))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none font-mono"
              />
            </div>

            {/* Scale visual reference */}
            <div className="flex flex-col justify-end">
              <span className="text-[10px] text-slate-500 font-mono">
                CELESTIAL CONSTANTS:
              </span>
              <span className="text-xs text-slate-300 font-mono mt-1">
                μ: {bodyData.mu.toLocaleString()} km³/s²
              </span>
              <span className="text-xs text-slate-300 font-mono">
                R: {bodyData.radius.toLocaleString()} km
              </span>
            </div>
          </div>

          {/* Computed values for Circular Orbits */}
          <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                Orbital Speed
              </p>
              <p className="text-lg font-bold text-emerald-400 font-mono mt-1">
                {v_c.toFixed(4)}{" "}
                <span className="text-xs font-normal text-slate-400">km/s</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                Escape velocity
              </p>
              <p className="text-lg font-bold text-cyan-400 font-mono mt-1">
                {escape_v.toFixed(4)}{" "}
                <span className="text-xs font-normal text-slate-400">km/s</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                Orbital Period
              </p>
              <p className="text-lg font-bold text-amber-400 font-mono mt-1">
                {period_min > 120
                  ? `${(period_min / 60).toFixed(2)} h`
                  : `${period_min.toFixed(1)} m`}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                Specific Energy
              </p>
              <p className="text-lg font-bold text-rose-400 font-mono mt-1">
                {spec_energy.toFixed(2)}{" "}
                <span className="text-xs font-normal text-slate-400">
                  MJ/kg
                </span>
              </p>
            </div>
          </div>

          {/* Formula step by step layout */}
          <div className="p-4 bg-slate-950/40 rounded-xl border border-slate-800/60 flex flex-col gap-3 text-xs text-slate-400">
            <h4 className="font-display font-medium text-slate-200">
              Keplerian Circular Formula Breakdown
            </h4>
            <div className="space-y-2 font-mono">
              <div className="flex justify-between items-center border-b border-slate-900 pb-1.5">
                <span>Semi-major axis ($r$):</span>
                <span className="text-slate-300">
                  R + h = {bodyData.radius} + {altitude} ={" "}
                  <strong className="text-indigo-400">{r.toFixed(1)} km</strong>
                </span>
              </div>
              <div className="flex justify-between items-center border-b border-slate-900 pb-1.5">
                <span>Orbital velocity ($v_c$):</span>
                <span className="text-slate-300">
                  √ (μ / r) = √ ({bodyData.mu} / {r.toFixed(1)}) ={" "}
                  <strong className="text-emerald-400">
                    {v_c.toFixed(4)} km/s
                  </strong>
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Escape speed ($v_e$):</span>
                <span className="text-slate-300">
                  √ (2μ / r) = √ (2 * {bodyData.mu} / {r.toFixed(1)}) ={" "}
                  <strong className="text-cyan-400">
                    {escape_v.toFixed(4)} km/s
                  </strong>
                </span>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={saveCircularNotes}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-all text-[11px] flex items-center gap-1.5 border border-slate-800"
              >
                <Save className="w-3.5 h-3.5" /> Save Parameters to Notes
              </button>
            </div>
          </div>
        </div>

        {/* Hohmann transfer card */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col gap-4 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-amber-500" />
            <h3 className="font-display font-semibold text-white">
              Hohmann Transfer Trajectory
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider font-mono">
                Departure Alt (km)
              </label>
              <input
                type="number"
                value={depAltitude}
                onChange={(e) =>
                  setDepAltitude(Math.max(10, parseInt(e.target.value) || 0))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 font-mono focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider font-mono">
                Arrival Alt (km)
              </label>
              <input
                type="number"
                value={arrAltitude}
                onChange={(e) =>
                  setArrAltitude(Math.max(10, parseInt(e.target.value) || 0))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 font-mono focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800 grid grid-cols-2 sm:grid-cols-3 gap-4 text-center font-mono">
            <div>
              <p className="text-[10px] text-slate-500 uppercase">
                Departure Burn ΔV₁
              </p>
              <p className="text-md font-bold text-indigo-400 mt-1">
                {delta_v1.toFixed(4)} km/s
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase">
                Arrival Burn ΔV₂
              </p>
              <p className="text-md font-bold text-indigo-400 mt-1">
                {delta_v2.toFixed(4)} km/s
              </p>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <p className="text-[10px] text-slate-500 uppercase">
                Total Required ΔV
              </p>
              <p className="text-md font-bold text-emerald-400 mt-1">
                {total_delta_v.toFixed(4)} km/s
              </p>
            </div>
          </div>

          <div className="space-y-1.5 text-xs text-slate-400 font-mono bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/60">
            <div className="flex justify-between">
              <span>Transfer semi-major axis ({"$a_{tx}$"}):</span>
              <span className="text-slate-300">{a_tx.toFixed(1)} km</span>
            </div>
            <div className="flex justify-between">
              <span>Time of Flight ({"$T_{of}$"}):</span>
              <span className="text-amber-400 font-medium">
                {(tof_sec / 3600).toFixed(2)} hours ({(tof_sec / 60).toFixed(1)}{" "}
                minutes)
              </span>
            </div>
          </div>

          <div className="flex justify-between items-center mt-2">
            {!isHohmannAnimating ? (
              <button
                onClick={handleStartHohmannTransfer}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-amber-600/10 transition-all"
              >
                <Flame className="w-4 h-4 text-white animate-pulse" /> Trigger
                Hohmann Transfer Animation
              </button>
            ) : (
              <button
                onClick={handleStopHohmannTransfer}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all"
              >
                <RotateCcw className="w-4 h-4" /> Stop & Reset Trajectory
              </button>
            )}

            <button
              onClick={saveHohmannNotes}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 rounded-lg transition-all text-[11px] flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" /> Save Hohmann Data
            </button>
          </div>
        </div>
      </div>

      {/* Orbit Visualization - Right Col */}
      <div className="lg:col-span-5 flex flex-col gap-6">
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col items-center justify-between gap-4 backdrop-blur-md flex-1">
          <div className="w-full flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Orbit className="w-5 h-5 text-indigo-400" />
              <h3 className="font-display font-semibold text-white">
                Interactive HUD Simulator
              </h3>
            </div>
            <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="p-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-900"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Interactive SVG Render Canvas */}
          <div className="relative w-full aspect-square bg-slate-950 border border-slate-800/80 rounded-xl overflow-hidden shadow-inner flex items-center justify-center space-grid">
            {/* Ambient Background Stars */}
            <div className="absolute inset-0 pointer-events-none opacity-40">
              <div
                className="absolute top-8 left-1/4 w-1 h-1 bg-white rounded-full animate-ping"
                style={{ animationDuration: "3s" }}
              />
              <div className="absolute top-2/3 left-12 w-0.5 h-0.5 bg-indigo-300 rounded-full" />
              <div className="absolute top-1/2 right-12 w-1 h-1 bg-amber-200 rounded-full animate-pulse" />
              <div className="absolute bottom-12 right-1/3 w-0.5 h-0.5 bg-white rounded-full" />
            </div>

            <svg className="w-full h-full max-w-[360px]" viewBox="0 0 300 300">
              {/* Scale concentric orbit guides for visual context */}
              <circle
                cx="150"
                cy="150"
                r="50"
                fill="none"
                stroke="rgba(148, 163, 184, 0.04)"
                strokeDasharray="3,3"
              />
              <circle
                cx="150"
                cy="150"
                r="90"
                fill="none"
                stroke="rgba(148, 163, 184, 0.04)"
                strokeDasharray="3,3"
              />
              <circle
                cx="150"
                cy="150"
                r="130"
                fill="none"
                stroke="rgba(148, 163, 184, 0.04)"
                strokeDasharray="3,3"
              />

              {/* standard orbit guide circular (static path) */}
              {!isHohmannAnimating && (
                <circle
                  cx="150"
                  cy="150"
                  r={orbitSvgRadius}
                  fill="none"
                  stroke="rgba(99, 102, 241, 0.25)"
                  strokeWidth="1.5"
                />
              )}

              {/* Hohmann animation overlays */}
              {isHohmannAnimating && (
                <>
                  {/* Dep orbit circular */}
                  <circle
                    cx="150"
                    cy="150"
                    r={depSvgRadius}
                    fill="none"
                    stroke="rgba(99, 102, 241, 0.3)"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />

                  {/* Arr orbit circular */}
                  <circle
                    cx="150"
                    cy="150"
                    r={arrSvgRadius}
                    fill="none"
                    stroke="rgba(16, 185, 129, 0.3)"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />

                  {/* Transfer ellipse: Semi-major axis = tx_a, semi-minor axis = tx_b. Focused on Central body */}
                  {(hohmannPhase === "coasting" ||
                    hohmannPhase === "burn1") && (
                    <ellipse
                      cx={150 - tx_focus_offset}
                      cy={150}
                      rx={tx_a}
                      ry={tx_b}
                      fill="none"
                      stroke="rgba(245, 158, 11, 0.5)"
                      strokeWidth="1.5"
                      strokeDasharray="4,4"
                    />
                  )}
                </>
              )}

              {/* Central Planet */}
              <circle
                cx="150"
                cy="150"
                r={planetSvgRadius}
                fill={bodyData.color}
                className="shadow-lg filter drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]"
              />
              {/* Core planet interior accent */}
              <circle
                cx="150"
                cy="150"
                r={planetSvgRadius * 0.75}
                fill="rgba(0, 0, 0, 0.15)"
              />

              {/* Circular satellite orbiter */}
              {!isHohmannAnimating && (
                <g>
                  <circle
                    cx={satX}
                    cy={satY}
                    r="4"
                    fill="#6366f1"
                    className="animate-pulse"
                  />
                  <circle
                    cx={satX}
                    cy={satY}
                    r="8"
                    fill="none"
                    stroke="#6366f1"
                    strokeWidth="1"
                    opacity="0.6"
                    className="animate-ping"
                    style={{ animationDuration: "2s" }}
                  />
                </g>
              )}

              {/* Hohmann animation satellite orbiter */}
              {isHohmannAnimating && (
                <g>
                  <circle
                    cx={hSatX}
                    cy={hSatY}
                    r="5"
                    fill={
                      hohmannPhase === "coasting"
                        ? "#f59e0b"
                        : hohmannPhase === "circular"
                          ? "#10b981"
                          : "#6366f1"
                    }
                  />

                  {/* Flashing thrust burn flash */}
                  {(hohmannPhase === "burn1" || hohmannPhase === "burn2") && (
                    <circle
                      cx={hSatX}
                      cy={hSatY}
                      r="12"
                      fill="none"
                      stroke="#f97316"
                      strokeWidth="2.5"
                      className="animate-ping"
                    />
                  )}
                </g>
              )}
            </svg>

            {/* Float HUD overlays */}
            <div className="absolute bottom-3 left-3 bg-slate-950/90 border border-slate-800 p-2.5 rounded-lg text-[10px] font-mono text-slate-400 flex flex-col gap-1">
              <div className="flex justify-between gap-4">
                <span>SIM STATE:</span>
                <span
                  className={isPlaying ? "text-emerald-400" : "text-rose-400"}
                >
                  {isPlaying ? "ACTIVE" : "PAUSED"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span>WARP FACTOR:</span>
                <span className="text-cyan-400">{simSpeed}X SEC</span>
              </div>
              {isHohmannAnimating && (
                <div className="flex justify-between gap-4 border-t border-slate-900 pt-1 mt-1 font-semibold">
                  <span>TRANSFER PHASE:</span>
                  <span className="text-amber-400 uppercase">
                    {hohmannPhase}
                  </span>
                </div>
              )}
            </div>

            {/* Countdown Overlay during transfer */}
            {isHohmannAnimating && hohmannPhase === "coasting" && (
              <div className="absolute top-3 left-3 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-lg font-mono text-xs text-amber-400">
                🚀 Coasting TOF Timeleft: {(hohmannTimeLeft / 60).toFixed(1)}{" "}
                mins
              </div>
            )}
          </div>

          {/* Speed Warp control slider */}
          <div className="w-full">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-medium text-slate-400 font-mono">
                SIMULATION TIME SLIDER
              </span>
              <span className="text-xs font-bold text-slate-200 font-mono">
                {simSpeed}x warp
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="1000"
              value={simSpeed}
              onChange={(e) => setSimSpeed(parseInt(e.target.value))}
              className="w-full accent-indigo-500 bg-slate-950 rounded-lg cursor-pointer h-1.5"
            />
            <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
              <span>Realtime</span>
              <span>GEO Warp (1000x)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
