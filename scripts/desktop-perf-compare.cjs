const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runSample(root) {
  const launcher = path.join(root, 'apps/desktop/node_modules/electron/cli.js');
  const env = { ...process.env };
  delete env.MOYU_SMOKE_RENDERER_DIR;
  const result = spawnSync(process.execPath, [launcher, '--no-sandbox', 'scripts/desktop-smoke.cjs', '--perf-only'], {
    cwd: root, env, encoding: 'utf8', timeout: 90_000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw result.error ?? new Error(`Electron benchmark failed in ${root}: ${result.status ?? result.signal}`);
  }
  const reportPath = /^Desktop performance report: (.+)\r?$/m.exec(result.stdout)?.[1]?.trim();
  assert.ok(reportPath, 'Electron did not report a benchmark output path');
  return JSON.parse(fs.readFileSync(path.resolve(root, reportPath), 'utf8'));
}

const metrics = {
  composerReadyMs: (report) => report.navigationToComposerReadyMs,
  idleFrameP95Ms: (report) => report.idle.frameInterval.p95Ms,
  idleInputP95Ms: (report) => report.idle.inputToSecondFrame.p95Ms,
  streamingFrameP95Ms: (report) => report.streaming.frameInterval.p95Ms,
  streamingInputP95Ms: (report) => report.streaming.inputToSecondFrame.p95Ms,
};

function comparableSettings(report) {
  const { tracing, ...scenario } = report.scenario;
  assert.ok(!tracing, 'Timing comparison must run without performance tracing');
  return { environment: report.environment, scenario };
}

function summarize(samples) {
  assert.equal(samples.before.length, 3);
  assert.equal(samples.after.length, 3);
  const expected = comparableSettings(samples.before[0]);
  for (const report of [...samples.before, ...samples.after]) assert.deepEqual(comparableSettings(report), expected);
  const median = (values) => [...values].sort((a, b) => a - b)[1];
  const round = (number) => Math.round(number * 100) / 100;
  const comparisons = Object.fromEntries(Object.entries(metrics).map(([key, getValue]) => {
    const before = samples.before.map(getValue);
    const after = samples.after.map(getValue);
    assert.ok([...before, ...after].every((value) => Number.isFinite(value) && value > 0), `Invalid values for ${key}`);
    const beforeMedian = median(before);
    const afterMedian = median(after);
    return [key, { before, after, beforeMedian, afterMedian, changePercent: round((afterMedian / beforeMedian - 1) * 100) }];
  }));
  return { ...expected, repetitionsPerVersion: 3, comparisons };
}

function main([before, after]) {
  assert.ok(before && after, 'Usage: node scripts/desktop-perf-compare.cjs <built-baseline-checkout> <built-candidate-checkout>');
  const roots = { before: path.resolve(before), after: path.resolve(after) };
  assert.notEqual(fs.realpathSync(roots.before), fs.realpathSync(roots.after), 'Use two separate checkouts');
  const samples = { before: [], after: [] };
  const rounds = [['before', 'after'], ['after', 'before'], ['before', 'after']];
  for (const [index, round] of rounds.entries()) {
    for (const variant of round) {
      console.log(`Round ${index + 1}/${rounds.length}: ${variant}`);
      samples[variant].push(runSample(roots[variant]));
    }
  }
  const report = summarize(samples);
  const output = path.join(roots.after, '.work', 'desktop-perf-comparison.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ ...report, samples }, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  console.log(`Desktop performance comparison: ${output}`);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { summarize };
