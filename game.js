/**
 * 积木跳 — 微信小游戏
 * 按住屏幕蓄力，松手跳向下一块积木。落在中心圈可以连击加分。
 *
 * 用微信开发者工具导入本目录，项目类型选「小游戏」。
 */
'use strict';

var BEST_KEY = 'jimu_jump_best';
var MAX_JUMP = 5.2;
var MIN_JUMP = 0.35;
var CHARGE_TIME = 1.08;
var PERFECT_RATIO = 0.32;
var LAND_PAD = 0.1;

var ISO_X = Math.cos(Math.PI / 6);
var ISO_Y = Math.sin(Math.PI / 6);

var THEMES = [
  { top: '#FFE08A', left: '#F0B43E', right: '#D49222', dust: '#FFD36A' },
  { top: '#9AD8FF', left: '#4EACE8', right: '#2E86C8', dust: '#B7E4FF' },
  { top: '#B6F3C9', left: '#5ED48C', right: '#34B06A', dust: '#D4FFE4' },
  { top: '#FFB7CE', left: '#F27AA0', right: '#D4557C', dust: '#FFD0E0' },
  { top: '#D4C6FF', left: '#A78AF0', right: '#7C62D4', dust: '#E6DEFF' },
  { top: '#FFC7A3', left: '#F09662', right: '#D47842', dust: '#FFE0CC' }
];

var canvas = wx.createCanvas();
var ctx = canvas.getContext('2d');

var dpr = 2;
var viewW = 375;
var viewH = 667;
var safeTop = 24;
var scale = 64;

var state = 'menu';
var time = 0;
var lastTs = 0;
var paused = false;
var score = 0;
var best = 0;
var combo = 0;
var power = 0;
var guideLeft = 0;
var overT = 0;
var newRecord = false;
var shake = 0;
var platformSeq = 0;
var lastDir = '';
var dirStreak = 0;

var platforms = [];
var current = null;
var cam = { x: 0, y: 0 };
var player = null;
var particles = [];
var floaters = [];
var audioCtx = null;
var audioFailed = false;
var sweetArmed = true;

var clouds = [
  { x: 0.12, y: 0.16, s: 1, v: 0.012 },
  { x: 0.62, y: 0.1, s: 0.72, v: 0.018 },
  { x: 0.38, y: 0.24, s: 0.5, v: 0.009 }
];

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function loadBest() {
  try {
    var v = Number(wx.getStorageSync(BEST_KEY));
    return isNaN(v) ? 0 : v;
  } catch (e) {
    return 0;
  }
}

function saveBest(n) {
  try {
    wx.setStorageSync(BEST_KEY, n);
  } catch (e) {}
}

function haptic(type) {
  try {
    if (wx.vibrateShort) wx.vibrateShort({ type: type || 'light' });
  } catch (e) {}
}

function ensureAudio() {
  if (audioCtx || audioFailed) return;
  try {
    if (wx.createWebAudioContext) audioCtx = wx.createWebAudioContext();
    else if (typeof AudioContext !== 'undefined') audioCtx = new AudioContext();
    else audioFailed = true;
  } catch (e) {
    audioFailed = true;
  }
  if (audioCtx && audioCtx.resume) {
    try { audioCtx.resume(); } catch (e2) {}
  }
}

