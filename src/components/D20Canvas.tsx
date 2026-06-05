import { useCallback, useEffect, useRef } from 'react';
import { getOutcomeForRoll, type RollOutcome } from '../types/story';

// ─── Icosahedron geometry ────────────────────────────────────────────────────

type Vec3 = [number, number, number];

const phi = (1 + Math.sqrt(5)) / 2;

const norm3 = ([x, y, z]: Vec3): Vec3 => {
  const l = Math.sqrt(x * x + y * y + z * z);
  return [x / l, y / l, z / l];
};

// 12 vertices of a unit icosahedron
const VERTS: Vec3[] = ([
  [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
  [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
  [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
] as Vec3[]).map(norm3);

// 20 triangular faces; winding order gives outward normals
const FACES: [number, number, number][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

// face index i → die number (1–20)
const FACE_NUM = FACES.map((_, i) => i + 1);

// Rotation to bring face `faceIdx` toward the camera (+Z)
// Given render order rotZ(rotY(rotX(v))), to have face normal → [0,0,1]:
//   rx = atan2(n.y, n.z),  ry = -asin(n.x)
function faceTargetRot(faceIdx: number): { rx: number; ry: number } {
  const [i0, i1, i2] = FACES[faceIdx];
  const n = norm3([
    (VERTS[i0][0] + VERTS[i1][0] + VERTS[i2][0]) / 3,
    (VERTS[i0][1] + VERTS[i1][1] + VERTS[i2][1]) / 3,
    (VERTS[i0][2] + VERTS[i1][2] + VERTS[i2][2]) / 3,
  ]);
  return {
    rx: Math.atan2(n[1], n[2]),
    ry: -Math.asin(Math.max(-1, Math.min(1, n[0]))),
  };
}

const FACE_TARGETS = FACES.map((_, i) => faceTargetRot(i));

// ─── Math helpers ────────────────────────────────────────────────────────────

const rX = (v: Vec3, a: number): Vec3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
};
const rY = (v: Vec3, a: number): Vec3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
};
const rZ = (v: Vec3, a: number): Vec3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
};
const rot = (v: Vec3, rx: number, ry: number, rz: number): Vec3 =>
  rZ(rY(rX(v, rx), ry), rz);

const persp = (v: Vec3, fov: number, cx: number, cy: number): [number, number] => {
  const z = v[2] + 3.5;
  return [v[0] / z * fov + cx, v[1] / z * fov + cy];
};

function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

function hexRgb(hex: string): [number, number, number] {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [255, 255, 255];
}

// ─── Outcome colors ──────────────────────────────────────────────────────────

const GLOW: Record<string, string> = {
  critFail: '#dc2626',
  low: '#ea580c',
  high: '#16a34a',
  critSuccess: '#ca8a04',
};

// ─── Particle ────────────────────────────────────────────────────────────────

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; r: number; color: string;
}

// ─── Internal animation state (stored in a ref to avoid re-renders) ──────────

interface DieState {
  phase: 'rolling' | 'settling' | 'settled';
  rx: number; ry: number; rz: number;
  vx: number; vy: number; vz: number;
  targetRx: number; targetRy: number;
  targetFace: number;
  settleT: number;
  glowT: number;
  particles: Particle[];
  notified: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface D20CanvasProps {
  rolling: boolean;
  finalRoll: number | null;
  onComplete?: (roll: number, outcome: RollOutcome) => void;
  size?: number;
}

export default function D20Canvas({ rolling, finalRoll, onComplete, size = 320 }: D20CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const stateRef = useRef<DieState>({
    phase: 'rolling',
    rx: 0.4, ry: 0.8, rz: 0.2,
    vx: 0.12, vy: 0.16, vz: 0.07,
    targetRx: 0, targetRy: 0,
    targetFace: 0,
    settleT: 0,
    glowT: 0,
    particles: [],
    notified: false,
  });

  // Prop refs so the stable draw loop can read current values
  const finalRollRef = useRef(finalRoll);
  finalRollRef.current = finalRoll;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!rolling || finalRoll === null) return;
    const s = stateRef.current;
    s.phase = 'rolling';
    s.notified = false;
    s.glowT = 0;
    s.particles = [];
    s.vx = (Math.random() - 0.5) * 0.45;
    s.vy = (Math.random() - 0.5) * 0.45;
    s.vz = (Math.random() - 0.5) * 0.25;

