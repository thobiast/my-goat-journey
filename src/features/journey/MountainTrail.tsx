import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Copy } from '../../i18n/copy';
import { TRAIL_SEGMENTS, levelState } from './trail';
import { TrailIcon } from './TrailIcons';

type TrailText = (template: string, values: Record<string, number>) => string;
const signs = [
  { x: 20, y: 74 },
  { x: 80.5, y: 56.5 },
  { x: 18.5, y: 39.5 },
  { x: 81, y: 18.5 },
  { x: 26.5, y: 14.5 },
];

function Pine({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M0 5v24" stroke="#526e48" strokeWidth="2" />
      <path d="M0-12l-7 12h4l-8 11h5l-8 11h28l-8-11h5L3 0h4z" fill="#58784e" />
    </g>
  );
}

function Landscape() {
  return (
    <>
      <rect width="400" height="480" fill="#F0F2E4" />
      <circle cx="321" cy="62" r="27" fill="#e7dbb5" opacity=".65" />
      <path d="M-25 187L65 83l55 57 93-109 80 110 56-55 76 112v282H-25z" fill="#DEE4CC" />
      <path
        d="M172 79l41-48 37 51-24-10-14 8-15-13zM40 112l25-29 26 27-20-7-7 7-10-7z"
        fill="#FFFDF8"
        opacity=".85"
      />
      <path d="M-25 234L49 170l65 30L247 106l93 104 85-44v314H-25z" fill="#C4D0B0" />
      <path d="M-25 322Q51 174 142 247t140-9q75-54 143 44v198H-25z" fill="#A4B78C" />
      <path d="M-25 403Q67 255 147 333t161 23q84-40 117-15v139H-25z" fill="#7F9D6C" />
      <path d="M-25 461Q72 370 163 407t134 13q71-34 128-10v70H-25z" fill="#6f9062" />
      <g fill="none" stroke="#536b48" strokeWidth="1" opacity=".18">
        <path d="M-5 305q64-101 129-56M6 319q67-83 129-52M264 286q81-44 138 14M258 302q87-36 151 18M-1 413q78-100 142-39M244 438q96-49 159-10" />
      </g>
      <g opacity=".72">
        <Pine x={32} y={230} scale={0.8} />
        <Pine x={49} y={237} scale={0.6} />
        <Pine x={354} y={325} />
        <Pine x={376} y={332} scale={0.75} />
        <Pine x={339} y={339} scale={0.6} />
        <Pine x={26} y={400} />
        <Pine x={43} y={411} scale={0.65} />
      </g>
    </>
  );
}

interface MountainTrailProps {
  startLevel: number;
  currentLevel: number;
  selectedLevel: number;
  fraction: number;
  showPosition: boolean;
  copy: Copy;
  text: TrailText;
  select: (level: number) => void;
}

export function MountainTrail({
  startLevel,
  currentLevel,
  selectedLevel,
  fraction,
  showPosition,
  copy,
  text,
  select,
}: MountainTrailProps) {
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const [point, setPoint] = useState(TRAIL_SEGMENTS[0].from);
  useLayoutEffect(() => {
    if (!showPosition) return;
    const path = paths.current[currentLevel - startLevel];
    if (!path) return;
    // The native SVG arc length drives both traveled stroke and marker position.
    const position = path.getPointAtLength(path.getTotalLength() * fraction);
    setPoint({ x: position.x, y: position.y });
  }, [startLevel, currentLevel, fraction, showPosition]);
  const summary = text(copy.trailMapSummary, {
    start: startLevel,
    end: startLevel + 4,
    level: currentLevel,
    percent: Math.round(fraction * 100),
    next: currentLevel + 1,
  });
  return (
    <div
      className="trail-map"
      role="group"
      aria-label={copy.trailMap}
      aria-describedby="trail-map-summary"
    >
      <p id="trail-map-summary" className="visually-hidden">
        {summary}
      </p>
      <svg
        className="trail-landscape"
        viewBox="0 0 400 480"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <Landscape />
        {TRAIL_SEGMENTS.map((segment, index) => {
          const ratio =
            currentLevel > startLevel + index
              ? 1
              : currentLevel === startLevel + index
                ? fraction
                : 0;
          return (
            <g key={segment.d}>
              <path
                d={segment.d}
                stroke="#FFFDF8"
                strokeWidth="13"
                fill="none"
                strokeLinecap="round"
                opacity=".7"
              />
              <path
                ref={(node) => {
                  paths.current[index] = node;
                }}
                className="trail-segment"
                d={segment.d}
                pathLength="1"
                stroke="#D8C9A8"
                strokeWidth="8"
                fill="none"
                strokeLinecap="round"
              />
              {ratio > 0 && (
                <path
                  className="traveled-segment"
                  d={segment.d}
                  pathLength="1"
                  stroke="#205D45"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${ratio} 1`}
                />
              )}
            </g>
          );
        })}
        {signs.map((sign, index) => {
          const waypoint = index < 4 ? TRAIL_SEGMENTS[index].from : TRAIL_SEGMENTS[3].to;
          return (
            <path
              className="trail-connector"
              key={index}
              d={`M${sign.x * 4} ${sign.y * 4.8}L${waypoint.x} ${waypoint.y}`}
              stroke="#52604D"
              strokeWidth="1"
              opacity=".5"
            />
          );
        })}
      </svg>
      <p className="trail-continues">{copy.trailContinues}</p>
      {signs.map((sign, index) => {
        const level = startLevel + index;
        const state = levelState(level, currentLevel);
        return (
          <button
            type="button"
            key={level}
            className={`level-sign level-sign-${index} ${state}`}
            style={{ '--sign-x': `${sign.x}%`, '--sign-y': `${sign.y}%` } as CSSProperties}
            aria-label={`${text(copy.generalLevel, { level })} — ${copy[`trailState${state === 'reached' ? 'Reached' : state === 'current' ? 'Current' : 'Upcoming'}`]}`}
            aria-pressed={level === selectedLevel}
            onClick={() => select(level)}
          >
            <TrailIcon name={state === 'reached' ? 'check' : 'flag'} size={16} />
            <span>{text(copy.generalLevel, { level })}</span>
          </button>
        );
      })}
      {showPosition && (
        <div
          className="position-marker"
          role="img"
          aria-label={text(copy.trailPosition, {
            level: currentLevel,
            percent: Math.round(fraction * 100),
            next: currentLevel + 1,
          })}
          style={{ left: `${point.x / 4}%`, top: `${point.y / 4.8}%` }}
        >
          <TrailIcon name="footprints" size={22} />
        </div>
      )}
    </div>
  );
}
