// === DEPENDENCIES ===
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const Database = require("better-sqlite3");
const { createCanvas, loadImage } = require("canvas");
const { get } = require("https");
const { URL } = require("url");
require("dotenv").config();

// === CONFIGURATION ===
const XP_MIN = 15;
const XP_MAX = 25;
const MESSAGE_COOLDOWN = 60 * 1000; // 1 minute
const DAILY_XP = 250;
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000; // 24 hours
const REP_COOLDOWN = 24 * 60 * 60 * 1000; // 1 rep per day
const SAFE_CHANNEL_ID = "1454085014370390058";
const MAX_MEMBERS_BATCH = 50;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const XP_TRANSFER_FEE = 0.1; // 10% fee for transfers

// Fondo predeterminado VERIFICADO (SIN ESPACIOS)
const DEFAULT_BACKGROUND = "https://i.imgur.com/4L1L4uA.png";

// Fondos públicos disponibles (SIN ESPACIOS)
const PUBLIC_BACKGROUNDS = [
  { name: "Cyber Matrix", url: "https://i.imgur.com/4L1L4uA.png" },
  { name: "Digital Ocean", url: "https://i.imgur.com/6Kk3V9x.png" },
  { name: "Neon Grid", url: "https://i.imgur.com/0JqOQmP.png" }
];

const RANKS = [
  { level: 0, name: "👶 Newbie", color: 0x95a5a6 },
  { level: 1, name: "🟢 Script Kiddie", color: 0x2ecc71 },
  { level: 5, name: "🔵 Junior Hacker", color: 0x3498db },
  { level: 10, name: "🟣 Hacker", color: 0x9b59b6 },
  { level: 15, name: "🟠 Advanced Hacker", color: 0xe67e22 },
  { level: 20, name: "🔴 Elite Hacker", color: 0xe74c3c },
  { level: 30, name: "👑 Cyber God", color: 0xf1c40f }
];

const ACHIEVEMENTS = [
  { id: "first_message", name: "🗣️ First Message", desc: "Sent your first message", emoji: "🗣️" },
  { id: "level_5", name: "🚀 First Big Leap", desc: "Reached level 5", emoji: "🚀" },
  { id: "level_10", name: "💎 Serious Hacker", desc: "Reached level 10", emoji: "💎" },
  { id: "daily_7", name: "🌞 Consistent", desc: "Claimed daily XP for 7 days in a row", emoji: "🌞" },
  { id: "level_30", name: "🤖 Cyber God", desc: "Reached the max level!", emoji: "🤖" },
  { id: "rep_10", name: "❤️ Popular", desc: "Received 10 reputation points", emoji: "❤️" }
];

// === TOKEN VALIDATION ===
if (!process.env.TOKEN) {
  console.error("❌ Error: TOKEN not found in .env");
  process.exit(1);
}

// === DATABASE ===
const db = new Database("levels.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 0,
    last_message INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, guild_id)
  )
`);

const addColumnIfMissing = (table, column, type, defaultValue = 0) => {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type} DEFAULT ${defaultValue}`);
  } catch (e) {}
};

addColumnIfMissing("users", "daily_claimed", "INTEGER", 0);
addColumnIfMissing("users", "rep", "INTEGER", 0);
addColumnIfMissing("users", "rep_last", "INTEGER", 0);
addColumnIfMissing("users", "background", "TEXT", `'${DEFAULT_BACKGROUND}'`);
addColumnIfMissing("users", "remind_level", "INTEGER", 0);

db.exec(`
  CREATE TABLE IF NOT EXISTS achievements (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (user_id, guild_id, achievement_id)
  )
`);

