require("dotenv").config();

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ChannelType } = require("discord.js");
const { status, queryFull } = require("minecraft-server-util");
const { Rcon } = require("rcon-client");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,      
    GatewayIntentBits.MessageContent,     
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// 1. STATE & CONFIGURATIE
const cooldown = new Set();
const conversations = {};
const startTime = Date.now();

const FREE_CHAT_FILE   = "./free_chat_channels.json";
const SERVER_CONFIG    = "./server_config.json";

let freeChatChannels = new Set();
let serverConfig = {
  welcomeChannelId: null,
  autoRoleId: null,
  welcomeMessage: "Welkom op de server {user}! 🎉 Lees de regels in <#RULES_CHANNEL> en veel plezier.",
};

function loadConfig() {
  try {
    if (fs.existsSync(FREE_CHAT_FILE)) {
      freeChatChannels = new Set(JSON.parse(fs.readFileSync(FREE_CHAT_FILE, "utf-8")));
    }
  } catch (err) {
    console.error("⚠️ Kon free_chat_channels.json niet laden:", err.message);
    freeChatChannels = new Set();
  }

  try {
    if (fs.existsSync(SERVER_CONFIG)) {
      serverConfig = { ...serverConfig, ...JSON.parse(fs.readFileSync(SERVER_CONFIG, "utf-8")) };
    }
  } catch (err) {
    console.error("⚠️ Kon server_config.json niet laden:", err.message);
  }
}

function saveFreeChatChannels() {
  fs.writeFileSync(FREE_CHAT_FILE, JSON.stringify([...freeChatChannels]), "utf-8");
}

function saveServerConfig() {
  fs.writeFileSync(SERVER_CONFIG, JSON.stringify(serverConfig, null, 2), "utf-8");
}

loadConfig();

// 2. MINECRAFT CONFIGURATIE
// ⚠️ Put your Minecraft server IP here (e.g., "123.456.789.10" or "play.myserver.com")
const MC_HOST                = process.env.MC_HOST                || "";
// ⚠️ Put your Minecraft server port here (default: 25565)
const MC_PORT                = parseInt(process.env.MC_PORT       || "25565", 10);
// ⚠️ Put your Minecraft query port here (default: 25565)
const MC_QUERY_PORT          = parseInt(process.env.MC_QUERY_PORT || "25565", 10);
// ⚠️ Put your Minecraft RCON port here (default: 25575)
const MC_RCON_PORT           = parseInt(process.env.MC_RCON_PORT  || "25575", 10);
// ⚠️ Put your RCON password here
const MC_RCON_PASS           = process.env.MC_RCON_PASSWORD       || "";
// ⚠️ Put your Minecraft server folder path here (default: "./ctserver")
const MC_SERVER_PATH         = process.env.MC_SERVER_PATH         || "./ctserver";
// ⚠️ Put the IP address users should use to join your server (e.g., "play.myserver.com")
const MC_JOIN_IP             = process.env.MC_JOIN_IP             || "";
// ⚠️ Put your RCON admin password here (used for .mcrcon command)
const MC_RCON_ADMIN_PASSWORD = process.env.MC_RCON_ADMIN_PASSWORD || "";


// 3. SERVER STRUCTUUR DEFINITIE
const SERVER_STRUCTURE = {
  roles: [
    { name: "⭐ Eigenaar",   color: "#FFD700", hoist: true,  permissions: ["Administrator"] },
    { name: "🛡️ Admin",      color: "#E74C3C", hoist: true,  permissions: ["ManageGuild", "ManageChannels", "ManageRoles", "KickMembers", "BanMembers"] },
    { name: "🎮 Lid",        color: "#5865F2", hoist: false, permissions: [] },
    { name: "🆕 Nieuweling", color: "#99AAB5", hoist: false, permissions: [] },
  ],
  categories: [
    {
      name: "📢 INFO",
      channels: [
        { name: "📋・regels", type: "text", topic: "Lees dit even door", readOnly: true },
        { name: "👋・welkom", type: "text", topic: "Welkomstberichten", readOnly: true },
      ],
    },
    {
      name: "💬 ALGEMEEN",
      channels: [
        { name: "💬・chat",   type: "text", topic: "Praat over alles", readOnly: false },
        { name: "😂・memes",  type: "text", topic: "Memes en media",   readOnly: false },
        { name: "🎙️・spraak", type: "voice" },
      ],
    },
    {
      name: "🎮 GAMING",
      channels: [
        { name: "🎮・gaming",    type: "text", topic: "Games, clips, alles", readOnly: false },
        { name: "⛏️・minecraft", type: "text", topic: "MC server info en coördinaten", readOnly: false },
        { name: "🤖・bot",       type: "text", topic: "Bot commands", readOnly: false },
        { name: "🎯・voice",     type: "voice" },
      ],
    },
  ],
};


