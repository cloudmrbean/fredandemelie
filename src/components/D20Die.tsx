import { useEffect, useRef, useState } from 'react';
import { type RollOutcome, OUTCOMES, getOutcomeForRoll } from '../types/story';

interface Props {
  rolling: boolean;
  finalRoll: number | null;
  onAnimationComplete?: (roll: number, outcome: RollOutcome) => void;
}

const GLOW: Record<RollOutcome, string> = {
  critFail: '#ef4444',
  low: '#f97316',
  high: '#22c55e',
  critSuccess: '#a855f7',
};

export default function D20Die({ rolling, finalRoll, onAnimationComplete }: Props) {
  const [displayNumber, setDisplayNumber] = useState<number>(20);
  const [settled, setSettled] = useState(false);
  const [outcome, setOutcome] = useState<RollOutcome | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!rolling || finalRoll === null) return;
    const roll = finalRoll;

    setSettled(false);
    setOutcome(null);

    let speed = 40;
    let ticks = 0;
    const maxTicks = 30;

    function tick() {
      ticks++;
      setDisplayNumber(Math.floor(Math.random() * 20) + 1);

      if (ticks >= maxTicks) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        speed = 120;
        intervalRef.current = setInterval(() => {
          ticks++;
          setDisplayNumber(Math.floor(Math.random() * 20) + 1);
          if (ticks >= maxTicks + 8) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            setDisplayNumber(roll);
            const o = getOutcomeForRoll(roll);
            setOutcome(o);
            const t = setTimeout(() => {
              setSettled(true);
              onAnimationComplete?.(roll, o);
            }, 400);
            timeoutRefs.current.push(t);
          }
        }, speed);
      }
    }

    intervalRef.current = setInterval(tick, speed);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      timeoutRefs.current.forEach(clearTimeout);
      timeoutRefs.current = [];
    };
  }, [rolling, finalRoll, onAnimationComplete]);

  const glowColor = outcome ? GLOW[outcome] : '#7c3aed';
  const isRolling = rolling && !settled;

  // d20 SVG: a decagon (10-sided polygon) with internal lines, representing a d20 face
  const sides = 10;
  const cx = 100;
  const cy = 100;
  const r = 82;
  const innerR = 48;

  const outerPoints = Array.from({ length: sides }, (_, i) => {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as [number, number];
  });

  const innerPoints = Array.from({ length: sides }, (_, i) => {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2 + Math.PI / sides;
    return [cx + innerR * Math.cos(angle), cy + innerR * Math.sin(angle)] as [number, number];
  });

  const starPoints = outerPoints.flatMap((op, i) => [op, innerPoints[i]]);
  const starPath = starPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ') + 'Z';

  const numColor = outcome ? GLOW[outcome] : '#c084fc';

  return (
    <div
      className="relative flex items-center justify-center select-none"
      style={{ width: 200, height: 200 }}
    >
      {/* Glow backdrop */}
      <div
        className="absolute inset-0 rounded-full blur-3xl opacity-30 transition-colors duration-500"
        style={{ backgroundColor: glowColor }}
      />

      <svg
        viewBox="0 0 200 200"
        width="200"
        height="200"
        className="relative z-10"
        style={{
          filter: `drop-shadow(0 0 12px ${glowColor}88)`,
          animation: isRolling ? 'roll20 0.15s linear infinite' : undefined,
          transition: 'filter 0.5s ease',
        }}
      >
        <style>{`
          @keyframes roll20 {
            0%   { transform: rotate(0deg) scale(1);    transform-origin: 100px 100px; }
            25%  { transform: rotate(9deg) scale(0.96); transform-origin: 100px 100px; }
            50%  { transform: rotate(0deg) scale(1);    transform-origin: 100px 100px; }
            75%  { transform: rotate(-9deg) scale(0.96);transform-origin: 100px 100px; }
            100% { transform: rotate(0deg) scale(1);    transform-origin: 100px 100px; }
          }
        `}</style>

        {/* Outer polygon fill */}
        <path d={starPath} fill="#1a1030" stroke={glowColor} strokeWidth="2" opacity="0.9" />

        {/* Inner web lines */}
        {outerPoints.map((op, i) => (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={op[0]}
            y2={op[1]}
            stroke={glowColor}
            strokeWidth="0.8"
            opacity="0.25"
          />
        ))}

        {/* Number */}
        <text
          x={cx}
          y={cy + 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={numColor}
          fontSize={settled ? '38' : '32'}
          fontWeight="bold"
          fontFamily="'Inter', system-ui, sans-serif"
          style={{ transition: 'font-size 0.3s ease, fill 0.5s ease' }}
        >
          {displayNumber}
        </text>

        {/* Settled sparkle ring */}
        {settled && (
          <circle
            cx={cx}
            cy={cy}
            r="70"
            fill="none"
            stroke={glowColor}
            strokeWidth="1.5"
            opacity="0.5"
            strokeDasharray="8 6"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 100 100"
              to="360 100 100"
              dur="8s"
              repeatCount="indefinite"
            />
          </circle>
        )}
      </svg>

      {/* Outcome label */}
      {settled && outcome && (
        <div
          className="absolute -bottom-8 left-0 right-0 text-center text-sm font-semibold tracking-wider animate-fade-in"
          style={{ color: GLOW[outcome] }}
        >
          {OUTCOMES[outcome].label.toUpperCase()}
        </div>
      )}
    </div>
  );
}
