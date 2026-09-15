import fs from 'node:fs';
import path from 'node:path';

export const MODEL = 'gpt-5.6-luna';
export const MAX_OUTPUT = 450;
export const TOTAL_LIMIT = 1.80;
export const MAX_STEPS = 60;
export const REQUEST_BYTE_LIMIT = 48000;
// Luna: $0.20/M input, $1.20/M output. Conservatively allow the 1.25x cache-write rate on all input.
export const RATES = { 'gpt-5.6-luna': [0.25, 1.2], 'gpt-5.6-sol': [5, 20], 'gpt-6-astra': [12.5, 50] };
export const cost = (input, output, model = MODEL) => { const rates = RATES[model]; if (!rates) throw new Error('Unknown model pricing.'); return (input * rates[0] + output * rates[1]) / 1_000_000; };

export function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export class Budget {
  constructor(file) {
    this.file = file;
    this.data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { spent: 0, calls: 0 };
    if (!Number.isFinite(this.data.spent) || this.data.spent < 0 || !Number.isInteger(this.data.calls) || this.data.calls < 0) {
      throw new Error('Invalid budget ledger. Restore the ledger before starting.');
    }
  }
  reserve(body, run) {
    // A UTF-8 byte per token is deliberately conservative. Include schema and message overhead.
    const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
    if (bytes > REQUEST_BYTE_LIMIT) throw new Error('Page snapshot exceeded the request size limit.');
    const amount = cost(bytes + 2048, body.max_completion_tokens || MAX_OUTPUT, body.model);
    if (this.data.spent + amount > TOTAL_LIMIT) throw new Error('The $1.80 app budget is reached. No more model calls will be made.');
    this.data.spent += amount;
    this.data.calls++;
    run.spent += amount;
    saveJson(this.file, this.data); // Reserve before network I/O; crashes and ambiguous failures retain the reservation.
    return amount;
  }
  settle(reserved, usage, run, model = MODEL) {
    if (!Number.isInteger(usage?.prompt_tokens) || !Number.isInteger(usage?.completion_tokens) || usage.prompt_tokens < 0 || usage.completion_tokens < 0) return;
    const actual = cost(usage.prompt_tokens, usage.completion_tokens, model);
    this.data.spent = Math.max(0, this.data.spent + actual - reserved);
    run.spent = Math.max(0, run.spent + actual - reserved);
    saveJson(this.file, this.data);
  }
  publicState() {
    return { spent: this.data.spent, limit: TOTAL_LIMIT, calls: this.data.calls, model: MODEL };
  }
}
