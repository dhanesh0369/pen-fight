// End-to-end browser test for pen variety + point-of-contact spin.
// Requires the dev server running (npm run dev) and a local Chrome install.
// Run: npm run test:e2e
// Env: BASE_URL (default http://localhost:5173), CHROME_PATH, SCREENSHOT_DIR
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const OUT = process.env.SCREENSHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'penfight-e2e-'));
const CHROME_PATH = process.env.CHROME_PATH || {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}[process.platform] || '/usr/bin/google-chrome';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name} ${detail}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new',
  args: ['--window-size=1400,900'],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

// ---------- helpers ----------
const scene = (fn, arg) => page.evaluate(async (fnSrc, arg) => {
  const m = await import('/src/game/Game.ts');
  const s = m.initGame({ mode: 'single' }).scene.getScene('MainScene');
  return new Function('s', 'arg', `return (${fnSrc})(s, arg)`)(s, arg);
}, fn.toString(), arg);

const toPage = async (gx, gy) => {
  const r = await page.evaluate(() => { const b = document.querySelector('canvas').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width }; });
  const k = r.w / 1400;
  return { x: r.l + gx * k, y: r.t + gy * k };
};

const penInfo = (p) => scene((s, p) => {
  const pen = p === 1 ? s.pen1 : s.pen2;
  const b = pen.body;
  return {
    type: s.penTypes[p], texture: pen.texture.key, mass: b.mass, frictionAir: b.frictionAir,
    restitution: b.restitution, w: b.bounds.max.x - b.bounds.min.x, h: b.bounds.max.y - b.bounds.min.y,
    x: pen.x, y: pen.y, rot: pen.rotation, label: (p === 1 ? s.penLabel1 : s.penLabel2).text,
  };
}, p);

// Reset to a clean single-player state; put pen2 far away so pen1 doesn't collide immediately.
const freshTurn = () => scene((s) => {
  s.resetGame();
  s.pen2.setPosition(1200, 820); // bottom-right corner, out of the shooting lanes
});

// Flick pen1: grab at local offset `grabX` along axis, drag by (ddx, ddy) from grab point.
async function flick(grabX, ddx, ddy, shotName) {
  const p = await penInfo(1);
  const gx = p.x + Math.cos(p.rot) * grabX, gy = p.y + Math.sin(p.rot) * grabX;
  const a = await toPage(gx, gy), b = await toPage(gx + ddx, gy + ddy);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + (b.x - a.x) * i / 10, a.y + (b.y - a.y) * i / 10);
  await sleep(100);
  const aim = await scene(s => ({ dragging: s.isDragging, grab: s.grabLocalX, text: s.aimText.text, visible: s.aimText.visible }));
  if (shotName) await page.screenshot({ path: `${OUT}/aim_${shotName}.png` });
  await page.mouse.up();
  // Sample state on the very next frames (before damping/collisions dominate)
  const after = await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    .then(() => scene(s => ({ av: s.pen1.body.angularVelocity, vx: s.pen1.body.velocity.x, vy: s.pen1.body.velocity.y, moving: s.isMoving })));
  return { aim, after };
}

// ---------- 1. Lobby ----------
await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
const cards = await page.$$eval('.pen-option', els => els.map(e => e.textContent.trim()));
check('lobby shows 3 pen options', cards.length === 3, JSON.stringify(cards));
check('ballpoint selected by default', (await page.$eval('.pen-option.selected', e => e.textContent)).includes('Ballpoint'));

const [gelCard] = await page.$$('xpath/.//button[contains(., "Heavy Metal Gel")]');
await gelCard.click();
await sleep(300);
check('gel card becomes selected', (await page.$eval('.pen-option.selected', e => e.textContent)).includes('Heavy Metal Gel'));
check('description updates', (await page.$eval('.pen-description', e => e.textContent)).includes('tank'));
check('choice persisted to localStorage', (await page.evaluate(() => localStorage.getItem('penfight.penType'))) === 'gel');
await page.screenshot({ path: `${OUT}/lobby.png` });

await page.reload({ waitUntil: 'networkidle0' });
check('choice survives reload', (await page.$eval('.pen-option.selected', e => e.textContent)).includes('Heavy Metal Gel'));

// ---------- 2. Game with heavy pen ----------
const [aiBtn] = await page.$$('xpath/.//button[contains(., "Play vs Computer")]');
await aiBtn.click();
await page.waitForSelector('canvas');
await sleep(1500);
await page.screenshot({ path: `${OUT}/game_start.png` });

const p1 = await penInfo(1), p2 = await penInfo(2);
check('player pen is gel', p1.type === 'gel' && p1.texture === 'pen_gel_1', JSON.stringify({ t: p1.type, tex: p1.texture }));
check('gel physics applied', Math.abs(p1.mass - 0.2) < 1e-6 && Math.abs(p1.frictionAir - 0.03) < 1e-6 && Math.abs(p1.restitution - 0.3) < 1e-6,
  `mass=${p1.mass} fa=${p1.frictionAir} rest=${p1.restitution}`);