// === UTILS ===
const utils = {
  xpToNextLevel(level) { return 5 * level ** 2 + 50 * level + 100; },
  getRank(level) { return RANKS.slice().reverse().find(r => level >= r.level) || RANKS[0]; },
  xpBar(current, max, size = 10) {
    if (max <= 0) max = 1;
    const ratio = Math.min(1, Math.max(0, current / max));
    const filled = Math.round(ratio * size);
    const empty = size - filled;
    let emoji = "🟩";
    if (ratio < 0.25) emoji = "🟥";
    else if (ratio < 0.5) emoji = "🟧";
    else if (ratio < 0.75) emoji = "🟨";
    return emoji.repeat(filled) + "⬛".repeat(empty);
  },
  async sendTemporaryMessage(channel, content, options = {}) {
    if (!channel) return null;
    try {
      const msg = await channel.send(content, options);
      if (channel.id !== SAFE_CHANNEL_ID) setTimeout(() => msg.delete().catch(() => {}), 10_000);
      return msg;
    } catch { return null; }
  },
  unlockAchievement(userId, guildId, achievementId) {
    try {
      db.prepare("INSERT OR IGNORE INTO achievements (user_id, guild_id, achievement_id) VALUES (?, ?, ?)")
        .run(userId, guildId, achievementId);
      return ACHIEVEMENTS.find(a => a.id === achievementId);
    } catch (e) {
      console.warn("Error unlocking achievement:", e.message);
      return null;
    }
  },
  getAchievements(userId, guildId) {
    return db.prepare("SELECT achievement_id FROM achievements WHERE user_id = ? AND guild_id = ?")
      .all(userId, guildId)
      .map(r => r.achievement_id);
  },
  async updateRankRole(member, newRank) {
    if (!member.manageable) return;
    const guild = member.guild;
    let role = guild.roles.cache.find(r => r.name === newRank.name);
    if (!role) {
      try {
        role = await guild.roles.create({ name: newRank.name, color: newRank.color, reason: "Leveling System" });
      } catch (e) { return; }
    }
    const oldRankRoles = member.roles.cache.filter(r => RANKS.some(rank => rank.name === r.name) && r.id !== role.id);
    try {
      if (oldRankRoles.size > 0) await member.roles.remove(oldRankRoles);
      if (!member.roles.cache.has(role.id)) await member.roles.add(role);
    } catch (e) {}
  },
  async giveXP(member, amount, timestamp = Date.now()) {
    if (!member || member.user.bot) return;
    const { id: userId, guild } = member;
    const guildId = guild.id;
    const user = db.prepare("SELECT * FROM users WHERE user_id = ? AND guild_id = ?").get(userId, guildId);
    if (!user) return;
    let { xp, level } = user;
    xp += amount;
    let leveledUp = false;
    let newLevel = level;
    const xpToNext = utils.xpToNextLevel;
    while (xp >= xpToNext(newLevel)) {
      xp -= xpToNext(newLevel);
      newLevel++;
      leveledUp = true;
    }
    db.prepare("UPDATE users SET xp = ?, level = ?, last_message = ? WHERE user_id = ? AND guild_id = ?")
      .run(xp, newLevel, timestamp, userId, guildId);
    
    // Check for level-up reminder
    const remindLevel = db.prepare("SELECT remind_level FROM users WHERE user_id = ? AND guild_id = ?").get(userId, guildId)?.remind_level || 0;
    if (leveledUp && newLevel === remindLevel) {
      const remindChannel = member;
      try {
        await remindChannel.send(`🔔 **Level ${newLevel} achieved!** Your reminder has been triggered.`);
      } catch {}
    }
    
    if (leveledUp) {
      const newRank = utils.getRank(newLevel);
      await utils.updateRankRole(member, newRank);
      if (newLevel === 5) utils.unlockAchievement(userId, guildId, "level_5");
      if (newLevel === 10) utils.unlockAchievement(userId, guildId, "level_10");
      if (newLevel === 30) utils.unlockAchievement(userId, guildId, "level_30");
      const channel = guild.systemChannel || member;
      try {
        const embed = new EmbedBuilder()
          .setColor(newRank.color)
          .setDescription(
            `🎉 **${member.user.username} leveled up to ${newLevel}!**\n` +
            `🏆 **Rank:** ${newRank.name}\n` +
            `⭐ **XP:** ${utils.xpBar(xp, xpToNext(newLevel))} ${xp}/${xpToNext(newLevel)}`
          )
          .setTimestamp();
        await channel.send({ embeds: [embed] }).catch(() => {});
      } catch {}
    }
  },
  checkDailyStreak(userId, guildId) {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const count = db.prepare(`
      SELECT COUNT(*) as c FROM achievements 
      WHERE user_id = ? AND guild_id = ? 
      AND achievement_id LIKE 'daily_claim_%' 
      AND unlocked_at * 1000 >= ?
    `).get(userId, guildId, Math.floor(weekAgo / 1000))?.c || 0;
    return count >= 7;
  },
  async giveRep(target, giverId, guildId) {
    const now = Date.now();
    const user = db.prepare("SELECT rep_last FROM users WHERE user_id = ? AND guild_id = ?").get(target.id, guildId);
    if (!user) return false;
    if (now - user.rep_last < REP_COOLDOWN) return false;
    db.prepare("UPDATE users SET rep = rep + 1, rep_last = ? WHERE user_id = ? AND guild_id = ?")
      .run(now, target.id, guildId);
    const newRep = db.prepare("SELECT rep FROM users WHERE user_id = ? AND guild_id = ?").get(target.id, guildId)?.rep || 0;
    if (newRep >= 10) utils.unlockAchievement(target.id, guildId, "rep_10");
    return true;
  },
  getServerStats(guildId) {
    const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE guild_id = ?").get(guildId)?.count || 0;
    const totalXP = db.prepare("SELECT SUM(xp) as sum FROM users WHERE guild_id = ?").get(guildId)?.sum || 0;
    const avgLevel = totalUsers > 0 ? (totalXP / totalUsers / 100).toFixed(1) : 0;
    return { totalUsers, avgLevel };
  },
  isValidImageURL(url) {
    if (!url) return false;
    const trimmed = url.trim();
    return trimmed.match(/\.(jpeg|jpg|png)(\?.*)?$/i) !== null;
  },
  async generateProfileImage(member, user) {
    const { level, xp, background } = user;
    const xpNeeded = utils.xpToNextLevel(level);
    const rank = utils.getRank(level);
    const avatarURL = member.displayAvatarURL({ format: 'png', size: 256 });
    const bgUrl = background.trim();
    try {
      const bg = await loadImage(bgUrl);
      const avatar = await loadImage(avatarURL);
      const canvas = createCanvas(900, 300);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bg, 0, 0, 900, 300);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, 0, 900, 300);
      ctx.save();
      ctx.beginPath();
      ctx.arc(150, 150, 100, 0, Math.PI * 2, true);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatar, 50, 50, 200, 200);
      ctx.restore();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 48px Arial';
      ctx.fillText(member.user.username, 280, 100);
      ctx.font = '28px Arial';
      ctx.fillText(`Level ${level} • ${rank.name}`, 280, 150);
      ctx.fillText(`XP: ${xp} / ${xpNeeded}`, 280, 190);
      const barWidth = 500;
      const barHeight = 25;
      const filled = (xp / xpNeeded) * barWidth;
      ctx.fillStyle = '#434343';
      ctx.fillRect(280, 220, barWidth, barHeight);
      ctx.fillStyle = '#' + rank.color.toString(16).padStart(6, '0');
      ctx.fillRect(280, 220, filled, barHeight);
      return canvas.toBuffer();
    } catch (e) {
      console.error("Error generating profile image:", e);
      return null;
    }
  }
};

