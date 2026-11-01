import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Screenshot regression: a filled quote tag and horizontal guide covered the
// phone's historical price line. Quote provenance must remain outside canvas.
test('latest quote is outside the historical canvas with no overlaid price guide', () => {
  const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../src/App.css', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /createPriceLine\s*\(/);
  assert.ok(app.indexOf('className="chart-quote"') < app.indexOf('<Chart\n'));
  assert.match(app, /className="chart-quote-time"/);
  assert.match(css, /\.chart-quote\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.chart-quote-time\s*\{[^}]*overflow-wrap:\s*anywhere/);
});
