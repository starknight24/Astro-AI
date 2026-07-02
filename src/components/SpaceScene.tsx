import { useEffect, useRef } from "react";
import * as THREE from "three";

interface Props {
  scrollProgress: number;
}

function makeGlowSprite(color: string, size: number, x: number, y: number, z: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, color);
  g.addColorStop(0.4, color.replace("1)", "0.2)"));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  sprite.position.set(x, y, z);
  return sprite;
}

function makePlanet(radius: number, color: number, emissive: number, emissiveInt: number, x: number, y: number, z: number) {
  const geo = new THREE.SphereGeometry(radius, 64, 64);
  const mat = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: emissiveInt, roughness: 0.7, metalness: 0.1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function makeNebula(count: number, spread: number, cx: number, cy: number, cz: number, col: THREE.Color) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = cx + (Math.random() - 0.5) * spread;
    pos[i * 3 + 1] = cy + (Math.random() - 0.5) * spread * 0.4;
    pos[i * 3 + 2] = cz + (Math.random() - 0.5) * spread;
    const br = 0.4 + Math.random() * 0.6;
    colors[i * 3] = col.r * br;
    colors[i * 3 + 1] = col.g * br;
    colors[i * 3 + 2] = col.b * br;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.7, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true }));
}

function makeMountainSilhouette() {
  const shape = new THREE.Shape();
  shape.moveTo(-300, 0);
  const peaks = [
    -280, 8, -250, 18, -220, 7, -195, 28, -165, 12,
    -140, 38, -110, 15, -80, 32, -55, 10, -30, 45,
    0, 20, 25, 40, 55, 16, 80, 50, 110, 22,
    140, 35, 165, 8, 195, 28, 220, 10, 250, 20, 280, 5,
  ];
  for (let i = 0; i < peaks.length; i += 2) shape.lineTo(peaks[i], peaks[i + 1]);
  shape.lineTo(300, 0);
  shape.lineTo(300, -40);
  shape.lineTo(-300, -40);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const mat = new THREE.MeshBasicMaterial({ color: 0x020210, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, -28, 25);
  return mesh;
}

export default function SpaceScene({ scrollProgress }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef(0);

  useEffect(() => {
    scrollRef.current = scrollProgress;
  }, [scrollProgress]);

  useEffect(() => {
    if (!mountRef.current) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000008);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mountRef.current.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000008, 0.006);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(0, 5, 80);

    // Lights
    scene.add(new THREE.AmbientLight(0x111133, 0.6));
    const sunLight = new THREE.PointLight(0xffeedd, 4, 400);
    sunLight.position.set(-80, 50, -100);
    scene.add(sunLight);
    const blueLight = new THREE.PointLight(0x3355ff, 2.5, 300);
    blueLight.position.set(100, -20, -80);
    scene.add(blueLight);
    const purpleLight = new THREE.PointLight(0x9933ff, 2, 250);
    purpleLight.position.set(-50, 60, 30);
    scene.add(purpleLight);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const SC = 7000;
    const starPos = new Float32Array(SC * 3);
    const starCol = new Float32Array(SC * 3);
    const starPalette = [new THREE.Color(0xffffff), new THREE.Color(0xaacfff), new THREE.Color(0xffddaa), new THREE.Color(0xffaacc)];
    for (let i = 0; i < SC; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 1200;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 1200;
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 1200;
      const c = starPalette[Math.floor(Math.random() * starPalette.length)];
      starCol[i * 3] = c.r; starCol[i * 3 + 1] = c.g; starCol[i * 3 + 2] = c.b;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(starCol, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 0.4, vertexColors: true, sizeAttenuation: true }));
    scene.add(stars);

    // Main planet (hero) — large blue gas giant
    const mainPlanet = makePlanet(18, 0x0d2d5e, 0x0033bb, 0.4, 0, -8, -40);
    scene.add(mainPlanet);
    scene.add(makeGlowSprite("rgba(30,70,255,1)", 90, 0, -8, -40));

    // Planet rings
    const ringGeo = new THREE.RingGeometry(22, 38, 128);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x4466bb, side: THREE.DoubleSide, transparent: true, opacity: 0.12 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI * 0.72;
    ring.position.set(0, -8, -40);
    scene.add(ring);

    // Outer ring glow
    const ringGlow = makeGlowSprite("rgba(60,100,220,1)", 140, 0, -8, -40);
    ringGlow.scale.set(200, 60, 1);
    scene.add(ringGlow);

    // Mars-like planet
    const mars = makePlanet(9, 0x7a2200, 0x3d1100, 0.5, -90, 25, -160);
    scene.add(mars);
    scene.add(makeGlowSprite("rgba(160,50,10,1)", 45, -90, 25, -160));

    // Jade / teal planet
    const jade = makePlanet(13, 0x083a2d, 0x004422, 0.4, 130, -25, -220);
    scene.add(jade);
    scene.add(makeGlowSprite("rgba(0,150,80,1)", 60, 130, -25, -220));

    // Sun (distant)
    const sunMesh = makePlanet(28, 0xff7700, 0xff4400, 1.8, -170, 65, -300);
    scene.add(sunMesh);
    scene.add(makeGlowSprite("rgba(255,120,0,1)", 160, -170, 65, -300));
    const sunMat = sunMesh.material as THREE.MeshStandardMaterial;

    // Small moon near main planet
    const moon = makePlanet(3, 0x888899, 0x444455, 0.1, 28, 5, -50);
    scene.add(moon);

    // Nebula clouds
    const nebulas = [
      makeNebula(1200, 55, -35, 25, -90, new THREE.Color(0.3, 0.1, 0.9)),
      makeNebula(900, 45, 60, -12, -140, new THREE.Color(0.1, 0.5, 0.9)),
      makeNebula(1000, 60, -70, 35, -200, new THREE.Color(0.8, 0.1, 0.5)),
      makeNebula(700, 35, 90, 15, -120, new THREE.Color(0.1, 0.8, 0.5)),
      makeNebula(1500, 80, 15, -15, -280, new THREE.Color(0.5, 0.1, 1.0)),
      makeNebula(800, 40, -100, -10, -180, new THREE.Color(0.9, 0.4, 0.1)),
    ];
    nebulas.forEach(n => scene.add(n));

    // Galaxy spiral
    const galGeo = new THREE.BufferGeometry();
    const GC = 10000;
    const galPos = new Float32Array(GC * 3);
    const galCol = new Float32Array(GC * 3);
    const gCX = 220, gCY = -70, gCZ = -450;
    for (let i = 0; i < GC; i++) {
      const arm = Math.floor(Math.random() * 3);
      const angle = (arm / 3) * Math.PI * 2 + (Math.random() - 0.5) * 1.2;
      const r = Math.random() * 90 + 5;
      const spin = r * 0.28;
      galPos[i * 3] = gCX + Math.cos(angle + spin) * r + (Math.random() - 0.5) * 12;
      galPos[i * 3 + 1] = gCY + (Math.random() - 0.5) * 8;
      galPos[i * 3 + 2] = gCZ + Math.sin(angle + spin) * r * 0.6 + (Math.random() - 0.5) * 12;
      const t = r / 90;
      const c = new THREE.Color().lerpColors(new THREE.Color(0xffffff), new THREE.Color(0x3311ff), t);
      galCol[i * 3] = c.r; galCol[i * 3 + 1] = c.g; galCol[i * 3 + 2] = c.b;
    }
    galGeo.setAttribute("position", new THREE.BufferAttribute(galPos, 3));
    galGeo.setAttribute("color", new THREE.BufferAttribute(galCol, 3));
    const galaxy = new THREE.Points(galGeo, new THREE.PointsMaterial({ size: 0.35, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.8, depthWrite: false, sizeAttenuation: true }));
    scene.add(galaxy);

    // Asteroids
    const asteroidGroup = new THREE.Group();
    for (let i = 0; i < 60; i++) {
      const geo = new THREE.IcosahedronGeometry(Math.random() * 1.8 + 0.3, 0);
      const mat = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.9 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((Math.random() - 0.5) * 250, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 350 - 50);
      mesh.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
      asteroidGroup.add(mesh);
    }
    scene.add(asteroidGroup);

    // Mountains
    scene.add(makeMountainSilhouette());

    // Camera path waypoints (8 stops across scroll 0..1)
    const camPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 5, 80),
      new THREE.Vector3(-15, 12, 45),
      new THREE.Vector3(-35, 18, 5),
      new THREE.Vector3(15, 2, -35),
      new THREE.Vector3(50, -8, -80),
      new THREE.Vector3(-15, 22, -130),
      new THREE.Vector3(25, -5, -180),
      new THREE.Vector3(0, 8, -230),
    ]);

    const lookPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -2, 0),
      new THREE.Vector3(-8, 5, 25),
      new THREE.Vector3(-22, 8, -25),
      new THREE.Vector3(8, -2, -75),
      new THREE.Vector3(35, -15, -130),
      new THREE.Vector3(-5, 18, -170),
      new THREE.Vector3(18, -8, -220),
      new THREE.Vector3(0, 2, -320),
    ]);

    let smoothT = 0;
    const camPos = new THREE.Vector3(0, 5, 80);
    const camLook = new THREE.Vector3(0, -2, 0);
    const clock = new THREE.Clock();
    let raf: number;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      // Smooth scroll interpolation
      const targetT = scrollRef.current;
      smoothT += (targetT - smoothT) * 0.035;
      const clampedT = Math.max(0, Math.min(0.9999, smoothT));

      camPos.lerp(camPath.getPoint(clampedT), 0.06);
      camLook.lerp(lookPath.getPoint(clampedT), 0.06);
      camera.position.copy(camPos);
      camera.lookAt(camLook);

      // Slow planet rotations
      mainPlanet.rotation.y += 0.0006;
      mars.rotation.y += 0.001;
      jade.rotation.y += 0.0004;
      sunMesh.rotation.y += 0.0002;
      moon.rotation.y += 0.003;
      ring.rotation.z += 0.0003;

      // Pulsing sun
      sunMat.emissiveIntensity = 1.6 + Math.sin(t * 1.2) * 0.4;

      // Moon orbit
      moon.position.x = 28 + Math.cos(t * 0.3) * 14;
      moon.position.y = 5 + Math.sin(t * 0.2) * 4;
      moon.position.z = -50 + Math.sin(t * 0.3) * 10;

      // Galaxy slow spin
      galaxy.rotation.y += 0.00008;
      stars.rotation.y += 0.00003;

      // Asteroid drift
      asteroidGroup.children.forEach((a, i) => {
        a.rotation.x += 0.002 * (i % 2 === 0 ? 1 : -1);
        a.rotation.z += 0.003 * (i % 3 === 0 ? 1 : -1);
        (a as THREE.Mesh).position.y += Math.sin(t * 0.4 + i * 0.7) * 0.008;
      });

      // Nebula slow rotation
      nebulas.forEach((n, i) => { n.rotation.y += 0.00015 * (i % 2 === 0 ? 1 : -1); });

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      mountRef.current?.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} style={{ position: "fixed", inset: 0, zIndex: 0 }} />;
}