// 4. HELPER FUNCTIES
const POLL_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

function formatUptime(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}u ${m % 60}m`;
  if (h > 0) return `${h}u ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function mockText(text) {
  return text.split("").map((c, i) => (i % 2 === 0 ? c.toLowerCase() : c.toUpperCase())).join("");
}

async function updatePresence() {
  try {
    const s = await getMCStatus();
    const online = s.players?.online ?? 0;
    const max = s.players?.max ?? 0;
    client.user.setActivity(`🟢 MC Online: ${online}/${max} | .help`, { type: 3 }); // Type 3 = Watching / Aan het kijken
  } catch (err) {
    client.user.setActivity(`🔴 MC Server Offline | .help`, { type: 3 });
  }
}

// 5. SERVER SETUP LOGICA
async function setupServer(guild, progressMsg) {
  const log = async (text) => {
    await progressMsg.edit(progressMsg.content + "\n" + text).catch(() => {});
  };

  await log("🔄 **Stap 1/4:** Rollen aanmaken...");
  const createdRoles = {};
  for (const roleDef of SERVER_STRUCTURE.roles) {
    const bestaand = guild.roles.cache.find((r) => r.name === roleDef.name);
    if (bestaand) {
      createdRoles[roleDef.name] = bestaand;
      continue;
    }
    const perms = roleDef.permissions.length > 0
      ? new PermissionsBitField(roleDef.permissions.map((p) => PermissionsBitField.Flags[p]))
      : new PermissionsBitField(0n);
    const role = await guild.roles.create({
      name: roleDef.name,
      color: roleDef.color,
      hoist: roleDef.hoist,
      permissions: perms,
    });
    createdRoles[roleDef.name] = role;
  }
  await log(`✅ ${Object.keys(createdRoles).length} rollen verwerkt.`);

  if (!serverConfig.autoRoleId && createdRoles["🆕 Nieuweling"]) {
    serverConfig.autoRoleId = createdRoles["🆕 Nieuweling"].id;
    saveServerConfig();
  }

  await log("🔄 **Stap 2/4:** Categorieën en kanalen aanmaken...");
  let aantalKanalen = 0;
  let welcomeChannelId = null;
  let rulesChannelId = null;
  const everyoneRole = guild.roles.everyone;

  for (const catDef of SERVER_STRUCTURE.categories) {
    let category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === catDef.name);
    if (!category) {
      category = await guild.channels.create({ name: catDef.name, type: ChannelType.GuildCategory });
    }

    for (const chDef of catDef.channels) {
      const isVoice = chDef.type === "voice";
      const channelType = isVoice ? ChannelType.GuildVoice : ChannelType.GuildText;
      const bestaand = guild.channels.cache.find((c) => c.name === chDef.name && c.parentId === category.id);
      
      if (bestaand) { 
        aantalKanalen++; 
        if (chDef.name.includes("welkom")) welcomeChannelId = bestaand.id;
        if (chDef.name.includes("regels")) rulesChannelId = bestaand.id;
        continue; 
      }

      const permOverwrites = [];
      if (chDef.readOnly && !isVoice) {
        permOverwrites.push({
          id: everyoneRole.id,
          deny: [PermissionsBitField.Flags.SendMessages],
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
        });
      }

      const ch = await guild.channels.create({
        name: chDef.name,
        type: channelType,
        parent: category.id,
        topic: chDef.topic || "",
        permissionOverwrites: permOverwrites,
      });

      if (chDef.name.includes("welkom")) welcomeChannelId = ch.id;
      if (chDef.name.includes("regels")) rulesChannelId = ch.id;
      aantalKanalen++;
    }
  }
  await log(`✅ ${aantalKanalen} kanalen verwerkt.`);

  await log("🔄 **Stap 3/4:** Welkomstkanaal configureren...");
  if (welcomeChannelId && !serverConfig.welcomeChannelId) {
    serverConfig.welcomeChannelId = welcomeChannelId;
    saveServerConfig();
  }

  await log("🔄 **Stap 4/4:** Regels placing...");
  if (rulesChannelId) {
    const rulesChannel = guild.channels.cache.get(rulesChannelId);
    if (rulesChannel) {
      const recentMessages = await rulesChannel.messages.fetch({ limit: 5 });
      const alBestaand = recentMessages.find((m) => m.author.id === client.user.id);
      if (!alBestaand) {
        const rulesEmbed = new EmbedBuilder()
          .setTitle("📋 Server Regels")
          .setColor("#5865F2")
          .setDescription("Welkom op de server! Hier zijn de regels:")
          .addFields(
            { name: "1️⃣ Respect", value: "Behandel iedereen met respect. Geen pesten, discriminatie of toxisch gedrag." },
            { name: "2️⃣ Geen spam", value: "Stuur geen spam, herhalende berichten of onnodige pings." },
            { name: "3️⃣ Juist kanaal", value: "Gebruik de juiste kanalen voor de juiste onderwerpen." },
            { name: "4️⃣ Geen NSFW", value: "Geen ongepaste of expliciete content buiten de daarvoor bestemde kanalen." },
            { name: "5️⃣ Luister naar staff", value: "Volg de aanwijzingen van admins en moderators op." },
            { name: "6️⃣ Minecraft server", value: "Geen griefing, cheaten of stelen op de Minecraft server." }
          )
          .setFooter({ text: "Door te joinen ga je akkoord met deze regels." })
          .setTimestamp();
        await rulesChannel.send({ embeds: [rulesEmbed] });
      }
    }
  }

  await log("\n✅ **Server setup succesvol afgerond!**");
  await log(`📌 Welkomstkanaal: <#${serverConfig.welcomeChannelId || "Niet ingesteld"}>`);
  await log(`🎭 Auto-rol: ${serverConfig.autoRoleId ? `<@&${serverConfig.autoRoleId}>` : "Niet ingesteld"}`);
}