// === NUEVAS FUNCIONES ===
async function showFullProfile(channel, member) {
  const { id: userId, guild } = member;
  const user = db.prepare("SELECT * FROM users WHERE user_id = ? AND guild_id = ?").get(userId, guild.id);
  if (!user) return;
  const imageBuffer = await utils.generateProfileImage(member, user);
  if (!imageBuffer) {
    const { level, xp, rep } = user;
    const rank = utils.getRank(level);
    const xpNeeded = utils.xpToNextLevel(level);
    const unlockedIds = utils.getAchievements(userId, guild.id);
    const unlocked = ACHIEVEMENTS.filter(a => unlockedIds.includes(a.id));
    const achievementsText = unlocked.length > 0
      ? unlocked.map(a => `${a.emoji} **${a.name}** — ${a.desc}`).join("\n")
      : "None yet. Keep interacting!";
    const embed = new EmbedBuilder()
      .setColor(rank.color)
      .setAuthor({ name: `${member.user.username} • Level ${level}`, iconURL: member.displayAvatarURL() })
      .setThumbnail(member.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "🏆 Rank", value: rank.name, inline: true },
        { name: "⭐ XP", value: `${xp}/${xpNeeded}`, inline: true },
        { name: "❤️ Reputation", value: `${rep}`, inline: true },
        { name: "📊 Progress", value: utils.xpBar(xp, xpNeeded), inline: false },
        { name: `🏅 Achievements (${unlocked.length}/${ACHIEVEMENTS.length})`, value: achievementsText, inline: false }
      )
      .setTimestamp()
      .setFooter({ text: "Use !profile to see this" });
    await channel.send({ embeds: [embed] });
    return;
  }
  await channel.send({
    files: [{ attachment: imageBuffer, name: 'profile.png' }],
    content: `📊 **${member.user.username}'s Profile**`
  });
}

