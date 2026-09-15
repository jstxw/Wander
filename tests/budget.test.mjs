import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Budget, TOTAL_LIMIT, RUN_LIMIT, MODEL, cost } from '../server/budget.mjs';
import { normalizeActionMessage, plan } from '../server/planner.mjs';
import { allowedUrl, checkoutPattern } from '../server/browser.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'budget.json'); return { file, budget: new Budget(file), run: { spent: 0 } };
}
test('budget reservations survive process restart and settle with usage', t => {
  const { file, budget, run } = fixture(t);
  const reservation = budget.reserve({ message: 'hello' }, run);
  assert.ok(reservation > 0); assert.equal(new Budget(file).data.spent, reservation);
  budget.settle(reservation, { prompt_tokens: 100, completion_tokens: 20 }, run);
  assert.ok(Math.abs(budget.data.spent - cost(100, 20)) < 1e-12);
  assert.equal(new Budget(file).data.spent, run.spent);
});
test('budget rejects a request before it crosses the total or task ceiling', t => {
  const { budget, run } = fixture(t);
  budget.data.spent = TOTAL_LIMIT - 0.00001;
  assert.throws(() => budget.reserve({}, run), /1.80/);
  budget.data.spent = 0; run.spent = RUN_LIMIT;
  assert.throws(() => budget.reserve({}, run), /0.25/);
  assert.equal(budget.data.calls, 0);
});
test('invalid usage cannot refund an ambiguous request', t => {
  const { budget, run } = fixture(t); const reserved = budget.reserve({}, run);
  budget.settle(reserved, { prompt_tokens: -3, completion_tokens: 1 }, run);
  assert.equal(budget.data.spent, reserved);
});
test('corrupt ledger fails closed', t => {
  const { file } = fixture(t); fs.writeFileSync(file, '{"spent":-1,"calls":0}');
  assert.throws(() => new Budget(file), /Invalid budget/);
});
test('Luna request disables reasoning, enforces structured output, and charges usage', async t => {
  const { budget, run } = fixture(t); let requested;
  const result = await plan({ key: 'test-key', task: 'Find eggs', observation: {}, history: [], budget, run, signal: new AbortController().signal,
    fetcher: async (_, options) => { requested = JSON.parse(options.body); return Response.json({ usage: { prompt_tokens: 120, completion_tokens: 60 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ action: 'ask', target: 0, value: '', message: 'Choose your store.' }) } }] }); }
  });
  assert.equal(requested.model, MODEL); assert.equal(requested.reasoning_effort, 'none'); assert.equal(requested.max_completion_tokens, 450);
  assert.equal(requested.response_format.json_schema.strict, true); assert.equal(result.action, 'ask'); assert.ok(run.spent < .001);
});
test('failed provider calls are not retried or exposed and retain reservations', async t => {
  const { budget, run } = fixture(t); let calls = 0;
  await assert.rejects(plan({ key: 'test-key', task: 'Find eggs', observation: {}, history: [], budget, run, signal: new AbortController().signal,
    fetcher: async () => { calls++; return new Response('secret-provider-body', { status: 401 }); }
  }), error => error.message.includes('401') && !error.message.includes('secret-provider-body'));
  assert.equal(calls, 1); assert.ok(run.spent > 0);
});
test('model cannot choose arbitrary code or unlisted actions', async t => {
  const { budget, run } = fixture(t);
  await assert.rejects(plan({ key: 'test-key', task: 'Find eggs', observation: {}, history: [], budget, run, signal: new AbortController().signal,
    fetcher: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"action":"eval","target":0,"value":"code","message":"hello"}' } }] })
  }), /Unexpected model action/);
});
test('tutor action wording addresses the user instead of narrating Wander work', async t => {
  const { budget, run } = fixture(t); run.tutor = true;
  const action = await plan({ key: 'test-key', task: 'Find pencils', observation: {}, history: [], budget, run, signal: new AbortController().signal,
    fetcher: async () => Response.json({ usage: { prompt_tokens: 10, completion_tokens: 10 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ action: 'fill', target: 2, value: 'pencils', message: 'Searching for pencils will show matching products.' }) } }] })
  });
  assert.equal(action.message, 'First, search for pencils will show matching products.');
});
test('first-person tutor instructions are deterministically rewritten for the user', () => {
  assert.equal(normalizeActionMessage({ action: 'click', value: '', message: 'I’ll open the official eligibility checker so you can see the renewal requirements.' }), 'First, open the official eligibility checker so you can see the renewal requirements.');
  assert.equal(normalizeActionMessage({ action: 'fill', value: 'passport renewal', message: "I will type passport renewal into the search box." }, 1), 'Next, type passport renewal into the search box.');
  assert.equal(normalizeActionMessage({ action: 'navigate', value: 'https://example.com', message: 'Opening the official website.' }, 2), 'Next, open the official website.');
  assert.equal(normalizeActionMessage({ action: 'click', value: '', message: 'Click Continue and I’ll show you the next page.' }, 3), 'Next, click the highlighted control to continue.');
});
test('ordinary web destinations are accepted; privileged schemes and credentials are rejected', () => {
  for (const url of ['https://www.metro.ca/en', 'https://www.staples.ca', 'https://www.google.com/search?q=school', 'http://example.com']) assert.equal(allowedUrl(url), true);
  for (const url of ['https://user@metro.ca', 'javascript:alert(1)', 'file:///tmp/test', 'chrome://settings', 'data:text/html,hello']) assert.equal(allowedUrl(url), false);
  assert.equal(checkoutPattern.test('Proceed to checkout'), true); assert.equal(checkoutPattern.test('Add to cart'), false);
});

test('dynamic mode escalates only the current run and charges Astra pricing', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-mode-'));
  try {
    const budget = new Budget(path.join(directory, 'budget.json'));
    const run = { spent: 0, modelMode: 'dynamic', waitCount: 1 };
    let requested;
    await plan({ key: 'test', task: 'Find red', observation: { text: '', elements: [] }, history: [], budget, run, signal: new AbortController().signal, fetcher: async (_, options) => {
      requested = JSON.parse(options.body);
      return Response.json({ usage: { prompt_tokens: 100, completion_tokens: 20 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ action: 'done', target: 0, value: '', message: 'Done' }) } }] });
    } });
    assert.equal(requested.model, 'gpt-6-astra');
    assert.equal(requested.reasoning_effort, 'low');
    assert.ok(Math.abs(run.spent - cost(100, 20, 'gpt-6-astra')) < 1e-9);
    assert.equal(run.escalated, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
