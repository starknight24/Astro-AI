import React, { useEffect, useRef } from "react";
import * as THREE from "three";

interface LandingPageProps {
  onLaunch: () => void;
}

// Scroll-driven WebGL cinematic ported from the Astro AI design bundle.
// A Three.js scene (planets, moons, galaxies, aurora, camera fly-through) is
// driven imperatively from scroll position; the overlay text/HUD live as DOM
// nodes that the animation loop mutates directly via data-* selectors.
export default function LandingPage({ onLaunch }: LandingPageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const scrollEl = root.querySelector<HTMLElement>("[data-scroll]");
    if (!scrollEl) return;

    const stages = Array.from(root.querySelectorAll("[data-stage]")) as HTMLElement[];
    const q = (sel: string) => root.querySelector<HTMLElement>(sel);
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

    const accent = ["#8b6cff", "#5ef2a8"];
    const motion: string = "Cinematic";
    const showRing: boolean = true;
    const stageNames = ["Departure", "Ascent", "Atlas", "Sandbox", "Deep field", "Overview"];

    let p = 0, pT = 0, mx = 0, my = 0, mxT = 0, myT = 0;
    let raf = 0;
    let loaderHidden = false;
    let loaderFallback = 0, hideTimer = 0;

    let renderer: any, scene: any, camera: any;
    let sky: any, stars: any, motes: any, aurora: any, gal1: any, gal2: any, gal3: any, hero: any;
    let planets: any[] = [], moons: any[] = [], creatures: any[] = [];
    let path: any, looks: any[] = [], _look: any;
    let t0 = 0;

    const onScroll = () => {
      const r = scrollEl.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      pT = total > 0 ? clamp(-r.top / total, 0, 1) : 0;
    };
    const onMove = (e: PointerEvent) => {
      mxT = (e.clientX / window.innerWidth - 0.5) * 2;
      myT = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    const onResize = () => resize();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onMove, { passive: true });

    function softTex() {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const x = c.getContext("2d")!;
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.35, "rgba(255,255,255,.7)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }

    function glowMat(color: any, power: number, scaleSign: number) {
      return new THREE.ShaderMaterial({
        uniforms: { glowColor: { value: new THREE.Color(color) }, pw: { value: power } },
        vertexShader: "varying float vi;uniform float pw;void main(){vec3 vn=normalize(normalMatrix*normal);vec3 ve=normalize(normalMatrix*vec3(0.0,0.0,1.0));vi=pow(max(0.0," + (scaleSign > 0 ? "0.62 - dot(vn,ve)" : "dot(vn,ve)+0.18") + "),pw);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
        fragmentShader: "uniform vec3 glowColor;varying float vi;void main(){gl_FragColor=vec4(glowColor,1.0)*clamp(vi,0.0,1.0);}",
        side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
      });
    }

    function makePlanet(opts: any) {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: opts.color, roughness: 0.85, metalness: 0.1, emissive: new THREE.Color(opts.emissive || opts.color), emissiveIntensity: opts.emI != null ? opts.emI : 0.12, flatShading: !!opts.lowpoly });
      const seg = opts.lowpoly ? 12 : 48;
      const body = new THREE.Mesh(new THREE.SphereGeometry(opts.r, seg, seg), mat);
      g.add(body);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(opts.r * 1.32, 32, 32), glowMat(opts.glow || opts.color, 2.6, 1));
      g.add(glow);
      if (opts.ring) {
        const rg = new THREE.Mesh(new THREE.RingGeometry(opts.r * 1.5, opts.r * 2.55, 80), new THREE.MeshBasicMaterial({ color: opts.ring, side: THREE.DoubleSide, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
        rg.rotation.x = Math.PI * 0.46; rg.rotation.y = 0.2;
        g.add(rg); g.userData.ring = rg;
      }
      g.position.set(opts.pos[0], opts.pos[1], opts.pos[2]);
      g.userData.spin = opts.spin || 0.06;
      g.userData.body = body;
      scene.add(g);
      return g;
    }

    function ridge(W: number, z: number, yBase: number, amp: number, depth: number, color: any, emissive: any) {
      const s = new THREE.Shape();
      s.moveTo(-W / 2, -40); s.lineTo(-W / 2, 0);
      const peaks = 14; let x = -W / 2;
      for (let i = 0; i < peaks; i++) { x += W / peaks; const y = yBase + Math.pow(Math.random(), 1.5) * amp; s.lineTo(x, y); }
      s.lineTo(W / 2, 0); s.lineTo(W / 2, -40); s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: false });
      geo.center();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: color, emissive: new THREE.Color(emissive), emissiveIntensity: 0.25, roughness: 1, metalness: 0, flatShading: true }));
      m.position.set(0, yBase - 6, z);
      scene.add(m);
      return m;
    }

    function initThree() {
      const w = window.innerWidth, h = window.innerHeight;
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x05030f, 0.0019);
      camera = new THREE.PerspectiveCamera(62, w / h, 0.1, 2000);
      camera.position.set(0, 1, 62);

      const violet = accent[0], green = accent[1];

      const mgr = new THREE.LoadingManager();
      const loader = new THREE.TextureLoader(mgr);
      const bar = q("[data-loadbar]");
      mgr.onProgress = (_u: any, a: number, b: number) => { if (bar) bar.style.width = (20 + (a / b) * 80) + "%"; };
      mgr.onLoad = () => hideLoader();
      loaderFallback = window.setTimeout(() => hideLoader(), 4500);

      // lights
      scene.add(new THREE.AmbientLight(0x4452a0, 0.9));
      const sun = new THREE.PointLight(0xfff0d8, 2.2, 600); sun.position.set(40, 30, 20); scene.add(sun);
      const rim = new THREE.DirectionalLight(new THREE.Color(green), 0.5); rim.position.set(-30, 10, -40); scene.add(rim);

      // skybox nebula
      const skyTx = loader.load("/assets/milkyway.jpg");
      sky = new THREE.Mesh(new THREE.SphereGeometry(900, 40, 40), new THREE.MeshBasicMaterial({ map: skyTx, side: THREE.BackSide, color: 0x6a74b0 }));
      scene.add(sky);

      // stars
      const dot = softTex();
      const sg = new THREE.BufferGeometry(); const N = 2600; const pos = new Float32Array(N * 3); const col = new Float32Array(N * 3);
      const cA = new THREE.Color(violet), cB = new THREE.Color(green), cW = new THREE.Color(0xffffff);
      for (let i = 0; i < N; i++) {
        const rr = 70 + Math.random() * 760, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
        pos[i * 3] = rr * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = rr * Math.cos(ph); pos[i * 3 + 2] = rr * Math.sin(ph) * Math.sin(th);
        const c = Math.random() < 0.12 ? cA : (Math.random() < 0.14 ? cB : cW);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      sg.setAttribute("color", new THREE.BufferAttribute(col, 3));
      stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.4, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
      scene.add(stars);

      // planets
      planets = [];
      planets.push(makePlanet({ r: 7, pos: [-18, 3, -25], color: new THREE.Color(violet).multiplyScalar(0.5).getHex(), emissive: violet, glow: violet, emI: 0.25, spin: 0.08 }));
      hero = planets[0];
      const ringPlanet = makePlanet({ r: 6, pos: [16, -3, -70], color: 0x6b5638, emissive: 0xb9863e, glow: 0xe0b46a, emI: 0.3, ring: 0xe6c789, spin: 0.05 });
      if (showRing === false && ringPlanet.userData.ring) ringPlanet.userData.ring.visible = false;
      planets.push(ringPlanet);
      planets.push(makePlanet({ r: 4.2, pos: [-10, 8, -110], color: new THREE.Color(green).multiplyScalar(0.42).getHex(), emissive: green, glow: green, emI: 0.28, spin: 0.1 }));
      planets.push(makePlanet({ r: 2.2, pos: [10, 12, -6], color: 0x355a8c, emissive: 0x4f7fd0, glow: 0x6fa0e6, emI: 0.2, lowpoly: true, spin: 0.18 }));

      // moons around hero
      moons = [];
      for (let i = 0; i < 2; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.7 + i * 0.3, 14, 14), new THREE.MeshStandardMaterial({ color: 0xc9d2f0, roughness: 1, emissive: 0x33405f, emissiveIntensity: 0.3, flatShading: true }));
        scene.add(m); moons.push({ m, r: 11 + i * 4, sp: 0.5 - i * 0.18, ph: i * 2 });
      }

      // galaxies (additive sprites of real photos)
      const mkSprite = (file: string, scale: number, posv: number[], op: number) => {
        const tx = loader.load(file);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, blending: THREE.AdditiveBlending, transparent: true, opacity: op, depthWrite: false }));
        sp.scale.set(scale, scale, 1); sp.position.set(posv[0], posv[1], posv[2]); scene.add(sp); return sp;
      };
      gal1 = mkSprite("/assets/galaxy1.jpg", 120, [-36, 16, -150], 0.9);
      gal2 = mkSprite("/assets/galaxy2.jpg", 70, [34, -14, -55], 0.8);
      gal3 = mkSprite("/assets/saturn.jpg", 34, [26, 6, -30], 0.0);
      gal3.material.opacity = 0;

      // mountains (departure)
      ridge(180, 44, -6, 16, 6, 0x070912, violet);
      ridge(200, 38, -8, 22, 8, 0x05060d, green);
      ridge(220, 30, -12, 30, 10, 0x030409, violet);

      // aurora ribbon
      aurora = new THREE.Mesh(new THREE.PlaneGeometry(260, 90, 1, 1), new THREE.ShaderMaterial({
        uniforms: { t: { value: 0 }, cA: { value: new THREE.Color(green) }, cB: { value: new THREE.Color(violet) } },
        vertexShader: "varying vec2 vu;void main(){vu=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
        fragmentShader: "varying vec2 vu;uniform float t;uniform vec3 cA;uniform vec3 cB;void main(){float band=smoothstep(0.0,0.45,vu.y)*(1.0-smoothstep(0.5,1.0,vu.y));float wv=sin(vu.x*9.0+t*0.7)*0.5+0.5;float wv2=sin(vu.x*17.0-t*0.5)*0.5+0.5;float a=band*(0.35+0.5*wv*wv2);vec3 c=mix(cA,cB,vu.x*0.8+0.1);gl_FragColor=vec4(c,a*0.55);}",
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      }));
      aurora.position.set(0, 18, 8); scene.add(aurora);

      // drifting motes
      const mg = new THREE.BufferGeometry(); const Mn = 420; const mp = new Float32Array(Mn * 3);
      for (let i = 0; i < Mn; i++) { mp[i * 3] = (Math.random() - 0.5) * 120; mp[i * 3 + 1] = (Math.random() - 0.3) * 70; mp[i * 3 + 2] = -(Math.random() * 160) + 20; }
      mg.setAttribute("position", new THREE.BufferAttribute(mp, 3));
      motes = new THREE.Points(mg, new THREE.PointsMaterial({ size: 1.5, map: dot, color: new THREE.Color(green), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
      scene.add(motes);

      // creatures (glowing space drifters)
      creatures = [];
      const cpos = [[-8, 2, -8], [6, -4, -38], [-14, 9, -64], [12, 4, -96], [-4, -6, -120]];
      for (let i = 0; i < cpos.length; i++) {
        const cc = i % 2 ? violet : green;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: new THREE.Color(cc), blending: THREE.AdditiveBlending, transparent: true, opacity: 0.9, depthWrite: false }));
        const sc = 2 + Math.random() * 2; sp.scale.set(sc, sc, 1);
        sp.position.set(cpos[i][0], cpos[i][1], cpos[i][2]); scene.add(sp);
        creatures.push({ sp, base: cpos[i].slice(), sp2: 0.4 + Math.random() * 0.6, ph: Math.random() * 6, amp: 1.5 + Math.random() * 2 });
      }

      // camera path
      path = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1, 62), new THREE.Vector3(3, 7, 40), new THREE.Vector3(-7, 4, 6),
        new THREE.Vector3(9, 0, -40), new THREE.Vector3(-3, 7, -92), new THREE.Vector3(0, 24, -72)
      ]);
      looks = [
        new THREE.Vector3(0, 11, 20), new THREE.Vector3(-12, 3, -22), new THREE.Vector3(16, -3, -70),
        new THREE.Vector3(-10, 8, -110), new THREE.Vector3(-34, 14, -150), new THREE.Vector3(0, -2, -118)
      ];
      _look = new THREE.Vector3().copy(looks[0]);

      onScroll();
      t0 = performance.now();
      raf = requestAnimationFrame(loop);
    }

    function hideLoader() {
      if (loaderHidden) return; loaderHidden = true;
      const l = q("[data-loading]");
      if (l) { l.style.opacity = "0"; hideTimer = window.setTimeout(() => { l.style.display = "none"; }, 800); }
    }

    function updateStages(pp: number) {
      const N = stages.length;
      const centers = [0.05, 0.235, 0.42, 0.6, 0.78, 0.95];
      const hw = 0.12;
      for (let i = 0; i < N; i++) {
        const d = Math.abs(pp - centers[i]) / hw;
        let o = clamp(1 - d, 0, 1); o = o * o * (3 - 2 * o);
        const st = stages[i];
        st.style.opacity = String(o);
        const off = (pp - centers[i]) * 220;
        st.style.transform = "translateY(" + (-off) + "px)";
        st.style.pointerEvents = o > 0.5 ? "auto" : "none";
      }
      let cur = 0, best = 9; for (let i = 0; i < centers.length; i++) { const dd = Math.abs(pp - centers[i]); if (dd < best) { best = dd; cur = i; } }
      const hs = q("[data-hud-stage]"); if (hs) hs.textContent = String(cur + 1).padStart(2, "0");
      const hn = q("[data-hud-name]"); if (hn) hn.textContent = stageNames[cur];
      const cw = q("[data-cuewrap]"); if (cw) cw.style.opacity = String(clamp(1 - pp / 0.08, 0, 1));
    }

    function domLoop() {
      p += (pT - p) * 0.08;
      updateStages(p);
      raf = requestAnimationFrame(domLoop);
    }

    function loop() {
      const now = performance.now(); const t = (now - t0) / 1000;
      const P = motion === "Off" ? 0 : (motion === "Calm" ? 0.55 : 1);
      p += (pT - p) * 0.07;
      mx += (mxT - mx) * 0.05; my += (myT - my) * 0.05;

      // camera along path
      const cp = path.getPoint(clamp(p, 0, 1));
      cp.x += mx * 3 * P; cp.y += -my * 2 * P;
      camera.position.lerp(cp, 0.18);
      const f = clamp(p, 0, 0.999) * (looks.length - 1);
      const li = Math.floor(f); const lf = f - li;
      const target = _look.copy(looks[li]).lerp(looks[Math.min(li + 1, looks.length - 1)], lf);
      target.x += mx * 4 * P; target.y += -my * 3 * P;
      camera.lookAt(target);

      // life
      for (const pl of planets) pl.rotation.y += pl.userData.spin * 0.01 * (0.3 + P);
      if (sky) sky.rotation.y += 0.0004 * (0.3 + P);
      if (stars) stars.rotation.y += 0.0002 * (0.3 + P);
      if (motes) { motes.rotation.y = t * 0.02 * P; motes.position.y = Math.sin(t * 0.3) * 2 * P; }
      if (aurora) aurora.material.uniforms.t.value = t;
      if (gal1) gal1.material.rotation = t * 0.02 * P;
      if (gal2) gal2.material.rotation = -t * 0.015 * P;
      if (hero) {
        for (let i = 0; i < moons.length; i++) {
          const mo = moons[i]; const a = t * mo.sp * (0.4 + P) + mo.ph;
          mo.m.position.set(hero.position.x + Math.cos(a) * mo.r, hero.position.y + Math.sin(a * 0.7) * 2, hero.position.z + Math.sin(a) * mo.r);
        }
      }
      for (const c of creatures) {
        c.sp.position.set(c.base[0] + Math.sin(t * c.sp2 + c.ph) * c.amp, c.base[1] + Math.cos(t * c.sp2 * 0.8 + c.ph) * c.amp, c.base[2] + Math.sin(t * 0.3 + c.ph) * 1.5 * P);
        c.sp.material.opacity = 0.55 + 0.4 * (Math.sin(t * 1.4 + c.ph) * 0.5 + 0.5);
      }

      updateStages(p);
      // HUD readouts
      const hv = q("[data-hud-vel]"); if (hv) hv.textContent = (Math.abs(pT - p) * 4200 + 7.2).toFixed(1);
      const ha = q("[data-hud-alt]"); if (ha) ha.textContent = Math.round(120 + p * 38400).toLocaleString();
      const cue = q("[data-cue]"); if (cue) { const c = (t * 0.5) % 1; cue.style.transform = "translateY(" + (c * 170 - 70) + "%)"; cue.style.opacity = String(c < 0.18 ? c / 0.18 : (c > 0.82 ? (1 - c) / 0.18 : 1)); }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    }

    function resize() {
      if (!renderer) return;
      const w = window.innerWidth, h = window.innerHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      onScroll();
    }

    function fail() {
      const l = q("[data-loading]");
      if (l) l.style.display = "none";
      // No WebGL: drop the canvas so the dark root shows through (readable fallback).
      canvas.style.display = "none";
      onScroll();
      raf = requestAnimationFrame(domLoop);
    }

    onScroll();
    try { initThree(); } catch (e) { console.warn("three init failed", e); fail(); }

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(loaderFallback);
      clearTimeout(hideTimer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      // Dispose Three's resources but do NOT forceContextLoss(): under React
      // StrictMode the effect remounts on the same <canvas>, and a force-lost
      // context cannot be re-acquired (canvas would render white/broken).
      try { if (renderer) renderer.dispose(); } catch (e) { /* noop */ }
    };
  }, []);

  const launch = (e: React.MouseEvent) => { e.preventDefault(); onLaunch(); };
  const noop = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div
      data-root=""
      ref={rootRef}
      style={{ position: "relative", background: "#03040a", color: "#eef0fb", fontFamily: "'Archivo', sans-serif", overflowX: "clip" }}
    >
      <canvas
        data-canvas=""
        ref={canvasRef}
        style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", zIndex: 0, display: "block" }}
      />

      {/* atmospheric tint over canvas */}
      <div style={{ position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none", background: "radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(3,4,12,.55) 92%, rgba(3,4,12,.92) 100%)" }} />

      {/* LOADING */}
      <div data-loading="" style={{ position: "fixed", inset: 0, zIndex: 30, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "18px", background: "#03040a", transition: "opacity .8s ease" }}>
        <div style={{ fontFamily: "'Archivo Expanded', sans-serif", fontWeight: 800, letterSpacing: "0.22em", fontSize: "14px", color: "#eef0fb" }}>ASTRO&nbsp;AI</div>
        <div style={{ width: "140px", height: "2px", background: "rgba(255,255,255,.12)", overflow: "hidden", borderRadius: "2px" }}>
          <div data-loadbar="" style={{ width: "18%", height: "100%", background: "linear-gradient(90deg,#8b6cff,#5ef2a8)", transition: "width .4s ease" }} />
        </div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10.5px", letterSpacing: "0.34em", textTransform: "uppercase", color: "#7a7f9c" }}>Spinning up the sky</div>
      </div>

      {/* SCROLL TRACK */}
      <div data-scroll="" style={{ position: "relative", height: "660vh", zIndex: 2 }}>
        <div data-overlay="" style={{ position: "sticky", top: 0, height: "100vh", overflow: "hidden", pointerEvents: "none" }}>

          {/* NAV */}
          <nav style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "24px", padding: "26px clamp(22px,4vw,56px)", pointerEvents: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
              <svg viewBox="0 0 32 32" style={{ width: "26px", height: "26px", flex: "none" }}>
                <circle cx="16" cy="16" r="7.5" fill="none" stroke="#eef0fb" strokeWidth="1.5" />
                <ellipse cx="16" cy="16" rx="14" ry="5" fill="none" stroke="#5ef2a8" strokeWidth="1.3" transform="rotate(-24 16 16)" />
                <circle cx="27.5" cy="9.5" r="1.5" fill="#8b6cff" />
              </svg>
              <span style={{ fontFamily: "'Archivo Expanded', sans-serif", fontWeight: 800, letterSpacing: "0.16em", fontSize: "15px" }}>ASTRO&nbsp;AI</span>
            </div>
            <a href="#" onClick={launch} style={{ fontFamily: "'Space Mono', monospace", fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase", textDecoration: "none", color: "#06121a", background: "linear-gradient(120deg,#8b6cff,#5ef2a8)", padding: "11px 18px", borderRadius: "100px", fontWeight: 700 }}>Launch app</a>
          </nav>

          {/* STAGES */}
          <div data-stage={0} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 6vw", opacity: 1, willChange: "transform, opacity" }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "clamp(10px,1vw,13px)", letterSpacing: "0.36em", textTransform: "uppercase", color: "#9aa0bd", marginBottom: "26px" }}>Astronomy, reimagined</div>
            <h2 style={{ margin: 0, fontFamily: "'Archivo Expanded', sans-serif", fontWeight: 800, lineHeight: "0.86", letterSpacing: "-0.02em", textTransform: "uppercase", fontSize: "clamp(56px,13vw,210px)", textShadow: "0 10px 80px rgba(4,6,24,.8)" }}>Become<br />Weightless</h2>
            <p style={{ margin: "30px 0 0", maxWidth: "540px", fontSize: "clamp(15px,1.5vw,20px)", lineHeight: 1.55, color: "#c4c8e0" }}>An astronomy platform for the next generation of space engineers. Step off the dashboard — and into the sky.</p>
          </div>

          <div data-stage={1} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 6vw", opacity: 0, willChange: "transform, opacity" }}>
            <h2 style={{ margin: 0, fontFamily: "'Archivo Expanded', sans-serif", fontWeight: 800, lineHeight: "0.86", letterSpacing: "-0.02em", textTransform: "uppercase", fontSize: "clamp(52px,12vw,190px)", textShadow: "0 10px 80px rgba(4,6,24,.8)" }}>The Sky<br />Isn't Flat</h2>
            <p style={{ margin: "28px 0 0", maxWidth: "500px", fontSize: "clamp(15px,1.5vw,20px)", lineHeight: 1.55, color: "#c4c8e0" }}>It was never a chart on a wall. It's a place — and you're already moving through it.</p>
          </div>

          <div data-stage={2} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", textAlign: "left", padding: "0 clamp(28px,8vw,140px)", opacity: 0, willChange: "transform, opacity" }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "13px", letterSpacing: "0.28em", textTransform: "uppercase", color: "#5ef2a8", marginBottom: "20px" }}>01 — Live sky atlas</div>
            <h2 style={{ margin: 0, fontFamily: "'Archivo Expanded', sans-serif", fontWeight: 800, lineHeight: "0.88", letterSpacing: "-0.02em", textTransform: "uppercase", fontSize: "clamp(48px,10.5vw,168px)" }}>Worlds<br />To Scale</h2>
            <p style={{ margin: "26px 0 0", maxWidth: "430px", fontSize: "clamp(15px,1.4vw,19px)", lineHeight: 1.55, color: "#c4c8e0" }}>Orbit 100,000+ catalogued bodies, rendered where they actually live in space.</p>
          </div>

          <div data-stage={3} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", textAlign: "right", padding: "0 clamp(28px,8vw,140px)", opacity: 0, willChange: "transform, opacity" }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "13px", letterSpacing: "0.28em", textTransform: "uppercase", color: "#5ef2a8", marginBottom: "20px" }}>02 — Physics sandbox</div>
            <h2 style={{ margin: 0, fontFamily: "'Archivo Expanded', sans-serif", fontWeight: 800, lineHeight: "0.88", letterSpacing: "-0.02em", textTransform: "uppercase", fontSize: "clamp(48px,10.5vw,168px)" }}>Feel<br />The Math</h2>
            <p style={{ margin: "26px 0 0", maxWidth: "430px", fontSize: "clamp(15px,1.4vw,19px)", lineHeight: 1.55, color: "#c4c8e0" }}>Plan burns and transfers in a place where every number has gravity behind it.</p>
          </div>

          <div data-stage={4} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 6vw", opacity: 0, willChange: "transform, opacity" }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "13px", letterSpacing: "0.28em", textTransform: "uppercase", color: "#5ef2a8", marginBottom: "20px" }}>03 — AI co-pilot</div>
            <h2 style={{ margin: 0, fontFamily: "'Archivo Expanded', sans-serif", fontWeight: 800, lineHeight: "0.86", letterSpacing: "-0.02em", textTransform: "uppercase", fontSize: "clamp(50px,11.5vw,182px)" }}>Ask The<br />Universe</h2>
            <p style={{ margin: "28px 0 0", maxWidth: "500px", fontSize: "clamp(15px,1.5vw,20px)", lineHeight: 1.55, color: "#c4c8e0" }}>Derivations, not just answers. A co-pilot that thinks in trajectories and shows its work.</p>
          </div>

          <div data-stage={5} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 6vw", opacity: 0, willChange: "transform, opacity" }}>
            <h2 style={{ margin: 0, fontFamily: "'Archivo Expanded', sans-serif", fontWeight: 800, lineHeight: "0.86", letterSpacing: "-0.02em", textTransform: "uppercase", fontSize: "clamp(50px,11.5vw,184px)", textShadow: "0 10px 80px rgba(4,6,24,.8)" }}>Begin Your<br />First Orbit</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginTop: "38px", flexWrap: "wrap", justifyContent: "center", pointerEvents: "auto" }}>
              <a href="#" onClick={launch} style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 600, fontSize: "16px", textDecoration: "none", color: "#06121a", background: "linear-gradient(120deg,#8b6cff,#5ef2a8)", padding: "16px 32px", borderRadius: "100px", boxShadow: "0 10px 50px rgba(139,108,255,.4)" }}>Start exploring</a>
              <a href="#" onClick={noop} style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 500, fontSize: "16px", textDecoration: "none", color: "#eef0fb", border: "1px solid rgba(255,255,255,.24)", padding: "15px 28px", borderRadius: "100px", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>Watch the journey</a>
            </div>
            <div style={{ marginTop: "22px", fontFamily: "'Space Mono', monospace", fontSize: "11.5px", letterSpacing: "0.24em", textTransform: "uppercase", color: "#9aa0bd" }}>No telescope required</div>
          </div>

          {/* HUD */}
          <div data-hud="left" style={{ position: "absolute", left: "clamp(22px,4vw,56px)", bottom: "26px", zIndex: 12, fontFamily: "'Space Mono', monospace", fontSize: "11.5px", letterSpacing: "0.16em", textTransform: "uppercase", color: "#9aa0bd" }}>
            <div style={{ color: "#eef0fb" }}>Stage <span data-hud-stage="">01</span> / 06</div>
            <div data-hud-name="" style={{ marginTop: "4px" }}>Departure</div>
          </div>
          <div data-hud="right" style={{ position: "absolute", right: "clamp(22px,4vw,56px)", bottom: "26px", zIndex: 12, textAlign: "right", fontFamily: "'Space Mono', monospace", fontSize: "11.5px", letterSpacing: "0.16em", textTransform: "uppercase", color: "#9aa0bd" }}>
            <div style={{ color: "#eef0fb" }}>VEL <span data-hud-vel="">0.0</span> km/s</div>
            <div style={{ marginTop: "4px" }}>ALT <span data-hud-alt="">0</span> km</div>
          </div>

          {/* SCROLL CUE */}
          <div data-cuewrap="" style={{ position: "absolute", left: "50%", bottom: "24px", transform: "translateX(-50%)", zIndex: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "10.5px", letterSpacing: "0.32em", textTransform: "uppercase", color: "#9aa0bd" }}>Scroll to fly</span>
            <span style={{ position: "relative", width: "1px", height: "46px", background: "rgba(255,255,255,.16)", overflow: "hidden" }}>
              <span data-cue="" style={{ position: "absolute", left: 0, top: 0, width: "1px", height: "50%", background: "linear-gradient(#5ef2a8,transparent)" }} />
            </span>
          </div>

        </div>
      </div>
    </div>
  );
}