// === CLIENT ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// === COMANDOS EXISTENTES + NUEVOS ===
const commands = {
  // === NUEVOS COMANDOS ===
  async inventory(message, args) {
    const target = message.mentions.members.first() || message.member;
    const user = db.prepare("SELECT * FROM users WHERE user_id = ? AND guild_id = ?").get(target.id, message.guild.id);
    if (!user) {
      return utils.sendTemporaryMessage(message.channel, "❌ This user has no data yet.");
    }
    const unlockedIds = utils.getAchievements(target.id, message.guild.id);
    const unlocked = ACHIEVEMENTS.filter(a => unlockedIds.includes(a.id));
    const embed = new EmbedBuilder()
      .setTitle(`🎒 ${target.user.username}'s Inventory`) // ✅ CORRECTO: target.user.username
      .setColor(0x9b59b6)
      .addFields(
        { name: "⭐ XP", value: `${user.xp}`, inline: true },
        { name: "❤️ Reputation", value: `${user.rep}`, inline: true },
        { name: "🏅 Achievements", value: unlocked.length > 0 
          ? unlocked.map(a => `${a.emoji} ${a.name}`).join("\n")
          : "None yet", inline: false }
      )
      .setThumbnail(target.displayAvatarURL({ size: 64 }));
    await message.channel.send({ embeds: [embed] });
  },

  async give(message, args) {
    const target = message.mentions.members.first();
    const amount = parseInt(args[2] || args[1]);
    if (!target || target.id === message.author.id) {
      return utils.sendTemporaryMessage(message.channel, "❌ Mention another user to give XP.");
    }
    if (isNaN(amount) || amount <= 0) {
      return utils.sendTemporaryMessage(message.channel, "❌ Amount must be a positive number.");
    }
    if (amount > 1000) {
      return utils.sendTemporaryMessage(message.channel, "❌ You can't give more than 1000 XP at once.");
    }
    
    // Get sender's XP
    const sender = db.prepare("SELECT xp FROM users WHERE user_id = ? AND guild_id = ?").get(message.author.id, message.guild.id);
    if (!sender || sender.xp < amount) {
      return utils.sendTemporaryMessage(message.channel, "❌ You don't have enough XP.");
    }
    
    // Calculate fee
    const fee = Math.floor(amount * XP_TRANSFER_FEE);
    const netAmount = amount - fee;
    
    // Deduct from sender
    db.prepare("UPDATE users SET xp = xp - ? WHERE user_id = ? AND guild_id = ?")
      .run(amount, message.author.id, message.guild.id);
    
    // Add to receiver
    db.prepare("INSERT OR IGNORE INTO users (user_id, guild_id) VALUES (?, ?)").run(target.id, message.guild.id);
    db.prepare("UPDATE users SET xp = xp + ? WHERE user_id = ? AND guild_id = ?")
      .run(netAmount, target.id, message.guild.id);
    
    await utils.sendTemporaryMessage(message.channel, 
      `✅ Sent ${netAmount} XP to **${target.user.username}** (${fee} XP fee).`
    );
  },

  async backgrounds(message) {
    const embed = new EmbedBuilder()
      .setTitle("🖼️ Public Backgrounds")
      .setColor(0x3498db)
      .setDescription("Use `!setbg <URL>` to set any of these backgrounds:")
      .addFields(
        PUBLIC_BACKGROUNDS.map(bg => ({
          name: bg.name,
          value: `[View](${bg.url})`,
          inline: true
        }))
      )
      .setFooter({ text: "More backgrounds coming soon!" });
    await message.channel.send({ embeds: [embed] });
  },

  async resetrep(message, args) {
    if (!message.member.permissions.has("Administrator")) return;
    const target = message.mentions.members.first();
    if (!target) {
      return utils.sendTemporaryMessage(message.channel, "❌ Mention a user to reset their reputation.");
    }
    db.prepare("UPDATE users SET rep = 0, rep_last = 0 WHERE user_id = ? AND guild_id = ?")
      .run(target.id, message.guild.id);
    await utils.sendTemporaryMessage(message.channel, `✅ Reset reputation for **${target.user.username}**.`);
  },

  async voice(message) {
    const user = db.prepare("SELECT xp FROM users WHERE user_id = ? AND guild_id = ?").get(message.author.id, message.guild.id);
    if (!user) {
      return utils.sendTemporaryMessage(message.channel, "❌ Send a message first to register.");
    }
    // Simulate voice XP (in a real bot, you'd track voice states)
    const voiceXP = 50;
    await utils.giveXP(message.member, voiceXP);
    await utils.sendTemporaryMessage(message.channel, `✅ +${voiceXP} XP for voice activity!`);
  },

  async remind(message, args) {
    const level = parseInt(args[1]);
    if (isNaN(level) || level < 1 || level > 50) {
      return utils.sendTemporaryMessage(message.channel, "❌ Please specify a valid level (1-50).");
    }
    db.prepare("UPDATE users SET remind_level = ? WHERE user_id = ? AND guild_id = ?")
      .run(level, message.author.id, message.guild.id);
    await utils.sendTemporaryMessage(message.channel, `✅ You'll be notified when you reach level **${level}**!`);
  },

  async compare(message, args) {
    const target = message.mentions.members.first();
    if (!target) {
      return utils.sendTemporaryMessage(message.channel, "❌ Mention a user to compare with.");
    }
    const user1 = db.prepare("SELECT * FROM users WHERE user_id = ? AND guild_id = ?").get(message.author.id, message.guild.id);
    const user2 = db.prepare("SELECT * FROM users WHERE user_id = ? AND guild_id = ?").get(target.id, message.guild.id);
    if (!user1 || !user2) {
      return utils.sendTemporaryMessage(message.channel, "❌ One of the users has no data yet.");
    }
    const rank1 = utils.getRank(user1.level);
    const rank2 = utils.getRank(user2.level);
    const embed = new EmbedBuilder()
      .setTitle("⚖️ XP Comparison")
      .setColor(0xe74c3c)
      .addFields(
        {
          name: `${message.author.username} (You)`, // ✅ CORRECTO: message.author.username (NO .user)
          value: `Level ${user1.level} • ${rank1.name}\nXP: ${user1.xp}`,
          inline: true
        },
        {
          name: `${target.user.username}`, // ✅ CORRECTO: target.user.username
          value: `Level ${user2.level} • ${rank2.name}\nXP: ${user2.xp}`,
          inline: true
        },
        {
          name: "Difference",
          value: `Level: ${Math.abs(user1.level - user2.level)}\nXP: ${Math.abs(user1.xp - user2.xp)}`,
          inline: false
        }
      )
      .setThumbnail(message.author.displayAvatarURL({ size: 64 }));
    await message.channel.send({ embeds: [embed] });
  },

  async shop(message) {
    const embed = new EmbedBuilder()
      .setTitle("🛒 Premium Shop")
      .setColor(0xf1c40f)
      .setDescription("Special backgrounds available for purchase:")
      .addFields(
        { name: "Golden Matrix", value: "5000 XP - `!buy golden`", inline: false },
        { name: "VIP Cyber", value: "10000 XP - `!buy vip`", inline: false }
      )
      .setFooter({ text: "More items coming soon!" });
    await message.channel.send({ embeds: [embed] });
  },

  async buy(message, args) {
    const item = args[1]?.toLowerCase();
    const prices = { golden: 5000, vip: 10000 };
    const backgrounds = { 
      golden: "https://i.imgur.com/golden-bg.png", // ✅ SIN ESPACIOS
      vip: "https://i.imgur.com/vip-bg.png" // ✅ SIN ESPACIOS
    };
    
    if (!item || !prices[item]) {
      return utils.sendTemporaryMessage(message.channel, "❌ Invalid item. Use `!shop` to see available items.");
    }
    
    const user = db.prepare("SELECT xp FROM users WHERE user_id = ? AND guild_id = ?").get(message.author.id, message.guild.id);
    if (!user || user.xp < prices[item]) {
      return utils.sendTemporaryMessage(message.channel, `❌ You need ${prices[item]} XP to buy this item.`);
    }
    
    // Deduct XP and set background
    db.prepare("UPDATE users SET xp = xp - ?, background = ? WHERE user_id = ? AND guild_id = ?")
      .run(prices[item], backgrounds[item], message.author.id, message.guild.id);
    
    await utils.sendTemporaryMessage(message.channel, `✅ Purchased ${item} background! Use \`!profile\` to see it.`);
  },

  // === COMANDOS EXISTENTES (sin cambios) ===
  async setbg(message, args) {
    if (args.length < 2) {
      return utils.sendTemporaryMessage(message.channel, "❌ Usage: `!setbg <image_url>`\nSupported: .png, .jpg, .jpeg");
    }
    const url = args[1].trim();
    if (!utils.isValidImageURL(url)) {
      return utils.sendTemporaryMessage(message.channel, "❌ Invalid image URL. Must end with .png, .jpg, or .jpeg");
    }
    db.prepare("UPDATE users SET background = ? WHERE user_id = ? AND guild_id = ?")
      .run(url, message.author.id, message.guild.id);
    await utils.sendTemporaryMessage(message.channel, "✅ Background updated!");
  },

  async resetbg(message) {
    db.prepare("UPDATE users SET background = ? WHERE user_id = ? AND guild_id = ?")
      .run(DEFAULT_BACKGROUND, message.author.id, message.guild.id);
    await utils.sendTemporaryMessage(message.channel, "✅ Background reset to default.");
  },

  async ping(message) {
    const sent = await message.channel.send("🏓 Pinging...");
    const ping = sent.createdTimestamp - message.createdTimestamp;
    await sent.edit(`🏓 Pong! Latency: **${ping}ms** | API: **${client.ws.ping}ms**`);
    if (message.channel.id !== SAFE_CHANNEL_ID) {
      setTimeout(() => sent.delete().catch(() => {}), 10_000);
    }
  },

  async info(message) {
    const { totalUsers, avgLevel } = utils.getServerStats(message.guild.id);
    const embed = new EmbedBuilder()
      .setTitle("ℹ️ System Information")
      .setColor(0x55acee)
      .addFields(
        { name: "Bot Version", value: "3.0.0", inline: true },
        { name: "Active Users", value: `${totalUsers}`, inline: true },
        { name: "Avg Server Level", value: `${avgLevel}`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: "Leveling System with Premium Features" });
    await message.channel.send({ embeds: [embed] });
  },

  async rank(message, args) {
    const target = message.mentions.members.first() || message.member;
    const user = db.prepare("SELECT * FROM users WHERE user_id = ? AND guild_id = ?").get(target.id, message.guild.id);
    if (!user) {
      return utils.sendTemporaryMessage(message.channel, "❌ This user has no data yet.");
    }
    const { level, xp } = user;
    const rank = utils.getRank(level);
    const xpNeeded = utils.xpToNextLevel(level);
    const embed = new EmbedBuilder()
      .setColor(rank.color)
      .setDescription(`📊 **${target.user.username}** • Level ${level} • ${rank.name}\n${utils.xpBar(xp, xpNeeded)} ${xp}/${xpNeeded}`);
    const msg = await message.channel.send({ embeds: [embed] });
    await msg.react("📊").catch(() => {});
    const filter = (reaction, user) => reaction.emoji.name === "📊" && !user.bot;
    const collector = msg.createReactionCollector({ filter, time: 60_000 });
    collector.on("collect", async (reaction, reactor) => {
      const member = await message.guild.members.fetch(reactor.id).catch(() => null);
      if (member) await showFullProfile(message.channel, member);
    });
  },

  async profile(message, args) {
    const target = message.mentions.members.first() || message.member;
    await showFullProfile(message.channel, target);
  },

  async daily(message, args) {
    const now = Date.now();
    const user = db.prepare("SELECT * FROM users WHERE user_id = ? AND guild_id = ?").get(message.author.id, message.guild.id);
    if (!user) {
      return utils.sendTemporaryMessage(message.channel, "❌ Send a message first to register.");
    }
    if (now - user.daily_claimed < DAILY_COOLDOWN) {
      const mins = Math.ceil((DAILY_COOLDOWN - (now - user.daily_claimed)) / 60_000);
      return utils.sendTemporaryMessage(message.channel, `⏳ You already claimed your daily XP. Come back in **${mins} minute(s)**.`);
    }
    db.prepare("UPDATE users SET xp = xp + ?, daily_claimed = ? WHERE user_id = ? AND guild_id = ?")
      .run(DAILY_XP, now, message.author.id, message.guild.id);
    db.prepare("INSERT INTO achievements (user_id, guild_id, achievement_id) VALUES (?, ?, ?)")
      .run(message.author.id, message.guild.id, `daily_claim_${Math.floor(now / 1000)}`);
    if (utils.checkDailyStreak(message.author.id, message.guild.id)) {
      utils.unlockAchievement(message.author.id, message.guild.id, "daily_7");
    }
    await utils.sendTemporaryMessage(message.channel, `✅ You claimed your daily XP! (+${DAILY_XP} XP)`);
  },

  async rep(message, args) {
    const target = message.mentions.members.first();
    if (!target || target.id === message.author.id) {
      return utils.sendTemporaryMessage(message.channel, "❌ Mention another user to give them reputation.");
    }
    const success = await utils.giveRep(target, message.author.id, message.guild.id);
    if (success) {
      await utils.sendTemporaryMessage(message.channel, `✅ You gave +1 reputation to **${target.user.username}**!`);
    } else {
      await utils.sendTemporaryMessage(message.channel, "⏳ You already gave reputation today. Come back in 24 hours.");
    }
  },

  async stats(message, args) {
    const target = message.mentions.members.first() || message.member;
    const user = db.prepare("SELECT * FROM users WHERE user_id = ? AND guild_id = ?").get(target.id, message.guild.id);
    if (!user) {
      return utils.sendTemporaryMessage(message.channel, "❌ This user has no data yet.");
    }
    const { xp, level, rep } = user;
    const { totalUsers } = utils.getServerStats(message.guild.id);
    const rankPosition = db.prepare(`
      SELECT COUNT(*) as pos FROM users 
      WHERE guild_id = ? AND (level > ? OR (level = ? AND xp > ?))
    `).get(message.guild.id, level, level, xp)?.pos + 1 || totalUsers;
    const embed = new EmbedBuilder()
      .setTitle(`📊 Stats for ${target.user.username}`)
      .setColor(0x00ff00)
      .addFields(
        { name: "Level", value: `${level}`, inline: true },
        { name: "Total XP", value: `${xp}`, inline: true },
        { name: "Reputation", value: `${rep}`, inline: true },
        { name: "Rank Position", value: `#${rankPosition} of ${totalUsers}`, inline: false }
      )
      .setThumbnail(target.displayAvatarURL());
    await message.channel.send({ embeds: [embed] });
  },

  async ranks(message) {
    const embed = new EmbedBuilder()
      .setTitle("🏆 Server Ranks")
      .setColor(0x55acee)
      .setDescription(RANKS.map(r => `**Level ${r.level}**: ${r.name}`).join("\n"))
      .setFooter({ text: "Level up by sending messages!" });
    await message.channel.send({ embeds: [embed] });
  },

  async top(message, args) {
    const page = parseInt(args[1]) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    const top = db.prepare(`
      SELECT user_id, level, xp
      FROM users
      WHERE guild_id = ?
      ORDER BY level DESC, xp DESC
      LIMIT ? OFFSET ?
    `).all(message.guild.id, limit, offset);
    const total = db.prepare("SELECT COUNT(*) as count FROM users WHERE guild_id = ?").get(message.guild.id)?.count || 0;
    const totalPages = Math.ceil(total / limit);
    if (!top.length) {
      return utils.sendTemporaryMessage(message.channel, "📊 No data yet.");
    }
    const embed = new EmbedBuilder()
      .setTitle(`🏆 Leaderboard (Page ${page}/${totalPages})`)
      .setColor(RANKS[RANKS.length - 1].color)
      .setTimestamp();
    const medals = ["🥇", "🥈", "🥉"];
    for (let i = 0; i < top.length; i++) {
      const { user_id, level, xp } = top[i];
      const member = await message.guild.members.fetch(user_id).catch(() => null);
      const username = member ? member.user.username : "Unknown User";
      const rank = utils.getRank(level);
      const xpNeeded = utils.xpToNextLevel(level);
      const position = offset + i + 1;
      const medal = position <= 3 ? medals[position - 1] : `🔹 ${position}.`;
      embed.addFields({
        name: `${medal} ${username}`,
        value: `**${rank.name}** • Level ${level}\n${utils.xpBar(xp, xpNeeded)} ${xp}/${xpNeeded}`,
        inline: false
      });
    }
    const msg = await message.channel.send({ embeds: [embed] });
    if (totalPages > 1) {
      await msg.react("⬅️").catch(() => {});
      await msg.react("➡️").catch(() => {});
      const filter = (reaction, user) => ["⬅️", "➡️"].includes(reaction.emoji.name) && !user.bot;
      const collector = msg.createReactionCollector({ filter, time: 60_000 });
      collector.on("collect", async (reaction, user) => {
        if (reaction.emoji.name === "⬅️" && page > 1) {
          args[1] = page - 1;
          await commands.top(message, args);
          msg.delete().catch(() => {});
        } else if (reaction.emoji.name === "➡️" && page < totalPages) {
          args[1] = page + 1;
          await commands.top(message, args);
          msg.delete().catch(() => {});
        }
        reaction.users.remove(user).catch(() => {});
      });
    }
  },

  async addxp(message, args) {
    if (!message.member.permissions.has("Administrator")) return;
    const target = message.mentions.members.first();
    const amount = parseInt(args[2] || args[1]);
    if (!target || isNaN(amount) || amount <= 0) {
      return utils.sendTemporaryMessage(message.channel, "❌ Usage: `!addxp @user <amount>`");
    }
    db.prepare("INSERT OR IGNORE INTO users (user_id, guild_id) VALUES (?, ?)").run(target.id, message.guild.id);
    await utils.giveXP(target, amount);
    await utils.sendTemporaryMessage(message.channel, `✅ Added ${amount} XP to **${target.user.username}**.`);
  },

  async addxpall(message, args) {
    if (!message.member.permissions.has("Administrator")) return;
    const amount = parseInt(args[1]);
    if (isNaN(amount) || amount <= 0) {
      return utils.sendTemporaryMessage(message.channel, "❌ Invalid amount.");
    }
    const userIds = db.prepare("SELECT user_id FROM users WHERE guild_id = ? LIMIT ?")
                       .all(message.guild.id, MAX_MEMBERS_BATCH)
                       .map(r => r.user_id);
    let count = 0;
    for (const id of userIds) {
      const member = await message.guild.members.fetch(id).catch(() => null);
      if (member && !member.user.bot) {
        await utils.giveXP(member, amount);
        count++;
      }
    }
    await utils.sendTemporaryMessage(message.channel, `✅ Gave ${amount} XP to **${count}** members.`);
  },

  async resetdaily(message, args) {
    if (!message.member.permissions.has("Administrator")) return;
    const target = message.mentions.members.first();
    if (!target) {
      return utils.sendTemporaryMessage(message.channel, "❌ Mention a user to reset their daily cooldown.");
    }
    db.prepare("UPDATE users SET daily_claimed = 0 WHERE user_id = ? AND guild_id = ?")
      .run(target.id, message.guild.id);
    await utils.sendTemporaryMessage(message.channel, `✅ Reset daily cooldown for **${target.user.username}**.`);
  },

  async reset(message, args) {
    if (!message.member.permissions.has("Administrator")) return;
    if (args[1] === "all") {
      db.prepare("DELETE FROM users WHERE guild_id = ?").run(message.guild.id);
      db.prepare("DELETE FROM achievements WHERE guild_id = ?").run(message.guild.id);
      return utils.sendTemporaryMessage(message.channel, "✅ All progress has been reset.");
    }
    const target = message.mentions.members.first();
    if (!target) {
      return utils.sendTemporaryMessage(message.channel, "❌ Mention a user to reset.");
    }
    db.prepare("UPDATE users SET xp = 0, level = 0, background = ? WHERE user_id = ? AND guild_id = ?")
      .run(DEFAULT_BACKGROUND, target.id, message.guild.id);
    db.prepare("DELETE FROM achievements WHERE user_id = ? AND guild_id = ?").run(target.id, message.guild.id);
    await utils.sendTemporaryMessage(message.channel, `✅ Reset progress for **${target.user.username}**.`);
  },

  async help(message) {
    const embed = new EmbedBuilder()
      .setTitle("📜 Leveling System Commands")
      .setColor(0x00ffff)
      .setDescription(`
**User Commands:**
• \`!rank\` [@user] — View rank
• \`!profile\` [@user] — View full profile
• \`!inventory\` — View your achievements
• \`!daily\` / \`!claim\` — Claim daily XP (+${DAILY_XP})
• \`!rep\` @user — Give reputation (1/day)
• \`!give\` @user <amount> — Transfer XP (10% fee)
• \`!voice\` — Get XP for voice activity
• \`!remind\` <level> — Set level-up reminder
• \`!compare\` @user — Compare stats
• \`!backgrounds\` — View public backgrounds
• \`!shop\` / \`!buy\` — Premium backgrounds
• \`!stats\` — View detailed stats
• \`!top\` [page] — View leaderboard
• \`!ranks\` — View all ranks
• \`!ping\` — Check bot latency
• \`!info\` — System information

**Admin Commands:**
• \`!addxp\` @user <amount>
• \`!addxpall\` <amount>
• \`!resetdaily\` @user
• \`!resetrep\` @user
• \`!reset\` [@user / all]
      `)
      .setFooter({ text: "Messages give XP every minute." });
    await utils.sendTemporaryMessage(message.channel, { embeds: [embed] });
  }
};

