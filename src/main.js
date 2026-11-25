// Original pixel-art koi pond simulation. All scene artwork is drawn in Canvas 2D.
const canvas = document.querySelector("#pond");
const ctx = canvas.getContext("2d");
// The control bar was removed from the page; these lookups stay safe without it.
const ui = (selector) => document.querySelector(selector) || {};
const W = 480;
const H = 270;

const palettes = {
  morning: ["#62bdea", "#1d68ab", "#d6f1ff"],
  overcast: ["#3b6b8b", "#38658d", "#dbe9f2"],
  sunset: ["#6fa9dc", "#3a5796", "#f6dcb4"],
};
const koiSkins = [
  { base: "#f4e8c8", marks: ["#cf3f32", "#cf3f32", "#cf3f32"] },
  { base: "#ece6d1", marks: ["#222c2d", "#222c2d", "#222c2d"] },
  { base: "#e39a4a", marks: ["#f6e8c7", "#f6e8c7", "#f6e8c7"] },
  { base: "#f4e9d2", marks: ["#d64832", "#242a2b", "#d64832"] },
  { base: "#e9d5a3", marks: ["#b83f32", "#b83f32", "#293137"] },
];

let fish = [];
let minnows = [];
let ripples = [];
let rain = false;
let paused = false;
let weather = "morning";
let lastTime = performance.now();
let audio = null;
let soundOn = false;

const PADS = [
  [62, 58, 26],
  [112, 38, 20],
  [404, 72, 30],
  [384, 208, 24],
  [40, 214, 22],
  [212, 118, 26],
  [278, 164, 28],
];
let pellets = [];
let feedSpot = null;
let feedActive = false;

canvas.width = W;
canvas.height = H;
ctx.imageSmoothingEnabled = false;

const SEGMENTS = 10;
const GAP = 2.8;

function makeKoi() {
  const skin = koiSkins[Math.floor(Math.random() * koiSkins.length)];
  const size = 0.78 + Math.random() * 0.62;
  const angle = Math.random() * Math.PI * 2;
  const x = 32 + Math.random() * (W - 64);
  const y = 28 + Math.random() * (H - 56);
  return {
    x,
    y,
    angle,
    speed: 10 + Math.random() * 8,
    size,
    phase: Math.random() * 8,
    turn: 0.55 + Math.random() * 0.4,
    ...skin,
    spine: Array.from({ length: SEGMENTS }, (_, i) => ({
      x: x - Math.cos(angle) * GAP * size * i,
      y: y - Math.sin(angle) * GAP * size * i,
    })),
    pattern: Array.from({ length: SEGMENTS }, (_, i) =>
      i >= 1 && i <= 6 && Math.random() < 0.6
        ? skin.marks[Math.floor(Math.random() * skin.marks.length)]
        : null,
    ),
    patchOffset: Array.from({ length: SEGMENTS }, () => Math.random() - 0.5),
    appetite: 1 + Math.floor(Math.random() * 3),
    ate: 0,
    fullUntil: 0,
    dash: 0,
    target: null,
  };
}

// Each body segment follows the one in front, giving a curved, swimming body.
function followSpine(koi) {
  const sp = koi.spine;
  sp[0].x = koi.x;
  sp[0].y = koi.y;
  const gap = GAP * koi.size;
  for (let i = 1; i < sp.length; i++) {
    const dx = sp[i - 1].x - sp[i].x;
    const dy = sp[i - 1].y - sp[i].y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > gap) {
      sp[i].x += (dx / d) * (d - gap);
      sp[i].y += (dy / d) * (d - gap);
    }
  }
}

function setFishCount(count) {
  count = Math.max(1, Math.min(22, count));
  while (fish.length > count) fish.pop();
  while (fish.length < count) fish.push(makeKoi());
  ui("#count").textContent = String(fish.length);
}

setFishCount(14);

function createMinnows() {
  const colors = ["#f0b830", "#ec7146", "#38b8d4", "#dd577e"];
  return Array.from({ length: 9 }, (_, i) => ({
    x: 120 + Math.random() * 240,
    y: 65 + Math.random() * 150,
    angle: Math.random() * Math.PI * 2,
    speed: 8 + Math.random() * 8,
    phase: Math.random() * 8,
    color: colors[i % colors.length],
  }));
}

minnows = createMinnows();

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * W,
    y: ((event.clientY - rect.top) / rect.height) * H,
  };
}

