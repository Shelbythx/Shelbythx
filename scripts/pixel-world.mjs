#!/usr/bin/env node
/**
 * pixel-world.mjs — анімований піксельний SVG із твого графіка контрибуцій GitHub.
 *
 * Сюжет одного циклу (24 с, далі все повторюється):
 *   1. Світ (графік контрибуцій) завантажується хвилею.
 *   2. Корабель летить під ним і лазером знищує клітинки з контрибуціями, SCORE росте.
 *   3. LEVEL CLEAR! → світ глючить і розсипається (WORLD DELETED).
 *   4. WELCOME TO MY PROFILE + PRESS START → затемнення → новий світ.
 *
 * Тільки CSS-анімації всередині SVG (без JS), тому GitHub показує його як звичайну картинку.
 * Без залежностей, Node 18+.
 *
 *   GITHUB_TOKEN=xxx node scripts/pixel-world.mjs --user Shelbythx --out profile/pixel-world.svg
 *   node scripts/pixel-world.mjs --demo --out preview.svg      # випадкові дані, токен не потрібен
 *   --min-fill 0.45   # добити порожні місця ігровими блоками до 45% заповнення (0 = тільки реальні)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ───────────────────────── CLI ─────────────────────────
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const DEMO = argv.includes('--demo');
const USER = opt('user', process.env.GITHUB_USER || process.env.GITHUB_REPOSITORY_OWNER || 'player');
const OUT = opt('out', 'profile/pixel-world.svg');
// Мінімальна частка заповнених клітинок (0…0.9). Якщо реальних контрибуцій менше,
// порожні місця добиваються ігровими блоками. 0 = тільки реальні контрибуції.
const MIN_FILL = Math.min(0.9, Math.max(0, parseFloat(opt('min-fill', '0')) || 0));
const TOKEN = process.env.GITHUB_TOKEN;

// ───────────────────────── Дані ─────────────────────────
const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

async function fetchCalendar(login, token) {
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{
    totalContributions weeks{contributionDays{contributionCount contributionLevel weekday}}}}}}`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'pixel-world-readme' },
    body: JSON.stringify({ query, variables: { login } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GitHub API: ${JSON.stringify(json.errors)}`);
  if (!json.data?.user) throw new Error(`Користувача "${login}" не знайдено`);
  const cal = json.data.user.contributionsCollection.contributionCalendar;
  return {
    total: cal.totalContributions,
    weeks: cal.weeks.map((w) =>
      w.contributionDays.map((d) => ({ weekday: d.weekday, count: d.contributionCount, level: LEVEL[d.contributionLevel] ?? 0 })),
    ),
  };
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;

function demoCalendar(rand) {
  const weeks = [];
  let total = 0;
  for (let w = 0; w < 53; w++) {
    const days = [];
    const from = w === 0 ? 3 : 0;
    const to = w === 52 ? 4 : 6;
    for (let d = from; d <= to; d++) {
      const r = rand();
      const count = r < 0.55 ? 0 : Math.floor((r - 0.55) * 30) + 1;
      const level = count === 0 ? 0 : count < 4 ? 1 : count < 7 ? 2 : count < 11 ? 3 : 4;
      total += count;
      days.push({ weekday: d, count, level });
    }
    weeks.push(days);
  }
  return { total, weeks };
}

/** Добиває порожні клітинки ігровими блоками до частки minFill. Реальні контрибуції не змінюються. */
function addBonusBlocks(data, minFill, rand) {
  const empty = [];
  let all = 0, filled = 0;
  data.weeks.forEach((days) => days.forEach((d) => { all++; if (d.level > 0) filled++; else empty.push(d); }));
  for (let i = empty.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [empty[i], empty[j]] = [empty[j], empty[i]];
  }
  const need = Math.max(0, Math.round(all * minFill) - filled);
  empty.slice(0, need).forEach((d) => {
    const r = rand();
    d.level = r < 0.4 ? 1 : r < 0.7 ? 2 : r < 0.9 ? 3 : 4;
    d.bonus = true;
  });
  return need;
}

