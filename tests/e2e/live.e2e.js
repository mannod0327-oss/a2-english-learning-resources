// Browser test of the live quiz: starts the real live.py, then plays a whole game with one
// desktop host page and four phone-sized player pages (teams, a dropped connection, a reload, the
// CSV, the "My mistakes" notebook). Not run by CI: it needs Node and Playwright.
//
//   npm install playwright && npx playwright install chromium     (once, anywhere)
//   node tests/e2e/live.e2e.js
//
// Environment: CHROMIUM_PATH (use this browser instead of Playwright's own), PYTHON (interpreter),
// SHOTS_DIR (also save screenshots of every screen there).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* maybe installed globally */ }
  return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}
const { chromium, devices } = loadPlaywright();

const REPO = path.resolve(__dirname, '..', '..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-live-e2e-'));
const RESULTS = path.join(WORK, 'results');
const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 8123 + Math.floor(Math.random() * 500), BASE = `http://127.0.0.1:${PORT}`;
const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
const shot = (page, name, opts) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name + '.png'), ...opts }) : null);

const net = require('net');
const PROXY = PORT + 1000, PBASE = `http://127.0.0.1:${PROXY}`;
const proxy = { sockets: new Set(), blocked: false };
proxy.server = net.createServer(client => {
  if (proxy.blocked) { client.destroy(); return; }
  const up = net.connect(PORT, '127.0.0.1');
  proxy.sockets.add(client); proxy.sockets.add(up);
  client.pipe(up); up.pipe(client);
  const done = () => { proxy.sockets.delete(client); proxy.sockets.delete(up); client.destroy(); up.destroy(); };
  client.on('error', done); up.on('error', done); client.on('close', done); up.on('close', done);
});
proxy.drop = () => { for (const s of proxy.sockets) s.destroy(); proxy.sockets.clear(); };
proxy.server.listen(PROXY, '127.0.0.1');

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + JSON.stringify(detail))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

// correct answers by question text, from the site's own notebook data
const html = fs.readFileSync(path.join(REPO, 'html', 'mistakes.html'), 'utf8');
const start = html.indexOf('const BANK=') + 'const BANK='.length;
const BANK = JSON.parse(html.slice(start, html.indexOf(';</script>', start)));
const CORRECT = new Map(Object.values(BANK).map(v => [v.q.split('___').join(' ').replace(/\s+/g, ' ').trim(), v.a[0]]));

async function answer(page, right) {
  await page.waitForSelector('.qtext');
  const text = (await page.locator('.qtext').innerText()).replace(/\s+/g, ' ').trim();
  const correct = CORRECT.get(text);
  if (!correct) throw new Error('unknown question: ' + text);
  const buttons = page.locator('button.opt');
  const n = await buttons.count();
  let idx = -1;
  for (let i = 0; i < n; i++) if ((await buttons.nth(i).locator('span').nth(1).innerText()).trim() === correct) idx = i;
  if (idx < 0) throw new Error('right option not found for: ' + text);
  await buttons.nth(right ? idx : (idx + 1) % n).click();
}

