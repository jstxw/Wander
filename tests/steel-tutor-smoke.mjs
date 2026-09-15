// Explicit, paid Steel-only smoke check. No model calls, user tabs or user cookies.
// node --env-file=.env.local tests/steel-tutor-smoke.mjs --live
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SteelComputer } from '../server/computer.mjs';

if (!process.argv.includes('--live')) throw new Error('Pass --live to authorize this Steel compute/browser smoke check.');
if (!process.env.STEEL_API_KEY) throw new Error('Provide STEEL_API_KEY through your environment.');
const computer = new SteelComputer({ key: process.env.STEEL_API_KEY, stateFile: process.argv.includes('--fresh') ? `.wander/tutor-smoke-${randomUUID()}.json` : '.wander/tutor-smoke-computer.json' });
const runId = randomUUID();
try {
  console.log('Preparing an isolated tutor test computer.');
  await computer.ensure();
  console.log('Installing remote Playwright tools.');
  await computer.prepareTutor();
  console.log('Opening example.com in a Steel Browser controlled from Steel Computer.');
  const result = await computer.inspect('https://example.com', runId);
  assert.ok(result.evidence, result.workspace.diagnostic || result.workspace.limitation);
  assert.match(result.evidence.title, /Example Domain/);
  assert.ok(result.workspace.artifacts.includes('observation.json'));
  assert.ok(result.workspace.screenshot);
  console.log('Verified remote page inspection, workspace files and screenshot. No OpenAI call was made.');
} finally {
  if (computer.tutorReady) await computer.releaseTutor(runId).catch(e => console.error(e.message));
  await computer.pause();
  console.log('Practice session released; tutor test computer paused.');
}