function playTone(freq, duration, type, volume, delay) {
  if (!audioCtx) return;
  try {
    var t0 = audioCtx.currentTime + (delay || 0);
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(Math.max(0.001, volume), t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  } catch (e) {}
}

function playJumpSound() {
  playTone(520, 0.12, 'triangle', 0.06, 0);
  playTone(280, 0.16, 'sine', 0.04, 0.02);
}

function playLandSound(perfect) {
  if (perfect) {
    playTone(660, 0.08, 'sine', 0.07, 0);
    playTone(880, 0.12, 'sine', 0.06, 0.07);
    playTone(1175, 0.16, 'triangle', 0.05, 0.14);
  } else {
    playTone(440, 0.09, 'sine', 0.06, 0);
  }
}

function playFailSound() {
  playTone(220, 0.18, 'sawtooth', 0.04, 0);
  playTone(110, 0.28, 'triangle', 0.05, 0.08);
}

function playStartSound() {
  playTone(523, 0.08, 'sine', 0.05, 0);
  playTone(784, 0.12, 'sine', 0.05, 0.08);
}

function resize() {
  var info = wx.getSystemInfoSync();
  dpr = Math.min(info.pixelRatio || 1, 2);
  viewW = info.windowWidth;
  viewH = info.windowHeight;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  safeTop = Math.max(20, (info.safeArea && info.safeArea.top) || 20);
  scale = clamp(Math.min(viewW, viewH) * 0.158, 52, 92);
}

function project(x, y, z) {
  var dx = x - cam.x;
  var dy = y - cam.y;
  return {
    x: viewW * 0.5 + (dx - dy) * scale * ISO_X,
    y: viewH * 0.6 + (dx + dy) * scale * ISO_Y - z * scale
  };
}

function isoRadii(r) {
  return {
    rx: r * scale * ISO_X * Math.SQRT2,
    ry: r * scale * ISO_Y * Math.SQRT2
  };
}

function pickDir() {
  var dir = Math.random() < 0.5 ? 'x' : 'y';
  if (dir === lastDir) dirStreak += 1;
  else dirStreak = 1;
  if (dirStreak >= 3) {
    dir = lastDir === 'x' ? 'y' : 'x';
    dirStreak = 1;
  }
  lastDir = dir;
  return dir;
}

function createPlatform(from) {
  platformSeq += 1;
  var theme = THEMES[platformSeq % THEMES.length];
  if (!from) {
    return {
      id: platformSeq,
      x: 0,
      y: 0,
      radius: 0.96,
      height: 0.88,
      shape: 'box',
      theme: theme,
      appear: 1,
      next: null
    };
  }
  var diff = clamp(score / 26, 0, 1);
  var radius = lerp(0.74, 0.5, diff) + Math.random() * lerp(0.16, 0.08, diff);
  var edge = lerp(0.9, 1.75, diff) + Math.random() * lerp(0.5, 1.05, diff);
  var dist = Math.min(edge + from.radius + radius, MAX_JUMP * 0.9);
  var dir = pickDir();
  var shape = Math.random() < 0.42 ? 'cylinder' : 'box';
  var plat = {
    id: platformSeq,
    x: from.x + (dir === 'x' ? dist : 0),
    y: from.y + (dir === 'y' ? dist : 0),
    radius: radius,
    height: rand(0.78, 1.02),
    shape: shape,
    theme: theme,
    appear: 0,
    next: null
  };
  from.next = plat;
  return plat;
}

function spawnAfter(from) {
  var plat = createPlatform(from);
  platforms.push(plat);
  return plat;
}

function makePlayer(plat) {
  return {
    x: plat.x,
    y: plat.y,
    z: plat.height,
    fromX: plat.x,
    fromY: plat.y,
    fromZ: plat.height,
    toX: plat.x,
    toY: plat.y,
    toZ: plat.height,
    jumpT: 0,
    jumpDur: 0.5,
    jumpH: 1,
    fallV: 0,
    mode: 'idle',
    squash: 1,
    squashTarget: 1,
    mood: 'normal',
    moodT: 0,
    rot: 0
  };
}

function initWorld() {
  score = 0;
  combo = 0;
  power = 0;
  overT = 0;
  newRecord = false;
  shake = 0;
  platformSeq = 0;
  lastDir = '';
  dirStreak = 0;
  particles = [];
  floaters = [];
  platforms = [];
  var first = createPlatform(null);
  platforms.push(first);
  current = first;
  spawnAfter(first);
  player = makePlayer(first);
  var n = first.next;
  cam.x = (first.x + n.x) / 2;
  cam.y = (first.y + n.y) / 2;
}

function focusCamera(dt, instant) {
  var n = current.next || current;
  var tx = (player.x + n.x) * 0.5;
  var ty = (player.y + n.y) * 0.5;
  if (instant) {
    cam.x = tx;
    cam.y = ty;
    return;
  }
  var k = Math.min(1, dt * 3.2);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
}

function powerToDist(p) {
  return MIN_JUMP + p * (MAX_JUMP - MIN_JUMP);
}

function distToPower(dist) {
  return clamp((dist - MIN_JUMP) / (MAX_JUMP - MIN_JUMP), 0, 1);
}

function contains(plat, x, y, pad) {
  var dx = x - plat.x;
  var dy = y - plat.y;
  if (plat.shape === 'cylinder') return Math.hypot(dx, dy) <= plat.radius + pad;
  return Math.abs(dx) <= plat.radius + pad && Math.abs(dy) <= plat.radius + pad;
}

function findLanding(x, y) {
  var best = null;
  var bestD = 1e9;
  var i;
  for (i = 0; i < platforms.length; i++) {
    var p = platforms[i];
    if (!contains(p, x, y, LAND_PAD)) continue;
    var d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

function isPerfect(plat, x, y) {
  return Math.hypot(plat.x - x, plat.y - y) <= plat.radius * PERFECT_RATIO;
}

function addShake(n) {
  if (n > shake) shake = n;
}

function burst(x, y, color, count, speed) {
  var i;
  for (i = 0; i < count; i++) {
    var a = Math.random() * Math.PI * 2;
    var s = speed * (0.45 + Math.random() * 0.7);
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - speed * 0.35,
      g: 520,
      life: 0.35 + Math.random() * 0.3,
      max: 0.65,
      color: color,
      size: 3 + Math.random() * 4,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 10,
      confetti: false
    });
  }
}

function confetti() {
  var i;
  for (i = 0; i < 42; i++) {
    particles.push({
      x: rand(viewW * 0.15, viewW * 0.85),
      y: rand(-40, viewH * 0.2),
      vx: rand(-30, 30),
      vy: rand(40, 160),
      g: 80,
      life: 1.4 + Math.random() * 0.8,
      max: 2.2,
      color: THEMES[i % THEMES.length].top,
      size: 6 + Math.random() * 5,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 8,
      confetti: true
    });
  }
}

function addFloater(text, color) {
  var p = project(player.x, player.y, player.z + 0.35);
  floaters.push({
    x: p.x,
    y: p.y,
    text: text,
    color: color,
    life: 0.85,
    max: 0.85,
    vy: -42
  });
}

function prunePlatforms() {
  while (platforms.length > 8 && platforms[0] !== current && platforms[1] !== current) {
    platforms.shift();
  }
}

function releaseJump() {
  if (!current.next) spawnAfter(current);
  if (power < 0.05) {
    player.mode = 'idle';
    player.squashTarget = 1;
    return;
  }
  var n = current.next;
  var dx = n.x - player.x;
  var dy = n.y - player.y;
  var len = Math.hypot(dx, dy) || 1;
  var dist = powerToDist(power);
  player.mode = 'jump';
  player.fromX = player.x;
  player.fromY = player.y;
  player.fromZ = player.z;
  player.toX = player.x + (dx / len) * dist;
  player.toY = player.y + (dy / len) * dist;
  player.toZ = n.height;
  player.jumpT = 0;
  player.jumpDur = 0.36 + dist * 0.055;
  player.jumpH = 0.62 + dist * 0.34;
  player.squashTarget = 1.2;
  player.rot = 0;
  haptic('light');
  playJumpSound();
  var feet = project(player.x, player.y, 0);
  burst(feet.x, feet.y, current.theme.dust, 8, 90);
}

function resolveLanding() {
  player.z = player.toZ;
  var hit = findLanding(player.x, player.y);
  if (!hit) {
    player.mode = 'fall';
    player.fallV = 0.4;
    player.mood = 'fall';
    haptic('heavy');
    playFailSound();
    addShake(8);
    return;
  }
  player.mode = 'idle';
  player.x = clamp(player.x, hit.x - hit.radius, hit.x + hit.radius);
  player.y = clamp(player.y, hit.y - hit.radius, hit.y + hit.radius);
  if (hit.shape === 'cylinder') {
    var dx = player.x - hit.x;
    var dy = player.y - hit.y;
    var mag = Math.hypot(dx, dy);
    var limit = hit.radius;
    if (mag > limit && mag > 0) {
      player.x = hit.x + (dx / mag) * limit;
      player.y = hit.y + (dy / mag) * limit;
    }
  }
  player.z = hit.height;
  player.squash = 0.7;
  player.squashTarget = 1;
  var feet = project(player.x, player.y, 0);
  if (hit === current) {
    combo = 0;
    playLandSound(false);
    burst(feet.x, feet.y, hit.theme.dust, 6, 70);
    return;
  }
  current = hit;
  if (!current.next) spawnAfter(current);
  var perfect = isPerfect(hit, player.x, player.y);
  if (perfect) {
    combo += 1;
    var add = combo + 1;
    score += add;
    player.mood = 'happy';
    player.moodT = 0.55;
    addFloater('完美 +' + add, '#FF7A45');
    burst(feet.x, feet.y - 20, hit.theme.top, 16, 160);
    addShake(7);
    haptic('medium');
    playLandSound(true);
  } else {
    combo = 0;
    score += 1;
    player.mood = 'normal';
    addFloater('+1', '#314056');
    burst(feet.x, feet.y, hit.theme.dust, 8, 80);
    addShake(3);
    playLandSound(false);
  }
  if (guideLeft > 0) guideLeft -= 1;
  prunePlatforms();
}

function enterGameOver() {
  if (state === 'over') return;
  state = 'over';
  overT = 0;
  if (score > best) {
    best = score;
    newRecord = true;
    saveBest(best);
    confetti();
    playTone(523, 0.1, 'sine', 0.06, 0);
    playTone(659, 0.1, 'sine', 0.06, 0.1);
    playTone(784, 0.1, 'sine', 0.06, 0.2);
    playTone(1046, 0.22, 'triangle', 0.07, 0.3);
  }
}

function startPlay() {
  initWorld();
  guideLeft = best < 8 ? 5 : 0;
  state = 'play';
  playStartSound();
}

function onDown() {
  ensureAudio();
  if (state !== 'play') return;
  if (player.mode !== 'idle') return;
  if (!current.next) spawnAfter(current);
  player.mode = 'charge';
  power = 0;
  sweetArmed = false;
  player.mood = 'charge';
}

function onUp() {
  ensureAudio();
  if (state === 'menu') {
    startPlay();
    return;
  }
  if (state === 'over') {
    if (overT > 0.45) startPlay();
    return;
  }
  if (state === 'play' && player.mode === 'charge') releaseJump();
}

function updatePlayer(dt) {
  if (state === 'menu') {
    player.z = current.height + (Math.sin(time * 2.5) + 1) * 0.1;
    player.squashTarget = 1 - Math.max(0, Math.sin(time * 2.5)) * 0.05;
    player.mode = 'idle';
    player.rot = 0;
    return;
  }
  if (player.mode === 'charge') {
    power = Math.min(1, power + dt / CHARGE_TIME);
    player.squashTarget = power >= 1 ? 0.58 + Math.sin(time * 26) * 0.025 : 1 - power * 0.4;
    player.z = current.height;
    var n = current.next;
    if (n && guideLeft > 0) {
      var sweet = distToPower(Math.hypot(n.x - player.x, n.y - player.y));
      var near = Math.abs(power - sweet) < 0.045;
      if (near && !sweetArmed) {
        sweetArmed = true;
        playTone(920, 0.05, 'sine', 0.04, 0);
      }
      if (!near && Math.abs(power - sweet) > 0.08) sweetArmed = false;
    }
  } else if (player.mode === 'jump') {
    player.jumpT += dt / player.jumpDur;
    var e = player.jumpT >= 1 ? 1 : player.jumpT;
    player.x = lerp(player.fromX, player.toX, e);
    player.y = lerp(player.fromY, player.toY, e);
    var arc = player.jumpH * 4 * e * (1 - e);
    player.z = lerp(player.fromZ, player.toZ, e) + arc;
    player.squashTarget = 1.12;
    if (player.jumpT >= 1) resolveLanding();
  } else if (player.mode === 'fall') {
    player.fallV -= 16 * dt;
    player.z += player.fallV * dt;
    player.rot += dt * 6.5;
    player.squashTarget = 1;
    if (player.z < -2.6) enterGameOver();
  } else {
    player.z = current.height;
    player.squashTarget = 1;
    player.rot = 0;
  }
  player.squash += (player.squashTarget - player.squash) * Math.min(1, dt * 14);
  if (player.moodT > 0) player.moodT -= dt;
}

function updateFx(dt) {
  var i;
  for (i = particles.length - 1; i >= 0; i--) {
    var p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
  }
  for (i = floaters.length - 1; i >= 0; i--) {
    var f = floaters[i];
    f.life -= dt;
    if (f.life <= 0) {
      floaters.splice(i, 1);
      continue;
    }
    f.y += f.vy * dt;
  }
  var c;
  for (c = 0; c < clouds.length; c++) {
    clouds[c].x += clouds[c].v * dt;
    if (clouds[c].x > 1.3) clouds[c].x = -0.3;
  }
  if (shake > 0) shake = Math.max(0, shake - dt * 28);
}

function update(dt) {
  time += dt;
  var i;
  for (i = 0; i < platforms.length; i++) {
    if (platforms[i].appear < 1) platforms[i].appear = Math.min(1, platforms[i].appear + dt * 2.4);
  }
  updatePlayer(dt);
  if (state === 'over') overT = Math.min(1, overT + dt * 2.1);
  if (state !== 'menu') focusCamera(dt, false);
  updateFx(dt);
}

function roundRect(x, y, w, h, r) {
  var rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fillPoly(corners, color) {
  ctx.beginPath();
  var i;
  for (i = 0; i < corners.length; i++) {
    var p = project(corners[i].x, corners[i].y, corners[i].z);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawBackground() {
  var hue = 206 + Math.sin(time * 0.12) * 6 + score * 0.35;
  var g = ctx.createLinearGradient(0, 0, 0, viewH);
  g.addColorStop(0, 'hsl(' + hue + ', 72%, 90%)');
  g.addColorStop(1, 'hsl(' + (hue + 16) + ', 58%, 78%)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, viewW, viewH);

  var sun = ctx.createRadialGradient(viewW * 0.78, viewH * 0.16, 8, viewW * 0.78, viewH * 0.16, viewW * 0.55);
  sun.addColorStop(0, 'rgba(255,255,255,0.9)');
  sun.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, viewW, viewH);

  var i;
  for (i = 0; i < clouds.length; i++) {
    drawCloud(clouds[i]);
  }
}

function drawCloud(c) {
  var x = c.x * viewW;
  var y = c.y * viewH;
  var s = c.s;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.beginPath();
  ctx.ellipse(x, y, 36 * s, 16 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 28 * s, y + 4 * s, 26 * s, 14 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 26 * s, y + 6 * s, 22 * s, 12 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlatformShadow(plat, visR) {
  var rad = isoRadii(visR * (plat.shape === 'cylinder' ? 0.92 : 1));
  var c = project(plat.x, plat.y, 0);
  ctx.fillStyle = 'rgba(48, 72, 110, 0.16)';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y + 6, rad.rx, rad.ry * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPerfectMark(plat, visR) {
  var emphasized = plat === (current && current.next);
  var rad = isoRadii(visR * PERFECT_RATIO);
  var c = project(plat.x, plat.y, plat.height * easeAppear(plat) + 0.02);
  var pulse = emphasized ? 1 + Math.sin(time * 4.2) * 0.06 : 1;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.scale(pulse, pulse);
  ctx.strokeStyle = emphasized ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)';
  ctx.lineWidth = emphasized ? 2.5 : 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(4, rad.rx), Math.max(3, rad.ry), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = emphasized ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)';
  ctx.fill();
  ctx.restore();
}

function easeAppear(plat) {
  var t = plat.appear;
  return 1 - Math.pow(1 - t, 3);
}

function drawBox(plat) {
  var k = 0.25 + 0.75 * easeAppear(plat);
  var hw = plat.radius * k;
  var hd = plat.radius * k;
  var h = plat.height * k;
  var x = plat.x;
  var y = plat.y;
  fillPoly([
    { x: x + hw, y: y - hd, z: h },
    { x: x + hw, y: y + hd, z: h },
    { x: x + hw, y: y + hd, z: 0 },
    { x: x + hw, y: y - hd, z: 0 }
  ], plat.theme.right);
  fillPoly([
    { x: x - hw, y: y + hd, z: h },
    { x: x + hw, y: y + hd, z: h },
    { x: x + hw, y: y + hd, z: 0 },
    { x: x - hw, y: y + hd, z: 0 }
  ], plat.theme.left);
  fillPoly([
    { x: x - hw, y: y - hd, z: h },
    { x: x + hw, y: y - hd, z: h },
    { x: x + hw, y: y + hd, z: h },
    { x: x - hw, y: y + hd, z: h }
  ], plat.theme.top);
  fillPoly([
    { x: x - hw * 0.72, y: y - hd * 0.72, z: h + 0.01 },
    { x: x + hw * 0.55, y: y - hd * 0.72, z: h + 0.01 },
    { x: x + hw * 0.2, y: y - hd * 0.15, z: h + 0.01 },
    { x: x - hw * 0.35, y: y - hd * 0.15, z: h + 0.01 }
  ], 'rgba(255,255,255,0.35)');
  drawPerfectMark(plat, plat.radius * k);
}

function drawCylinder(plat) {
  var k = 0.25 + 0.75 * easeAppear(plat);
  var visR = plat.radius * k;
  var h = plat.height * k;
  var top = project(plat.x, plat.y, h);
  var bot = project(plat.x, plat.y, 0);
  var rad = isoRadii(visR);
  var bodyH = bot.y - top.y;
  ctx.fillStyle = plat.theme.left;
  ctx.beginPath();
  ctx.ellipse(bot.x, bot.y, rad.rx, rad.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  if (bodyH > 0) ctx.fillRect(top.x - rad.rx, top.y, rad.rx * 2, bodyH);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(top.x, top.y, rad.rx, Math.max(0, bodyH));
  ctx.fillStyle = plat.theme.top;
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, rad.rx, rad.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.beginPath();
  ctx.ellipse(top.x - rad.rx * 0.18, top.y - rad.ry * 0.22, rad.rx * 0.42, rad.ry * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  drawPerfectMark(plat, visR);
}

function drawPlatformBody(plat) {
  if (plat.shape === 'cylinder') drawCylinder(plat);
  else drawBox(plat);
}

function expressionOf() {
  if (player.mode === 'fall' || state === 'over') return 'fall';
  if (player.mode === 'jump') return 'jump';
  if (player.mode === 'charge') return 'charge';
  if (player.mood === 'happy' && player.moodT > 0) return 'happy';
  return 'normal';
}

function drawEyes(expr, headR, headY) {
  var dx = headR * 0.34;
  var ey = headY - headR * 0.02;
  var r = headR * 0.13;
  ctx.lineWidth = Math.max(2, headR * 0.09);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#2C3544';
  ctx.fillStyle = '#2C3544';
  if (expr === 'charge') {
    ctx.beginPath();
    ctx.moveTo(-dx - r, ey - r * 0.2);
    ctx.lineTo(-dx + r, ey + r * 0.55);
    ctx.moveTo(dx - r, ey + r * 0.55);
    ctx.lineTo(dx + r, ey - r * 0.2);
    ctx.stroke();
    return;
  }
  if (expr === 'happy') {
    ctx.beginPath();
    ctx.arc(-dx, ey + r * 0.2, r * 1.15, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(dx, ey + r * 0.2, r * 1.15, Math.PI, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (expr === 'fall') {
    ctx.beginPath();
    ctx.moveTo(-dx - r, ey - r);
    ctx.lineTo(-dx + r, ey + r);
    ctx.moveTo(-dx + r, ey - r);
    ctx.lineTo(-dx - r, ey + r);
    ctx.moveTo(dx - r, ey - r);
    ctx.lineTo(dx + r, ey + r);
    ctx.moveTo(dx + r, ey - r);
    ctx.lineTo(dx - r, ey + r);
    ctx.stroke();
    return;
  }
  var blink = expr === 'normal' && (time % 3.4) < 0.12;
  if (blink) {
    ctx.beginPath();
    ctx.moveTo(-dx - r, ey);
    ctx.lineTo(-dx + r, ey);
    ctx.moveTo(dx - r, ey);
    ctx.lineTo(dx + r, ey);
    ctx.stroke();
  } else {
    var er = expr === 'jump' ? r * 1.35 : r;
    ctx.beginPath();
    ctx.arc(-dx, ey, er, 0, Math.PI * 2);
    ctx.arc(dx, ey, er, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(-dx + er * 0.35, ey - er * 0.35, er * 0.35, 0, Math.PI * 2);
    ctx.arc(dx + er * 0.35, ey - er * 0.35, er * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  if (expr !== 'fall') {
    ctx.strokeStyle = '#2C3544';
    ctx.lineWidth = Math.max(1.5, headR * 0.07);
    ctx.beginPath();
    ctx.arc(0, headY + headR * 0.28, headR * 0.22, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
}

function drawHero() {
  var foot = project(player.x, player.y, player.z);
  var S = clamp(scale * 0.56, 42, 70);
  var lift = Math.max(0, player.z);
  var shadowK = clamp(1.2 - lift * 0.16, 0.38, 1);
  var ground = project(player.x, player.y, 0);
  ctx.fillStyle = 'rgba(48, 72, 110, ' + (0.2 * shadowK) + ')';
  ctx.beginPath();
  ctx.ellipse(ground.x, ground.y + 4, S * 0.42 * shadowK, S * 0.16 * shadowK, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(foot.x, foot.y);
  ctx.translate(0, -S * 0.42);
  ctx.rotate(player.rot);
  ctx.translate(0, S * 0.42);
  var sy = clamp(player.squash, 0.45, 1.35);
  var sx = 1 + (1 - sy) * 0.55;
  ctx.scale(sx, sy);

  if (combo >= 3 && state === 'play' && player.mode !== 'fall') {
    var glow = ctx.createRadialGradient(0, -S * 0.7, 4, 0, -S * 0.7, S);
    glow.addColorStop(0, 'rgba(255, 196, 92, 0.0)');
    glow.addColorStop(0.4, 'rgba(255, 170, 70, 0.35)');
    glow.addColorStop(1, 'rgba(255, 170, 70, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -S * 0.7, S, 0, Math.PI * 2);
    ctx.fill();
  }

  var bodyW = S * 0.58;
  var bodyH = S * 0.62;
  ctx.fillStyle = '#3E4A5E';
  roundRect(-bodyW * 0.42, -S * 0.12, bodyW * 0.28, S * 0.16, 4);
  ctx.fill();
  roundRect(bodyW * 0.14, -S * 0.12, bodyW * 0.28, S * 0.16, 4);
  ctx.fill();

  ctx.fillStyle = '#FFFEFB';
  roundRect(-bodyW / 2, -bodyH, bodyW, bodyH * 0.82, bodyW * 0.28);
  ctx.fill();
  ctx.fillStyle = '#FF8A5B';
  roundRect(-bodyW / 2, -bodyH * 0.42, bodyW, bodyH * 0.22, 4);
  ctx.fill();

  var headR = S * 0.32;
  var headY = -bodyH - headR * 0.42;
  ctx.fillStyle = '#FFFEFB';
  ctx.beginPath();
  ctx.arc(0, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 138, 160, 0.9)';
  ctx.beginPath();
  ctx.ellipse(-headR * 0.5, headY + headR * 0.22, headR * 0.16, headR * 0.1, 0, 0, Math.PI * 2);
  ctx.ellipse(headR * 0.5, headY + headR * 0.22, headR * 0.16, headR * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  drawEyes(expressionOf(), headR, headY);

  ctx.fillStyle = '#FF8A5B';
  var hat = headR * 0.46;
  roundRect(-hat / 2, headY - headR - hat * 0.72, hat, hat * 0.72, 3);
  ctx.fill();
  ctx.fillStyle = '#FFD0B8';
  roundRect(-hat / 2, headY - headR - hat * 0.72, hat, hat * 0.22, 2);
  ctx.fill();

  ctx.restore();
  return foot;
}

function drawChargeMeter(foot) {
  if (state !== 'play' || player.mode !== 'charge') return;
  var barW = 16;
  var barH = 118;
  var bx = foot.x + 46;
  if (bx + barW > viewW - 16) bx = foot.x - 62;
  var by = foot.y - 150;
  if (by < safeTop + 70) by = safeTop + 70;

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  roundRect(bx - 6, by - 8, barW + 12, barH + 16, 12);
  ctx.fill();

  var n = current.next;
  var sweet = 0.5;
  if (n) sweet = distToPower(Math.hypot(n.x - player.x, n.y - player.y));
  if (guideLeft > 0) {
    var band = 0.05;
    var y1 = by + barH * (1 - clamp(sweet + band, 0, 1));
    var y2 = by + barH * (1 - clamp(sweet - band, 0, 1));
    ctx.fillStyle = 'rgba(255, 196, 70, 0.85)';
    roundRect(bx, y1, barW, Math.max(4, y2 - y1), 6);
    ctx.fill();
  }

  var fillH = barH * power;
  var near = guideLeft > 0 && Math.abs(power - sweet) < 0.05;
  ctx.fillStyle = near ? '#FFB703' : '#5B8CFF';
  roundRect(bx, by + barH - fillH, barW, Math.max(4, fillH), 6);
  ctx.fill();

  ctx.strokeStyle = 'rgba(36, 48, 68, 0.35)';
  ctx.lineWidth = 2;
  roundRect(bx, by, barW, barH, 6);
  ctx.stroke();
}

function drawWorld() {
  var list = [];
  var i;
  for (i = 0; i < platforms.length; i++) {
    list.push({ depth: platforms[i].x + platforms[i].y, order: 0, plat: platforms[i], hero: false });
  }
  list.push({ depth: player.x + player.y, order: 1, plat: null, hero: true });
  list.sort(function (a, b) {
    return a.depth - b.depth || a.order - b.order;
  });
  var foot = null;
  for (i = 0; i < list.length; i++) {
    if (list[i].hero) {
      foot = drawHero();
    } else {
      var k = 0.25 + 0.75 * easeAppear(list[i].plat);
      drawPlatformShadow(list[i].plat, list[i].plat.radius * k);
      drawPlatformBody(list[i].plat);
    }
  }
  return foot || project(player.x, player.y, player.z);
}

function drawParticles() {
  var i;
  for (i = 0; i < particles.length; i++) {
    var p = particles[i];
    var alpha = clamp(p.life / p.max, 0, 1);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    if (p.confetti) {
      roundRect(-p.size / 2, -p.size / 4, p.size, p.size * 0.55, 1.5);
      ctx.fill();
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawFloaters() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  var i;
  for (i = 0; i < floaters.length; i++) {
    var f = floaters[i];
    ctx.globalAlpha = clamp(f.life / f.max, 0, 1);
    ctx.font = '700 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(f.text, f.x, f.y + 2);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function drawScoreHud() {
  var y = safeTop + 36;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 ' + Math.round(viewW * 0.12) + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(String(score), viewW / 2, y + 3);
  ctx.fillStyle = '#243044';
  ctx.fillText(String(score), viewW / 2, y);
  if (combo > 1 && state === 'play') {
    ctx.font = '700 16px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#FF7A45';
    ctx.fillText('连击 x' + combo, viewW / 2, y + Math.round(viewW * 0.07) + 8);
  }
}

function drawMenu() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  var titleY = safeTop + viewH * 0.16;
  ctx.font = '800 ' + Math.round(viewW * 0.15) + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText('积木跳', viewW / 2, titleY + 3);
  ctx.fillStyle = '#243044';
  ctx.fillText('积木跳', viewW / 2, titleY);

  ctx.font = '500 ' + Math.round(viewW * 0.04) + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#4C5D78';
  ctx.fillText('按住蓄力  ·  松手起跳', viewW / 2, titleY + viewW * 0.1);

  ctx.font = '600 15px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#5C6D88';
  ctx.fillText('最高分  ' + best, viewW / 2, viewH * 0.78);

  var alpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * 3));
  ctx.globalAlpha = alpha;
  ctx.font = '700 20px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#243044';
  ctx.fillText('轻触开始', viewW / 2, viewH * 0.84);
  ctx.globalAlpha = 1;

  ctx.font = '500 13px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#6A7C96';
  ctx.fillText('落在白圈中心可连击加分', viewW / 2, viewH * 0.9);
}

function drawGuide() {
  if (state !== 'play' || guideLeft <= 0) return;
  if (player.mode === 'fall') return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 14px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = 'rgba(36, 48, 68, 0.8)';
  ctx.fillText('按住蓄力，能量进入金色区域后松手', viewW / 2, viewH - 36);
}

function drawGameOver() {
  if (state !== 'over') return;
  var ease = 1 - Math.pow(1 - overT, 3);
  ctx.fillStyle = 'rgba(20, 28, 42, ' + (0.42 * ease) + ')';
  ctx.fillRect(0, 0, viewW, viewH);

  var cardW = Math.min(320, viewW * 0.78);
  var cardH = newRecord ? 300 : 268;
  var x = (viewW - cardW) / 2;
  var y = (viewH - cardH) / 2 + (1 - ease) * 36;

  ctx.globalAlpha = ease;
  ctx.fillStyle = 'rgba(36, 48, 68, 0.12)';
  roundRect(x, y + 8, cardW, cardH, 24);
  ctx.fill();
  ctx.fillStyle = '#FFFEFB';
  roundRect(x, y, cardW, cardH, 24);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 16px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#7B8BA3';
  ctx.fillText('游戏结束', viewW / 2, y + 36);

  var numY = y + 108;
  if (newRecord) {
    ctx.fillStyle = '#FF8A5B';
    roundRect(viewW / 2 - 42, y + 52, 84, 26, 13);
    ctx.fill();
    ctx.font = '700 13px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('新纪录', viewW / 2, y + 65);
    numY = y + 128;
  }

  ctx.font = '800 64px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#243044';
  ctx.fillText(String(score), viewW / 2, numY);

  ctx.font = '600 15px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#6A7C96';
  ctx.fillText('最高分  ' + best, viewW / 2, numY + 52);

  var btnW = cardW - 48;
  var btnH = 48;
  var btnX = x + 24;
  var btnY = y + cardH - 72;
  ctx.fillStyle = '#FF8A5B';
  roundRect(btnX, btnY, btnW, btnH, 16);
  ctx.fill();
  ctx.font = '700 18px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('再来一局', viewW / 2, btnY + btnH / 2);
  ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBackground();
  ctx.save();
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }
  var foot = drawWorld();
  ctx.restore();
  drawParticles();
  drawFloaters();
  drawChargeMeter(foot);
  if (state === 'menu') drawMenu();
  else drawScoreHud();
  drawGuide();
  drawGameOver();
}

function frame(ts) {
  if (!lastTs) lastTs = ts;
  var dt = (ts - lastTs) / 1000;
  lastTs = ts;
  if (dt > 0.05) dt = 0.05;
  if (dt < 0) dt = 0;
  if (!paused) update(dt);
  render();
  var raf = canvas.requestAnimationFrame ? canvas.requestAnimationFrame.bind(canvas) : requestAnimationFrame;
  raf(frame);
}

function pointOf(touch) {
  var x = touch.clientX != null ? touch.clientX : touch.x;
  var y = touch.clientY != null ? touch.clientY : touch.y;
  return { x: x, y: y };
}

function boot() {
  resize();
  best = loadBest();
  initWorld();
  state = 'menu';
  focusCamera(0, true);

  wx.onTouchStart(function (e) {
    var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;
    onDown(pointOf(t));
  });
  wx.onTouchEnd(function () {
    onUp();
  });
  wx.onTouchCancel(function () {
    if (state === 'play' && player.mode === 'charge') {
      player.mode = 'idle';
      player.squashTarget = 1;
    }
  });
  if (wx.onHide) wx.onHide(function () { paused = true; });
  if (wx.onShow) {
    wx.onShow(function () {
      paused = false;
      lastTs = 0;
    });
  }
  if (wx.onWindowResize) wx.onWindowResize(function () { resize(); });

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('keydown', function (e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (e.repeat) return;
      onDown();
    });
    window.addEventListener('keyup', function (e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      onUp();
    });
  }

  var raf = canvas.requestAnimationFrame ? canvas.requestAnimationFrame.bind(canvas) : requestAnimationFrame;
  raf(frame);
}

boot();
