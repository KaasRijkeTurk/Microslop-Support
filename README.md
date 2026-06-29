# Microslop Support Bot

A powerful Discord bot with AI chat, Minecraft server management, and full Discord server setup capabilities.

---

## Features

- **AI Chat** — Powered by Ollama (local LLM). Chat with the bot in DMs or mention it in any channel.
- **Minecraft Server Integration** — Check server status, players, mods, whitelist, bans, ops and more.
- **RCON Support** — Send RCON commands directly from Discord.
- **Server Setup** — Auto-create channels, roles, and rules with a single command.
- **Welcome System** — Custom welcome messages and auto-roles.
- **Fun Commands** — Roasts, polls, ship calculator, mock text, coinflip and more.

---

## Commands

### ── General ──

| Command | Description |
|---|---|
| `.help` | Show this overview |
| `.uptime` | How long the bot has been running |
| `.purge [1-100 / all] [ww]` | Delete messages |
| `.roast @user` | Roast someone |
| `.poll [vraag] \| [opt1] \| [opt2]` | Create a poll |
| `.coinflip` | Flip a coin |
| `.mock [tekst]` | SpOnGeBoB text |
| `.ship @a @b` | Compatibility check |
| `.userinfo [@user]` | User info |
| `.serverinfo` | Discord server info |
| `.freechat` | Toggle free-chat for this channel |

### ── Server Management ──

| Command | Description |
|---|---|
| `.setup [ww]` | Set up the entire server (channels, roles, rules) |
| `.setwelcome #kanaal` | Set the welcome channel |
| `.setautorole @rol` | Set the auto-role on join |
| `.setwelcomemsg [bericht]` | Customize the welcome message (`{user}` = ping) |

### ── Minecraft ──

| Command | Description |
|---|---|
| `.mchelp` | All Minecraft commands |
| `.mcstatus` | Online/offline + player count |
| `.mcplayers` | Who is online right now |
| `.mcmods` | Installed mods |
| `.mcjoin` | How to join (IP, port, version, mods) |
| `.mcinfo` | Full server info |
| `.mcwhitelist` | Whitelist |
| `.mcbanned` | Banned players |
| `.mcops` | Operators / admins |
| `.mcrcon [commando] [ww]` | Send an RCON command |

---

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Ollama](https://ollama.ai/) running locally with a model (default: `llama3.2`)
- A Discord Bot Token ([create one here](https://discord.com/developers/applications))

### Installation

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd "Microslop Support Bot"

# 2. Install dependencies
npm install

# 3. Create your .env file
cp .env.example .env

# 4. Fill in your values in .env
nano .env
```

### Configuration

Open `.env` and fill in your values:

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Your Discord bot token |
| `MC_HOST` | Minecraft server IP |
| `MC_PORT` | Minecraft server port (default: `25565`) |
| `MC_QUERY_PORT` | Query port (default: `25565`) |
| `MC_RCON_PORT` | RCON port (default: `25575`) |
| `MC_RCON_PASSWORD` | RCON password |
| `MC_SERVER_PATH` | Path to your MC server folder |
| `MC_JOIN_IP` | IP for players to join |
| `MC_RCON_ADMIN_PASSWORD` | Password for `.mcrcon` command |
| `SETUP_PASSWORD` | Password for `.setup` command |

> **Note:** You can also configure values directly in `index.js` under section `// 2. MINECRAFT CONFIGURATIE`. Look for `⚠️` comments.

### Ollama AI

Make sure Ollama is running and you have a model installed:

```bash
ollama pull llama3.2
ollama serve
```

You can change the model name in `index.js` (look for `⚠️ Change this to your Ollama model name`).

---

## Running the Bot

```bash
node index.js
```

---

## Project Structure

```
├── index.js              # Main bot file
├── .env.example          # Environment template
├── server_config.json    # Server config (welcome channel, auto-role, etc.)
├── free_chat_channels.json # Free chat channel list
└── README.md             # This file
```

---

## Important

- Never commit your `.env` file — it's in `.gitignore`.
- Change the default passwords for `.setup` and `.purge` commands in `index.js`.
- Make sure `enable-query=true` is set in your `server.properties` for `.mcplayers` to work properly.

---

## License

MIT

---

*Made with ❤️ for Minecraft communities*
