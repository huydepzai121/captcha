// language: TypeScript, file: src/assets/shapes.ts, runtime: Node 22
// Vẽ vật thể cho image set tổng hợp. Mỗi hàm trả markup SVG bên trong một canvas
// vuông cạnh CANVAS. Vật thể nằm gọn trong canvas, có biến thiên theo rng.

import type { Category } from '../domain/challenge.js';
import { floatBetween, intBetween, pick, type Rng } from '../generator/prng.js';

export const CANVAS = 200;

const f = (v: number): string => v.toFixed(2);

const rect = (x: number, y: number, w: number, h: number, fill: string, extra = ''): string =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}"${extra}/>`;

const circle = (cx: number, cy: number, r: number, fill: string, extra = ''): string =>
  `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}"${extra}/>`;

const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string): string =>
  `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}"/>`;

const path = (d: string, fill: string, extra = ''): string =>
  `<path d="${d}" fill="${fill}"${extra}/>`;

const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, w: number): string =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${stroke}" stroke-width="${f(w)}" stroke-linecap="round"/>`;

/** Nền trời/đường theo giờ trong ngày. */
export function background(rng: Rng, kind: 'sky' | 'ground'): string {
  const palettes: Record<'sky' | 'ground', ReadonlyArray<readonly [string, string]>> = {
    sky: [
      ['#8ec5e8', '#5a9bd4'],
      ['#c8dff0', '#9fc3de'],
      ['#f0c9a0', '#d99a6c'],
      ['#5b6b8a', '#39445c'],
      ['#dfe9f2', '#b8cadb'],
    ],
    ground: [
      ['#8d8f92', '#6d7073'],
      ['#a89c88', '#877d6c'],
      ['#7a7d80', '#5c5f62'],
      ['#6f6a63', '#55514c'],
      ['#9aa0a6', '#7b8085'],
    ],
  };
  const [a, b] = pick(rng, palettes[kind]);
  const horizon = kind === 'sky' ? CANVAS : CANVAS;
  return (
    rect(0, 0, CANVAS, horizon, a) +
    rect(0, horizon * 0.62, CANVAS, horizon * 0.38, b)
  );
}

/** Cột đèn / cọc — dùng chung cho traffic_light và hydrant. */
const pole = (x: number, top: number, bottom: number, w: number, color: string): string =>
  rect(x - w / 2, top, w, bottom - top, color);

export function drawBridge(rng: Rng): string {
  const deckColor = pick(rng, ['#8b6f47', '#7d6440', '#9a7b52', '#6f5a3c']);
  const archColor = pick(rng, ['#a08a6a', '#8d7a5e', '#b09a7a']);
  const waterColor = pick(rng, ['#3f6f8f', '#356075', '#487f9e']);
  const y = floatBetween(rng, 88, 108);
  const thickness = floatBetween(rng, 9, 14);
  const arches = intBetween(rng, 1, 3);
  const spanW = CANVAS / arches;

  let s = rect(0, y + thickness + 6, CANVAS, CANVAS - y - thickness - 6, waterColor);
  for (let i = 0; i < arches; i += 1) {
    const x0 = i * spanW;
    const cx = x0 + spanW / 2;
    const rise = floatBetween(rng, 18, 30);
    s += path(
      `M ${f(x0)} ${f(y + thickness)} L ${f(x0)} ${f(y - rise * 0.2)} Q ${f(cx)} ${f(y - rise)} ${f(x0 + spanW)} ${f(y - rise * 0.2)} L ${f(x0 + spanW)} ${f(y + thickness)} Z`,
      archColor,
    );
  }
  s += rect(0, y, CANVAS, thickness, deckColor);
  // lan can
  const railY = y - 12;
  s += rect(0, railY, CANVAS, 3, deckColor);
  for (let x = 6; x < CANVAS; x += intBetween(rng, 14, 22)) {
    s += rect(x, railY, 2.5, 12, deckColor);
  }
  return s;
}

