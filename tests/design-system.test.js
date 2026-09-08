/* Design-system tests, mirroring katjanorstad.no's tests/typography.test.js
 * conventions for this app's own two stylesheets: the mono face is never
 * used to set a word, furniture is never serif, running text is serif, and
 * colour only ever comes from a custom property — never a bare hex value
 * outside the tokens themselves — which is what makes "the mode switch is
 * a palette switch" true everywhere at once instead of only where someone
 * remembered to use the variable.
 */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SITE = fs.readFileSync(path.join(ROOT, 'assets/css/site.css'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'assets/css/app.css'), 'utf8');

const decomment = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS_SOURCES = [['site.css', decomment(SITE)], ['app.css', decomment(APP)]];

test('the mono face is never used to set a word (paired with uppercase)', () => {
  const offenders = [];
  for (const [name, css] of CSS_SOURCES) {
    for (const block of css.split('}')) {
      if (!block.includes('var(--font-mono)')) continue;
      if (!/text-transform:\s*uppercase/.test(block)) continue;
      const sel = (/([^{;]+)\{/.exec(block) || [, block]).pop().trim().replace(/\s+/g, ' ');
      offenders.push(`${name}: ${sel}`);
    }
  }
  assert.deepEqual(offenders, [], `mono set uppercase (a name, not a figure):\n  ${offenders.join('\n  ')}`);
});

test('running text is set in the serif', () => {
  const body = /\nbody \{([\s\S]*?)\n\}/.exec(decomment(SITE));
  assert.ok(body, 'no body rule found in site.css');
  assert.match(body[1], /font-family:\s*var\(--font-serif\)/);
});

test('tracked uppercase furniture never sets the serif', () => {
  const offenders = [];
  for (const [name, css] of CSS_SOURCES) {
    for (const block of css.split('}')) {
      if (!/text-transform:\s*uppercase/.test(block)) continue;
      if (!/font-family:\s*var\(--font-serif\)/.test(block)) continue;
      const sel = (/([^{;]+)\{/.exec(block) || [, block]).pop().trim().replace(/\s+/g, ' ');
      offenders.push(`${name}: ${sel}`);
    }
  }
  assert.deepEqual(offenders, [], `uppercase furniture set in the serif:\n  ${offenders.join('\n  ')}`);
});

test('the readouts that count (cap meter, streaks, pips-adjacent figures) are monospaced and tabular', () => {
  for (const selector of ['.cap-meter', '.streak']) {
    const re = new RegExp(`${selector.replace('.', '\\.')} \\{([^}]*)\\}`);
    const rule = re.exec(decomment(APP));
    assert.ok(rule, `no ${selector} rule found`);
    assert.match(rule[1], /font-family:\s*var\(--font-mono\)/);
    assert.match(rule[1], /font-variant-numeric:\s*tabular-nums/);
  }
});

test('no rule outside the token definitions themselves hard-codes a colour', () => {
  // Every hex/rgb colour must live inside a :root or body.mode-* block,
  // where the tokens are DEFINED. Everywhere else must reference a
  // var(--...) instead — that's what makes swapping the palette (or,
  // eventually, adding the shuffle button the spec defers) a one-line
  // change rather than a hunt through every component rule.
  const offenders = [];
  for (const [name, css] of CSS_SOURCES) {
    // Strip token-definition blocks (:root, body, body.mode-home, body.mode-work
    // opening declarations) before scanning for stray colours.
    const withoutTokenBlocks = css
      .replace(/:root\s*\{[^}]*\}/g, '')
      .replace(/body(\.mode-(home|work))?\s*\{[^}]*\}/g, '');
    const colourPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
    for (const m of withoutTokenBlocks.matchAll(colourPattern)) {
      offenders.push(`${name}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `hard-coded colours outside the token blocks:\n  ${offenders.join('\n  ')}`);
});

test('the four semantic colour uses are all present: filled ring, sand wash, pips, solid tag', () => {
  const css = decomment(APP);
  assert.match(css, /\.task-row\.is-done \.task-ring \{[^}]*background:\s*var\(--mode-mid\)/,
    'no filled-ring rule for a done task');
  assert.match(css, /\.row-completed \{[^}]*background:\s*var\(--mode-sand\)/,
    'no sand-wash rule for a completed row');
  assert.match(css, /\.pip\.filled \{[^}]*background:\s*var\(--mode-mid\)/,
    'no filled-pip rule for quota progress');
  assert.match(css, /\.tag-today \{[^}]*background:\s*var\(--mode-mid\)/,
    'no solid tag rule for a due-today deadline');
});

test('both mode palettes declare all four tiers, matching the spec\'s Crimson & Teal values', () => {
  const css = decomment(APP);
  const home = /body\.mode-home\s*\{([^}]*)\}/.exec(css);
  const work = /body\.mode-work\s*\{([^}]*)\}/.exec(css);
  assert.ok(home && work, 'missing a mode palette block');
  for (const tier of ['--mode-light', '--mode-mid', '--mode-dark', '--mode-sand']) {
    assert.match(home[1], new RegExp(`${tier}:\\s*#`), `mode-home is missing ${tier}`);
    assert.match(work[1], new RegExp(`${tier}:\\s*#`), `mode-work is missing ${tier}`);
  }
  assert.match(home[1], /--mode-mid:\s*#a92f4e/i, 'home mid does not match the spec');
  assert.match(work[1], /--mode-mid:\s*#509994/i, 'work mid does not match the spec');
});
