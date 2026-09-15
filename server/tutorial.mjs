import { snapshotPage } from '../extension/page-tools.js';
import { chromium } from 'playwright';
import fs from 'node:fs';
import { saveJson } from './budget.mjs';

export function allowedUrl(value) {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password;
  } catch { return false; }
}

export const checkoutPattern = /\b(check\s*out|checkout|place\s+(?:my\s+)?order|pay\s+now|confirm\s+(?:my\s+)?order|complete\s+purchase|subscribe|passer\s+(?:la\s+)?commande|paiement|payer)\b/i;



