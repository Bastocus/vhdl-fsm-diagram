/**
 * Real-browser regression test for the webview HTML/CSP.
 *
 * Renders the actual buildPanelHtml() output (src/panelHtml.ts) in a headless
 * Chrome (via puppeteer) and asserts, against real browser behaviour rather
 * than reading the CSP spec:
 *   - toolbar inline onclick="..." handlers (zoom, reset, fit, theme, lock,
 *     export) execute without CSP violations
 *   - a condition string containing a literal `</script>` cannot break out
 *     of the inlined FSM_DATA payload
 *   - a <script> element injected without the page's nonce is blocked by CSP
 *
 * This guards against a repeat of the v1.10.1 regression, where adding
 * 'unsafe-inline' to the same script-src directive as the nonce silently did
 * nothing (a nonce disables 'unsafe-inline' for the whole directive it's
 * declared in) and the toolbar buttons stayed dead despite `npm test` (parser
 * fixtures + pure-helper unit tests) staying green.
 *
 * Loads pages via file:// navigation rather than page.setContent() — Puppeteer's
 * evaluateOnNewDocument (used here to stub acquireVsCodeApi) is not reliably
 * applied before inline scripts run when using setContent().
 *
 * Run with: npx tsx test/webview.ts  (or as part of npm test)
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import puppeteer, { Browser, Page } from 'puppeteer';
import { buildPanelHtml } from '../src/panelHtml';
import { ParsedFsm } from '../src/parser';

let passed = 0;
let failed = 0;

function assert(description: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  PASS  ${description}`);
    passed++;
  } else {
    console.log(`  FAIL  ${description}`);
    if (detail) console.log(`        ${detail}`);
    failed++;
  }
}

const sampleFsm: ParsedFsm = {
  signalName: 'state',
  caseLine: 10,
  typeName: 'state_t',
  typeLine: 5,
  states: [
    { name: 'idle', line: 6 },
    { name: 'active', line: 7 },
  ],
  transitions: [
    { from: 'idle', to: 'active', condition: 'en = \'1\'', line: 12 },
    { from: 'active', to: 'idle', condition: '(always)', line: 14 },
  ],
  entityName: 'e',
  architectureName: 'rtl',
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vhdl-fsm-webview-test-'));
let fileCounter = 0;

/** Stub acquireVsCodeApi, write `html` to a temp file, and navigate to it via file://. */
async function loadHtml(browser: Browser, html: string): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('pageerror: ' + err.message));
  // Passed as a raw string, not a function reference: tsx/esbuild can inject a
  // `__name` helper call into transpiled function bodies, and Puppeteer serializes
  // callbacks via fn.toString() — that helper doesn't exist in the page's isolated
  // world, so a function reference here throws "__name is not defined" on the page.
  await page.evaluateOnNewDocument(
    'window.acquireVsCodeApi = function() { return { postMessage: function(){}, getState: function(){}, setState: function(){} }; };',
  );
  const file = path.join(tmpDir, `page-${fileCounter++}.html`);
  fs.writeFileSync(file, html);
  await page.goto('file://' + file, { waitUntil: 'load' });
  return { page, errors };
}