function fleeTarget(koi, from, minDist) {
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = minDist + Math.random() * 60;
    const c = {
      x: Math.max(30, Math.min(W - 30, koi.x + Math.cos(a) * d)),
      y: Math.max(26, Math.min(H - 26, koi.y + Math.sin(a) * d)),
    };
    const score = Math.hypot(c.x - from.x, c.y - from.y);
    if (Math.hypot(c.x - koi.x, c.y - koi.y) > 50 && score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best || { x: W - koi.x, y: H - koi.y };
}

function startle(koi, from, minDist, dashTime) {
  koi.target = fleeTarget(koi, from, minDist);
  koi.angle = Math.atan2(koi.target.y - koi.y, koi.target.x - koi.x);
  koi.dash = dashTime;
}

canvas.addEventListener("pointerdown", (event) => {
  const point = pointerPosition(event);
  ripples.push({ ...point, age: 0 });

  const hit = fish.filter((koi) =>
    koi.spine.some(
      (seg) => Math.hypot(seg.x - point.x, seg.y - point.y) < 5 * koi.size + 3,
    ),
  );

  if (hit.length) {
    for (const koi of hit) startle(koi, point, 120, 1.3);
    for (const koi of fish) {
      if (
        !hit.includes(koi) &&
        Math.hypot(koi.x - point.x, koi.y - point.y) < 45
      ) {
        startle(koi, point, 70, 0.7);
      }
    }
  } else {
    for (const koi of fish) koi.target = point;
  }
  for (const minnow of minnows) minnow.fleeUntil = performance.now() + 900;
});

function drawWater(time) {
  const [surface, deep, light] = palettes[weather];
  const water = ctx.createLinearGradient(0, 0, W, H);
  water.addColorStop(0, surface);
  water.addColorStop(1, deep);
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, W, H);

  const cell = 6;
  for (let y = 0; y < H; y += cell) {
    for (let x = 0; x < W; x += cell) {
      const v =
        Math.sin(x * 0.045 + time * 0.5) +
        Math.sin(y * 0.062 - time * 0.4) +
        Math.sin((x + y) * 0.03 + time * 0.3);
      if (v > 1.3) {
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = light;
        ctx.fillRect(x, y, cell, cell);
      } else if (v < -1.35) {
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = deep;
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }

  // Broken sunlight lines.
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = light;
  for (let i = 0; i < 44; i++) {
    const x = (i * 67 + time * (3 + (i % 4))) % W;
    const y = (i * 37 + Math.sin(time * 0.4 + i) * 7 + H) % H;
    ctx.fillRect(Math.floor(x), Math.floor(y), 7 + (i % 5), 1);
    if (i % 3 === 0) ctx.fillRect(Math.floor(x + 3), Math.floor(y + 1), 1, 2);
  }
  ctx.globalAlpha = 1;

  // Depth shading at the pond edge.
  ctx.fillStyle = "#0a3a6a66";
  ctx.fillRect(0, 0, W, 5);
  ctx.fillRect(0, H - 6, W, 6);
  ctx.fillRect(0, 0, 5, H);
  ctx.fillRect(W - 5, 0, 5, H);
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const c = (shift) =>
    Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

function ellipse(cx, cy, rx, ry) {
  const x = Math.round(cx);
  const y = Math.round(cy);
  const RY = Math.max(1, Math.round(ry));
  for (let dy = -RY; dy <= RY; dy++) {
    const half = Math.round(rx * Math.sqrt(1 - (dy * dy) / (RY * RY)));
    ctx.fillRect(x - half, y + dy, half * 2 + 1, 1);
  }
}

function petal(x, y, angle, len, width, color) {
  ctx.fillStyle = color;
  for (let t = 1; t <= len; t++) {
    const w = Math.max(
      1,
      Math.round(Math.sin((Math.PI * t) / (len + 1)) * width),
    );
    ctx.fillRect(
      Math.round(x + Math.cos(angle) * t - w / 2),
      Math.round(y + Math.sin(angle) * t - w / 2),
      w,
      w,
    );
  }
}

function drawFlower(x, y, size, phase) {
  const sway = Math.sin(phase * 0.6) * 0.05;
  ctx.fillStyle = "rgba(8, 55, 40, 0.35)";
  ellipse(x + 2, y + 3, size * 0.95, size * 0.8);
  const rings = [
    { n: 10, len: size, w: size * 0.3, color: "#c9dceb", off: 0 },
    { n: 8, len: size * 0.78, w: size * 0.3, color: "#e8f1f8", off: 0.2 },
    { n: 6, len: size * 0.54, w: size * 0.28, color: "#ffffff", off: 0.45 },
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.n; i++) {
      const angle = (i / ring.n) * Math.PI * 2 + ring.off + sway;
      petal(x, y, angle, Math.round(ring.len), ring.w, ring.color);
    }
  }
  const core = Math.max(2, size * 0.17);
  ctx.fillStyle = "#f6c744";
  ellipse(x, y, core, core);
  ctx.fillStyle = "#df8a2a";
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + sway;
    ctx.fillRect(
      Math.round(x + Math.cos(a) * core * 0.7),
      Math.round(y + Math.sin(a) * core * 0.7),
      1,
      1,
    );
  }
}

function drawPad(x, y, r, phase) {
  const ry = r * 0.88;
  const [surface, deep] = palettes[weather];
  const water = mix(surface, deep, ((x + y) / (W + H)) * 0.8);

  ctx.fillStyle = "rgba(5, 40, 80, 0.25)";
  ellipse(x + 3, y + 5, r, ry);
  ctx.fillStyle = "#14583f";
  ellipse(x, y, r, ry);
  ctx.fillStyle = "#237a57";
  ellipse(x, y - 1, r - 3, ry - 3);
  ctx.fillStyle = "#3a9266";
  ellipse(x - 2, y - 2, r * 0.62, ry * 0.6);

  ctx.fillStyle = "#1b6a4b";
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    for (let t = r * 0.3; t < r - 3; t++) {
      ctx.fillRect(
        Math.round(x + Math.cos(a) * t),
        Math.round(y + Math.sin(a) * t * 0.88),
        1,
        1,
      );
    }
  }

  const notch = (x * 0.07 + y * 0.03) % (Math.PI * 2);
  ctx.fillStyle = water;
  for (let a = -0.16; a <= 0.16; a += 0.04) {
    pixelRay(x, y, notch + a, r + 1, 2);
  }

  drawFlower(
    x + r * 0.05 - Math.cos(notch) * r * 0.12,
    y - r * 0.08 - Math.sin(notch) * r * 0.1,
    r * 0.62,
    phase,
  );
}

