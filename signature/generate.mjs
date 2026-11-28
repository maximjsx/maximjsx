import { readFileSync, writeFileSync } from "node:fs";

const USERNAME = "maximjsx";
const HERE = new URL(".", import.meta.url);
const OUT = new URL("../assets/signature.svg", HERE);

const W = 840;
const H = 300;
const SIG_W = 594;
const SIG_H = 227;
const SCALE = 0.66;
const SIG_X = (W - SIG_W * SCALE) / 2;
const SIG_Y = 14;
const LINE_Y = 190;
const LAMP_Y = 204;
const STATS_Y = 252;

// timings follow ur.contact, compressed a bit so a readme visitor sees the whole thing
const WRITE_START = 1100;
const WRITE_MS = 2500;
const STROKE_LIFT = 140;
const PEN_WIDTH = 21;
const DOT_DELAY = 100;
const DROP_MS = 1340;
const SHINE_DELAY = 150;
const SHINE_MS = 2300;
const RISE_MS = 1400;

const LIGHT = "rgb(255 244 222)";
const light = (alpha) => `rgb(255 244 222 / ${alpha})`;

const r = (v) => Math.round(v * 10) / 10;
const sec = (ms) => `${r(ms / 1000)}s`;
const at = (ms) => sec(ms + WRITE_START);
const mix = (a, b, k) => a + (b - a) * k;
const easeInOut = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const numbers = (d) => d.match(/-?\d*\.?\d+/g).map(Number);
const font = (name) => readFileSync(new URL(`fonts/${name}`, HERE)).toString("base64");