// 6. MINECRAFT HELPERS
function readServerProperties() {
  try {
    const file = path.join(MC_SERVER_PATH, "server.properties");
    const content = fs.readFileSync(file, "utf-8");
    const props = {};
    for (const line of content.split("\n")) {
      if (line.startsWith("#") || !line.includes("=")) continue;
      const [key, ...rest] = line.split("=");
      props[key.trim()] = rest.join("=").trim();
    }
    return props;
  } catch (err) { 
    console.error("⚠️ Kon server.properties niet lezen:", err.message);
    return null; 
  }
}

function getMods() {
  try {
    const AdmZip = require("adm-zip");
    // ⚠️ Put your modpack file name here (e.g., "Beek SMP 1.6.mrpack")
    const zip = new AdmZip("your_modpack.mrpack");
    const json = JSON.parse(zip.readAsText("modrinth.index.json"));
    return json.files.map((f) => f.path.split("/").pop().replace(/\.jar$/i, ""));
  } catch (err) { 
    return []; 
  }
}

function getWhitelist() {
  try {
    const file = path.join(MC_SERVER_PATH, "whitelist.json");
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, "utf-8")).map((e) => e.name);
  } catch { return []; }
}

function getBannedPlayers() {
  try {
    const file = path.join(MC_SERVER_PATH, "banned-players.json");
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, "utf-8")).map((e) => ({ name: e.name, reason: e.reason }));
  } catch { return []; }
}

function getOps() {
  try {
    const file = path.join(MC_SERVER_PATH, "ops.json");
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, "utf-8")).map((e) => e.name);
  } catch { return []; }
}

async function getMCStatus() { return await status(MC_HOST, MC_PORT, { timeout: 5000 }); }
async function getMCQuery()  { return await queryFull(MC_HOST, MC_QUERY_PORT, { timeout: 5000 }); }

async function sendRcon(command) {
  const rcon = new Rcon({ host: MC_HOST, port: MC_RCON_PORT, password: MC_RCON_PASS });
  await rcon.connect();
  const result = await rcon.send(command);
  await rcon.end();
  return result;
}

// 7. OLLAMA AI HELPERS
async function getIntroForUser(guild, userId) {
  try {
    const introChannel = guild.channels.cache.find(
      (c) => c.name === "introduceer-jezelf" || c.name === "introduce-yourself" || c.name.includes("welkom")
    );
    if (!introChannel) return null;
    
    const messages = await introChannel.messages.fetch({ limit: 100 });
    const userMsg = messages.find((m) => m.author.id === userId);
    return userMsg ? userMsg.content : null;
  } catch { return null; }
}