const WIDTHS = [2.6, 3.6, 4.2, 4.2, 3.6, 3.0, 2.3, 1.7, 1.2, 0.8];

function disc(cx, cy, r) {
  const x = Math.round(cx);
  const y = Math.round(cy);
  const R = Math.max(1, Math.round(r));
  for (let dy = -R; dy <= R; dy++) {
    const half = Math.round(Math.sqrt(R * R - dy * dy));
    ctx.fillRect(x - half, y + dy, half * 2 + 1, 1);
  }
}

function pixelRay(x, y, angle, length, size = 2) {
  for (let t = 0; t <= length; t++) {
    ctx.fillRect(
      Math.round(x + Math.cos(angle) * t),
      Math.round(y + Math.sin(angle) * t),
      size,
      size,
    );
  }
}

function drawKoi(koi, time) {
  const s = koi.size;
  const sp = koi.spine;
  const n = sp.length;
  const swim = time * 6 + koi.phase;

  // Soft shadow on the pond floor.
  ctx.save();
  ctx.strokeStyle = "rgba(5, 40, 85, 0.22)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 7 * s;
  ctx.beginPath();
  sp.forEach((p, i) => {
    if (i) ctx.lineTo(p.x + 4, p.y + 6);
    else ctx.moveTo(p.x + 4, p.y + 6);
  });
  ctx.stroke();
  ctx.restore();

  const pts = sp.map((p, i) => {
    const a =
      i === 0 ? koi.angle : Math.atan2(sp[i - 1].y - p.y, sp[i - 1].x - p.x);
    const off = Math.sin(swim - i * 0.8) * i * 0.2 * s;
    return { x: p.x - Math.sin(a) * off, y: p.y + Math.cos(a) * off, a };
  });

  const tail = pts[n - 1];
  const tailDir = tail.a + Math.PI;
  const sway = Math.sin(swim - n * 0.8) * 0.4;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = koi.base;
  for (let k = -2; k <= 2; k++) {
    pixelRay(
      tail.x,
      tail.y,
      tailDir + k * 0.3 + sway,
      (5 + (2 - Math.abs(k)) * 1.6) * s,
    );
  }

  const flap = Math.sin(swim * 1.3) * 0.35;
  const shoulder = pts[2];
  ctx.fillStyle = "#f6efdc";
  ctx.globalAlpha = 0.75;
  pixelRay(
    shoulder.x,
    shoulder.y,
    shoulder.a + Math.PI / 2 + 0.9 + flap,
    5 * s,
  );
  pixelRay(
    shoulder.x,
    shoulder.y,
    shoulder.a - Math.PI / 2 - 0.9 - flap,
    5 * s,
  );
  ctx.globalAlpha = 1;

  ctx.fillStyle = koi.base;
  for (let i = n - 1; i >= 0; i--) disc(pts[i].x, pts[i].y, WIDTHS[i] * s);

  // Colour patches.
  for (let i = 0; i < n; i++) {
    if (!koi.pattern[i]) continue;
    const o = koi.patchOffset[i] * WIDTHS[i] * 0.6 * s;
    ctx.fillStyle = koi.pattern[i];
    disc(
      pts[i].x - Math.sin(pts[i].a) * o,
      pts[i].y + Math.cos(pts[i].a) * o,
      WIDTHS[i] * s * 0.62,
    );
  }

  const head = pts[0];
  ctx.fillStyle = "#10222e";
  for (const side of [-1, 1]) {
    ctx.fillRect(
      Math.round(
        head.x + Math.cos(head.a) * 1.4 * s - Math.sin(head.a) * 2 * s * side,
      ),
      Math.round(
        head.y + Math.sin(head.a) * 1.4 * s + Math.cos(head.a) * 2 * s * side,
      ),
      1,
      1,
    );
  }
}

