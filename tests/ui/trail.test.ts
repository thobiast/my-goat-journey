import { describe, expect, test } from 'vitest';
import {
  levelState,
  levelThreshold,
  TRAIL_SEGMENTS,
  trailStretch,
} from '../../src/features/journey/trail';

// Parse only the one absolute cubic command required by the presentation contract.
function cubicPoints(d: string) {
  expect(d).toMatch(/^M\s+[\d.]+\s+[\d.]+\s+C(?:\s+[\d.]+){6}$/);
  const numbers = d.match(/[\d.]+/g)!.map(Number);
  return Array.from({ length: 4 }, (_, index) => ({
    x: numbers[index * 2],
    y: numbers[index * 2 + 1],
  }));
}

describe('Journey trail geometry in a 400 by 480 viewBox', () => {
  const markers = [
    { x: 88, y: 436.8 },
    { x: 300, y: 350.4 },
    { x: 112, y: 264 },
    { x: 292, y: 177.6 },
    { x: 204, y: 100.8 },
  ];

  test('four cubic segments connect the five approved marker positions', () => {
    expect(TRAIL_SEGMENTS).toHaveLength(4);
    TRAIL_SEGMENTS.forEach((segment, index) => {
      expect(segment.from).toEqual(markers[index]);
      expect(segment.to).toEqual(markers[index + 1]);
      const points = cubicPoints(segment.d);
      expect(points[0]).toEqual(segment.from);
      expect(points[3]).toEqual(segment.to);
      if (index > 0) expect(segment.from).toEqual(TRAIL_SEGMENTS[index - 1].to);
    });
  });

  test('the cubic control points keep every segment moving upward inside the viewBox', () => {
    for (const segment of TRAIL_SEGMENTS) {
      const points = cubicPoints(segment.d);
      points.forEach((point, index) => {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(400);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(480);
        if (index > 0) expect(point.y).toBeLessThan(points[index - 1].y);
      });
    }
  });

  test('neighboring cubics have continuous upward tangents without sharp zigzag joins', () => {
    for (let index = 1; index < TRAIL_SEGMENTS.length; index += 1) {
      const previous = cubicPoints(TRAIL_SEGMENTS[index - 1].d);
      const next = cubicPoints(TRAIL_SEGMENTS[index].d);
      expect(previous[3].x - previous[2].x).toBeCloseTo(next[1].x - next[0].x);
      expect(previous[3].y - previous[2].y).toBeCloseTo(next[1].y - next[0].y);
      expect(next[1].y - next[0].y).toBeLessThan(0);
    }
  });
});

describe('Journey level presentation states', () => {
  test.each([
    [1, 1, 'current'],
    [2, 1, 'upcoming'],
    [17, 18, 'reached'],
    [18, 18, 'current'],
    [19, 18, 'upcoming'],
    [1, 128, 'reached'],
    [127, 128, 'reached'],
    [128, 128, 'current'],
    [129, 128, 'upcoming'],
  ] as const)('presents marker %i at current level %i as %s', (level, currentLevel, state) => {
    expect(levelState(level, currentLevel)).toBe(state);
  });

  test('re-evaluates marker state when corrected progress decreases', () => {
    expect(levelState(18, 20)).toBe('reached');
    expect(levelState(18, 18)).toBe('current');
    expect(levelState(18, 17)).toBe('upcoming');
  });
});

describe('Journey level thresholds', () => {
  test.each([
    [1, 0],
    [2, 100],
    [5, 400],
    [18, 1700],
    [128, 12700],
    [10001, 1000000],
  ])('level %i begins at %i accumulated XP', (level, threshold) =>
    expect(levelThreshold(level)).toBe(threshold),
  );
});

describe('Journey trail stretches', () => {
  test.each([
    [1, 0, 1, 5, [1, 2, 3, 4, 5]],
    [5, 1, 5, 9, [5, 6, 7, 8, 9]],
    [18, 4, 17, 21, [17, 18, 19, 20, 21]],
    [20, 4, 17, 21, [17, 18, 19, 20, 21]],
    [21, 5, 21, 25, [21, 22, 23, 24, 25]],
    [128, 31, 125, 129, [125, 126, 127, 128, 129]],
    [10001, 2500, 10001, 10005, [10001, 10002, 10003, 10004, 10005]],
  ])(
    'locates level %i without capping the trail',
    (level, pageIndex, startLevel, endLevel, levels) => {
      expect(trailStretch(level as number)).toEqual({ pageIndex, startLevel, endLevel, levels });
    },
  );

  test('every stretch has five consecutive markers and overlaps the next at its boundary', () => {
    for (let level = 1; level <= 512; level += 4) {
      const stretch = trailStretch(level);
      const next = trailStretch(stretch.endLevel);
      expect(stretch.levels).toHaveLength(5);
      expect(stretch.levels).toEqual(
        Array.from({ length: 5 }, (_, index) => stretch.startLevel + index),
      );
      expect(next.startLevel).toBe(stretch.endLevel);
      expect(next.pageIndex).toBe(stretch.pageIndex + 1);
      expect(stretch.levels.filter((marker) => next.levels.includes(marker))).toEqual([
        stretch.endLevel,
      ]);
    }
  });
});