function bbox(d) {
  const n = numbers(d);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function polylineLength(d) {
  const n = numbers(d);
  let length = 0;
  for (let i = 2; i < n.length; i += 2) {
    length += Math.hypot(n[i] - n[i - 2], n[i + 1] - n[i - 1]);
  }
  return length;
}

function random(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

// only a token owned by the user itself can see private repos and their PRs, the actions token cannot
const PRIVATE_TOKEN = process.env.STATS_TOKEN;
const TOKEN = PRIVATE_TOKEN || process.env.GITHUB_TOKEN;

async function github(path) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "signature-card" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchRepos() {
  const path = PRIVATE_TOKEN ? "/user/repos?affiliation=owner&visibility=all" : `/users/${USERNAME}/repos?type=owner`;
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await github(`${path}&per_page=100&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) return repos;
  }
}

async function fetchStats() {
  const [user, repos, commits, prs] = await Promise.all([
    github(`/users/${USERNAME}`),
    fetchRepos(),
    github(`/search/commits?q=author:${USERNAME}&per_page=1`),
    github(`/search/issues?q=author:${USERNAME}+type:pr&per_page=1`),
  ]);
  return [
    { label: "STARS", value: repos.reduce((sum, repo) => sum + repo.stargazers_count, 0) },
    { label: "COMMITS", value: commits.total_count },
    { label: "PULL REQUESTS", value: prs.total_count },
    { label: "FOLLOWERS", value: user.followers },
    { label: "REPOS", value: repos.length },
  ];
}

function compact(value) {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0).replace(/\.0$/, "")}k`;
}

function timeline(letters) {
  const [initial, ...toWrite] = letters;
  const penTotal = toWrite.flatMap((l) => l.pens).reduce((sum, d) => sum + polylineLength(d), 0);
  let cursor = 0;
  const written = toWrite.map((letter) => {
    const strokes = letter.pens.map((d, k) => {
      if (k > 0) cursor += STROKE_LIFT;
      const length = polylineLength(d);
      const stroke = { d, length: Math.ceil(length) + 2, start: cursor, duration: (WRITE_MS * length) / penTotal };
      cursor += stroke.duration;
      return stroke;
    });
    return { ...letter, strokes, end: cursor };
  });
  const dropLetter = written.find((l) => l.drops.length);
  const dropStart = dropLetter.end + DOT_DELAY;
  const finished = Math.max(cursor, dropStart + 640);
  return { initial, written, drop: dropLetter.drops[0], writeEnd: cursor, dropStart, finished };
}

// the M starts centered on its own and the word pulls it left while it is written, like ur.contact.
// it only rises to make room once the stats come in
function slideKeyframes(initial, allInk, writeEnd, riseStart) {
  const m = bbox(initial.ink);
  const wordRight = Math.max(...allInk.map((d) => bbox(d).x1));
  const centerX = (right) => r(W / 2 - (SIG_X + ((m.x0 + right) / 2) * SCALE));
  const startY = r(H / 2 - (SIG_Y + ((m.y0 + m.y1) / 2) * SCALE));
  const riseEnd = WRITE_START + riseStart + RISE_MS;
  const pct = (ms) => r((ms / riseEnd) * 100);

  const frames = [`0% { transform: translate(${centerX(m.x1)}px, ${startY}px); }`];
  for (let i = 0; i <= 12; i++) {
    const right = mix(m.x1, wordRight, easeInOut(i / 12));
    frames.push(`${pct(WRITE_START + (writeEnd * i) / 12)}% { transform: translate(${centerX(right)}px, ${startY}px); }`);
  }
  frames.push(
    `${pct(WRITE_START + riseStart)}% { transform: translate(${centerX(wordRight)}px, ${startY}px); animation-timing-function: cubic-bezier(.6, 0, .2, 1); }`,
    `100% { transform: translate(${centerX(wordRight)}px, 0); }`,
  );
  return { css: frames.join("\n      "), duration: riseEnd };
}

function starLayer(rand, { count, minR, maxR, minO, maxO, twinkle, cool }) {
  return Array.from({ length: count }, () => {
    const x = r(rand() * W);
    const y = r(rand() * H);
    const size = r(mix(minR, maxR, rand()));
    const opacity = r(mix(minO, maxO, rand()));
    const fill = rand() < cool ? "#cbdbff" : "#fff4de";
    const style = rand() < twinkle ? ` class="twinkle" style="animation-duration: ${r(2 + rand() * 4)}s; animation-delay: -${r(rand() * 6)}s"` : "";
    return `<circle cx="${x}" cy="${y}" r="${size}" fill="${fill}" opacity="${opacity}"${style}/>`;
  }).join("");
}

// each layer is drawn twice side by side and slid by one width, so the loop has no seam
function parallax(rand) {
  const layers = [
    { speed: 240, count: 110, minR: 0.25, maxR: 0.6, minO: 0.15, maxO: 0.45, twinkle: 0.1, cool: 0.3 },
    { speed: 120, count: 45, minR: 0.5, maxR: 0.95, minO: 0.3, maxO: 0.7, twinkle: 0.3, cool: 0.2 },
    { speed: 55, count: 14, minR: 0.9, maxR: 1.5, minO: 0.55, maxO: 0.9, twinkle: 0.5, cool: 0.15 },
  ];
  return layers
    .map((layer, i) => {
      const stars = starLayer(rand, layer);
      const glow = i === 2 ? ` filter="url(#star-glow)"` : "";
      return `<g class="drift" style="animation-duration: ${layer.speed}s"${glow}><g id="stars-${i}">${stars}</g><use href="#stars-${i}" x="${W}"/></g>`;
    })
    .join("\n      ");
}

function shootingStars() {
  return [
    { x: 620, y: 30, delay: 6, every: 11 },
    { x: 260, y: 18, delay: 13, every: 17 },
  ]
    .map(
      (s) =>
        `<g transform="translate(${s.x} ${s.y}) rotate(155)"><rect class="meteor" width="70" height="1" fill="url(#meteor)" style="animation-duration: ${s.every}s; animation-delay: ${s.delay}s"/></g>`,
    )
    .join("\n      ");
}

function statsRow(stats, revealAt) {
  const slot = (W - 160) / stats.length;
  return stats
    .map((stat, i) => {
      const x = r(80 + slot * (i + 0.5));
      const delay = at(revealAt + i * 140);
      return `<g class="reveal" style="animation-delay: ${delay}">
      <text class="stat" x="${x}" y="${STATS_Y}" text-anchor="middle">${compact(stat.value)}</text>
      <text class="label" x="${x}" y="${STATS_Y + 18}" text-anchor="middle">${stat.label}</text>
    </g>`;
    })
    .join("\n    ");
}

function render(letters, stats) {
  const t = timeline(letters);
  const allInk = [t.initial.ink, ...t.written.map((l) => l.ink)];
  const mCenter = bbox(t.initial.ink);
  const halo = { x: r((mCenter.x0 + mCenter.x1) / 2), y: r((mCenter.y0 + mCenter.y1) / 2) };
  const dropBox = bbox(t.drop);
  const anchor = { x: r((dropBox.x0 + dropBox.x1) / 2), y: r(dropBox.y1) };
  const shineStart = t.finished + SHINE_DELAY;
  const riseStart = t.finished + 500;
  const litStart = riseStart + 500;
  const slide = slideKeyframes(t.initial, allInk, t.writeEnd, riseStart);
  const strokes = t.written.flatMap((l) => l.strokes);

  const masks = t.written
    .map(
      (l, i) => `<mask id="pen-${i}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="${SIG_W + 40}" height="${SIG_H + 40}">
      <g filter="url(#soft-edge)" fill="none" stroke="#fff" stroke-width="${PEN_WIDTH}" stroke-linecap="round" stroke-linejoin="round">
        ${l.strokes.map((s) => `<path d="${s.d}" stroke-dasharray="${s.length}" stroke-dashoffset="${s.length}" style="animation: write ${sec(s.duration)} linear ${at(s.start)} forwards"/>`).join("\n        ")}
      </g>
    </mask>`,
    )
    .join("\n    ");

  const inkClip = [...allInk, t.drop].map((d) => `<path d="${d}"/>`).join("");
  const writtenInk = t.written
    .map((l, i) => `<path class="ink wet" d="${l.ink}" mask="url(#pen-${i})" style="animation-delay: ${at(l.end + 400)}"/>`)
    .join("\n        ");
  const tipMotions = strokes
    .map((s) => `<animateMotion path="${s.d}" begin="${at(s.start)}" dur="${sec(s.duration)}" fill="freeze"/>`)
    .join("\n          ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Maxim, GitHub stats">
  <title>Maxim</title>
  <style>
    @font-face { font-family: "Geist"; font-weight: 300; src: url(data:font/woff2;base64,${font("geist-300.woff2")}) format("woff2"); }
    @font-face { font-family: "Geist Mono"; src: url(data:font/woff2;base64,${font("geist-mono.woff2")}) format("woff2"); }

    .grain { animation: grain 1.2s steps(6) infinite; }
    @keyframes grain {
      0% { transform: translate(0, 0); }
      25% { transform: translate(-3%, 2%); }
      50% { transform: translate(2%, -3%); }
      75% { transform: translate(-2%, -1%); }
      100% { transform: translate(1%, 3%); }
    }

    .space { opacity: 0; animation: fade 4s ease .2s forwards; }
    .drift { animation: drift linear infinite; }
    @keyframes drift { to { transform: translateX(-${W}px); } }
    .twinkle { animation: twinkle ease-in-out infinite alternate; }
    @keyframes twinkle { to { opacity: .1; } }
    .planet { animation: planet 150s linear -55s infinite; }
    @keyframes planet {
      from { transform: translate(${W + 80}px, 0); }
      to { transform: translate(-160px, 0); }
    }
    .moon { animation: planet 95s linear -20s infinite; }
    .galaxy { animation: galaxy 320s linear -150s infinite; }
    @keyframes galaxy {
      from { transform: translate(${W + 140}px, 0); }
      to { transform: translate(-220px, 0); }
    }
    .spin { transform-box: fill-box; transform-origin: center; animation: spin 90s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .nebula { animation: nebula 40s ease-in-out infinite alternate; }
    @keyframes nebula { to { transform: translate(-40px, 10px); } }
    .meteor { opacity: 0; animation: meteor ease-in infinite; }
    @keyframes meteor {
      0% { opacity: 0; transform: translateX(0); }
      1% { opacity: 1; }
      6% { opacity: 0; transform: translateX(260px); }
      100% { opacity: 0; transform: translateX(260px); }
    }

    .slide { animation: slide ${sec(slide.duration)} linear both; }
    @keyframes slide {
      ${slide.css}
    }

    .signature { animation: emerge 2s cubic-bezier(.2, .6, .2, 1) .2s backwards; }
    @keyframes emerge { from { opacity: 0; filter: blur(16px); } }

    .ink { fill: #ebe6dc; }
    .wet { fill: #fff; filter: drop-shadow(0 0 5px ${light(0.7)}); animation: dry 1.6s ease forwards; }
    @keyframes dry { to { fill: #ebe6dc; filter: drop-shadow(0 0 0 ${light(0)}); } }
    @keyframes write { to { stroke-dashoffset: 0; } }

    .halo { animation: breathe 3.6s ease-in-out infinite; }
    @keyframes breathe { 50% { opacity: .35; } }

    .tip { opacity: 0; animation: tip ${sec(t.writeEnd + 150)} linear ${at(0)}; }
    @keyframes tip { 2%, 94% { opacity: 1; } }

    .drop { opacity: 0; transform-origin: ${anchor.x}px ${anchor.y}px; animation: drop ${sec(DROP_MS)} linear ${at(t.dropStart)} forwards; }
    @keyframes drop {
      0% { opacity: 0; transform: translateY(-150px) scale(.7); }
      19% { opacity: 1; transform: translateY(-150px) scale(1); animation-timing-function: cubic-bezier(.55, 0, 1, .45); }
      47% { transform: translateY(0) scale(.78, 1.4); }
      55% { transform: scale(1.3, .6); }
      64% { transform: scale(.88, 1.15); }
      74% { transform: scale(1.05, .95); }
      100% { opacity: 1; transform: none; }
    }
    .ripple { opacity: 0; transform-origin: ${anchor.x}px ${anchor.y}px; animation: ripple .7s ease-out ${at(t.dropStart + 640)}; }
    @keyframes ripple {
      from { opacity: .4; transform: scale(.12); }
      to { opacity: 0; transform: scale(1); }
    }

    .shine { transform: translateX(-160px); animation: shine ${sec(SHINE_MS)} cubic-bezier(.45, 0, .2, 1) ${at(shineStart)} forwards; }
    @keyframes shine { to { transform: translateX(${SIG_W + 20}px); } }

    .lamp { transform-origin: ${W / 2}px 0; transform: scaleX(0); animation: lamp 1.1s cubic-bezier(.7, 0, .2, 1) ${at(litStart)} forwards; }
    @keyframes lamp { to { transform: scaleX(1); } }
    .pool { opacity: 0; transform-origin: ${W / 2}px ${LAMP_Y}px; transform: scaleY(.2); animation: pool 2s cubic-bezier(.2, .7, .2, 1) ${at(litStart + 500)} forwards; }
    @keyframes pool { to { opacity: 1; transform: scaleY(1); } }

    .reveal { opacity: 0; animation: reveal 1.8s cubic-bezier(.2, .7, .2, 1) forwards; }
    @keyframes reveal {
      from { opacity: 0; filter: blur(10px); transform: translateY(10px); }
      to { opacity: 1; filter: blur(0); transform: none; }
    }
    .line { font: 300 19px "Geist", "Segoe UI", system-ui, sans-serif; letter-spacing: .02em; }
    .stat { font: 300 22px "Geist", "Segoe UI", system-ui, sans-serif; fill: #f4f1ea; }
    .label { font: 9.5px "Geist Mono", ui-monospace, Consolas, monospace; letter-spacing: .18em; fill: #6a655d; }

    @keyframes fade { to { opacity: 1; } }

    @media (prefers-reduced-motion: reduce) {
      * { animation-duration: 1ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; }
      .tip, .ripple, .meteor { display: none; }
    }
  </style>
  <defs>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="16"/></clipPath>
    <filter id="noise" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/>
    </filter>
    <filter id="star-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="haze" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="soft-edge" filterUnits="userSpaceOnUse" x="-20" y="-20" width="${SIG_W + 40}" height="${SIG_H + 40}">
      <feGaussianBlur stdDeviation="1.6"/>
    </filter>
    <radialGradient id="glow" cx="50%" cy="34%" r="60%">
      <stop offset="0" stop-color="${LIGHT}" stop-opacity=".06"/>
      <stop offset="1" stop-color="${LIGHT}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="nebula-warm">
      <stop offset="0" stop-color="#c98a5a" stop-opacity=".16"/>
      <stop offset="1" stop-color="#c98a5a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="nebula-cool">
      <stop offset="0" stop-color="#5a6fc9" stop-opacity=".13"/>
      <stop offset="1" stop-color="#5a6fc9" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="galaxy-core">
      <stop offset="0" stop-color="#fff4de" stop-opacity=".55"/>
      <stop offset=".25" stop-color="#e8d8ff" stop-opacity=".18"/>
      <stop offset="1" stop-color="#9aa8ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="planet-body" cx="35%" cy="30%" r="80%">
      <stop offset="0" stop-color="#d9b48c"/>
      <stop offset=".45" stop-color="#8a5a3c"/>
      <stop offset="1" stop-color="#1a0f0a"/>
    </radialGradient>
    <radialGradient id="moon-body" cx="35%" cy="30%" r="80%">
      <stop offset="0" stop-color="#b9c4dc"/>
      <stop offset=".5" stop-color="#4c5670"/>
      <stop offset="1" stop-color="#0c0e14"/>
    </radialGradient>
    <linearGradient id="ring" x1="0" x2="1">
      <stop offset="0" stop-color="#fff4de" stop-opacity="0"/>
      <stop offset=".5" stop-color="#fff4de" stop-opacity=".5"/>
      <stop offset="1" stop-color="#fff4de" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="meteor">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#fff" stop-opacity=".9"/>
    </linearGradient>
    <radialGradient id="halo-light">
      <stop offset="0" stop-color="${LIGHT}" stop-opacity=".16"/>
      <stop offset="1" stop-color="${LIGHT}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="tip-light">
      <stop offset="0" stop-color="#fff"/>
      <stop offset=".22" stop-color="#fff" stop-opacity=".95"/>
      <stop offset=".5" stop-color="${LIGHT}" stop-opacity=".28"/>
      <stop offset="1" stop-color="${LIGHT}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="shine-light">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".32" stop-color="#fff" stop-opacity=".45"/>
      <stop offset=".5" stop-color="#fff"/>
      <stop offset=".68" stop-color="#fff" stop-opacity=".45"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="lamp-light">
      <stop offset="0" stop-color="${LIGHT}" stop-opacity="0"/>
      <stop offset=".5" stop-color="${LIGHT}" stop-opacity=".9"/>
      <stop offset="1" stop-color="${LIGHT}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="pool-light" cx="50%" cy="100%" r="50%" fx="50%" fy="100%" gradientTransform="translate(0 .5) scale(1 .5)">
      <stop offset="0" stop-color="${LIGHT}" stop-opacity=".16"/>
      <stop offset=".45" stop-color="${LIGHT}" stop-opacity=".04"/>
      <stop offset=".75" stop-color="${LIGHT}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="line-ink" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#fff"/>
      <stop offset=".4" stop-color="#f4f1ea"/>
      <stop offset="1" stop-color="#a9a49b"/>
    </linearGradient>
    <clipPath id="ink-clip">${inkClip}</clipPath>
    ${masks}
  </defs>

  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="#000"/>
    <g class="space">
      <g class="nebula">
        <ellipse cx="180" cy="230" rx="240" ry="110" fill="url(#nebula-cool)"/>
        <ellipse cx="690" cy="60" rx="220" ry="120" fill="url(#nebula-warm)"/>
      </g>
      <g class="galaxy">
        <g transform="translate(0 70) rotate(-24)">
          <g class="spin">
            <ellipse rx="46" ry="13" fill="url(#galaxy-core)" filter="url(#haze)"/>
            <ellipse rx="30" ry="7" fill="url(#galaxy-core)" transform="rotate(38)" filter="url(#haze)"/>
            <ellipse rx="9" ry="3.4" fill="#fff4de" opacity=".35"/>
          </g>
        </g>
      </g>
      ${parallax(random(7))}
      <g class="moon" opacity=".8"><circle cy="220" r="4.5" fill="url(#moon-body)"/></g>
      <g class="planet" opacity=".75">
        <g transform="translate(0 34) rotate(-16)" fill="none" stroke="url(#ring)" stroke-width="1">
          <path d="M-34 0 A34 6.5 0 0 1 34 0" opacity=".5"/>
          <circle r="15" fill="url(#planet-body)" stroke="none" transform="rotate(16)"/>
          <path d="M-34 0 A34 6.5 0 0 0 34 0" opacity=".9"/>
        </g>
      </g>
      ${shootingStars()}
      <rect width="${W}" height="${H}" fill="url(#glow)"/>
    </g>

    <g class="slide">
      <g class="signature" transform="translate(${r(SIG_X)} ${SIG_Y}) scale(${SCALE})">
        <ellipse class="halo" cx="${halo.x}" cy="${halo.y}" rx="190" ry="150" fill="url(#halo-light)" opacity="0"/>
        <path class="ink" d="${t.initial.ink}"/>
        ${writtenInk}
        <g class="drop"><path class="ink wet" d="${t.drop}" style="animation-delay: ${at(t.dropStart + 1100)}"/></g>
        <ellipse class="ripple" cx="${anchor.x}" cy="${anchor.y}" rx="27" ry="8.1" fill="none" stroke="#ebe6dc" stroke-width=".8"/>
        <g clip-path="url(#ink-clip)" style="filter: drop-shadow(0 0 4px ${light(0.9)}) drop-shadow(0 0 12px ${light(0.45)})">
          <rect class="shine" x="0" y="-20" width="150" height="${SIG_H + 40}" fill="url(#shine-light)"/>
        </g>
        <circle class="tip" r="9" fill="url(#tip-light)">
          ${tipMotions}
        </circle>
      </g>
    </g>

    <rect class="pool" x="${W / 2 - 300}" y="${LAMP_Y - 180}" width="600" height="180" fill="url(#pool-light)"/>
    <rect class="lamp" x="${W / 2 - 210}" y="${LAMP_Y}" width="420" height="1" fill="url(#lamp-light)"/>

    <text class="reveal line" x="${W / 2}" y="${LINE_Y}" text-anchor="middle" fill="url(#line-ink)" style="animation-delay: ${at(litStart + 400)}">Made by Maxim.jsx, click me to add this card to your readme as well 😎</text>
    ${statsRow(stats, litStart + 700)}

    <rect class="grain" x="-${W / 2}" y="-${H / 2}" width="${W * 2}" height="${H * 2}" filter="url(#noise)" opacity=".035"/>
  </g>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="15.5" fill="none" stroke="${light(0.07)}"/>
</svg>
`;
}

const letters = JSON.parse(readFileSync(new URL("letters.json", HERE), "utf8"));
const stats = await fetchStats();
writeFileSync(OUT, render(letters, stats));
console.log(stats.map((s) => `${s.label.toLowerCase()} ${s.value}`).join(", "));