export function drawFireHydrant(rng: Rng): string {
  const body = pick(rng, ['#c62828', '#b71c1c', '#d32f2f', '#a51f1f']);
  const cap = pick(rng, ['#9e9e9e', '#cfd8dc', '#b0bec5']);
  const cx = floatBetween(rng, 82, 118);
  const baseY = floatBetween(rng, 150, 165);
  const h = floatBetween(rng, 62, 78);
  const w = floatBetween(rng, 30, 38);
  const top = baseY - h;

  let s = rect(cx - w * 0.9, baseY - 6, w * 1.8, 6, cap);
  s += rect(cx - w / 2, top + 10, w, h - 16, body);
  s += ellipse(cx, top + 12, w / 2, 9, body);
  s += circle(cx, top + 2, 5, cap);
  s += rect(cx - w / 2 - 7, top + h * 0.38, 7, 9, body);
  s += rect(cx + w / 2, top + h * 0.38, 7, 9, body);
  s += circle(cx - w / 2 - 3.5, top + h * 0.38 + 4.5, 3.2, cap);
  s += circle(cx + w / 2 + 3.5, top + h * 0.38 + 4.5, 3.2, cap);
  s += rect(cx - w * 0.3, top + h - 8, w * 0.6, 8, cap);
  return s;
}

export function drawBicycle(rng: Rng): string {
  const frame = pick(rng, ['#1e88e5', '#e53935', '#43a047', '#f9a825', '#212121']);
  const tire = pick(rng, ['#212121', '#37474f']);
  const cxLeft = floatBetween(rng, 52, 66);
  const cxRight = floatBetween(rng, 134, 148);
  const wheelY = floatBetween(rng, 140, 156);
  const r = floatBetween(rng, 34, 42);
  const bbX = (cxLeft + cxRight) / 2;
  const bbY = wheelY - floatBetween(rng, 6, 16);
  const seatX = cxLeft + (cxRight - cxLeft) * 0.35;
  const seatY = bbY - floatBetween(rng, 34, 46);
  const headX = cxRight - (cxRight - cxLeft) * 0.12;
  const headY = bbY - floatBetween(rng, 30, 42);

  const circleStroke = (cx: number, cy: number, rr: number): string =>
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rr)}" fill="none" stroke="${tire}" stroke-width="6"/>`;

  let s = circleStroke(cxLeft, wheelY, r) + circleStroke(cxRight, wheelY, r);
  s += line(cxLeft, wheelY, bbX, bbY, frame, 5);
  s += line(bbX, bbY, cxRight, wheelY, frame, 5);
  s += line(bbX, bbY, seatX, seatY, frame, 5);
  s += line(seatX, seatY, cxRight, wheelY, frame, 5);
  s += line(seatX, seatY, headX, headY, frame, 5);
  s += line(headX, headY, cxRight, wheelY, frame, 5);
  s += rect(seatX - 10, seatY - 5, 20, 5, '#111');
  s += line(headX, headY, headX + 13, headY - 5, frame, 4);
  s += circle(bbX, bbY, 5, '#555');
  return s;
}

export function drawBus(rng: Rng): string {
  const body = pick(rng, ['#fdd835', '#1565c0', '#c62828', '#2e7d32', '#ef6c00']);
  const glass = '#cfe8f5';
  const y = floatBetween(rng, 78, 100);
  const h = floatBetween(rng, 58, 72);
  const x = floatBetween(rng, 14, 34);
  const w = CANVAS - x * 2;
  const wheelR = floatBetween(rng, 11, 14);

  let s = `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="8" fill="${body}"/>`;
  const winY = y + 9;
  const winH = h * 0.36;
  const winCount = intBetween(rng, 3, 4);
  const gap = 4;
  const winW = (w - gap * (winCount + 1)) / winCount;
  for (let i = 0; i < winCount; i += 1) {
    const wx = x + gap + i * (winW + gap);
    s += `<rect x="${f(wx)}" y="${f(winY)}" width="${f(winW)}" height="${f(winH)}" rx="3" fill="${glass}"/>`;
  }
  s += rect(x + 4, y + h * 0.62, w - 8, 4, 'rgba(0,0,0,0.25)');
  s += circle(x + w * 0.24, y + h, wheelR, '#212121');
  s += circle(x + w * 0.76, y + h, wheelR, '#212121');
  s += circle(x + w * 0.24, y + h, wheelR * 0.42, '#9e9e9e');
  s += circle(x + w * 0.76, y + h, wheelR * 0.42, '#9e9e9e');
  return s;
}

