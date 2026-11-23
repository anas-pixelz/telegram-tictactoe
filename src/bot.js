import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TOKEN = process.env.BOT_TOKEN;
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WIDGET_HTML = await readFile(path.join(ROOT, 'widget.html'), 'utf8');

if (!TOKEN) {
  console.error('Missing BOT_TOKEN. Add it to your environment before starting the bot.');
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
  if (!response.ok || !body.ok) {
    const error = new Error(body.description || `Telegram API error: ${response.status}`);
    error.code = body.error_code || response.status;
    throw error;
  }
  return body.result;
}

function newGame() {
  return { b: Array(9).fill(''), turn: 'x', status: 'playing', winner: null };
}

const LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

function getWinner(board) {
  for (const [a,b,c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every(Boolean) ? 'draw' : null;
}

function minimax(board, isBot, depth = 0) {
  const result = getWinner(board);
  if (result === 'o') return 10 - depth;
  if (result === 'x') return depth - 10;
  if (result === 'draw') return 0;

  let best = isBot ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (board[i]) continue;
    board[i] = isBot ? 'o' : 'x';
    const score = minimax(board, !isBot, depth + 1);
    board[i] = '';
    best = isBot ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}

function botMove(board) {
  let bestScore = -Infinity;
  let bestIndex = -1;
  for (let i = 0; i < 9; i++) {
    if (board[i]) continue;
    board[i] = 'o';
    const score = minimax(board, false, 1);
    board[i] = '';
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  if (bestIndex >= 0) board[bestIndex] = 'o';
}

function normalizeState(value) {
  if (!value || !Array.isArray(value.b) || value.b.length !== 9) return newGame();
  const board = value.b.map(cell => cell === 'x' || cell === 'o' ? cell : '');
  const winner = getWinner(board);
  return {
    b: board,
    turn: winner ? '' : 'x',
    status: winner === 'draw' ? 'draw' : winner ? 'won' : 'playing',
    winner: winner === 'draw' ? null : winner
  };
}

function parseState(raw) {
  try {
    return normalizeState(JSON.parse(raw || 'null'));
  } catch {
    return newGame();
  }
}

async function sendGame(chatId, replyToMessageId) {
  const payload = {
    chat_id: chatId,
    html: WIDGET_HTML,
    height: 390,
    caption: 'Play Tic-Tac-Toe against the bot. You are X; the bot is O.',
    allow_queries: true,
    chat_data: JSON.stringify(newGame())
  };
  if (replyToMessageId) payload.reply_parameters = { message_id: replyToMessageId };
  await api('sendWidget', payload);
}

async function sendHelp(chatId) {
  await api('sendMessage', {
    chat_id: chatId,
    text: [
      '⭕ Tic-Tac-Toe',
      '',
      'You play as X. The bot plays as O.',
      'Tap a square to make your move. The bot uses minimax, so it will not make a losing mistake.',
      '',
      '/start — send a game',
      '/new — start another game',
      '/help — show these instructions'
    ].join('\n')
  });
}

async function handleMessage(message) {
  if (!message?.text || message.chat?.type !== 'private') return;
  const text = message.text.trim();
  const command = text.split(/\s+/, 1)[0].split('@')[0].toLowerCase();

  if (command === '/start' || command === '/new') {
    try {
      await sendGame(message.chat.id, message.message_id);
    } catch (error) {
      console.error('sendWidget failed:', error.message);
      await api('sendMessage', {
        chat_id: message.chat.id,
        text: `I couldn't send the game widget. Telegram returned: ${error.message}`
      }).catch(err => console.error('Could not send error message:', err.message));
    }
    return;
  }

  if (command === '/help') {
    await sendHelp(message.chat.id);
    return;
  }

  if (command === '/about') {
    await api('sendMessage', {
      chat_id: message.chat.id,
      text: 'A small Tic-Tac-Toe demo built with Telegram HTML Widgets and the official Bot API.'
    });
  }
}

async function handleWidgetQuery(query) {
  // Production widgets are currently supported in private chats only.
  if (!query?.id) return;

  let state = newGame();
  let answer = { ok: false, message: 'Invalid game request.' };

  try {
    if (!query.chat || !query.message_id || query.chat.type !== 'private') {
      answer = { ok: false, message: 'This demo currently supports private chats only.' };
    } else {
      const chatId = query.chat.id;
      const messageId = query.message_id;
      const rawData = query.data || '';

      const message = await api('getChat', { chat_id: chatId });
      if (message.type !== 'private') throw new Error('Private chat required.');

      // The board sent by Telegram is the source of truth for this message.
      // The first query after a fresh send always carries the initial chat_data.
      state = parseState(query.chat_data);
      if (rawData === 'reset') {
        state = newGame();
        answer = { ok: true, message: 'New game started.' };
      } else {
        const match = /^move:([0-8])$/.exec(rawData);
        if (!match) {
          answer = { ok: false, message: 'Unknown move.' };
        } else {
          const index = Number(match[1]);
          if (state.status !== 'playing' || state.turn !== 'x' || state.b[index]) {
            answer = { ok: false, message: 'That move is not available.' };
          } else {
            state.b[index] = 'x';
            let result = getWinner(state.b);
            if (result) {
              state.status = result === 'draw' ? 'draw' : 'won';
              state.winner = result === 'draw' ? null : result;
              state.turn = '';
            } else {
              state.turn = 'o';
              botMove(state.b);
              result = getWinner(state.b);
              if (result) {
                state.status = result === 'draw' ? 'draw' : 'won';
                state.winner = result === 'draw' ? null : result;
                state.turn = '';
              } else {
                state.turn = 'x';
              }
            }
            answer = { ok: true, message: 'Move accepted.' };
          }
        }
      }

      const stateText = JSON.stringify(state);
      await api('editMessageWidgetData', {
        chat_id: chatId,
        message_id: messageId,
        chat_data: stateText
      });
    }
  } catch (error) {
    console.error('Widget query failed:', error.message);
    answer = { ok: false, message: 'The move could not be processed. Try again.' };
  }

  // Telegram requires every widget query to be answered within 15 seconds.
  try {
    await api('answerWidgetQuery', {
      widget_query_id: query.id,
      data: JSON.stringify({ ...answer, state })
    });
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
      data: JSON.stringify({ ok: false, message: 'Shared games are not enabled in this demo.' })
    }).catch(error => console.error('Could not answer shared widget query:', error.message));
  }
}

async function startPolling() {
  const webhook = await api('getWebhookInfo');
  if (webhook.url) {
    throw new Error(`A webhook is currently configured for this bot (${webhook.url}). Remove it in BotFather or call deleteWebhook before using polling.`);
  }

  const me = await api('getMe');
  console.log(`Tic-Tac-Toe bot started as @${me.username || process.env.BOT_USERNAME || 'unknown'}`);
  console.log('Polling for message and widget_query updates…');

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
        try {
          await handleUpdate(update);
        } catch (error) {
          console.error(`Update ${update.update_id} failed:`, error.message);
        }
      }
    } catch (error) {
      console.error('Polling error:', error.message);
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
  }
}

startPolling().catch(error => {
  console.error('Fatal startup error:', error.message);
  process.exit(1);
});
