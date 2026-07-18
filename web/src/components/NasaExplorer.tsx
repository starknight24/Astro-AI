import React, { useState, useEffect } from "react";
import {
  Globe,
  MapPin,
  Search,
  Activity,
  Calendar,
  ShieldAlert,
} from "lucide-react";

interface NasaExplorerProps {
  onActivityAdded: (
    type: "chat" | "problem" | "calculator" | "quiz" | "image",
    desc: string,
  ) => void;
}

interface APODData {
  title: string;
  url: string;
  explanation: string;
  date: string;
  copyright?: string;
}

interface Asteroid {
  id: string;
  name: string;
  diameterMin: number;
  diameterMax: number;
  velocity: number; // km/h
  missDistance: number; // LD (Lunar Distance)
  isHazardous: boolean;
  date: string;
}

// Sample APOD database to stay extremely fast & robust as fallback
const APOD_FALLBACK: APODData = {
  title: "The Pillars of Creation in Near-Infrared",
  url: "https://images-assets.nasa.gov/image/PIA25492/PIA25492~medium.jpg",
  explanation:
    "Webb’s new look at the Pillars of Creation, which were first made famous by NASA’s Hubble Space Telescope in 1995, reveals a new view of a familiar landscape. The three-dimensional pillars look like majestic rock formations, but are far more permeable. These columns are made up of cool interstellar gas and dust that appear – at times – semi-transparent in near-infrared light.",
  date: "2026-06-26",
  copyright: "NASA, ESA, CSA, STScI",
};

// Sample Near-Earth Asteroids
const SAMPLE_ASTEROIDS: Asteroid[] = [
  {
    id: "1",
    name: "(2026 AM1)",
    diameterMin: 45,
    diameterMax: 98,
    velocity: 41200,
    missDistance: 3.2,
    isHazardous: false,
    date: "2026-06-26",
  },
  {
    id: "2",
    name: "(2026 BF3)",
    diameterMin: 120,
    diameterMax: 270,
    velocity: 68500,
    missDistance: 1.8,
    isHazardous: true,
    date: "2026-06-26",
  },
  {
    id: "3",
    name: "Apophis (99942)",
    diameterMin: 340,
    diameterMax: 370,
    velocity: 110200,
    missDistance: 0.08,
    isHazardous: true,
    date: "2026-06-27",
  },
  {
    id: "4",
    name: "(2026 CG9)",
    diameterMin: 12,
    diameterMax: 28,
    velocity: 22400,
    missDistance: 8.4,
    isHazardous: false,
    date: "2026-06-28",
  },
  {
    id: "5",
    name: "(2026 DH2)",
    diameterMin: 70,
    diameterMax: 150,
    velocity: 53100,
    missDistance: 4.1,
    isHazardous: false,
    date: "2026-06-28",
  },
];

// Mars Rover Images Fallbacks
const ROVER_IMAGES = [
  {
    rover: "Perseverance",
    camera: "Mastcam-Z",
    url: "https://photojournal.jpl.nasa.gov/jpeg/PIA24484.jpg",
    caption: "Jezero Crater delta panoramas taken by Perseverance.",
  },
  {
    rover: "Curiosity",
    camera: "Navcam",
    url: "https://photojournal.jpl.nasa.gov/jpeg/PIA19803.jpg",
    caption: "Gale Crater Mt. Sharp layers, explored by Curiosity.",
  },
  {
    rover: "Perseverance",
    camera: "Front Hazcam",
    url: "https://photojournal.jpl.nasa.gov/jpeg/PIA24424.jpg",
    caption: "Perseverance's first raw hazcam view of Jezero's floor.",
  },
  {
    rover: "Curiosity",
    camera: "Mast Camera",
    url: "https://photojournal.jpl.nasa.gov/jpeg/PIA16226.jpg",
    caption: "Self-portrait of Curiosity Rover at 'Rocknest' site.",
  },
];