async function main(): Promise<void> {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    // ── Toolbar buttons work under the CSP ──────────────────────────────────
    const nonce1 = 'test-nonce-1';
    const html = buildPanelHtml([sampleFsm], 'sample.vhd', 'dark', nonce1);
    const { page, errors: consoleErrors } = await loadHtml(browser, html);

    const fns = await page.evaluate(() =>
      ['zoomIn', 'zoomOut', 'fitToView', 'resetZoom', 'exportSvg', 'toggleTheme', 'toggleLock']
        .map(name => typeof (window as any)[name]),
    );
    assert(
      'all toolbar onclick target functions are defined (inline <script> executed)',
      fns.every(t => t === 'function'),
      `got: ${JSON.stringify(fns)}`,
    );

    const toolbarDisplay = await page.$eval('#toolbar', el => getComputedStyle(el).display);
    assert('toolbar is visible once FSM data is present', toolbarDisplay === 'flex', `got=${toolbarDisplay}`);

    const zoomBefore = await page.$eval('#zoom-display', el => el.textContent);
    await page.click('button.btn[onclick="zoomIn()"]');
    const zoomAfterIn = await page.$eval('#zoom-display', el => el.textContent);
    assert(
      'clicking Zoom In (inline onclick) changes the zoom display',
      zoomBefore !== zoomAfterIn,
      `before=${zoomBefore} after=${zoomAfterIn}`,
    );

    await page.click('button.btn[onclick="resetZoom()"]');
    const zoomAfterReset = await page.$eval('#zoom-display', el => el.textContent);
    assert(
      'clicking Reset (inline onclick) restores 100%',
      zoomAfterReset === '100%',
      `got=${zoomAfterReset}`,
    );

    const lightBefore = await page.evaluate(() => document.body.classList.contains('light'));
    await page.click('#theme-btn');
    const lightAfter = await page.evaluate(() => document.body.classList.contains('light'));
    assert(
      'clicking the theme button (inline onclick) toggles body.light',
      lightBefore !== lightAfter,
      `before=${lightBefore} after=${lightAfter}`,
    );

    await page.click('button.btn[onclick="fitToView()"]');
    await page.click('button.btn[onclick="exportSvg()"]');

    assert(
      'no console/page errors while exercising the toolbar',
      consoleErrors.length === 0,
      `errors: ${JSON.stringify(consoleErrors)}`,
    );

    // ── CSP actually blocks an unnonced injected <script> ───────────────────
    const injected = await page.evaluate(() => {
      try {
        const s = document.createElement('script');
        s.textContent = 'window.__injected = true;';
        document.body.appendChild(s);
        return (window as any).__injected === true;
      } catch (e) {
        return 'threw: ' + (e as Error).message;
      }
    });
    assert(
      'a <script> element injected at runtime without the page nonce does not execute',
      injected === false,
      `got: ${JSON.stringify(injected)}`,
    );
    await page.close();

    // ── XSS: a </script>-bearing condition cannot break out of the payload ──
    const evilFsm: ParsedFsm = {
      ...sampleFsm,
      transitions: [
        { from: 'idle', to: 'active', condition: '</script><script>window.__xss=true;</script>', line: 12 },
      ],
    };
    const nonce2 = 'test-nonce-2';
    const evilHtml = buildPanelHtml([evilFsm], 'evil.vhd', 'dark', nonce2);
    assert(
      'raw HTML never contains a literal </script> before the real closing tag',
      (() => {
        const scriptOpen = evilHtml.indexOf(`<script nonce="${nonce2}">`);
        const bodyStart = scriptOpen + `<script nonce="${nonce2}">`.length;
        const firstClose = evilHtml.indexOf('</script>', bodyStart);
        const lastClose = evilHtml.lastIndexOf('</script>');
        // The payload's condition text must not have produced an *earlier* close tag.
        return firstClose === lastClose;
      })(),
    );

    const { page: page2, errors: errors2 } = await loadHtml(browser, evilHtml);
    const xssRan = await page2.evaluate(() => (window as any).__xss === true);
    assert('a condition containing </script><script> never executes as script', xssRan !== true);

    // FSM_DATA is a top-level `const` inside the inline script — it does not become
    // a `window` property, so it must be read via a bare identifier lookup here.
    const dataRoundTrip = await page2.evaluate(() => {
      // eslint-disable-next-line no-undef
      return (FSM_DATA as any)[0].transitions[0].condition;
    });
    assert(
      'the escaped condition round-trips to its original text via FSM_DATA',
      dataRoundTrip === evilFsm.transitions[0].condition,
      `got: ${JSON.stringify(dataRoundTrip)}`,
    );
    assert('no console/page errors on the </script>-condition page', errors2.length === 0, JSON.stringify(errors2));
    await page2.close();

    // ── Empty-state render (no FSMs) still produces valid, non-crashing HTML ─
    const emptyHtml = buildPanelHtml([], 'nofsm.vhd', 'auto', 'test-nonce-3');
    const { page: page3, errors: errors3 } = await loadHtml(browser, emptyHtml);
    const emptyStateVisible = await page3.$eval('.empty h3', el => el.textContent);
    assert('empty FSM list renders the "No FSM detected" placeholder', emptyStateVisible === 'No FSM detected');
    assert('no console/page errors on empty-state render', errors3.length === 0, JSON.stringify(errors3));
    await page3.close();
  } finally {
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('');
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('webview test crashed:', err);
  process.exit(1);
});
