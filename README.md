# Telegram Tic-Tac-Toe Widget

A minimal Telegram bot that sends an interactive Tic-Tac-Toe HTML Widget directly inside a Telegram message using the Bot API `sendWidget` method.

The player is **X** and the bot is **O**. The bot validates every move, chooses its response with minimax, and writes the authoritative board to Telegram's `chat_data` using `editMessageWidgetData`.

## Requirements

- Node.js 24+
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A Telegram client with HTML Widget support

## Setup

1. Copy `.env.example` to `.env`.
2. Set `BOT_TOKEN` to your bot token.
3. Run `npm start`.

No external npm dependencies are required. The project uses Node.js built-in `fetch` and the official Telegram Bot API directly, so it can call the new widget methods without waiting for a wrapper library to add them.

## Commands

- `/start` — send a new game widget.
- `/new` — send another game.
- `/help` — show instructions.

## How the widget works

1. `sendWidget` sends the self-contained HTML/CSS/JS widget.
2. A cell tap calls `TelegramWidget.request("move:N")`.
3. Telegram delivers a `widget_query` update to the bot.
4. The bot validates the move, runs minimax for O, and updates `chat_data` with `editMessageWidgetData`.
5. The bot answers the widget query with the updated state.

The widget has no network access. All game decisions and authoritative state changes happen in the bot.

## Deployment

For Railway:
- Create a Node.js service from this repository.
- Add the `BOT_TOKEN` environment variable.
- Add a Railway Volume mounted at `/app/data`.
- Set `DATA_DIR=/app/data` so game sessions survive restarts.
- Use the start command `npm start`.

Use one running replica because this prototype uses long polling. Do not run the same bot token in another polling process at the same time. Without a persistent volume, active game sessions are lost when the service restarts.

## Production availability

Telegram currently supports sending widgets in production only in private chats with the bot. Group, inline and forwarded-widget scenarios are not part of this prototype.

Official references:
- https://core.telegram.org/bots/widgets
- https://core.telegram.org/bots/api#sendwidget
- https://core.telegram.org/bots/api#answerwidgetquery
- https://core.telegram.org/bots/api#editmessagewidgetdata