function drawMinnows(time) {
  for (const minnow of minnows) {
    const x = Math.round(minnow.x);
    const y = Math.round(minnow.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(minnow.angle);
    ctx.fillStyle = minnow.color;
    ctx.fillRect(-2, 0, 5, 2);
    ctx.fillRect(-4, Math.round(Math.sin(time * 10 + minnow.phase)), 2, 1);
    ctx.fillStyle = "#f8e6ac";
    ctx.fillRect(2, 0, 1, 1);
    ctx.restore();

    if (minnow.fleeUntil > performance.now()) {
      minnow.x += Math.cos(minnow.angle) * minnow.speed * 0.04;
      minnow.y += Math.sin(minnow.angle) * minnow.speed * 0.04;
    } else {
      minnow.x += Math.cos(minnow.angle) * minnow.speed * 0.012;
      minnow.y += Math.sin(minnow.angle) * minnow.speed * 0.012;
      if (Math.random() < 0.012) minnow.angle += (Math.random() - 0.5) * 0.8;
    }
    if (
      minnow.x < 20 ||
      minnow.x > W - 20 ||
      minnow.y < 20 ||
      minnow.y > H - 20
    ) {
      minnow.angle = Math.atan2(H / 2 - minnow.y, W / 2 - minnow.x);
    }
  }
}

// ---------- Feeding ----------
// The nearest free pellet for this fish, or the feeding spot if every pellet is taken.
function foodFor(koi, now) {
  if (!pellets.length || koi.fullUntil > now || koi.dash > 0) return null;
  let best = null;
  let bestD = Infinity;
  for (const p of pellets) {
    if (p.delay > 0 || p.z > 0) continue;
    if (p.claim && p.claim !== koi) continue;
    const d = Math.hypot(p.x - koi.x, p.y - koi.y);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  if (best) return { x: best.x, y: best.y, d: bestD, pellet: best };
  if (feedSpot) {
    const d = Math.hypot(feedSpot.x - koi.x, feedSpot.y - koi.y);
    if (d > 20) return { x: feedSpot.x, y: feedSpot.y, d, pellet: null };
  }
  return null;
}

function feedKoi() {
  let spot = null;
  for (let i = 0; i < 40 && !spot; i++) {
    const c = {
      x: 100 + Math.random() * (W - 200),
      y: 65 + Math.random() * (H - 130),
    };
    if (PADS.every(([x, y, r]) => Math.hypot(c.x - x, c.y - y) > r + 24))
      spot = c;
  }
  spot = spot || { x: W / 2, y: H / 2 };
  feedSpot = spot;
  feedActive = true;
  for (const koi of fish) {
    koi.ate = 0;
    koi.fullUntil = 0;
    if (koi.dash <= 0) koi.target = null;
  }
  ripples.push({ x: spot.x, y: spot.y, age: 0, scale: 0.5, speed: 1.4 });
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * 18;
    pellets.push({
      x: spot.x + Math.cos(a) * d,
      y: spot.y + Math.sin(a) * d * 0.8,
      z: 14 + Math.random() * 12,
      vz: 0,
      delay: Math.random() * 0.7,
      floating: 0,
      nibble: 0,
      claim: null,
      phase: Math.random() * 6,
    });
  }
}

function updateFood(dt, time) {
  for (const p of pellets) {
    if (p.delay > 0) {
      p.delay -= dt;
      continue;
    }
    if (p.z > 0) {
      p.vz -= 90 * dt;
      p.z += p.vz * dt;
      if (p.z <= 0) {
        p.z = 0;
        ripples.push({ x: p.x, y: p.y, age: 0, scale: 0.18, speed: 2 });
      }
    } else {
      p.floating += dt;
    }
  }

  for (const koi of fish) {
    if (koi.fullUntil > time || koi.dash > 0) continue;
    for (const p of pellets) {
      if (p.delay > 0 || p.z > 0 || p.claim) continue;
      if (Math.hypot(p.x - koi.x, p.y - koi.y) < 6 * koi.size + 2) {
        p.claim = koi;
        break;
      }
    }
  }

  // Nibble, then eat. A fish that has had enough swims off.
  const eaten = [];
  for (const p of pellets) {
    const koi = p.claim;
    if (!koi) continue;
    if (
      koi.dash > 0 ||
      koi.fullUntil > time ||
      Math.hypot(p.x - koi.x, p.y - koi.y) > 10 * koi.size + 4
    ) {
      p.claim = null;
      p.nibble = 0;
      continue;
    }
    const before = Math.floor(p.nibble / 0.22);
    p.nibble += dt;
    if (Math.floor(p.nibble / 0.22) !== before) {
      ripples.push({ x: p.x, y: p.y, age: 0, scale: 0.14, speed: 2.2 });
    }
    if (p.nibble >= 0.5) {
      eaten.push(p);
      koi.ate++;
      if (koi.ate >= koi.appetite) {
        koi.fullUntil = time + 12;
        koi.target = fleeTarget(koi, p, 90);
      }
    }
  }
  pellets = pellets.filter((p) => !eaten.includes(p) && p.floating < 20);

  if (feedActive && pellets.length === 0) {
    feedActive = false;
    for (const koi of fish) {
      const near = Math.hypot(koi.x - feedSpot.x, koi.y - feedSpot.y) < 90;
      if (near && !koi.target && koi.dash <= 0)
        koi.target = fleeTarget(koi, feedSpot, 80);
    }
  }
}

function drawFood(time) {
  for (const p of pellets) {
    if (p.delay > 0) continue;
    const x = Math.round(p.x);
    const bob = p.z > 0 ? 0 : Math.round(Math.sin(time * 2 + p.phase) * 0.5);
    ctx.globalAlpha = p.floating > 16 ? Math.max(0, (20 - p.floating) / 4) : 1;
    ctx.fillStyle = "rgba(8, 50, 95, 0.35)";
    ctx.fillRect(x, Math.round(p.y) + 2, 3, 1);
    const y = Math.round(p.y - p.z) + bob;
    ctx.fillStyle = "#e3a84e";
    ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = "#fbe3a1";
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
}

function updateKoi(dt, time) {
  for (const koi of fish) {
    let steerX = Math.sin(time * 0.32 + koi.phase) * 0.4;
    let steerY = Math.cos(time * 0.27 + koi.phase) * 0.4;
    let centerX = 0;
    let centerY = 0;
    let nearby = 0;
    let avoidX = 0;
    let avoidY = 0;

    for (const other of fish) {
      if (other === koi) continue;
      const dx = other.x - koi.x;
      const dy = other.y - koi.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 54) {
        centerX += dx;
        centerY += dy;
        nearby++;
      }
      if (distance < 22 && distance > 0) {
        avoidX -= dx / distance;
        avoidY -= dy / distance;
      }
    }

    if (nearby) {
      steerX += (centerX / nearby) * 0.002;
      steerY += (centerY / nearby) * 0.002;
    }
    steerX += avoidX * 0.06;
    steerY += avoidY * 0.06;

    const food = foodFor(koi, time);
    if (food) {
      steerX += ((food.x - koi.x) / (food.d || 1)) * 1.3;
      steerY += ((food.y - koi.y) / (food.d || 1)) * 1.3;
    }

    if (koi.target && (!food || koi.dash > 0)) {
      const dx = koi.target.x - koi.x;
      const dy = koi.target.y - koi.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 12) koi.target = null;
      else {
        steerX += (dx / distance) * 1.1;
        steerY += (dy / distance) * 1.1;
      }
    }

    if (koi.x < 28) steerX += 1;
    if (koi.x > W - 28) steerX -= 1;
    if (koi.y < 24) steerY += 1;
    if (koi.y > H - 24) steerY -= 1;

    const desired = Math.atan2(steerY, steerX);
    const delta = Math.atan2(
      Math.sin(desired - koi.angle),
      Math.cos(desired - koi.angle),
    );
    const turnRate =
      koi.dash > 0
        ? koi.turn * 4
        : food && food.d < 30
          ? koi.turn * 2.5
          : koi.turn;
    koi.angle += Math.max(-turnRate * dt, Math.min(turnRate * dt, delta));

    if (koi.dash > 0) koi.dash -= dt;
    const pace =
      koi.dash > 0
        ? 3
        : food
          ? food.pellet && food.d < 10 * koi.size
            ? 0.4
            : 1.7
          : koi.target
            ? 1.5
            : 1;
    koi.x += Math.cos(koi.angle) * koi.speed * pace * dt;
    koi.y += Math.sin(koi.angle) * koi.speed * pace * dt;
    followSpine(koi);
  }
}

