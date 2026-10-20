#!/usr/bin/env node
/** Send only the EZPZTEK simulation contract, never a production webhook. */
import fs from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { parseDeliveryEvent } from '../src/lib/delivery/core.ts';
const [file] = process.argv.slice(2);
try {
  if (!file) throw new Error('Usage: node --experimental-strip-types scripts/send-delivery-sandbox.mjs event.json');
  const target = new URL(process.env.DELIVERY_SANDBOX_URL || 'http://localhost:3000/api/integrations/sandbox/foodpanda');
  if (target.pathname !== '/api/integrations/sandbox/foodpanda' || target.search || target.username || target.password) throw new Error('Only the exact EZPZTEK sandbox path is allowed.');
  const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  if (target.protocol !== 'https:' && !(localhost && target.protocol === 'http:')) throw new Error('Use HTTPS outside localhost.');
  const secret = process.env.DELIVERY_SANDBOX_SECRET;
  if (!secret || secret.length < 32) throw new Error('Set DELIVERY_SANDBOX_SECRET to the matching 32+ character server secret.');
  const bytes = await fs.readFile(file);
  if (bytes.byteLength > 65536) throw new Error('Event exceeds 64 KiB.');
  const body = JSON.stringify(parseDeliveryEvent(JSON.parse(bytes.toString('utf8'))));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const response = await fetch(target, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'x-ezpz-timestamp': timestamp, 'x-ezpz-signature': signature }, body,
  });
  console.log(`HTTP ${response.status}\n${await response.text()}`);
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