// ───────────────────────── Піксельний шрифт 5×7 ─────────────────────────
const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  ':': ['.....', '..#..', '.....', '.....', '.....', '..#..', '.....'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

/** Піксельна сітка → один SVG path (сусідні пікселі в рядку зливаються). */
function gridPath(rows, x, y, s, match = (ch) => ch === '#') {
  let d = '';
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; ) {
      if (!match(row[rx])) { rx++; continue; }
      let len = 1;
      while (rx + len < row.length && match(row[rx + len])) len++;
      d += `M${x + rx * s} ${y + ry * s}h${len * s}v${s}h-${len * s}z`;
      rx += len;
    }
  });
  return d;
}
const textPath = (str, x, y, s) =>
  [...str.toUpperCase()].map((ch, i) => gridPath(FONT[ch] || FONT['?'], x + i * 6 * s, y, s)).join('');
const textW = (str, s) => str.length * 6 * s - s;

// ───────────────────────── Спрайти (оригінальні) ─────────────────────────
const SHIP = [
  '.....w.....',
  '....mwm....',
  '....mcm....',
  '...mmcmm...',
  '.d.mmmmm.d.',
  '.dmmmmmmmd.',
  'dmmmmmmmmmd',
  'dmm.mmm.mmd',
  'd.........d',
];
const FLAME_A = ['...........', '...........', '...........', '...........', '...........', '...........', '...........', '...........', '...........', '.....y.....', '.....o.....'];
const FLAME_B = ['...........', '...........', '...........', '...........', '...........', '...........', '...........', '...........', '...........', '....oyo....', '...........'];

// ───────────────────────── Палітра ─────────────────────────
const C = {
  bg: '#0b0a1f', frame: '#BC52EE', empty: '#1a1c3c', sep: '#2b2950',
  lv: [null, '#0c4a66', '#0a7fa6', '#00ADD8', '#8af3ff'],
  mag: '#BC52EE', magDark: '#6a2c91', cyan: '#00ADD8', white: '#f4f1ff',
  yellow: '#ffd84d', orange: '#ff7a2f', pink: '#ff4fd8', shadow: '#2a0f45',
};