function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.04);
  lastTime = now;
  const time = now / 1000;

  if (!paused) {
    updateFood(dt, time);
    updateKoi(dt, time);
  }
  drawWater(time);

  // Rain ripples appear beneath the fish and lilies.
  if (rain) {
    for (let i = 0; i < 12; i++) {
      const x = (i * 71 + time * 17) % W;
      const y = (i * 43 + time * 29) % H;
      ctx.strokeStyle = "#dff2ff80";
      ctx.fillStyle = "#dff2ff80";
      ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
      if (i % 3 === 0) {
        ctx.strokeRect(Math.floor(x - 2), Math.floor(y + 1), 5, 2);
      }
    }
  }

  
  const RIPPLE_LIFE = 2.8;
  for (const ripple of ripples) {
    ripple.age += dt * (ripple.speed || 1);
    for (let k = 0; k < 3; k++) {
      const p = ripple.age / RIPPLE_LIFE - k * 0.13;
      if (p <= 0 || p >= 1) continue;
      const rx = 4 + p * 78 * (ripple.scale || 1);
      const ry = rx * 0.6;
      if (k === 0) {
        ctx.fillStyle = `rgba(235, 248, 255, ${(1 - p) * 0.1})`;
        ctx.beginPath();
        ctx.ellipse(ripple.x, ripple.y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(225, 243, 255, ${(1 - p) * 0.75})`;
      ctx.lineWidth = k === 0 ? 2 : 1.3;
      ctx.beginPath();
      ctx.ellipse(ripple.x, ripple.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ripples = ripples.filter((ripple) => ripple.age < RIPPLE_LIFE);

  drawMinnows(time);
  for (const koi of fish) drawKoi(koi, time);
  drawFood(time);

  PADS.forEach(([x, y, r], i) => drawPad(x, y, r, time + i));

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

ui("#more").onclick = () => setFishCount(fish.length + 1);
ui("#less").onclick = () => setFishCount(fish.length - 1);

ui("#scatter").onclick = () => {
  for (const koi of fish) {
    koi.angle += Math.PI + (Math.random() - 0.5) * 1.2;
    koi.target = null;
  }
};

ui("#ambient").onclick = (event) => {
  paused = !paused;
  event.currentTarget.setAttribute("aria-pressed", String(paused));
};

ui("#rain").onclick = (event) => {
  rain = !rain;
  event.currentTarget.setAttribute("aria-pressed", String(rain));
};

ui("#weather").onchange = (event) => {
  weather = event.target.value;
};


ui("#sound").onclick = async (event) => {
  try {
    if (!audio) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      audio = new AudioContextClass();
      const buffer = audio.createBuffer(
        1,
        audio.sampleRate * 2,
        audio.sampleRate,
      );
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] = (Math.random() * 2 - 1) * 0.05;
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = audio.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 480;
      const gain = audio.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(audio.destination);
      source.start();
      audio.gain = gain;
    }
    await audio.resume();
    soundOn = !soundOn;
    audio.gain.gain.setTargetAtTime(soundOn ? 0.1 : 0, audio.currentTime, 0.5);
    event.currentTarget.setAttribute("aria-pressed", String(soundOn));
  } catch (error) {
    console.warn("Audio is unavailable in this browser.", error);
  }
};

ui("#feed").onclick = feedKoi;