export function drawTrafficLight(rng: Rng): string {
  const housing = pick(rng, ['#212121', '#2b2b2b', '#37474f']);
  const postColor = pick(rng, ['#546e7a', '#455a64', '#3e4a50']);
  const cx = floatBetween(rng, 88, 112);
  const top = floatBetween(rng, 32, 48);
  const w = floatBetween(rng, 40, 48);
  const h = floatBetween(rng, 96, 112);
  const postBottom = floatBetween(rng, 168, 182);

  let s = rect(cx - 4, top + h, 8, postBottom - top - h, postColor);
  s += rect(cx - w / 2, top, w, h, housing, ' rx="7"');
  const r = w * 0.27;
  const gap = (h - r * 6) / 4;
  const cy1 = top + gap + r;
  const cy2 = cy1 + r * 2 + gap;
  const cy3 = cy2 + r * 2 + gap;
  const lit = intBetween(rng, 0, 2);
  const lamps = ['#e53935', '#fdd835', '#43a047'];
  const dim = ['#6d2323', '#6d6323', '#2c5c34'];
  for (let i = 0; i < 3; i += 1) {
    const cy = i === 0 ? cy1 : i === 1 ? cy2 : cy3;
    const active = i === lit;
    s += circle(cx, cy, active ? r : r * 0.94, active ? lamps[i]! : dim[i]!);
  }
  return s;
}

export function drawCrosswalk(rng: Rng): string {
  const road = pick(rng, ['#4a4a4a', '#3f3f3f', '#555555']);
  const paint = pick(rng, ['#f5f5f5', '#eeeeee', '#e0e0e0']);
  const yTop = floatBetween(rng, 34, 58);
  const stripes = intBetween(rng, 5, 7);
  const bandH = floatBetween(rng, 78, 104);
  const sw = floatBetween(rng, 12, 18);
  const skew = floatBetween(rng, -14, 14);
  const span = CANVAS - 16;
  const step = span / stripes;

  let s = rect(0, 0, CANVAS, CANVAS, road);
  for (let i = 0; i < stripes; i += 1) {
    const x = 8 + i * step + step * 0.16;
    s += path(
      `M ${f(x)} ${f(yTop)} L ${f(x + sw)} ${f(yTop)} L ${f(x + sw - skew)} ${f(yTop + bandH)} L ${f(x - skew)} ${f(yTop + bandH)} Z`,
      paint,
    );
  }
  return s;
}

export const SHAPE_BY_CATEGORY: Readonly<Record<Category, (rng: Rng) => string>> = {
  bridge: drawBridge,
  fire_hydrant: drawFireHydrant,
  bicycle: drawBicycle,
  bus: drawBus,
  traffic_light: drawTrafficLight,
  crosswalk: drawCrosswalk,
};

/** Nền phù hợp ngữ cảnh của từng category. */
export const BACKGROUND_KIND: Readonly<Record<Category, 'sky' | 'ground'>> = {
  bridge: 'sky',
  fire_hydrant: 'ground',
  bicycle: 'ground',
  bus: 'ground',
  traffic_light: 'sky',
  crosswalk: 'ground',
};

/** SVG hoàn chỉnh cho một ảnh nguồn. */
export function renderScene(category: Category, rng: Rng): string {
  const bg = background(rng, BACKGROUND_KIND[category]);
  const shape = SHAPE_BY_CATEGORY[category](rng);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">${bg}${shape}</svg>`;
}
