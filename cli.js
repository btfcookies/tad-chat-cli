#!/usr/bin/env node
// Usage: tad <your-name> [forum]
const readline = require('readline');

const BASE_URL = (process.env.TAD_CHAT_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
const NAME = (process.argv[2] || '').trim();
const FORUM = (process.argv[3] || 'general-discussion').trim();
const POLL_MS = 2000;
const HISTORY = 20;

if (!NAME) {
  console.error('Usage: tad <your-name> [forum]');
  console.error('Set TAD_CHAT_URL to point at a different server (default http://localhost:3000).');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
function show(line) {
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  console.log(line);
  rl.prompt(true);
}

function format(msg) {
  const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `[${time}] ${msg.name}: ${msg.text}`;
}

async function fetchMessages() {
  const res = await fetch(`${BASE_URL}/messages?forum=${encodeURIComponent(FORUM)}`);
  const data = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(data)) {
    throw new Error((data && data.error) || `Server answered ${res.status}`);
  }
  return data;
}

async function sendMessage(text) {
  const res = await fetch(`${BASE_URL}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NAME, text, forum: FORUM }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server answered ${res.status}`);
}

let lastTime = 0;
let polling = false;
let failing = false;

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const fresh = (await fetchMessages()).filter((m) => m.time > lastTime);
    if (failing) {
      failing = false;
      show('(reconnected)');
    }
    for (const msg of fresh) {
      show(format(msg));
      lastTime = msg.time;
    }
  } catch (err) {
    if (!failing) {
      failing = true;
      show(`(connection problem: ${err.message}, retrying)`);
    }
  } finally {
    polling = false;
  }
}

let queue = Promise.resolve();

function enqueueSend(text) {
  queue = queue
    .then(() => sendMessage(text))
    .then(poll)
    .catch((err) => show(`(not sent: ${err.message})`));
}

async function main() {
  try {
    const history = await fetchMessages();
    history.slice(-HISTORY).forEach((m) => console.log(format(m)));
    if (history.length) lastTime = history[history.length - 1].time;
  } catch (err) {
    console.error(`Could not load ${FORUM} from ${BASE_URL}: ${err.message}`);
    process.exit(1);
  }

  console.log(`--- ${NAME} in ${FORUM} on ${BASE_URL} (type /quit to leave) ---`);
  rl.prompt();

  const timer = setInterval(poll, POLL_MS);

  function quit() {
    clearInterval(timer);
    rl.close();
    process.exit(0);
  }

  rl.on('line', (line) => {
    const text = line.trim();
    if (text === '/quit') return quit();
    if (text) enqueueSend(text);
    rl.prompt(true);
  });
  rl.on('close', quit);
}

main();
