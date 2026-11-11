const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');

const historySize = 1_000;
const burstSize = 5;
const burstCount = 60;
const burstIntervalMs = 40;
const sampleMs = 3_000;

function seedHistory(store, botId) {
  const conversation = store.botConversation(botId);
  for (let i = 0; i < historySize; i++) {
    const role = i % 2 ? 'assistant' : 'user';
    const content = role === 'assistant'
      ? `### 项目记录 ${i}\n\n- 核对任务状态和依赖。\n- 保留 **验收条件** 和 \`review\` 标记。\n\n记录结果，继续下一步。`
      : `第 ${i} 条记录：帮我核对项目进度、下一个里程碑和待确认事项。`;
    conversation.messages.push({ id: `perf-history-${i}`, role, content, createdAt: 1_700_000_000_000 + i * 1000 });
  }
  store.saveConversation(conversation.id);
  return conversation.id;
}

function waitForComposer(historySize) {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + 15_000;
    const check = () => {
      const input = document.querySelector('.composer__input');
      if (input && !input.disabled && !input.closest('[inert]') && document.querySelectorAll('[data-message-id^="perf-history-"]').length === historySize) {
        resolve(performance.now());
      } else if (performance.now() >= deadline) {
        reject(new Error('Composer or history did not become ready'));
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}

function sampleRenderer(durationMs) {
  return new Promise((resolve) => {
    const frames = [];
    const inputDelays = [];
    const input = document.querySelector('.composer__input');
    const scroller = document.querySelector('.messages');
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    let frame;
    let probeFrame;
    let lastFrame;
    let index = 0;
    const tick = (stamp) => {
      if (lastFrame !== undefined) frames.push(stamp - lastFrame);
      lastFrame = stamp;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const probe = setInterval(() => {
      if (probeFrame !== undefined) return;
      const start = performance.now();
      setValue.call(input, `性能测量草稿 ${++index}`);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      probeFrame = requestAnimationFrame(() => {
        probeFrame = requestAnimationFrame(() => {
          inputDelays.push(performance.now() - start);
          probeFrame = undefined;
        });
      });
    }, 150);
    let distance = 0;
    const scroll = setInterval(() => {
      const bottom = scroller.scrollHeight - scroller.clientHeight;
      distance = (distance + 180) % 1800;
      scroller.scrollTop = bottom - distance;
    }, 90);
    setTimeout(() => {
      cancelAnimationFrame(frame);
      clearInterval(probe);
      clearInterval(scroll);
      if (probeFrame !== undefined) cancelAnimationFrame(probeFrame);
      setValue.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      scroller.scrollTop = scroller.scrollHeight;
      resolve({ frames, inputDelays });
    }, durationMs);
  });
}

function summarize(values) {
  assert.ok(values.length > 0, 'Expected at least one performance sample');
  const sorted = [...values].sort((a, b) => a - b);
  const round = (value) => Math.round(value * 100) / 100;
  return {
    samples: sorted.length,
    p50Ms: round(sorted[Math.ceil(sorted.length * 0.5) - 1]),
    p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    maxMs: round(sorted.at(-1)),
  };
}

async function runPerformance({ win, evaluate, until, conversationId, startupMs, output }) {
  const runId = 'perf-run';
  const messageId = 'perf-live-reply';
  const message = { id: messageId, role: 'assistant', content: '', createdAt: Date.now(), streaming: true };
  const send = (event) => win.webContents.send('moyu:event', { ...event, conversationId });
  const idle = await evaluate(sampleRenderer, sampleMs);
  send({ type: 'run_start', runId });
  send({ type: 'message_start', message });
  await until((id) => !!document.querySelector(`[data-message-id="${id}"]`), 'benchmark reply mounted', 10_000, messageId);
  const sample = evaluate(sampleRenderer, sampleMs);
  let content = '';
  for (let burst = 0; burst < burstCount; burst++) {
    for (let part = 0; part < burstSize; part++) {
      const text = `片段 ${burst * burstSize + part + 1}。 `;
      content += text;
      send({ type: 'delta', messageId, text });
    }
    await delay(burstIntervalMs);
  }
  const streaming = await sample;
  await until((id, expected) => document.querySelector(`[data-message-content="${id}"]`)?.textContent?.trim() === expected, 'full stream rendered', 10_000, messageId, content.trim());
  send({ type: 'message_end', message: { ...message, content, streaming: false } });
  const metrics = (data) => ({
    frameInterval: summarize(data.frames),
    inputToSecondFrame: summarize(data.inputDelays),
  });
  const report = {
    environment: { os: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, electron: process.versions.electron },
    scenario: { historySize, burstSize, burstCount, burstIntervalMs, sampleMs, viewport: win.getContentSize(), offscreen: true },
    navigationToComposerReadyMs: Math.round(startupMs * 100) / 100,
    idle: metrics(idle),
    streaming: metrics(streaming),
  };
  const json = JSON.stringify(report, null, 2);
  fs.writeFileSync(path.join(output, 'performance.json'), json + '\n');
  console.log(json);
  console.log(`Desktop performance report: ${path.join(output, 'performance.json')}`);
}

module.exports = { historySize, seedHistory, waitForComposer, runPerformance };