async function askOllama(channelId, prompt) {
  if (!conversations[channelId]) conversations[channelId] = [];
  const history = conversations[channelId];
  history.push(`User: ${prompt}`);
  
  const systemPrompt = `You are Rahul, a chill and sarcastic friend. Keep replies text-only, lowercase, no punctuation. Max 1 short sentence. Never use emojis. Never mention you are AI.`;
  const fullPrompt = systemPrompt + "\n\n" + history.slice(-10).join("\n") + "\nBot:";
  
  // ⚠️ Make sure Ollama is running on localhost:11434 and you have the "llama3.2" model installed
  const res = await axios.post("http://localhost:11434/api/generate", { 
    model: "llama3.2", // ⚠️ Change this to your Ollama model name
    prompt: fullPrompt, 
    stream: false,
    options: { num_predict: 35, temperature: 0.7, num_thread: 2 }
  });
  const answer = res.data.response.trim();
  
  history.push(`Bot: ${answer}`);
  if (history.length > 20) history.shift();
  return answer;
}

async function generateRoast(targetName, introText = null) {
  const contextLine = introText
    ? `Their introduction text from the channel is: "${introText}". Use details from this text to make a clever, personal roast.`
    : `You don't know anything about them, just roast their name "${targetName}".`;

  const prompt = `You are Rahul, a chill and sarcastic friend. Make a short joke or roast about "${targetName}". ${contextLine} Rules: lowercase, no punctuation, max 1 short sentence. Never use emojis. Only return the roast.`;

  const res = await axios.post("http://localhost:11434/api/generate", { 
    model: "llama3.2", 
    prompt: prompt, 
    stream: false,
    options: { 
      num_predict: 35, 
      temperature: 0.8, 
      num_thread: 2 
    }
  });
  return res.data.response.trim();
}

async function generateShip(name1, name2, score) {
  const prompt = `"${name1}" and "${name2}" got ${score}% compatibility. Give a funny 1-sentence reaction as a sarcastic friend. Lowercase, no punctuation. Never use emojis. Only return the reaction.`;
  
  const res = await axios.post("http://localhost:11434/api/generate", { 
    model: "llama3.2", 
    prompt: prompt, 
    stream: false,
    options: { num_predict: 35, temperature: 0.7, num_thread: 2 }
  });
  return res.data.response.trim();
}

// 8. DISCORD EVENTS
client.once("ready", () => {
  console.log(`✅ Succesvol ingelogd als ${client.user.tag}`);
  
  updatePresence();
  setInterval(updatePresence, 30000);
});