(async () => {
  const server = spawn(PYTHON, [...(PYTHON === 'py' ? ['-3'] : []), 'live.py', '--no-browser', '--port', String(PORT), '--bind', '127.0.0.1', '--results', RESULTS],
    { cwd: REPO, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  let log = '';
  server.stdout.on('data', d => (log += d));
  server.stderr.on('data', d => (log += d));
  for (let i = 0; i < 50; i++) { try { const r = await fetch(BASE + '/api/info'); if (r.ok) break; } catch (e) { await sleep(100); } }

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const watch = (page, who) => {
    page.on('pageerror', e => errors.push(who + ' pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(who + ' console: ' + m.text()); });
  };
  try {
    // ---------- host: setup ----------
    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
    const host = await hostCtx.newPage();
    watch(host, 'host');
    await host.goto(BASE + '/live/host.html');
    await host.waitForSelector('.units .unit');
    check('setup lists 42 units', (await host.locator('.units .unit').count()) === 42);
    check('create disabled with no unit', await host.locator('button.go').isDisabled());
    await shot(host, 'host-setup', { fullPage: true });
    await host.locator('.unit input[value="1"]').check();
    await host.locator('.unit input[value="2"]').check();
    await host.locator('input[type=range]').fill('4');
    await host.locator('select').nth(0).selectOption('10');
    await host.locator('select').nth(1).selectOption('2');
    check('summary text', /4 questions from 2 units/.test(await host.locator('.settings p.muted').innerText()), await host.locator('.settings p.muted').innerText());
    await host.locator('button.go').click();
    await host.waitForSelector('.pin');
    const pin = (await host.locator('.pin').innerText()).replace(/\s/g, '');
    check('lobby shows a 6 digit PIN', /^\d{6}$/.test(pin), pin);
    check('QR code drawn', (await host.locator('.qr svg').count()) === 1 || (await host.locator('.lobby-grid .err').count()) === 1);
    check('host session remembered', await host.evaluate(() => !!JSON.parse(localStorage.getItem('live-host')).key));

    // ---------- players join ----------
    const phone = devices['Pixel 5'];
    const players = {};
    for (const name of ['Ada', 'Bob', 'Cem', 'Dil']) {
      const ctx = await browser.newContext({ ...phone });
      const page = await ctx.newPage();
      watch(page, name);
      await page.goto(`${name === 'Bob' ? PBASE : BASE}/play?pin=${pin}`);
      await page.waitForSelector('input[placeholder="Your nickname"]');
      check(`${name}: PIN prefilled from link`, (await page.locator('input[placeholder="Game PIN"]').inputValue()) === pin);
      await page.locator('input[placeholder="Your nickname"]').fill(name);
      await page.locator('button.go').click();
      await page.waitForSelector('text=You\'re in!');
      players[name] = { ctx, page };
    }
    await shot(players.Ada.page, 'player-wait');
    await host.waitForFunction(() => document.querySelectorAll('.chip').length === 4);
    check('host sees 4 players in 2 teams', (await host.locator('.team-col').count()) === 2 && (await host.locator('.chip').count()) === 4);
    await shot(host, 'host-lobby', { fullPage: true });

    // wrong PIN / duplicate nickname / kick
    const odd = await browser.newContext({ ...phone });
    const op = await odd.newPage();
    watch(op, 'odd');
    await op.goto(BASE + '/play');
    await op.locator('input[placeholder="Game PIN"]').fill('000000');
    await op.locator('input[placeholder="Your nickname"]').fill('X');
    await op.locator('button.go').click();
    await op.waitForSelector('.err:not(.hidden)');
    check('wrong PIN message', /No game with that PIN/.test(await op.locator('.err').innerText()));
    await op.locator('input[placeholder="Game PIN"]').fill(pin);
    await op.locator('input[placeholder="Your nickname"]').fill('ada');
    await op.locator('button.go').click();
    await op.waitForFunction(() => /taken/.test(document.querySelector('.err').textContent));
    check('duplicate nickname refused', true);
    await op.locator('input[placeholder="Your nickname"]').fill('Zed');
    await op.locator('button.go').click();
    await op.waitForSelector('text=You\'re in!');
    await host.waitForFunction(() => document.querySelectorAll('.chip').length === 5);
    await host.locator('.chip', { hasText: 'Zed' }).locator('button.x').click();
    await op.waitForSelector('text=removed you');
    check('kicked player is told and back at the join screen', (await op.locator('input[placeholder="Game PIN"]').count()) === 1);
    await host.waitForFunction(() => document.querySelectorAll('.chip').length === 4);

    // ---------- play ----------
    await host.keyboard.press('Space');            // Space starts the game
    for (const p of Object.values(players)) await p.page.waitForSelector('button.opt');
    check('players see 3 options', (await players.Ada.page.locator('button.opt').count()) === 3);
    check('host shows the question and a countdown', (await host.locator('.qtext').count()) === 1 && (await host.locator('.timer').innerText()).length > 0);
    await shot(players.Ada.page, 'player-question');
    await shot(host, 'host-question');

    await answer(players.Ada.page, true);
    await answer(players.Bob.page, true);
    await answer(players.Cem.page, false);
    await players.Ada.page.waitForSelector('text=Answer sent');
    check('answer locks the buttons', await players.Ada.page.locator('button.opt').first().isDisabled());
    await host.waitForFunction(() => /3 \/ 4 answered/.test(document.body.innerText));
    check('host counts answers', true);

    // Bob reloads the page mid-question: he must land back in the same question, already answered
    await players.Bob.page.reload();
    await players.Bob.page.waitForSelector('text=Answer sent');
    check('reload resumes the game and remembers the answer', true);

    // Dil never answers: the question ends by itself after ~10.5 s
    const t0 = Date.now();
    await host.waitForSelector('.brow', { timeout: 20000 });
    const waited = (Date.now() - t0) / 1000;
    check('unanswered question closes on time', waited < 15, waited);
    await players.Ada.page.waitForSelector('.verdict');
    await players.Cem.page.waitForSelector('.verdict');
    await players.Dil.page.waitForSelector('.verdict');
    check('Ada sees Correct', /Correct!/.test(await players.Ada.page.locator('.verdict').innerText()));
    check('Cem sees Not this time + right answer', /Not this time[\s\S]*Right answer/.test(await players.Cem.page.locator('.verdict').innerText()));
    check('Dil sees Time\'s up', /Time's up/.test(await players.Dil.page.locator('.verdict').innerText()));
    check('points shown', /\+\d{3,4}/.test(await players.Ada.page.locator('.verdict').innerText()));
    await shot(players.Ada.page, 'player-right');
    await shot(players.Cem.page, 'player-wrong');
    await shot(host, 'host-reveal', { fullPage: true });
    check('host reveal marks the right option', (await host.locator('.opt.right').count()) === 1);
    check('host leaderboard', (await host.locator('.brow').count()) >= 4);

    // wrong answer landed in the site's notebook
    const mistakes = await players.Cem.page.evaluate(() => JSON.parse(localStorage.getItem('dA2:mistakes') || '{}'));
    const ids = Object.keys(mistakes);
    check('wrong answer saved to dA2:mistakes', ids.length === 1 && mistakes[ids[0]].b === 0 && mistakes[ids[0]].w === 1 && BANK[ids[0]], mistakes);
    check('right answer not saved', Object.keys(await players.Ada.page.evaluate(() => JSON.parse(localStorage.getItem('dA2:mistakes') || '{}'))).length === 0);

    // a host double click on Next must not skip the next question
    await host.locator('button.go').dblclick();
    await host.waitForSelector('.qtext');
    check('double click on Next does not skip', (await host.locator('.qhead').innerText()).includes('Question 2 / 4'), await host.locator('.qhead').innerText());

    // everybody answers question 2 (Ada and Bob right, the others wrong)
    const roundOf = async (who) => {
      for (const n of who) await players[n].page.waitForSelector('button.opt:not([disabled])', { timeout: 15000 });
      for (const n of who) await answer(players[n].page, n === 'Ada' || n === 'Bob');
    };
    await roundOf(['Ada', 'Bob', 'Cem', 'Dil']);
    await host.waitForSelector('.brow');

    // Bob's connection dies and stays dead while the game moves on: banner, then he catches up by himself
    proxy.blocked = true;
    proxy.drop();
    await players.Bob.page.waitForSelector('.status:not(.hidden)', { timeout: 10000 });
    check('connection-lost banner appears', true);
    await host.locator('button.go').click();                              // question 3 opens without Bob
    await host.waitForFunction(() => document.body.innerText.includes('Question 3 / 4'));
    await roundOf(['Ada', 'Cem', 'Dil']);
    await sleep(2500);
    check('Bob still shows the old reveal while offline', (await players.Bob.page.locator('.verdict').count()) === 1);
    proxy.blocked = false;
    await players.Bob.page.waitForSelector('button.opt:not([disabled])', { timeout: 15000 });
    check('Bob reconnects and lands on the current question', /Question 3 \/ 4/.test(await players.Bob.page.locator('.pbar').nth(1).innerText()));
    check('banner goes away', (await players.Bob.page.locator('.status:not(.hidden)').count()) === 0);
    await answer(players.Bob.page, true);
    await host.waitForSelector('.brow');

    // question 4
    await host.locator('button.go').click();
    await host.waitForFunction(() => document.body.innerText.includes('Question 4 / 4'));
    await roundOf(['Ada', 'Bob', 'Cem', 'Dil']);
    await host.waitForSelector('.brow');
    check('last reveal offers the podium', /podium/i.test(await host.locator('button.go').innerText()));
    await host.keyboard.press('Enter');
    await host.waitForSelector('.podium');
    await sleep(1800);                                     // let the podium animation finish
    const podium = await host.locator('.podium .who').allInnerTexts();
    check('podium shows the winners', podium.length === 3 && podium.includes('Ada') && podium.includes('Bob'), podium);
    await shot(host, 'host-final', { fullPage: true });
    check('team totals shown', (await host.locator('.board .brow').count()) === 2);

    // player final screens + mistakes link
    await players.Cem.page.waitForSelector('text=You finished');
    await players.Ada.page.waitForSelector('h1');
    check('winner message', /You won!|You finished 2nd/.test(await players.Ada.page.locator('h1').innerText()), await players.Ada.page.locator('h1').innerText());
    check('Cem sees saved mistakes link', (await players.Cem.page.locator('a[href="/mistakes.html"]').count()) === 1);
    await shot(players.Cem.page, 'player-final', { fullPage: true });
    check('team line on final screen', /Team \w+: \dn?d? ?\w* place/.test(await players.Ada.page.locator('.stack').innerText()) || /Team /.test(await players.Ada.page.locator('.stack').innerText()));

    // the site's own notebook shows the saved mistakes (same origin)
    await players.Cem.page.locator('a[href="/mistakes.html"]').click();
    await players.Cem.page.waitForSelector('#mistakes .stat');
    const saved = await players.Cem.page.locator('#mistakes .stat b').first().innerText();
    check('My mistakes page shows the live-game mistakes', Number(saved) >= 4, saved);
    await shot(players.Cem.page, 'mistakes', { fullPage: true });

    // CSV download
    const [download] = await Promise.all([host.waitForEvent('download'), host.locator('button', { hasText: 'Results (.csv)' }).click()]);
    const csvPath = path.join(WORK, 'download.csv');
    await download.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath);
    check('CSV has BOM and all players', csv.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && ['Ada', 'Bob', 'Cem', 'Dil'].every(n => csv.toString().includes(n)));
    check('CSV download name', /live-results-\d{6}\.csv/.test(download.suggestedFilename()), download.suggestedFilename());
    const files = fs.existsSync(RESULTS) ? fs.readdirSync(RESULTS) : [];
    check('results also saved on disk', files.length === 1 && files[0].endsWith(pin + '.csv'), files);
    check('host shows where it was saved', /Also saved on this computer/.test(await host.locator('#saved').innerText()));

    // host reload after the game: resumes at the podium
    await host.reload();
    await host.waitForSelector('.podium');
    check('host reload resumes at the podium', true);
    await host.locator('button.go', { hasText: 'New game' }).click();
    await host.waitForSelector('.units .unit');
    check('New game returns to setup', true);
    check('setup remembers last choices', (await host.locator('.unit input:checked').count()) === 2);

    // a player who comes back to /play while the finished game is still listed sees the result, and can start over
    await players.Cem.page.goto(BASE + '/play');
    await players.Cem.page.waitForSelector('text=You finished');
    check('returning player sees the result again', true);
    await players.Cem.page.locator('button', { hasText: 'Join another game' }).click();
    await players.Cem.page.waitForSelector('input[placeholder="Game PIN"]');
    check('Join another game returns to the join screen', (await players.Cem.page.evaluate(() => localStorage.getItem('live-session'))) === null);
    // a QR code for a different game replaces an old session
    await players.Ada.page.goto(BASE + '/play?pin=123456');
    await players.Ada.page.waitForSelector('input[placeholder="Game PIN"]');
    check('QR link for another game shows the join form with that PIN', (await players.Ada.page.locator('input[placeholder="Game PIN"]').inputValue()) === '123456');
  } catch (e) {
    check('script finished without exception', false, String(e && e.stack || e));
  } finally {
    await browser.close();
    proxy.server.close();
    server.kill();
  }
  const expected = err => /Failed to load resource|EventSource|MIME type/.test(err);
  const unexpected = errors.filter(e => !expected(e));
  check('no unexpected JavaScript errors', unexpected.length === 0, unexpected);
  if (errors.length !== unexpected.length) console.log('ignored console noise:', errors.filter(expected));
  if (/Traceback/.test(log)) console.log('SERVER LOG:\n' + log);
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  try { fs.rmSync(WORK, { recursive: true, force: true }); } catch (e) { /* temp folder */ }
  process.exit(failed.length ? 1 : 0);
})();