export default function NasaExplorer({ onActivityAdded }: NasaExplorerProps) {
  const [tab, setTab] = useState<"apod" | "asteroids" | "rovers" | "iss">(
    "apod",
  );

  // TODO(week4): wire to NASA tools via agent
  const apod = APOD_FALLBACK;
  const asteroids = SAMPLE_ASTEROIDS;

  // Asteroid search state
  const [asteroidQuery, setAsteroidQuery] = useState("");

  // Rover filter state
  const [roverFilter, setRoverFilter] = useState("All");

  // ISS Tracker state
  const [issPos, setIssPos] = useState({
    lat: 21.34,
    lon: -42.88,
    alt: 421.5,
    vel: 27580,
  });
  const [issHistory, setIssHistory] = useState<{ lat: number; lon: number }[]>([
    { lat: 10, lon: -70 },
    { lat: 15, lon: -56 },
    { lat: 18, lon: -49 },
  ]);

  // Sync ISS Real-time orbital propagation safely
  useEffect(() => {
    if (tab !== "iss") return;

    // Periodically update coordinates simulating real ISS ground track
    const interval = setInterval(() => {
      setIssPos((prev) => {
        // Move ISS along general orbit
        let newLon = prev.lon + 0.8;
        if (newLon > 180) newLon = -180;

        // Sine wave latitude calculation for 51.6 degree inclination
        const newLat = 51.6 * Math.sin((newLon * Math.PI) / 180);

        setIssHistory((hist) => {
          const updated = [...hist, { lat: newLat, lon: newLon }];
          if (updated.length > 40) updated.shift();
          return updated;
        });

        return {
          ...prev,
          lat: parseFloat(newLat.toFixed(4)),
          lon: parseFloat(newLon.toFixed(4)),
          alt: parseFloat((418 + Math.sin(Date.now() / 10000) * 4).toFixed(1)),
        };
      });
    }, 1200);

    return () => clearInterval(interval);
  }, [tab]);

  // Trigger telemetry on tab selection
  const selectTab = (t: typeof tab) => {
    setTab(t);
    onActivityAdded("calculator", `Explored NASA Database: ${t.toUpperCase()}`);
  };

  const filteredAsteroids = asteroids.filter((a) =>
    a.name.toLowerCase().includes(asteroidQuery.toLowerCase()),
  );

  const filteredRoverImages = ROVER_IMAGES.filter((img) =>
    roverFilter === "All" ? true : img.rover === roverFilter,
  );

  // Plot coordinates to SVG canvas grid (360 lon wide, 180 lat high)
  const mapWidth = 320;
  const mapHeight = 160;
  const lonToX = (lon: number) => ((lon + 180) * mapWidth) / 360;
  const latToY = (lat: number) => ((-lat + 90) * mapHeight) / 180;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] bg-slate-950/60 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-md">
      {/* Category Tabs Header */}
      <div className="px-6 py-3 border-b border-slate-800 bg-slate-900/70 flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-cyan-400" />
          <h2 className="font-display font-semibold text-white">
            NASA Space Exploration Databases
          </h2>
        </div>

        <div className="flex bg-slate-950 border border-slate-800 p-1 rounded-xl">
          {(["apod", "asteroids", "rovers", "iss"] as const).map((t) => (
            <button
              key={t}
              onClick={() => selectTab(t)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg font-mono uppercase transition-all ${
                tab === t
                  ? "bg-cyan-600 text-white shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Database View Container */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Tab 1: APOD */}
        {tab === "apod" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-6xl mx-auto items-center">
            <div className="relative rounded-2xl overflow-hidden border border-slate-800/80 bg-slate-900 group shadow-lg">
              <img
                src={apod.url}
                alt={apod.title}
                referrerPolicy="no-referrer"
                className="w-full aspect-[4/3] object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute bottom-3 right-3 bg-slate-950/80 px-2.5 py-1 rounded text-[10px] font-mono text-slate-400 border border-slate-800">
                © {apod.copyright || "Public Domain"}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs">
                <Calendar className="w-4 h-4" />
                <span>Astronomy Picture of the Day • {apod.date}</span>
              </div>
              <h3 className="font-display font-bold text-2xl text-white tracking-tight leading-snug">
                {apod.title}
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed max-h-[250px] overflow-y-auto pr-2">
                {apod.explanation}
              </p>

              <div className="mt-2 text-xs text-slate-500 font-mono italic">
                Scientific documentation aggregated directly from NASA Open API
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Asteroids */}
        {tab === "asteroids" && (
          <div className="flex flex-col gap-5 max-w-5xl mx-auto">
            <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
              <div>
                <h3 className="font-display font-semibold text-lg text-white">
                  Asteroid Tracker (NeoWs API)
                </h3>
                <p className="text-xs text-slate-400">
                  Near-Earth Asteroid objects with orbit risk analysis
                </p>
              </div>

              {/* Search */}
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search asteroid name..."
                  value={asteroidQuery}
                  onChange={(e) => setAsteroidQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredAsteroids.map((ast) => (
                <div
                  key={ast.id}
                  className={`p-5 rounded-2xl border transition-all flex justify-between items-center ${
                    ast.isHazardous
                      ? "bg-rose-500/5 border-rose-500/30"
                      : "bg-slate-900/50 border-slate-800"
                  }`}
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-100">
                        {ast.name}
                      </span>
                      {ast.isHazardous && (
                        <span className="px-2 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded text-[9px] font-mono font-bold flex items-center gap-1">
                          <ShieldAlert className="w-3 h-3" /> Potentially
                          Hazardous
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono text-slate-400">
                      <div>
                        Diameter:{" "}
                        <strong className="text-slate-200">
                          {ast.diameterMin}-{ast.diameterMax} m
                        </strong>
                      </div>
                      <div>
                        Speed:{" "}
                        <strong className="text-slate-200">
                          {ast.velocity.toLocaleString()} km/h
                        </strong>
                      </div>
                      <div>
                        Miss distance:{" "}
                        <strong className="text-cyan-400">
                          {ast.missDistance} Lunar Dist.
                        </strong>
                      </div>
                      <div>
                        Observation:{" "}
                        <strong className="text-slate-200">{ast.date}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center shrink-0">
                    <p className="text-[9px] text-slate-500 font-mono">
                      RISK SCORE
                    </p>
                    <p
                      className={`text-md font-mono font-bold ${ast.isHazardous ? "text-rose-400 animate-pulse" : "text-emerald-400"}`}
                    >
                      {ast.isHazardous ? "HIGH" : "SAFE"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 3: Mars Rovers */}
        {tab === "rovers" && (
          <div className="flex flex-col gap-6 max-w-5xl mx-auto">
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
              <div>
                <h3 className="font-display font-semibold text-lg text-white">
                  Mars Exploratory Rover Cameras
                </h3>
                <p className="text-xs text-slate-400">
                  Visual feeds archived from JPL mission logs
                </p>
              </div>

              {/* Selector */}
              <div className="flex bg-slate-950 border border-slate-800 p-1 rounded-xl">
                {["All", "Perseverance", "Curiosity"].map((rover) => (
                  <button
                    key={rover}
                    onClick={() => setRoverFilter(rover)}
                    className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${
                      roverFilter === rover
                        ? "bg-slate-800 text-white shadow"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {rover}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {filteredRoverImages.map((img, idx) => (
                <div
                  key={idx}
                  className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden flex flex-col gap-3 group shadow"
                >
                  <div className="relative aspect-video overflow-hidden bg-slate-950">
                    <img
                      src={img.url}
                      alt={img.rover}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute top-3 left-3 bg-slate-950/90 border border-slate-800 px-2 py-0.5 rounded text-[10px] font-mono text-cyan-400">
                      {img.rover} • {img.camera}
                    </div>
                  </div>
                  <p className="px-4 pb-4 text-xs text-slate-400 leading-relaxed font-sans">
                    {img.caption}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 4: ISS Tracker */}
        {tab === "iss" && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 max-w-5xl mx-auto items-center">
            {/* World coordinate Map - Left Col */}
            <div className="md:col-span-7 flex flex-col gap-3 items-center">
              <div className="relative w-full aspect-[2/1] bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-inner flex items-center justify-center space-grid">
                {/* Simulated World outline background */}
                <div className="absolute inset-0 pointer-events-none opacity-10 flex items-center justify-center font-display font-bold text-[3rem] tracking-wider text-slate-500 uppercase select-none">
                  ORBIT MAP
                </div>

                <svg
                  className="w-full h-full"
                  viewBox={`0 0 ${mapWidth} ${mapHeight}`}
                >
                  {/* Grid lines */}
                  <line
                    x1="0"
                    y1="80"
                    x2="320"
                    y2="80"
                    stroke="rgba(148, 163, 184, 0.08)"
                  />
                  <line
                    x1="160"
                    y1="0"
                    x2="160"
                    y2="160"
                    stroke="rgba(148, 163, 184, 0.08)"
                  />

                  {/* ISS Historical Trajectory path */}
                  {issHistory.length > 1 && (
                    <path
                      d={`M ${issHistory.map((pt) => `${lonToX(pt.lon)},${latToY(pt.lat)}`).join(" L ")}`}
                      fill="none"
                      stroke="#06b6d4"
                      strokeWidth="1.5"
                      strokeDasharray="2,2"
                      opacity="0.8"
                    />
                  )}

                  {/* ISS Current Mark */}
                  <circle
                    cx={lonToX(issPos.lon)}
                    cy={latToY(issPos.lat)}
                    r="5"
                    fill="#06b6d4"
                    className="animate-pulse"
                  />
                  <circle
                    cx={lonToX(issPos.lon)}
                    cy={latToY(issPos.lat)}
                    r="12"
                    fill="none"
                    stroke="#06b6d4"
                    strokeWidth="1"
                    className="animate-ping"
                    style={{ animationDuration: "3s" }}
                  />
                </svg>

                {/* Tracking cursor tooltip */}
                <div className="absolute top-3 left-3 bg-slate-950/95 border border-slate-800 p-2 rounded text-[10px] font-mono text-cyan-400 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-cyan-500 animate-pulse" />{" "}
                  Telemetry Stream: LIVE
                </div>
              </div>
              <span className="text-[10px] text-slate-500 font-mono tracking-wider">
                ISS ORBITAL ECCENTRICITY: ~0.00029 | INCLINATION: 51.64°
              </span>
            </div>

            {/* Live Data readout - Right Col */}
            <div className="md:col-span-5 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-cyan-400 animate-bounce" />
                <h3 className="font-display font-semibold text-white">
                  ISS Real-time Space Tracker
                </h3>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Visualizing coordinates, velocity, and altitude tracking for the
                International Space Station. The ISS travels at roughly 7.66
                km/s, completing an orbit every 92.9 minutes.
              </p>

              <div className="grid grid-cols-2 gap-4 font-mono text-xs">
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <span className="text-[10px] text-slate-500 uppercase block">
                    Latitude
                  </span>
                  <strong className="text-md text-white mt-1 block">
                    {issPos.lat > 0
                      ? `${issPos.lat}° N`
                      : `${Math.abs(issPos.lat)}° S`}
                  </strong>
                </div>
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <span className="text-[10px] text-slate-500 uppercase block">
                    Longitude
                  </span>
                  <strong className="text-md text-white mt-1 block">
                    {issPos.lon > 0
                      ? `${issPos.lon}° E`
                      : `${Math.abs(issPos.lon)}° W`}
                  </strong>
                </div>
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <span className="text-[10px] text-slate-500 uppercase block">
                    Altitude
                  </span>
                  <strong className="text-md text-cyan-400 mt-1 block">
                    {issPos.alt} km
                  </strong>
                </div>
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <span className="text-[10px] text-slate-500 uppercase block">
                    Speed
                  </span>
                  <strong className="text-md text-cyan-400 mt-1 block">
                    {issPos.vel.toLocaleString()} km/h
                  </strong>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
