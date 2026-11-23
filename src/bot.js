import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN || ''}`;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, '..', 'data'));
const GAMES_FILE = path.join(DATA_DIR, 'games.json');
const WIDGET_HTML = await readFile(path.join(ROOT, 'widget.html'), 'utf8');

if (!TOKEN) {
  console.error('Missing BOT_TOKEN.');
  process.exit(1);
}

async function api(method, payload = {}, timeoutMs = 20000) {
  const response = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.description || `Telegram API error: ${response.status}`);
  return body.result;
}

const games = new Map();
const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const freshGame = () => ({ b: Array(9).fill(''), turn: 'x', status: 'playing', winner: null });
const keyOf = (chatId, messageId) => `${chatId}:${messageId}`;

async function loadGames() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const saved = JSON.parse(await readFile(GAMES_FILE, 'utf8'));
    for (const [key, state] of Object.entries(saved)) games.set(key, state);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function saveGames() {
  const temp = `${GAMES_FILE}.tmp`;
  await writeFile(temp, JSON.stringify(Object.fromEntries(games)));
  await rename(temp, GAMES_FILE);
}

function winner(board) {
  for (const [a,b,c] of lines) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return board.every(Boolean) ? 'draw' : null;
}

function minimax(board, botTurn, depth = 0) {
  const result = winner(board);
  if (result === 'o') return 10 - depth;
  if (result === 'x') return depth - 10;
  if (result === 'draw') return 0;
  let best = botTurn ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (board[i]) continue;
    board[i] = botTurn ? 'o' : 'x';
    const score = minimax(board, !botTurn, depth + 1);
    board[i] = '';
    best = botTurn ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}

function playBot(board) {
  let best = -Infinity, choice = -1;
  for (let i = 0; i < 9; i++) {
    if (board[i]) continue;
    board[i] = 'o';
    const score = minimax(board, false, 1);
    board[i] = '';
    if (score > best) { best = score; choice = i; }
  }
  if (choice >= 0) board[choice] = 'o';
}

function finishIfNeeded(state) {
  const result = winner(state.b);
  if (result) {
    state.status = result === 'draw' ? 'draw' : 'won';
    state.winner = result === 'draw' ? null : result;
    state.turn = '';
  } else {
    state.status = 'playing';
    state.winner = null;
    state.turn = 'x';
  }
}

async function sendGame(chatId, replyToMessageId) {
  const state = freshGame();
  const payload = {
    chat_id: chatId,
    html: WIDGET_HTML,
    height: 390,
    caption: 'Play Tic-Tac-Toe against the bot. You are X; the bot is O.',
    allow_queries: true,
    chat_data: JSON.stringify(state)
  };
  if (replyToMessageId) payload.reply_parameters = { message_id: replyToMessageId };
  const sent = await api('sendWidget', payload);
  games.set(keyOf(chatId, sent.message_id), state);
  await saveGames();
}

async function handleMessage(message) {
  if (!message?.text || message.chat?.type !== 'private') return;
  const command = message.text.trim().split(/\s+/, 1)[0].split('@')[0].toLowerCase();
  if (command === '/start' || command === '/new') {
    try {
      await sendGame(message.chat.id, message.message_id);
    } catch (error) {
      console.error('sendWidget failed:', error.message);
      await api('sendMessage', { chat_id: message.chat.id, text: `Could not send the widget: ${error.message}` });
    }
  } else if (command === '/help') {
    await api('sendMessage', {
      chat_id: message.chat.id,
      text: '⭕ Tic-Tac-Toe\nYou are X and the bot is O. Tap a square to move. The bot uses minimax.\n\n/start or /new — start a game\n/help — show help'
    });
  }
}

async function handleWidgetQuery(query) {
  if (!query?.id) return;
  let state = freshGame();
  try {
    if (!query.chat || !query.message_id || query.chat.type !== 'private') throw new Error('Private chats only.');
    const key = keyOf(query.chat.id, query.message_id);
    const current = games.get(key);
    if (!current) throw new Error('Game session expired. Send /new to start again.');
    state = structuredClone(current);

    if (query.data === 'reset') {
      state = freshGame();
    } else {
      const match = /^move:([0-8])$/.exec(query.data || '');
      if (!match) throw new Error('Unknown move.');
      const index = Number(match[1]);
      if (state.status !== 'playing' || state.turn !== 'x' || state.b[index]) throw new Error('That square is unavailable.');
      state.b[index] = 'x';
      finishIfNeeded(state);
      if (state.status === 'playing') {
        state.turn = 'o';
        playBot(state.b);
        finishIfNeeded(state);
      }
    }

    await api('editMessageWidgetData', {
      chat_id: query.chat.id,
      message_id: query.message_id,
      chat_data: JSON.stringify(state)
    });
    games.set(key, state);
    await saveGames();
  } catch (error) {
    console.error('Widget query failed:', error.message);
    const key = query.chat && query.message_id ? keyOf(query.chat.id, query.message_id) : null;
    if (key && games.has(key)) state = games.get(key);
  }

  try {
    await api('answerWidgetQuery', { widget_query_id: query.id, data: JSON.stringify(state) });
  } catch (error) {
    console.error('answerWidgetQuery failed:', error.message);
  }
}

async function handleUpdate(update) {
  if (update.message) await handleMessage(update.message);
  if (update.widget_query) await handleWidgetQuery(update.widget_query);
  if (update.shared_widget_query) {
    await api('answerWidgetQuery', {
      widget_query_id: update.shared_widget_query.id,
      data: JSON.stringify(freshGame())
    }).catch(error => console.error('Shared query error:', error.message));
  }
}

async function start() {
  await loadGames();
  const webhook = await api('getWebhookInfo');
  if (webhook.url) throw new Error(`Webhook is configured at ${webhook.url}; remove it before polling.`);
  const me = await api('getMe');
  console.log(`Tic-Tac-Toe started as @${me.username}`);
  let offset = 0;
  while (true) {
    try {
      const updates = await api('getUpdates', {
        offset,
        timeout: 30,
        allowed_updates: ['message', 'widget_query', 'shared_widget_query']
      }, 35000);
      for (const update of updates) {
        offset = update.update_id + 1;
        try { await handleUpdate(update); }
        catch (error) { console.error(`Update ${update.update_id} failed:`, error.message); }
      }
    } catch (error) {
      console.error('Polling error:', error.message);
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
  }
}

start().catch(error => {
  console.error('Fatal startup error:', error.message);
  process.exit(1);
});
