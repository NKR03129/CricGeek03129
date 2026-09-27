"use client";

interface WriterDNAChartProps {
  analyst: number;
  fan: number;
  storyteller: number;
  debater: number;
  size?: number;
}

export default function WriterDNAChart({
  analyst,
  fan,
  storyteller,
  debater,
  size = 280,
}: WriterDNAChartProps) {
  const center = size / 2;
  const radius = size * 0.36;

  // 4-axis diamond layout (top, right, bottom, left)
  const dimensions = [
    { label: "Analyst",     value: analyst,     angle: -90,  icon: "📊", color: "#3b82f6" },
    { label: "Debater",     value: debater,     angle: 0,    icon: "⚔️",  color: "#ef4444" },
    { label: "Storyteller", value: storyteller, angle: 90,   icon: "📖", color: "#a855f7" },
    { label: "Fan",         value: fan,         angle: 180,  icon: "🔥", color: "#f97316" },
  ];

  const getPoint = (angle: number, value: number, maxRadius: number) => {
    const rad = (angle * Math.PI) / 180;
    const r = (value / 100) * maxRadius;
    return { x: center + r * Math.cos(rad), y: center + r * Math.sin(rad) };
  };

  const rings = [25, 50, 75, 100];

  const dataPoints = dimensions.map((d) => getPoint(d.angle, d.value, radius));
  const dataPolygon = dataPoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
        {/* Grid rings */}
        {rings.map((ring) => {
          const ringPoints = dimensions.map((d) => getPoint(d.angle, ring, radius));
          const ringPolygon = ringPoints.map((p) => `${p.x},${p.y}`).join(" ");
          return (
            <polygon
              key={ring}
              points={ringPolygon}
              fill="none"
              stroke={ring === 100 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}
              strokeWidth="1"
            />
          );
        })}

        {/* Axis lines */}
        {dimensions.map((d) => {
          const end = getPoint(d.angle, 100, radius);
          return (
            <line
              key={d.label}
              x1={center}
              y1={center}
              x2={end.x}
              y2={end.y}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
          );
        })}

        {/* Data fill */}
        <polygon
          points={dataPolygon}
          fill="rgba(34,197,94,0.12)"
          stroke="#22C55E"
          strokeWidth="2"
          className="radar-pulse"
        />

        {/* Data points */}
        {dataPoints.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="4"
            fill={dimensions[i].color}
            stroke="#0A0A0A"
            strokeWidth="2"
          />
        ))}
      </svg>

      {/* Labels */}
      {dimensions.map((d) => {
        const labelPoint = getPoint(d.angle, 125, radius);
        const total = analyst + fan + storyteller + debater;
        const pct = total > 0 ? Math.round((d.value / total) * 100) : 25;
        return (
          <div
            key={d.label}
            className="absolute flex flex-col items-center"
            style={{
              left: labelPoint.x,
              top: labelPoint.y,
              transform: "translate(-50%, -50%)",
            }}
          >
            <span className="text-lg">{d.icon}</span>
            <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
              {d.label}
            </span>
            <span className="text-xs font-bold" style={{ color: d.color }}>
              {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