// ───────────────────────── Генерація ─────────────────────────
function render({ weeks }, login, seed) {
  const rand = mulberry32(seed);
  const T = 24; // довжина циклу, с
  const n = weeks.length;
  const W = 720, H = 200;
  const CELL = 10, STEP = 12;
  const gridW = n * STEP - 2;
  const GX = Math.round((W - gridW) / 2), GY = 50;
  const colX = (c) => GX + c * STEP;
  const rowY = (r) => GY + r * STEP;
  const ccx = (c) => colX(c) + CELL / 2;
  const LANE = 150; // верх спрайта корабля
  const SP = 3; // розмір пікселя спрайта

  // Таймлайн (секунди)
  const POP0 = 0.2, POP1 = 1.2;
  const S0 = 1.6, S1 = 13.6, SHIP_OUT = 14.4;
  const GL0 = 15.6, GL1 = 16.6;
  const DEL0 = 16.3, DEL1 = 17.9;
  const WEL0 = 18.3, WEL_DT = 0.07;
  const BACK0 = 18.2, BACK1 = 19.0, PRESS0 = 19.9;
  const END0 = 23.0, END1 = 23.5;
  const frac = (c) => (n > 1 ? c / (n - 1) : 0);
  const popT = (c) => POP0 + frac(c) * (POP1 - POP0);
  const hitT = (c) => S0 + frac(c) * (S1 - S0);

  const css = [];
  const kf = (name, stops) => {
    const all = [...stops];
    if (all[0][0] > 0) all.unshift([0, all[0][1]]);
    if (all[all.length - 1][0] < T) all.push([T, all[all.length - 1][1]]);
    let last = -1;
    const parts = all.map(([t, rule]) => {
      let p = Math.round(Math.min(100, Math.max(0, (t / T) * 100)) * 1000) / 1000;
      if (p <= last) p = Math.round((last + 0.001) * 1000) / 1000;
      last = p;
      return `${p}%{${rule}}`;
    });
    css.push(`@keyframes ${name}{${parts.join('')}}.${name}{animation-name:${name}}`);
  };
  const STEPS = 'animation-timing-function:steps(1,end)';
  const op = (v) => `opacity:${v}`;
  /** Видимий тільки у вікні [t0, t1). */
  const windowKf = (name, t0, t1) => kf(name, [[0, `${op(0)};${STEPS}`], [t0, `${op(1)};${STEPS}`], [t1, `${op(0)};${STEPS}`]]);

  const body = [];
  const add = (s) => body.push(s);

  // ── Фон: екран, зірки ──
  add(`<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="8" fill="${C.bg}" stroke="${C.frame}" stroke-opacity=".55" stroke-width="2"/>`);
  for (let g = 0; g < 3; g++) {
    let d = '';
    for (let i = 0; i < 16; i++) d += `M${Math.floor(8 + rand() * (W - 16))} ${Math.floor(6 + rand() * (H - 12))}h2v2h-2z`;
    add(`<path class="tw${g}" d="${d}" fill="${[C.white, C.cyan, C.mag][g]}" opacity=".7"/>`);
  }

  // ── HUD ──
  const name = login.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12) || 'PLAYER';
  // Очки: кожен блок дає 10 × рівень, HI — максимум за рівень
  const points = (days) => days.reduce((a, d) => a + d.level * 10, 0);
  const total = weeks.reduce((a, days) => a + points(days), 0);
  const digits = Math.max(5, String(total).length);
  const pad = (v) => String(v).padStart(digits, '0');
  add(`<path d="${textPath('1UP', 24, 14, 2)}" fill="${C.mag}"/>`);
  add(`<path d="${textPath(name, 24 + 4 * 12, 14, 2)}" fill="${C.white}"/>`);
  const hi = `HI ${pad(total)}`;
  const hiX = Math.round((W - textW(hi, 2)) / 2);
  add(`<path d="${textPath('HI', hiX, 14, 2)}" fill="${C.mag}"/>`);
  add(`<path d="${textPath(pad(total), hiX + 3 * 12, 14, 2)}" fill="${C.cyan}"/>`);
  const scoreStr = `SCORE ${pad(0)}`;
  const scoreX = W - 24 - textW(scoreStr, 2);
  add(`<path d="${textPath('SCORE', scoreX, 14, 2)}" fill="${C.mag}"/>`);
  let sep = '';
  for (let x = 16; x < W - 16; x += 8) sep += `M${x} 36h4v2h-4z`;
  add(`<path d="${sep}" fill="${C.sep}"/>`);

  // Рахунок: окремий стан на кожне влучання
  const hits = []; // {c, t, sum}
  let sum = 0;
  weeks.forEach((days, c) => {
    const pts = points(days);
    if (pts > 0) { sum += pts; hits.push({ c, t: hitT(c), sum }); }
  });
  const states = [{ t: 0, sum: 0 }, ...hits];
  const digitDefs = [...'0123456789'].map((ch) => `<path id="g${ch}" d="${gridPath(FONT[ch], 0, 0, 2)}"/>`).join('');
  states.forEach((s, i) => {
    const t1 = i + 1 < states.length ? states[i + 1].t : T;
    windowKf(`sc${i}`, s.t, t1);
    const uses = [...pad(s.sum)].map((ch, j) => `<use href="#g${ch}" x="${scoreX + (6 + j) * 12}" y="14"/>`).join('');
    add(`<g class="a sc${i}" fill="${C.white}">${uses}</g>`);
  });

  // ── Світ: порожні плитки по рядках (падають під час глюка) ──
  css.push(`.p{animation:pop ${T}s linear infinite both;transform-box:fill-box;transform-origin:center}`);
  css.push(`@keyframes pop{0%{transform:scale(0)}${((0.1 / T) * 100).toFixed(3)}%{transform:scale(1.3)}${((0.2 / T) * 100).toFixed(3)}%{transform:scale(1)}94.5%{transform:scale(1)}94.51%,100%{transform:scale(0)}}`);
  for (let c = 0; c < n; c++) css.push(`.d${c}{animation-delay:${popT(c).toFixed(3)}s}`);

  const rows = Array.from({ length: 7 }, () => []);
  weeks.forEach((days, c) => days.forEach((d) => rows[d.weekday].push(`<rect class="p d${c}" x="${colX(c)}" y="${rowY(d.weekday)}" width="${CELL}" height="${CELL}"/>`)));
  // тряска + мерехтіння світу
  const shake = [[0, `transform:translate(0,0);${op(1)};${STEPS}`], [GL0, `transform:translate(0,0);${op(1)};${STEPS}`]];
  for (let t = GL0 + 0.07; t < GL1; t += 0.07) {
    const dx = (Math.floor(rand() * 5) - 2) * 2, dy = (Math.floor(rand() * 3) - 1) * 2;
    shake.push([t, `transform:translate(${dx}px,${dy}px);${op([1, 1, 0.55, 1, 0.3][Math.floor(rand() * 5)])};${STEPS}`]);
  }
  shake.push([GL1, `transform:translate(0,0);${op(1)};${STEPS}`]);
  kf('wd', shake);
  add(`<g class="a wd" fill="${C.empty}">`);
  rows.forEach((tiles, r) => {
    const tf = GL1 + 0.1 + (6 - r) * 0.07 + rand() * 0.05;
    kf(`r${r}`, [
      [0, `transform:translateY(0);${op(1)}`],
      [tf, `transform:translateY(0);${op(1)};animation-timing-function:cubic-bezier(.55,0,1,.45)`],
      [tf + 0.6, `transform:translateY(150px);${op(0)}`],
    ]);
    add(`<g class="a r${r}">${tiles.join('')}</g>`);
  });
  add(`</g>`);

  // ── Клітинки з контрибуціями: з'являються, вибухають від лазера ──
  const laserTop = GY - 4, laserBottom = LANE + 2;
  weeks.forEach((days, c) => {
    const filled = days.filter((d) => d.level > 0);
    if (!filled.length) return;
    const tp = popT(c), th = hitT(c);
    const hidden = `${op(0)};transform:scale(0)`, shown = `${op(1)};transform:scale(1)`;
    kf(`k${c}`, [[0, hidden], [tp, hidden], [tp + 0.1, `${op(1)};transform:scale(1.3)`], [tp + 0.2, shown], [th, shown], [th + 0.05, `${op(1)};transform:scale(1.45)`], [th + 0.16, hidden]]);
    kf(`f${c}`, [[0, op(0)], [th - 0.01, op(0)], [th, op(1)], [th + 0.12, op(0)]]);
    kf(`s${c}`, [[0, `${op(0)};transform:scale(.5)`], [th, `${op(0)};transform:scale(.5)`], [th + 0.02, `${op(1)};transform:scale(.7)`], [th + 0.3, `${op(0)};transform:scale(2.6)`]]);
    kf(`l${c}`, [[0, op(0)], [th - 0.05, op(0)], [th - 0.03, op(1)], [th + 0.07, op(1)], [th + 0.09, op(0)]]);

    const lx = ccx(c);
    add(`<g class="a l${c}"><rect x="${lx - 3}" y="${laserTop}" width="6" height="${laserBottom - laserTop}" fill="${C.pink}" opacity=".35"/><rect x="${lx - 1}" y="${laserTop}" width="2" height="${laserBottom - laserTop}" fill="${C.white}"/></g>`);
    filled.forEach((d) => add(`<rect class="a fb k${c}" x="${colX(c)}" y="${rowY(d.weekday)}" width="${CELL}" height="${CELL}" fill="${C.lv[d.level]}"/>`));
    add(`<g class="a f${c}" fill="${C.white}">${filled.map((d) => `<rect x="${colX(c) - 1}" y="${rowY(d.weekday) - 1}" width="12" height="12"/>`).join('')}</g>`);
    filled.forEach((d) => {
      const x = ccx(c), y = rowY(d.weekday) + CELL / 2;
      const sq = (dx, dy) => `M${x + dx} ${y + dy}h2v2h-2z`;
      add(`<path class="a fb s${c}" d="${sq(-7, -7) + sq(5, -7) + sq(-7, 5) + sq(5, 5) + sq(-1, -9) + sq(-1, 7)}" fill="${C.yellow}"/>`);
    });
  });

  // ── Глюк: смуги і шум ──
  const glitchBar = (i, color) => {
    const stops = [[0, `${op(0)};${STEPS}`]];
    let t = GL0 + rand() * 0.3;
    while (t < DEL1 - 0.2) {
      stops.push([t, `${op(0.85)};${STEPS}`]);
      t += 0.05 + rand() * 0.08;
      stops.push([t, `${op(0)};${STEPS}`]);
      t += 0.15 + rand() * 0.35;
    }
    kf(`gb${i}`, stops);
    const w = 60 + Math.floor(rand() * 260), h = 2 + Math.floor(rand() * 3) * 2;
    const x = Math.floor(rand() * (W - w)), y = GY - 6 + Math.floor(rand() * 96);
    add(`<rect class="a gb${i}" x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`);
  };
  for (let i = 0; i < 8; i++) glitchBar(i, [C.cyan, C.mag, C.white, C.pink][i % 4]);
  for (let g = 0; g < 3; g++) {
    let d = '';
    for (let i = 0; i < 70; i++) d += `M${GX + Math.floor(rand() * gridW / 2) * 2} ${GY - 6 + Math.floor(rand() * 48) * 2}h2v2h-2z`;
    const stops = [[0, `${op(0)};${STEPS}`]];
    for (let t = GL0 + g * 0.06; t < DEL1; t += 0.18) {
      stops.push([t, `${op(0.9)};${STEPS}`], [t + 0.06, `${op(0)};${STEPS}`]);
    }
    kf(`nz${g}`, stops);
    add(`<path class="a nz${g}" d="${d}" fill="${[C.white, C.cyan, C.mag][g]}"/>`);
  }

  // ── Повідомлення ──
  const shadowText = (str, x, y, s, color, cls) =>
    `<g class="a ${cls}"><path d="${textPath(str, x + s, y + s, s)}" fill="${C.shadow}"/><path d="${textPath(str, x, y, s)}" fill="${color}"/></g>`;

  const clear = 'LEVEL CLEAR!';
  kf('lc', [[0, `${op(0)};${STEPS}`], [SHIP_OUT - 0.1, `${op(1)};${STEPS}`], [14.9, `${op(0)};${STEPS}`], [15.05, `${op(1)};${STEPS}`], [15.2, `${op(0)};${STEPS}`], [15.35, `${op(1)};${STEPS}`], [GL0 + 0.05, `${op(0)};${STEPS}`]]);
  add(shadowText(clear, Math.round((W - textW(clear, 3)) / 2), 81, 3, C.cyan, 'lc'));

  const del = 'WORLD DELETED';
  const delX = Math.round((W - textW(del, 3)) / 2);
  const jitter = [[0, `${op(0)};transform:translate(0,0);${STEPS}`]];
  for (let t = DEL0; t < DEL1; t += 0.09) jitter.push([t, `${op(rand() < 0.15 ? 0 : 1)};transform:translate(${(Math.floor(rand() * 5) - 2) * 2}px,0);${STEPS}`]);
  jitter.push([DEL1, `${op(0)};transform:translate(0,0);${STEPS}`]);
  kf('dm', jitter);
  kf('dc', jitter.map(([t, r], i) => [t, i === 0 || t >= DEL1 ? r : `${op(0.8)};transform:translate(${(Math.floor(rand() * 5) - 3) * 2}px,${(Math.floor(rand() * 3) - 1) * 2}px);${STEPS}`]));
  add(`<path class="a dc" d="${textPath(del, delX, 81, 3)}" fill="${C.cyan}"/>`);
  add(shadowText(del, delX, 81, 3, C.mag, 'dm'));

  // WELCOME TO MY PROFILE — літери друкуються по одній, колір перетікає cyan → magenta
  const welcome = 'WELCOME TO MY PROFILE';
  const ws = 4, wX = Math.round((W - textW(welcome, ws)) / 2), wY = 64;
  const lerp = (a, b, k) => {
    const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16)), pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
    return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, '0')).join('');
  };
  [...welcome].forEach((ch, i) => {
    if (ch === ' ') return;
    const t = WEL0 + i * WEL_DT;
    kf(`w${i}`, [[0, `${op(0)};transform:translateY(-6px)`], [t, `${op(0)};transform:translateY(-6px)`], [t + 0.01, `${op(1)};transform:translateY(-6px)`], [t + 0.09, `${op(1)};transform:translateY(0)`], [END0, `${op(1)};transform:translateY(0)`], [END1, `${op(0)};transform:translateY(0)`]]);
    const x = wX + i * 6 * ws;
    add(`<g class="a w${i}"><path d="${textPath(ch, x + ws, wY + ws, ws)}" fill="${C.shadow}"/><path d="${textPath(ch, x, wY, ws)}" fill="${lerp('00ADD8', 'BC52EE', i / (welcome.length - 1))}"/></g>`);
  });
  const press = 'PRESS START';
  kf('ps', [[0, op(0)], [PRESS0, op(0)], [PRESS0 + 0.01, op(1)], [END0, op(1)], [END1 - 0.2, op(0)]]);
  add(`<g class="a ps"><path class="blink" d="${textPath(press, Math.round((W - textW(press, 2)) / 2), 112, 2)}" fill="${C.white}"/></g>`);

  // ── Корабель ──
  const shipW = SHIP[0].length * SP;
  const sprite = (rows, color, ch) => `<path d="${gridPath(rows, -shipW / 2, LANE, SP, (x) => x === ch)}" fill="${color}"/>`;
  const x0 = ccx(0), x1 = ccx(n - 1), mid = W / 2;
  const tr = (x, y = 0) => `transform:translate(${x}px,${y}px)`;
  kf('shp', [
    [0, tr(-40)], [0.6, `${tr(-40)};animation-timing-function:cubic-bezier(.2,.8,.3,1)`], [S0, tr(x0)], [S1, tr(x1)],
    [SHIP_OUT, tr(W + 40)], [BACK0 - 0.01, tr(W + 40)], [BACK0, `${tr(-40)};animation-timing-function:cubic-bezier(.2,.8,.3,1)`],
    [BACK1, tr(mid)], [END0, `${tr(mid)};animation-timing-function:cubic-bezier(.6,0,.9,.4)`], [END1, tr(mid, -200)],
  ]);
  add(`<g class="a shp"><g class="bob">`);
  add(`<g class="fl1">${sprite(FLAME_A, C.yellow, 'y')}${sprite(FLAME_A, C.orange, 'o')}</g>`);
  add(`<g class="fl2">${sprite(FLAME_B, C.yellow, 'y')}${sprite(FLAME_B, C.orange, 'o')}</g>`);
  add(sprite(SHIP, C.magDark, 'd') + sprite(SHIP, C.mag, 'm') + sprite(SHIP, C.cyan, 'c') + sprite(SHIP, C.white, 'w'));
  add(`</g></g>`);

  // ── CRT-сканлайни поверх усього ──
  add(`<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="7" fill="url(#sl)"/>`);

  const baseCss = [
    `.a{animation-duration:${T}s;animation-iteration-count:infinite;animation-timing-function:linear;animation-fill-mode:both}`,
    `.fb{transform-box:fill-box;transform-origin:center}`,
    `.bob{animation:bob .8s steps(1,end) infinite}@keyframes bob{0%{transform:translateY(0)}50%{transform:translateY(-2px)}}`,
    `.fl1{animation:fl1 .16s steps(1,end) infinite}@keyframes fl1{0%{opacity:1}50%{opacity:0}}`,
    `.fl2{animation:fl2 .16s steps(1,end) infinite}@keyframes fl2{0%{opacity:0}50%{opacity:1}}`,
    `.blink{animation:blink .9s steps(1,end) infinite}@keyframes blink{0%{opacity:1}60%{opacity:0}}`,
    `@keyframes tw{0%{opacity:.8}50%{opacity:.15}}`,
    `.tw0{animation:tw 2.4s steps(1,end) infinite}.tw1{animation:tw 3.3s steps(1,end) .7s infinite}.tw2{animation:tw 1.9s steps(1,end) 1.3s infinite}`,
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges" role="img" aria-labelledby="t">
<title id="t">${name}: a ship clears the contribution world, the world glitches out, then WELCOME TO MY PROFILE</title>
<defs><pattern id="sl" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity=".22"/></pattern>${digitDefs}</defs>
<style>${baseCss.join('')}${css.join('')}</style>
${body.join('\n')}
</svg>
`;
}

// ───────────────────────── main ─────────────────────────
const seed = hash(USER.toLowerCase());
let data;
if (DEMO) data = demoCalendar(mulberry32(seed));
else if (!TOKEN) {
  console.error('Немає GITHUB_TOKEN. Для перегляду без токена запусти з --demo.');
  process.exit(1);
} else data = await fetchCalendar(USER, TOKEN);

const bonus = addBonusBlocks(data, MIN_FILL, mulberry32(seed ^ 0x9e3779b9));
const svg = render(data, USER, seed);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(`✔ ${OUT}: ${data.weeks.length} тижнів, ${data.total} контрибуцій, +${bonus} ігрових блоків, ${(svg.length / 1024).toFixed(1)} KB`);