check('gel body size 170x26', Math.round(p1.w) === 170 && Math.round(p1.h) === 26, `${p1.w}x${p1.h}`);
check('pen label shown', p1.label === 'Heavy Metal Gel', p1.label);
check('AI got a valid pen', ['ballpoint', 'marker', 'gel'].includes(p2.type) && p2.texture === `pen_${p2.type}_2` && p2.label.length > 0, p2.type);
check('pens start at spawn positions', Math.round(p1.x) === 390 && Math.round(p2.x) === 1010, `${p1.x}, ${p2.x}`);

// ---------- 3. Center flick: straight push ----------
await freshTurn();
let r = await flick(0, -250, 0, 'center');
check('center grab registers', Math.abs(r.aim.grab) < 1, `grab=${r.aim.grab}`);
check('aim label shows ~0% spin', /Power 100%/.test(r.aim.text) && /Spin • 0%/.test(r.aim.text), r.aim.text);
check('center flick: moves right', r.after.vx > 5 && Math.abs(r.after.vy) < 0.5, `v=(${r.after.vx.toFixed(2)}, ${r.after.vy.toFixed(2)})`);
check('center flick: no spin', Math.abs(r.after.av) < 0.005, `av=${r.after.av}`);
const centerSpeed = r.after.vx;

// ---------- 4. Tip flick, perpendicular: max spin ----------
await freshTurn();
r = await flick(85, 0, -250, 'tip'); // grab right tip, drag up => shoot down
check('tip grab registers near +85', r.aim.grab > 80, `grab=${r.aim.grab}`);
check('aim label shows clockwise ~100% spin', /Spin ⟳ (9\d|100)%/.test(r.aim.text), r.aim.text);
check('tip flick: clockwise spin (+)', r.after.av > 0.1, `av=${r.after.av.toFixed(3)} (expected ~0.18 minus damping)`);
const tipSpeed = Math.hypot(r.after.vx, r.after.vy);
check('tip flick: weaker push than center (energy went into spin)', tipSpeed < centerSpeed * 0.8, `tip=${tipSpeed.toFixed(2)} center=${centerSpeed.toFixed(2)}`);
const gelSpin = r.after.av;

// ---------- 5. Opposite end: counter-clockwise ----------
await freshTurn();
r = await flick(-85, 0, -250, 'tail');
check('other end: counter-clockwise spin (-)', r.after.av < -0.1, `av=${r.after.av.toFixed(3)}`);

// ---------- 6. Grabbing outside the pen is ignored ----------
await freshTurn();
r = await flick(0, 0, 0); // sanity: at center works
await freshTurn();
const pp = await penInfo(1);
const far = await toPage(pp.x, pp.y - 120);
await page.mouse.move(far.x, far.y); await page.mouse.down();
const draggingFar = await scene(s => s.isDragging);
await page.mouse.up();
check('click far off the pen does not grab', draggingFar === false);

// ---------- 7. AI turn completes with its aim indicator ----------
await freshTurn();
await scene(s => { s.pen2.setPosition(1020, 480); s.pen2.setAngle(180); });
await flick(0, -60, 0); // gentle shot so nobody falls off
let sawAI = false, aiShot = false;
for (let i = 0; i < 60; i++) {
  const st = await scene(s => ({ turn: s.currentTurn, thinking: s.isAIThinking, moving: s.isMoving, over: s.isGameOver }));
  if (st.turn === 2 && st.thinking) { if (!sawAI) await page.screenshot({ path: `${OUT}/ai_aim.png` }); sawAI = true; }
  if (sawAI && st.turn === 2 && st.moving) aiShot = true;
  if (aiShot && st.turn === 1 && !st.moving) break;
  if (st.over) break;
  await sleep(150);
}
check('AI takes its turn and shoots', sawAI && aiShot);

// ---------- 8. Light pen spins more than heavy ----------
await page.evaluate(() => localStorage.setItem('penfight.penType', 'ballpoint'));
await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
const [aiBtn2] = await page.$$('xpath/.//button[contains(., "Play vs Computer")]');
await aiBtn2.click();
await page.waitForSelector('canvas'); await sleep(1500);
const b1 = await penInfo(1);
check('ballpoint applied', b1.type === 'ballpoint' && Math.round(b1.w) === 150 && Math.abs(b1.mass - 0.07) < 1e-6, `${b1.w} ${b1.mass}`);
await freshTurn();
r = await flick(75, 0, -250);
check('ballpoint spins much more than gel (same flick)', r.after.av > gelSpin * 1.8, `ballpoint=${r.after.av.toFixed(3)} gel=${gelSpin.toFixed(3)}`);
await sleep(400);
await page.screenshot({ path: `${OUT}/ballpoint_spinning.png` });

// ---------- 9. Restart flow + no errors ----------
await scene(s => s.gameOver('test'));
await page.mouse.click(700, 450);
await sleep(200);
const afterRestart = await scene(s => ({ over: s.isGameOver, turn: s.currentTurn, type: s.penTypes[1] }));
check('restart keeps pen type', !afterRestart.over && afterRestart.turn === 1 && afterRestart.type === 'ballpoint', JSON.stringify(afterRestart));
check('no console/page errors', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter(x => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed (screenshots: ${OUT})`);
process.exit(failed.length ? 1 : 0);