// Aliases
commands.claim = commands.daily;
commands.leaderboard = commands.top;

// === EVENTS ===
client.once("ready", () => {
  console.log(`✅ ${client.user.tag} is online with Premium Features!`);
  client.user.setActivity("with 20+ commands 💯", { type: "PLAYING" });
});

client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;
  const content = message.content.trim();
  if (!content) return;
  const args = content.split(/\s+/);
  const cmd = args[0].toLowerCase();
  const existed = db.prepare("SELECT 1 FROM users WHERE user_id = ? AND guild_id = ?")
                    .get(message.author.id, message.guild.id);
  db.prepare("INSERT OR IGNORE INTO users (user_id, guild_id, background) VALUES (?, ?, ?)")
    .run(message.author.id, message.guild.id, DEFAULT_BACKGROUND);
  if (!existed) {
    utils.unlockAchievement(message.author.id, message.guild.id, "first_message");
  }
  if (cmd.startsWith("!")) {
    const commandName = cmd.slice(1);
    if (commands[commandName]) {
      try {
        await commands[commandName](message, args);
      } catch (error) {
        console.error("Command error:", error);
        await utils.sendTemporaryMessage(message.channel, "❌ An error occurred.");
      }
      return;
    }
  }
  const now = Date.now();
  const user = db.prepare("SELECT last_message FROM users WHERE user_id = ? AND guild_id = ?")
                  .get(message.author.id, message.guild.id);
  if (user && now - user.last_message >= MESSAGE_COOLDOWN) {
    const xp = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;
    await utils.giveXP(message.member, xp, now);
  }
});

client.login(process.env.TOKEN).catch(err => {
  console.error("❌ Login error:", err.message);
  process.exit(1);
});