client.on("guildMemberAdd", async (member) => {
  if (serverConfig.autoRoleId) {
    const role = member.guild.roles.cache.get(serverConfig.autoRoleId);
    if (role) await member.roles.add(role).catch(console.error);
  }

  if (!serverConfig.welcomeChannelId) return;
  const channel = member.guild.channels.cache.get(serverConfig.welcomeChannelId);
  if (!channel) return;

  const rulesChannel = member.guild.channels.cache.find((c) => c.name.includes("regels"));
  const embed = new EmbedBuilder()
    .setTitle(`👋 Welkom, ${member.displayName}!`)
    .setDescription(
      `Hey ${member}! Welkom op **${member.guild.name}**! 🎉\n\n` +
      `Je bent lid nummer **${member.guild.memberCount}** van de server.\n\n` +
      (rulesChannel ? `📋 Lees de regels in ${rulesChannel} voordat je begint.\n` : "") +
      `\nHeb je vragen? Ping gewoon iemand of stuur een bericht in 💬・algemeen.`
    )
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setColor("#5865F2")
    .setFooter({ text: member.guild.name })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(console.error);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  const isDM = message.channel.type === ChannelType.DM;
  const isMentioned = !isDM && message.mentions.has(client.user);
  const isFreeChatChannel = !isDM && freeChatChannels.has(message.channel.id);

  // DM AFHANDELING
  if (isDM) {
    if (content === ".help") {
      return message.reply("Stuur me gewoon een berichtje, ik reageer altijd in dm 🗿");
    }
    if (cooldown.has(message.author.id)) return message.reply("⏳ Chill, niet spammen...");
    cooldown.add(message.author.id);
    setTimeout(() => cooldown.delete(message.author.id), 4000);
    if (!content) return;
    try { 
      return message.reply(await askOllama("dm-" + message.author.id, content)); 
    } catch (err) { 
      console.error(err); 
      return message.reply("⚠️ AI error (check of Ollama draait)."); 
    }
  }

  // COMMANDO'S
  
  // .help
  if (content === ".help") {
    const helpEmbed = new EmbedBuilder()
      .setTitle("🤖 Bot Commando's")
      .setColor("#2B2D31")
      .addFields(
        { name: "🌐 Algemeen", value: "`.help` — Overzicht\n`.uptime` — Bot uptime\n`.purge [aantal] [ww]` — Verwijder berichten\n`.roast @user` — Roast iemand\n`.poll [vraag] | [opt1] | [opt2]` — Stemming\n`.coinflip` — Kop of munt\n`.mock [tekst]` — Spongebob tekst\n`.ship @a @b` — Compatibiliteit\n`.userinfo [@user]` — Gebruikersinfo\n`.serverinfo` — Discord server info\n`.freechat` — Toggle AI chat in huidig kanaal" },
        { name: "⚙️ Beheer", value: "`.setup [ww]` — Server opzetten\n`.setwelcome #kanaal` — Welkomstkanaal\n`.setautorole @rol` — Auto-rol instellen\n`.setwelcomemsg [msg]` — Bericht aanpassen" },
        { name: "⛏️ Minecraft", value: "`.mchelp` — Alle Minecraft commando's bekijken" }
      )
      .setFooter({ text: "Gemaakt door Microslop" });
    return message.reply({ embeds: [helpEmbed] });
  }

  if (content === ".mchelp") {
    const mcHelpEmbed = new EmbedBuilder()
      .setTitle("⛏️ Minecraft Commando's")
      .setColor("#43B581")
      .setDescription("`.mcstatus` — Online/offline + speleraantal\n`.mcplayers` — Wie is er nu online\n`.mcmods` — Geïnstalleerde mods\n`.mcjoin` — Hoe te joinen (IP, poort, versie)\n`.mcinfo` — Volledige server info\n`.mcwhitelist` — Whitelist bekijken\n`.mcbanned` — Gebande spelers\n`.mcops` — Beheerders\n`.mcrcon [cmd] [ww]` — RCON commando sturen");
    return message.reply({ embeds: [mcHelpEmbed] });
  }

  // SERVER BEHEER
  if (content.startsWith(".setup")) {
    // ⚠️ Change this to your own setup password
    const SETUP_PASSWORD = process.env.SETUP_PASSWORD || "setup1234";
    const args = content.split(" ");
    if (args[1] !== SETUP_PASSWORD) return message.reply("❌ Verkeerd wachtwoord. Gebruik: `.setup [wachtwoord]`");
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ Je mist de benodigde rechten.");

    const progressMsg = await message.reply("🚀 **Server setup gestart...**");
    try {
      await setupServer(message.guild, progressMsg);
    } catch (err) {
      console.error(err);
      await progressMsg.edit(progressMsg.content + "\n❌ **Fout opgetreden:** " + err.message);
    }
    return;
  }

  if (content.startsWith(".setwelcome ")) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ Geen rechten.");
    const channel = message.mentions.channels.first();
    if (!channel) return message.reply("Gebruik: `.setwelcome #kanaal`");
    serverConfig.welcomeChannelId = channel.id;
    saveServerConfig();
    return message.reply(`✅ Welkomstkanaal ingesteld op ${channel}`);
  }

  if (content.startsWith(".setautorole ")) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ Geen rechten.");
    const role = message.mentions.roles.first();
    if (!role) return message.reply("Gebruik: `.setautorole @rol`");
    serverConfig.autoRoleId = role.id;
    saveServerConfig();
    return message.reply(`✅ Auto-rol ingesteld op ${role}`);
  }

  if (content.startsWith(".setwelcomemsg ")) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ Geen rechten.");
    const msg = content.slice(15).trim();
    if (!msg) return message.reply("Gebruik: `.setwelcomemsg [bericht]` — gebruik {user} voor een ping");
    serverConfig.welcomeMessage = msg;
    saveServerConfig();
    return message.reply(`✅ Welkomstbericht opgeslagen:\n> ${msg}`);
  }

  // MINECRAFT COMMANDO'S
  if (content === ".mcstatus") {
    try {
      const s = await getMCStatus();
      const online = s.players?.online ?? 0;
      const max = s.players?.max ?? 0;
      const bar = "█".repeat(Math.min(online, 10)) + "░".repeat(Math.max(0, 10 - Math.min(online, 10)));
      return message.reply(`🟢 **Online** | ${s.motd?.clean || ""}\n🎮 ${s.version?.name} | 👥 [${bar}] ${online}/${max}`);
    } catch {
      return message.reply("🔴 **Server is offline of momenteel niet bereikbaar.**");
    }
  }

  if (content === ".mcplayers") {
    try {
      try {
        const q = await getMCQuery();
        const players = q.players;
        if (!players || players.length === 0) return message.reply("👥 Niemand online");
        return message.reply(`👥 **Online (${players.length}):**\n${players.map((p) => `• ${p}`).join("\n")}`);
      } catch {
        const s = await getMCStatus();
        const online = s.players?.online ?? 0;
        if (online === 0) return message.reply("👥 Niemand online");
        const sample = s.players?.sample ?? [];
        const lijst = sample.length > 0 ? sample.map((p) => `• ${p.name}`).join("\n") : "_Zet enable-query=true in server.properties voor de volledige spelerslijst_";
        return message.reply(`👥 **Online (${online}):**\n${lijst}`);
      }
    } catch { return message.reply("❌ Server niet bereikbaar."); }
  }

  if (content === ".mcmods") {
    const mods = getMods();
    if (mods.length === 0) return message.reply("📦 Geen mods gevonden.");
    const lijnen = mods.map((m, i) => `${i + 1}. ${m}`);
    const chunks = [];
    let huidig = `📦 **Mods (${mods.length}):**\n`;
    for (const lijn of lijnen) {
      if (huidig.length + lijn.length + 1 > 1900) { chunks.push(huidig); huidig = ""; }
      huidig += lijn + "\n";
    }
    if (huidig) chunks.push(huidig);
    for (const chunk of chunks) await message.reply(chunk);
    return;
  }

  if (content === ".mcjoin") {
    const props = readServerProperties();
    const port = props?.["server-port"] || "25565";
    const isWhitelistOn = props?.["white-list"] === "true";

    const embed = new EmbedBuilder()
        .setTitle("📖 Hoe join je de server?")
        .setColor("#5865F2")
        .addFields(
            { name: "🔌 Server IP", value: `\`${MC_JOIN_IP}:${port}\``, inline: false },
            { name: "📦 Installatie via Modrinth (Aanbevolen)", value: "1. Download de [Modrinth App](https://modrinth.com/app) of [Prism Launcher](https://prismlauncher.org/).\n2. Download het modpack (zie onder).\n3. Kies **Import from file** in de launcher.\n4. Selecteer het `.mrpack` bestand.\n5. Druk op Play!\n\n_⚠️ Handmatig mods installeren wordt niet ondersteund._", inline: false }
        );

    try {
        const s = await getMCStatus();
        embed.addFields({ name: "🎮 Huidige Versie", value: `\`${s.version?.name || "Onbekend"}\``, inline: true });
    } catch { 
        embed.addFields({ name: "🎮 Huidige Versie", value: "Onbekend (Offline)", inline: true });
    }

    if (isWhitelistOn) embed.setFooter({ text: "🔒 Whitelist is ingeschakeld. Vraag een admin voor toegang." });

    return message.reply({ embeds: [embed] });
  }   

  if (content === ".mcinfo") {
    const props = readServerProperties();
    const mods = getMods();
    const ops = getOps();
    let statusLine = "❓ Onbekend";
    let spelers = "Onbekend";
    try { 
      const s = await getMCStatus(); 
      statusLine = `🟢 Online (${s.version?.name})`; 
      spelers = `${s.players?.online ?? 0}/${s.players?.max ?? 0}`; 
    } catch { statusLine = "🔴 Offline"; }
    
    const lines = ["**🖥️ Minecraft Server Info**", `Status: ${statusLine}`, `Spelers: ${spelers}`, `IP: \`${MC_JOIN_IP}\``];
    if (props) {
      lines.push(`Poort: \`${props["server-port"] || "25565"}\``, `Gamemode: ${props["gamemode"] || "?"}`, `Difficulty: ${props["difficulty"] || "?"}`, `PVP: ${props["pvp"] === "true" ? "Aan" : "Uit"}`, `Whitelist: ${props["white-list"] === "true" ? "Aan" : "Uit"}`, `Max Spelers: ${props["max-players"] || "?"}`, `View Distance: ${props["view-distance"] || "?"} chunks`, `Seed: ${props["level-seed"] || "Willekeurig"}`);
    }
    lines.push(`Mods: ${mods.length > 0 ? `${mods.length} geïnstalleerd` : "Vanilla"}`, `Ops: ${ops.length > 0 ? ops.join(", ") : "Geen"}`);
    return message.reply(lines.join("\n"));
  }

  if (content === ".mcwhitelist") {
    const whitelist = getWhitelist();
    if (whitelist.length === 0) return message.reply("📋 Whitelist is leeg of uitgeschakeld.");
    return message.reply(`📋 **Whitelist (${whitelist.length}):**\n${whitelist.map((n) => `• ${n}`).join("\n")}`);
  }

  if (content === ".mcbanned") {
    const banned = getBannedPlayers();
    if (banned.length === 0) return message.reply("✅ Niemand verbannen.");
    return message.reply(`🚫 **Verbannen spelers (${banned.length}):**\n${banned.map((b) => `• **${b.name}** — ${b.reason}`).join("\n")}`);
  }

  if (content === ".mcops") {
    const ops = getOps();
    if (ops.length === 0) return message.reply("👑 Geen operators (Admins) gevonden.");
    return message.reply(`👑 **Operators:**\n${ops.map((o) => `• ${o}`).join("\n")}`);
  }

  if (content.startsWith(".mcrcon")) {
    const args = content.slice(7).trim().split(" ");
    if (args[args.length - 1] !== MC_RCON_ADMIN_PASSWORD) return message.reply("❌ Verkeerd RCON-admin wachtwoord.");
    const commando = args.slice(0, -1).join(" ");
    if (!commando) return message.reply("Gebruik: `.mcrcon [commando] [ww]`");
    if (!MC_RCON_PASS) return message.reply("❌ RCON wachtwoord is niet geconfigureerd in .env");
    try {
      const resultaat = await sendRcon(commando);
      return message.reply(`✅ Command uitgevoerd: \`${commando}\`\n\`\`\`\n${resultaat || "(Geen output)"}\n\`\`\``);
    } catch (err) { return message.reply(`❌ RCON Fout: ${err.message}`); }
  }

  // OVERIGE UTILITIES & FUN COMMANDO'S
  if (content.startsWith(".purge")) {
    // ⚠️ Change this to your own purge password
    const PURGE_PASSWORD = "1232";
    const parts = content.split(" ");
    if (parts[parts.length - 1] !== PURGE_PASSWORD) return message.reply("❌ Verkeerd purge wachtwoord.");
    const args = parts[1];
    
    async function deleteMessages(msgs) {
      const now = Date.now(), twoWeeks = 14 * 24 * 60 * 60 * 1000;
      const recent = msgs.filter((m) => now - m.createdTimestamp < twoWeeks);
      const old = msgs.filter((m) => now - m.createdTimestamp >= twoWeeks);
      if (recent.size > 0) await message.channel.bulkDelete(recent, true);
      for (const m of old.values()) { await m.delete().catch(() => {}); await new Promise((r) => setTimeout(r, 500)); }
      return recent.size + old.size;
    }

    if (args === "all") {
      try {
        let totalDeleted = 0;
        while (true) { 
          const f = await message.channel.messages.fetch({ limit: 100 }); 
          if (f.size === 0) break; 
          totalDeleted += await deleteMessages(f); 
          if (f.size < 100) break; 
        }
        const msg = await message.channel.send(`🧹 Kanaal volledig schoongemaakt (${totalDeleted} berichten).`);
        setTimeout(() => msg.delete().catch(() => {}), 3000);
      } catch { message.channel.send("❌ Purge mislukt.").catch(() => {}); }
      return;
    }
    const amount = parseInt(args, 10);
    if (!amount || amount < 1) return message.reply("Gebruik: `.purge [1-100] [ww]` of `.purge all [ww]`");
    try {
      const fetched = await message.channel.messages.fetch({ limit: Math.min(amount, 100) });
      const count = await deleteMessages(fetched);
      const msg = await message.channel.send(`🧹 Succesvol ${count} berichten verwijderd.`);
      setTimeout(() => msg.delete().catch(() => {}), 3000);
    } catch (err) { message.channel.send(`❌ Purge mislukt: ${err.message}`).catch(() => {}); }
    return;
  }

  if (content.startsWith(".roast")) {
    const target = message.mentions.members.first();
    if (!target) return message.reply("Tag iemand om te roasten. Gebruik: `.roast @user`");
    try {
      const intro = await getIntroForUser(message.guild, target.id);
      const roast = await generateRoast(target.displayName, intro);
      return message.reply(`${target} ${roast}`);
    } catch { return message.reply("⚠️ Roast mislukt, de AI heeft even geen inspiratie."); }
  }

  if (content === ".uptime") return message.reply(`Ik ben al \`${formatUptime(Date.now() - startTime)}\` onafgebroken online!`);

  if (content.startsWith(".poll")) {
    const parts = content.slice(5).trim().split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3) return message.reply("Gebruik: `.poll [vraag] | [opt1] | [opt2] ...`");
    const question = parts[0];
    const options = parts.slice(1);
    if (options.length > 5) return message.reply("Je kunt maximaal 5 opties toevoegen.");
    const pollMsg = await message.channel.send(`📊 **${question}**\n\n${options.map((o, i) => `${POLL_EMOJIS[i]} ${o}`).join("\n")}\n\n_Stem door op een reactie hieronder te klikken!_`);
    for (let i = 0; i < options.length; i++) await pollMsg.react(POLL_EMOJIS[i]);
    await message.delete().catch(() => {});
    return;
  }

  if (content === ".coinflip") return message.reply(Math.random() < 0.5 ? "🪙 Kop!" : "🪙 Munt!");

  if (content.startsWith(".mock")) {
    const tekst = content.slice(5).trim();
    if (!tekst) return message.reply("Gebruik: `.mock [tekst]`");
    return message.reply(mockText(tekst));
  }

  if (content.startsWith(".ship")) {
    const members = message.mentions.members;
    if (members.size < 2) return message.reply("Tag 2 personen. Gebruik: `.ship @user1 @user2`");
    const [m1, m2] = [...members.values()];
    const score = Math.floor(Math.random() * 101);
    const bar = "█".repeat(Math.floor(score / 10)) + "░".repeat(10 - Math.floor(score / 10));
    try {
      const reactie = await generateShip(m1.displayName, m2.displayName, score);
      return message.reply(`💘 **${m1.displayName}** + **${m2.displayName}**\n[${bar}] **${score}%**\n${reactie}`);
    } catch { return message.reply(`💘 **${m1.displayName}** + **${m2.displayName}** — ${score}%`); }
  }

  if (content.startsWith(".userinfo")) {
    const target = message.mentions.members.first() ?? message.member;
    const user = target.user;
    const roles = target.roles.cache.filter(r => r.id !== message.guild.id).map(r => r.name).join(", ");
    
    const embed = new EmbedBuilder()
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL({ dynamic: true }) })
      .setColor(target.displayHexColor !== "#000000" ? target.displayHexColor : "#5865F2")
      .addFields(
        { name: "🆔 ID", value: `\`${user.id}\``, inline: true },
        { name: "📅 Aangemaakt", value: user.createdAt.toLocaleDateString("nl-NL"), inline: true },
        { name: "📥 Gejoind", value: target.joinedAt?.toLocaleDateString("nl-NL") ?? "?", inline: true },
        { name: "🎭 Rollen", value: roles || "Geen", inline: false }
      )
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }));

    return message.reply({ embeds: [embed] });
  }

  if (content === ".serverinfo") {
    const guild = message.guild;
    const owner = await guild.fetchOwner();
    
    const embed = new EmbedBuilder()
      .setTitle(`Server Info: ${guild.name}`)
      .setThumbnail(guild.iconURL({ dynamic: true }))
      .setColor("#2B2D31")
      .addFields(
        { name: "👑 Eigenaar", value: owner.user.tag, inline: true },
        { name: "👥 Leden", value: `${guild.memberCount}`, inline: true },
        { name: "📅 Oprichtingsdatum", value: guild.createdAt.toLocaleDateString("nl-NL"), inline: true },
        { name: "📂 Kanalen", value: `${guild.channels.cache.size}`, inline: true },
        { name: "🎭 Rollen", value: `${guild.roles.cache.size}`, inline: true },
        { name: "🆔 Server ID", value: `\`${guild.id}\``, inline: false }
      );

    return message.reply({ embeds: [embed] });
  }

  if (content === ".freechat") {
    const id = message.channel.id;
    if (freeChatChannels.has(id)) { 
      freeChatChannels.delete(id); 
      saveFreeChatChannels(); 
      return message.reply("❌ Free-chat uitgeschakeld voor dit kanaal."); 
    } else { 
      freeChatChannels.add(id); 
      saveFreeChatChannels(); 
      return message.reply("✅ Free-chat ingeschakeld voor dit kanaal. Ik reageer nu op elk bericht."); 
    }
  }

  // AI CHAT TRIGGER
  if (!isMentioned && !isFreeChatChannel) return;
  if (cooldown.has(message.author.id)) return message.reply("⏳ Chill, de AI heeft een kleine afkoelperiode...");
  cooldown.add(message.author.id);
  setTimeout(() => cooldown.delete(message.author.id), 4000);
  
  const prompt = content.replace(/<@!?(\d+)>/g, "").trim();
  if (!prompt) return;
  try { 
    message.reply(await askOllama(message.channel.id, prompt)); 
  } catch (err) { 
    console.error("AI Error:", err.message); 
    message.reply("⚠️ AI error (check of Ollama op de achtergrond draait)."); 
  }
});

// ⚠️ Make sure you set your DISCORD_TOKEN in the .env file
client.login(process.env.DISCORD_TOKEN);
