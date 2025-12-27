# Discord Level Bot

A comprehensive Discord leveling system with XP, ranks, achievements, and premium features.

## Features

- **Level System**: Users gain XP by sending messages
- **Rank Tracking**: Automatic role assignment based on level
- **Achievements**: Unlock special badges as you progress
- **Leaderboards**: View top users on the server
- **Profile Images**: Customizable profile cards with backgrounds
- **Reputation System**: Give reputation to other users
- **Daily Rewards**: Claim daily XP bonuses
- **XP Transfer**: Send XP to other users (with transfer fee)
- **Premium Shop**: Purchase special backgrounds with earned XP
- **Level Reminders**: Get notified when reaching specific levels
- **User Stats**: Detailed statistics and comparison tools

## Commands

### User Commands
- `!rank` [@user] — View rank
- `!profile` [@user] — View full profile
- `!inventory` — View your achievements
- `!daily` / `!claim` — Claim daily XP (+250)
- `!rep` @user — Give reputation (1/day)
- `!give` @user <amount> — Transfer XP (10% fee)
- `!voice` — Get XP for voice activity
- `!remind` <level> — Set level-up reminder
- `!compare` @user — Compare stats
- `!backgrounds` — View public backgrounds
- `!shop` / `!buy` — Premium backgrounds
- `!stats` — View detailed stats
- `!top` [page] — View leaderboard
- `!ranks` — View all ranks
- `!ping` — Check bot latency
- `!info` — System information

### Admin Commands
- `!addxp` @user <amount>
- `!addxpall` <amount>
- `!resetdaily` @user
- `!resetrep` @user
- `!reset` [@user / all]

## Setup

1. Create a `.env` file with your bot token:
```
TOKEN=your_discord_bot_token_here
SAFE_CHANNEL_ID=your_safe_channel_id
```

2. Install dependencies:
```bash
npm install discord.js@latest better-sqlite3 canvas dotenv
```

3. Run the bot:
```bash
node index.js
```

## Configuration

The bot can be configured by modifying the constants at the top of the file:
- `XP_MIN` / `XP_MAX`: Range of XP given per message
- `MESSAGE_COOLDOWN`: Time between XP gains from messages
- `DAILY_XP`: Amount of XP given for daily rewards
- `XP_TRANSFER_FEE`: Percentage fee for XP transfers
- And more!

## Database Schema

The bot uses SQLite with two tables:
- `users`: Stores user XP, level, and settings
- `achievements`: Tracks unlocked achievements

## Customization

- Modify `RANKS` array to change level requirements and names
- Add new achievements to the `ACHIEVEMENTS` array
- Update `PUBLIC_BACKGROUNDS` with your own image URLs
- Customize XP formulas in `utils.xpToNextLevel()`