    const t = setTimeout(() => {
      const faceIdx = finalRoll - 1; // face 0 has number 1
      const tgt = FACE_TARGETS[faceIdx];
      s.targetRx = tgt.rx;
      s.targetRy = tgt.ry;
      s.targetFace = faceIdx;
      s.settleT = 0;
      s.phase = 'settling';
    }, 1800);

    return () => clearTimeout(t);
  }, [rolling, finalRoll]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = stateRef.current;
    const W = size, H = size;
    const cx = W / 2, cy = H / 2;
    const fov = W * 0.43;

    ctx.clearRect(0, 0, W, H);

    // ── Update state ──────────────────────────────────────────────────────────

    if (s.phase === 'rolling') {
      s.vx += (Math.random() - 0.5) * 0.028;
      s.vy += (Math.random() - 0.5) * 0.028;
      s.vz += (Math.random() - 0.5) * 0.018;
      s.vx = Math.max(-0.28, Math.min(0.28, s.vx));
      s.vy = Math.max(-0.28, Math.min(0.28, s.vy));
      s.vz = Math.max(-0.18, Math.min(0.18, s.vz));
      s.rx += s.vx; s.ry += s.vy; s.rz += s.vz;

    } else if (s.phase === 'settling') {
      s.settleT = Math.min(1, s.settleT + 0.026);
      const ease = 1 - Math.pow(1 - s.settleT, 4);
      s.rx = lerpAngle(s.rx, s.targetRx, ease);
      s.ry = lerpAngle(s.ry, s.targetRy, ease);
      s.rz = lerpAngle(s.rz, 0, ease);

      if (s.settleT >= 1) {
        s.phase = 'settled';
        s.rx = s.targetRx; s.ry = s.targetRy; s.rz = 0;

        const fr = finalRollRef.current;
        if (fr !== null) {
          const outcome = getOutcomeForRoll(fr);
          const col = GLOW[outcome];
          const count = outcome === 'critSuccess' ? 70 : outcome === 'critFail' ? 45 : 35;
          for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i / count) + Math.random() * 0.4;
            const spd = 2.5 + Math.random() * 4.5;
            s.particles.push({
              x: cx, y: cy,
              vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd,
              life: 1, r: 1.5 + Math.random() * 3.5, color: col,
            });
          }
          // Extra sparkle ring for critical success
          if (outcome === 'critSuccess') {
            for (let i = 0; i < 20; i++) {
              const angle = Math.random() * Math.PI * 2;
              const dist = fov * 0.5 + Math.random() * fov * 0.3;
              s.particles.push({
                x: cx + Math.cos(angle) * dist * 0.3,
                y: cy + Math.sin(angle) * dist * 0.3,
                vx: Math.cos(angle) * 1.5, vy: Math.sin(angle) * 1.5,
                life: 0.8 + Math.random() * 0.2, r: 2 + Math.random() * 2, color: '#ffd700',
              });
            }
          }
        }
      }

    } else if (s.phase === 'settled') {
      s.glowT = Math.min(1, s.glowT + 0.045);

      s.particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.06;
        p.vx *= 0.97; p.vy *= 0.97;
        p.life -= 0.022;
      });
      s.particles = s.particles.filter(p => p.life > 0);

      const fr = finalRollRef.current;
      if (!s.notified && fr !== null && s.glowT > 0.6) {
        s.notified = true;
        const cb = onCompleteRef.current;
        setTimeout(() => cb?.(fr, getOutcomeForRoll(fr)), 0);
      }
    }

    // ── Project vertices ──────────────────────────────────────────────────────

    const pv = VERTS.map(v => {
      const w = rot(v, s.rx, s.ry, s.rz);
      return { w, p: persp(w, fov, cx, cy) };
    });

    // ── Face data ─────────────────────────────────────────────────────────────

    type FD = {
      i: number;
      pts: [[number, number], [number, number], [number, number]];
      nz: number; // camera-facing component of normal
      brightness: number;
      depth: number;
    };

    const lightDir = norm3([0.5, -0.8, 1.0]);

    const faces: FD[] = FACES.map((f, i) => {
      const [a, b, c] = f;
      const wa = pv[a].w, wb = pv[b].w, wc = pv[c].w;
      const e1: Vec3 = [wb[0] - wa[0], wb[1] - wa[1], wb[2] - wa[2]];
      const e2: Vec3 = [wc[0] - wa[0], wc[1] - wa[1], wc[2] - wa[2]];
      const n: Vec3 = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const nl = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
      const norm: Vec3 = nl > 0 ? [n[0] / nl, n[1] / nl, n[2] / nl] : [0, 0, 1];
      const light = Math.max(0,
        norm[0] * lightDir[0] + norm[1] * lightDir[1] + norm[2] * lightDir[2],
      );
      return {
        i,
        pts: [pv[a].p, pv[b].p, pv[c].p],
        nz: norm[2],
        brightness: 0.18 + 0.82 * light,
        depth: (wa[2] + wb[2] + wc[2]) / 3,
      };
    });

    // Back-to-front sort
    faces.sort((a, b) => a.depth - b.depth);

    // ── Outer glow (settled) ──────────────────────────────────────────────────

    const fr = finalRollRef.current;
    if (s.phase === 'settled' && fr !== null && s.glowT > 0) {
      const [r, g, b] = hexRgb(GLOW[getOutcomeForRoll(fr)]);
      const grd = ctx.createRadialGradient(cx, cy, fov * 0.18, cx, cy, fov * 0.92);
      const a1 = Math.round(s.glowT * 90).toString(16).padStart(2, '0');
      const a2 = '00';
      grd.addColorStop(0, `rgba(${r},${g},${b},${s.glowT * 0.35})`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      void a1; void a2; // keep linter happy
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(cx, cy, fov, 0, Math.PI * 2); ctx.fill();
    }

    // ── Draw faces ────────────────────────────────────────────────────────────

    for (const fd of faces) {
      if (fd.nz <= 0.01) continue; // back-face cull

      const [p0, p1, p2] = fd.pts;
      const isResult = s.phase === 'settled' && fd.i === s.targetFace;

      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.closePath();

      // Face fill: dark steel blue with diffuse lighting
      const bv = fd.brightness;
      let fr2 = Math.round(14 + bv * 42);
      let fg = Math.round(18 + bv * 38);
      let fb = Math.round(44 + bv * 78);

      if (isResult && s.glowT > 0 && fr !== null) {
        const [gr, gg, gb] = hexRgb(GLOW[getOutcomeForRoll(fr)]);
        const t = s.glowT * 0.55;
        fr2 = Math.round(fr2 * (1 - t) + gr * t);
        fg = Math.round(fg * (1 - t) + gg * t);
        fb = Math.round(fb * (1 - t) + gb * t);
      }
      ctx.fillStyle = `rgb(${fr2},${fg},${fb})`;
      ctx.fill();

      // Edge
      const ea = 0.35 + bv * 0.65;
      if (isResult && s.glowT > 0 && fr !== null) {
        const col = GLOW[getOutcomeForRoll(fr)];
        const [er, eg, eb] = hexRgb(col);
        ctx.strokeStyle = `rgba(${er},${eg},${eb},${ea})`;
        ctx.lineWidth = 1.2 + bv * 0.6;
        ctx.shadowColor = col;
        ctx.shadowBlur = 10 * s.glowT;
      } else {
        // Gold edges — brighter on lit faces
        ctx.strokeStyle = `rgba(${Math.round(180 + bv * 75)},${Math.round(130 + bv * 50)},${Math.round(40 + bv * 20)},${ea})`;
        ctx.lineWidth = 0.6 + bv * 0.5;
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Face number
      const facing = fd.nz * fd.nz; // sharp falloff
      if (facing > 0.04) {
        const scx = (p0[0] + p1[0] + p2[0]) / 3;
        const scy = (p0[1] + p1[1] + p2[1]) / 3;
        const area = Math.abs(
          (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]),
        ) / 2;
        const fs = Math.min(20, Math.max(7, Math.sqrt(area) * 0.55));

        ctx.save();
        ctx.font = `bold ${fs}px 'Palatino Linotype', Palatino, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (isResult && s.glowT > 0 && fr !== null) {
          ctx.fillStyle = `rgba(255,255,255,${facing})`;
          ctx.shadowColor = GLOW[getOutcomeForRoll(fr)];
          ctx.shadowBlur = 14;
        } else {
          ctx.fillStyle = `rgba(195,185,255,${facing * 0.75})`;
        }
        ctx.fillText(String(FACE_NUM[fd.i]), scx, scy);
        ctx.restore();
      }
    }

    // ── Particles ─────────────────────────────────────────────────────────────

    for (const p of s.particles) {
      ctx.save();
      ctx.globalAlpha = Math.pow(p.life, 1.5);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [size]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return <canvas ref={canvasRef} width={size} height={size} />;
}
