
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  Events
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

// ========================================
// PRIZEN BOT — discord.js v14
// ========================================

const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || "";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "Missing BOT_TOKEN, CLIENT_ID, or GUILD_ID environment variable."
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const COLORS = {
  purple: 0x8B5CF6,
  dark: 0x171323,
  red: 0xED4245,
  green: 0x57F287
};

const DATA_FILE = path.join(__dirname, "data.json");

const defaultData = () => ({
  giveaways: {},
  warnings: {},
  tickets: {},
  raidModeGuilds: [],
  locks: {}
});

let data = defaultData();
let saveQueue = Promise.resolve();

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      data = defaultData();
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    data = {
      ...defaultData(),
      ...parsed,
      giveaways: parsed.giveaways || {},
      warnings: parsed.warnings || {},
      tickets: parsed.tickets || {},
      raidModeGuilds: parsed.raidModeGuilds || [],
      locks: parsed.locks || {}
    };
  } catch (error) {
    console.error("Could not load data.json:", error.message);
    console.error(
      "The existing file was not overwritten. Back it up and repair its JSON before restarting."
    );
    process.exit(1);
  }
}

function saveData() {
  // Serialize writes so simultaneous button clicks do not corrupt the file.
  saveQueue = saveQueue.then(async () => {
    const tempFile = `${DATA_FILE}.tmp`;
    await fs.promises.writeFile(
      tempFile,
      JSON.stringify(data, null, 2),
      "utf8"
    );
    await fs.promises.rename(tempFile, DATA_FILE);
  });

  return saveQueue;
}

loadData();

const spamTracker = new Map();
const joinTracker = new Map();
const activeTimers = new Map();

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function makeEmbed(title, description, color = COLORS.purple) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

function isRaidMode(guildId) {
  return data.raidModeGuilds.includes(guildId);
}

async function isStaff(interaction) {
  if (!interaction.inGuild()) return false;

  const permissions = interaction.memberPermissions;

  if (
    permissions?.has(PermissionFlagsBits.Administrator) ||
    permissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    return true;
  }

  if (!STAFF_ROLE_ID) return false;

  try {
    const member = await interaction.guild.members.fetch(
      interaction.user.id
    );
    return member.roles.cache.has(STAFF_ROLE_ID);
  } catch {
    return false;
  }
}

async function requireStaff(interaction) {
  if (await isStaff(interaction)) return true;

  const reply = {
    content: "You need the required staff permissions to use this command.",
    ephemeral: true
  };

  if (interaction.deferred) {
    await interaction.editReply(reply);
  } else if (interaction.replied) {
    await interaction.followUp(reply);
  } else {
    await interaction.reply(reply);
  }

  return false;
}

async function getTextChannel(guild, name) {
  let channel = guild.channels.cache.find(
    c => c.name === name && c.type === ChannelType.GuildText
  );

  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      reason: "PRIZEN bot setup"
    });
  }

  return channel;
}

async function logToGuild(guild, message) {
  try {
    const channel = guild.channels.cache.find(
      c =>
        c.name === "security-logs" &&
        c.type === ChannelType.GuildText
    );

    if (channel) await channel.send({ content: message });
  } catch (error) {
    console.error("Could not send security log:", error.message);
  }
}

async function safeReply(interaction, content) {
  const payload = {
    content,
    ephemeral: true,
    allowedMentions: { parse: [] }
  };

  try {
    if (interaction.deferred) {
      await interaction.editReply(payload);
    } else if (interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (error) {
    console.error("Could not reply to interaction:", error.message);
  }
}

// ========================================
// SLASH COMMANDS
// ========================================

const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Create the basic PRIZEN server channels")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o =>
      o.setName("member").setDescription("Member to warn").setRequired(true))
    .addStringOption(o =>
      o.setName("reason").setDescription("Warning reason")
        .setRequired(true).setMaxLength(500)),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Temporarily timeout a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o =>
      o.setName("member").setDescription("Member to timeout").setRequired(true))
    .addIntegerOption(o =>
      o.setName("minutes").setDescription("Duration, maximum 40320 minutes")
        .setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason")
        .setRequired(false).setMaxLength(500)),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete recent messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o =>
      o.setName("amount").setDescription("Number of messages, 1–100")
        .setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Prevent members from sending messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Remove the channel message restriction")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("raidmode")
    .setDescription("Toggle PRIZEN raid-protection mode")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Start a button-entry giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName("prize").setDescription("Prize being offered")
        .setRequired(true).setMaxLength(200))
    .addIntegerOption(o =>
      o.setName("minutes").setDescription("Duration in minutes")
        .setRequired(true).setMinValue(1).setMaxValue(10080)),

  new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("Post a support ticket panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("ticket-close")
    .setDescription("Close the current support ticket")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
].map(command => command.toJSON());

// ========================================
// COMMAND REGISTRATION
// ========================================

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("PRIZEN slash commands registered.");
}

// ========================================
// GIVEAWAYS — PERSISTENT STORAGE
// ========================================

function giveawayRow(id, ended = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ended ? `prizen_ended:${id}` : `prizen_enter:${id}`)
      .setLabel(ended ? "Giveaway Ended" : "Enter Giveaway")
      .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setEmoji(ended ? "🔒" : "🎉")
      .setDisabled(ended)
  );
}

function giveawayEmbed(giveaway, ended = false) {
  const entries = Object.keys(giveaway.entries || {}).length;

  if (ended) {
    return makeEmbed(
      "🎉 PRIZEN GIVEAWAY ENDED",
      `**Prize:** ${giveaway.prize}\n` +
      `**Hosted by:** <@${giveaway.hostId}>\n` +
      `**Entries:** ${entries}\n` +
      (giveaway.winnerId
        ? `**Winner:** <@${giveaway.winnerId}>`
        : "No eligible entries, so there is no winner."),
      COLORS.green
    );
  }

  return makeEmbed(
    "🎉 PRIZEN GIVEAWAY",
    `**Prize:** ${giveaway.prize}\n` +
    `**Hosted by:** <@${giveaway.hostId}>\n` +
    `**Entries:** ${entries}\n` +
    `**Ends:** <t:${Math.floor(giveaway.endAt / 1000)}:R>`,
    COLORS.purple
  );
}

async function finishGiveaway(id) {
  const giveaway = data.giveaways[id];
  if (!giveaway || giveaway.resultPosted) return;

  // Pick and save the winner once. Restarts won't reroll the result.
  if (!giveaway.ended) {
    giveaway.ended = true;
    const entries = Object.keys(giveaway.entries || {});

    giveaway.winnerId = entries.length
      ? entries[Math.floor(Math.random() * entries.length)]
      : null;

    giveaway.endedAt = Date.now();
    await saveData();
  }

  const guild = client.guilds.cache.get(giveaway.guildId);

  if (!guild) {
    console.error(`Giveaway ${id}: guild unavailable; result remains saved.`);
    return;
  }

  try {
    const channel = await guild.channels.fetch(giveaway.channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error("Giveaway channel is missing or is not text-based.");
    }

    let message = null;

    try {
      message = await channel.messages.fetch(giveaway.messageId);
    } catch {
      console.warn(`Giveaway ${id}: original message could not be fetched.`);
    }

    if (message) {
      await message.edit({
        embeds: [giveawayEmbed(giveaway, true)],
        components: [giveawayRow(id, true)]
      });
    }

    // Persist before announcing so a restart cannot choose a new winner.
    giveaway.resultPosted = true;
    await saveData();

    if (giveaway.winnerId) {
      await channel.send({
        content:
          `🎉 Congratulations <@${giveaway.winnerId}>! ` +
          `You won **${giveaway.prize}**. Contact PRIZEN staff to claim it.`,
        allowedMentions: { users: [giveaway.winnerId] }
      });

      try {
        const winner = await client.users.fetch(giveaway.winnerId);
        await winner.send({
          embeds: [
            makeEmbed(
              "You won a PRIZEN giveaway!",
              `You won **${giveaway.prize}** in **${guild.name}**.\n` +
              "Contact the server's staff to arrange your prize."
            )
          ]
        });
      } catch {
        await logToGuild(
          guild,
          `⚠️ Could not DM giveaway winner <@${giveaway.winnerId}>. ` +
          "Please contact them in the server."
        );
      }
    } else {
      await channel.send(
        `The PRIZEN giveaway for **${giveaway.prize}** ended without any entries.`
      );
    }

    await logToGuild(
      guild,
      `🎉 Giveaway ended: **${giveaway.prize}**. ` +
      `Entries: ${Object.keys(giveaway.entries || {}).length}. ` +
      `Winner: ${giveaway.winnerId ? `<@${giveaway.winnerId}>` : "None"}.`
    );
  } catch (error) {
    console.error(`Could not finish giveaway ${id}:`, error);
  }
}

function scheduleGiveaway(id) {
  if (activeTimers.has(id)) {
    clearTimeout(activeTimers.get(id));
    activeTimers.delete(id);
  }

  const giveaway = data.giveaways[id];
  if (!giveaway || giveaway.resultPosted) return;

  const delay = Math.max(0, giveaway.endAt - Date.now());

  const timer = setTimeout(async () => {
    activeTimers.delete(id);
    await finishGiveaway(id);
  }, Math.min(delay, 2_147_000_000));

  activeTimers.set(id, timer);
}

// ========================================
// TICKETS
// ========================================

function ticketCloseRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("prizen_ticket_close")
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Danger)
  );
}

async function closeTicket(interaction, channel) {
  const ownerId = data.tickets[channel.id]?.ownerId ||
    channel.topic?.match(/PRIZEN_OWNER:(\d+)/)?.[1] ||
    channel.name.match(/^ticket-(\d+)$/)?.[1];

  const owner = ownerId === interaction.user.id;
  const staff = await isStaff(interaction);

  if (!owner && !staff) {
    return safeReply(
      interaction,
      "Only this ticket's owner or authorized staff can close it."
    );
  }

  await interaction.reply({
    content: "This ticket will close in 3 seconds.",
    ephemeral: true
  });

  await wait(3000);

  try {
    data.tickets[channel.id] = {
      ...(data.tickets[channel.id] || {}),
      ownerId: ownerId || null,
      closedAt: Date.now()
    };
    await saveData();

    await channel.delete("PRIZEN support ticket closed");
  } catch (error) {
    console.error("Ticket close failed:", error.message);
  }
}

// ========================================
// STARTUP
// ========================================

client.once(Events.ClientReady, async readyClient => {
  console.log(`PRIZEN is online as ${readyClient.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Slash command registration failed:", error);
  }

  // Restore unfinished giveaways after restarts.
  for (const [id, giveaway] of Object.entries(data.giveaways)) {
    if (!giveaway.resultPosted) scheduleGiveaway(id);
  }
});

client.on(Events.Error, error => {
  console.error("Discord client error:", error);
});

// ========================================
// SLASH COMMAND INTERACTIONS
// ========================================

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName, guild, channel } = interaction;

      if (!guild) {
        return safeReply(interaction, "Use this command inside the PRIZEN server.");
      }

      // SETUP
      if (commandName === "setup") {
        if (!await requireStaff(interaction)) return;

        await interaction.deferReply({ ephemeral: true });

        const welcome = await getTextChannel(guild, "welcome");
        const logs = await getTextChannel(guild, "security-logs");
        const general = await getTextChannel(guild, "general");
        const support = await getTextChannel(guild, "support");

        await logs.send({
          embeds: [
            makeEmbed(
              "PRIZEN Security",
              "Security logging is ready.",
              COLORS.green
            )
          ]
        });

        await interaction.editReply(
          `Setup complete. Found or created: ${welcome}, ${logs}, ${general}, ${support}.`
        );
        return;
      }

      // All commands except ticket-close require staff.
      if (commandName !== "ticket-close" &&
          !await requireStaff(interaction)) return;

      // WARN
      if (commandName === "warn") {
        const user = interaction.options.getUser("member");
        const reason = interaction.options.getString("reason");
        const member = await guild.members.fetch(user.id).catch(() => null);

        if (!member) {
          return safeReply(interaction, "That member is not in this server.");
        }

        if (user.id === interaction.user.id || user.bot) {
          return safeReply(interaction, "You cannot warn yourself or a bot.");
        }

        if (member.permissions.has(PermissionFlagsBits.Administrator)) {
          return safeReply(interaction, "This command cannot warn an administrator.");
        }

        const key = `${guild.id}:${user.id}`;
        data.warnings[key] ||= [];

        data.warnings[key].push({
          reason,
          moderator: interaction.user.id,
          at: Date.now()
        });

        await saveData();

        try {
          await user.send({
            embeds: [
              makeEmbed(
                "PRIZEN Warning",
                `You received a warning in **${guild.name}**.\nReason: ${reason}`,
                COLORS.red
              )
            ]
          });
        } catch {}

        await logToGuild(
          guild,
          `⚠️ **Warning:** ${user.tag} (${user.id})\n` +
          `Moderator: ${interaction.user.tag}\nReason: ${reason}\n` +
          `Total recorded: ${data.warnings[key].length}`
        );

        await safeReply(
          interaction,
          `Warned ${user.tag}. Total recorded warnings: ${data.warnings[key].length}.`
        );
        return;
      }

      // TIMEOUT
      if (commandName === "timeout") {
        const user = interaction.options.getUser("member");
        const minutes = interaction.options.getInteger("minutes");
        const reason = interaction.options.getString("reason") ||
          "No reason supplied";

        const member = await guild.members.fetch(user.id).catch(() => null);

        if (!member) {
          return safeReply(interaction, "That member is not in this server.");
        }

        if (
          user.id === interaction.user.id ||
          user.id === client.user.id ||
          member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
          return safeReply(interaction, "You cannot timeout yourself, the bot, or an administrator.");
        }

        if (!member.moderatable) {
          return safeReply(
            interaction,
            "I cannot timeout that member. Check my Moderate Members permission and role position."
          );
        }

        await member.timeout(minutes * 60 * 1000, reason);

        await logToGuild(
          guild,
          `⏱️ **Timeout:** ${user.tag}\nDuration: ${minutes} minutes\n` +
          `Moderator: ${interaction.user.tag}\nReason: ${reason}`
        );

        await safeReply(interaction, `Timed out ${user.tag} for ${minutes} minute(s).`);
        return;
      }

      // PURGE
      if (commandName === "purge") {
        if (!channel || channel.type !== ChannelType.GuildText) {
          return safeReply(interaction, "This command requires a server text channel.");
        }

        const amount = interaction.options.getInteger("amount");

        await interaction.deferReply({ ephemeral: true });

        try {
          const deleted = await channel.bulkDelete(amount, true);
          await interaction.editReply(
            `Deleted ${deleted.size} recent message(s). Messages older than 14 days cannot be bulk-deleted.`
          );
        } catch (error) {
          console.error("Purge failed:", error);
          await interaction.editReply(
            "I could not delete those messages. Check my Manage Messages permission."
          );
        }
        return;
      }

      // LOCK / UNLOCK
      if (commandName === "lock" || commandName === "unlock") {
        if (!channel || !channel.isTextBased() || !channel.permissionOverwrites) {
          return safeReply(interaction, "Use this command in a server text channel.");
        }

        const shouldLock = commandName === "lock";

        await channel.permissionOverwrites.edit(
          guild.roles.everyone,
          { SendMessages: shouldLock ? false : null }
        );

        if (shouldLock) {
          data.locks[channel.id] = {
            guildId: guild.id,
            channelId: channel.id,
            lockedAt: Date.now(),
            moderatorId: interaction.user.id
          };
        } else {
          delete data.locks[channel.id];
        }

        await saveData();

        await interaction.reply(
          shouldLock
            ? "🔒 This channel is locked for @everyone."
            : "🔓 The @everyone message restriction has been removed."
        );

        await logToGuild(
          guild,
          `${shouldLock ? "🔒 Locked" : "🔓 Unlocked"} ${channel} by ${interaction.user.tag}.`
        );
        return;
      }

      // RAID MODE
      if (commandName === "raidmode") {
        const enabled = !isRaidMode(guild.id);

        data.raidModeGuilds = enabled
          ? [...new Set([...data.raidModeGuilds, guild.id])]
          : data.raidModeGuilds.filter(id => id !== guild.id);

        await saveData();

        await safeReply(
          interaction,
          enabled
            ? "🛡️ Raid mode enabled. New-member joins will be monitored more strictly."
            : "Raid mode disabled. Standard monitoring remains active."
        );

        await logToGuild(
          guild,
          `🛡️ Raid mode ${enabled ? "ENABLED" : "DISABLED"} by ${interaction.user.tag}.`
        );
        return;
      }

      // GIVEAWAY
      if (commandName === "giveaway") {
        const prize = interaction.options.getString("prize");
        const minutes = interaction.options.getInteger("minutes");
        const id = `${guild.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        const giveaway = {
          guildId: guild.id,
          channelId: channel.id,
          messageId: null,
          hostId: interaction.user.id,
          prize,
          endAt: Date.now() + minutes * 60_000,
          entries: {},
          ended: false,
          winnerId: null,
          resultPosted: false
        };

        await interaction.deferReply();

        const message = await interaction.editReply({
          embeds: [giveawayEmbed(giveaway)],
          components: [giveawayRow(id)],
          fetchReply: true,
          allowedMentions: { parse: [] }
        });

        giveaway.messageId = message.id;
        data.giveaways[id] = giveaway;
        await saveData();
        scheduleGiveaway(id);

        await logToGuild(
          guild,
          `🎉 Giveaway started by ${interaction.user.tag}: **${prize}**.`
        );
        return;
      }

      // TICKET PANEL
      if (commandName === "ticket-panel") {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("prizen_ticket_open")
            .setLabel("Open Support Ticket")
            .setStyle(ButtonStyle.Primary)
        );

        await interaction.reply({
          embeds: [
            makeEmbed(
              "PRIZEN Support",
              "Need help? Open a private support ticket below. Explain your issue clearly and a staff member will respond when available."
            )
          ],
          components: [row]
        });
        return;
      }

      // TICKET CLOSE COMMAND
      if (commandName === "ticket-close") {
        if (!channel || channel.type !== ChannelType.GuildText ||
            !channel.name.startsWith("ticket-")) {
          return safeReply(interaction, "This command can only be used inside a ticket channel.");
        }

        return closeTicket(interaction, channel);
      }
    }

    // ====================================
    // BUTTONS
    // ====================================

    if (interaction.isButton()) {
      // GIVEAWAY ENTRY
      if (interaction.customId.startsWith("prizen_enter:")) {
        const id = interaction.customId.slice("prizen_enter:".length);
        const giveaway = data.giveaways[id];

        if (
          !giveaway ||
          giveaway.ended ||
          giveaway.endAt <= Date.now()
        ) {
          return safeReply(interaction, "This giveaway has ended.");
        }

        if (interaction.guildId !== giveaway.guildId) {
          return safeReply(interaction, "This giveaway is not in this server.");
        }

        if (giveaway.entries?.[interaction.user.id]) {
          return safeReply(interaction, "You have already entered this giveaway.");
        }

        giveaway.entries ||= {};
        giveaway.entries[interaction.user.id] = Date.now();
        await saveData();

        await safeReply(interaction, "🎉 You're entered! Good luck.");

        try {
          await interaction.message.edit({
            embeds: [giveawayEmbed(giveaway)],
            components: [giveawayRow(id)],
            allowedMentions: { parse: [] }
          });
        } catch (error) {
          console.error("Could not update giveaway entries:", error.message);
        }
        return;
      }

      // OPEN TICKET
      if (interaction.customId === "prizen_ticket_open") {
        const guild = interaction.guild;

        if (!guild) {
          return safeReply(interaction, "Use this button in the PRIZEN server.");
        }

        const existing = guild.channels.cache.find(
          c =>
            c.type === ChannelType.GuildText &&
            c.name === `ticket-${interaction.user.id}`
        );

        if (existing) {
          return safeReply(interaction, `You already have a ticket: ${existing}`);
        }

        await interaction.deferReply({ ephemeral: true });

        const overwrites = [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory
            ]
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels
            ]
          }
        ];

        if (STAFF_ROLE_ID) {
          const staffRole = await guild.roles.fetch(STAFF_ROLE_ID).catch(() => null);

          if (staffRole) {
            overwrites.push({
              id: staffRole.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
              ]
            });
          }
        }

        try {
          const ticket = await guild.channels.create({
            name: `ticket-${interaction.user.id}`,
            type: ChannelType.GuildText,
            topic: `PRIZEN_OWNER:${interaction.user.id}`,
            permissionOverwrites: overwrites,
            reason: `Support ticket opened by ${interaction.user.tag}`
          });

          data.tickets[ticket.id] = {
            ownerId: interaction.user.id,
            guildId: guild.id,
            channelId: ticket.id,
            openedAt: Date.now()
          };
          await saveData();

          await ticket.send({
            content: `${interaction.user}${STAFF_ROLE_ID ? ` <@&${STAFF_ROLE_ID}>` : ""}`,
            embeds: [
              makeEmbed(
                "PRIZEN Support Ticket",
                "Describe the issue you need help with. A staff member will respond when available."
              )
            ],
            components: [ticketCloseRow()],
            allowedMentions: {
              users: [interaction.user.id],
              roles: STAFF_ROLE_ID ? [STAFF_ROLE_ID] : []
            }
          });

          await interaction.editReply(`Your private ticket is ready: ${ticket}`);

          await logToGuild(
            guild,
            `🎫 Ticket opened by ${interaction.user.tag}: ${ticket}`
          );
        } catch (error) {
          console.error("Ticket creation failed:", error);
          await interaction.editReply(
            "I couldn't create the ticket. Check my Manage Channels permission and the configured staff role."
          );
        }
        return;
      }

      // CLOSE TICKET BUTTON
      if (interaction.customId === "prizen_ticket_close") {
        const channel = interaction.channel;

        if (
          !channel ||
          channel.type !== ChannelType.GuildText ||
          !channel.name.startsWith("ticket-")
        ) {
          return safeReply(interaction, "This button only works in a ticket channel.");
        }

        return closeTicket(interaction, channel);
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);
    await safeReply(
      interaction,
      "Something went wrong. Check the FadeHost console for the error details."
    );
  }
});

// ========================================
// WELCOME + ANTI-RAID JOIN MONITOR
// ========================================

client.on(Events.GuildMemberAdd, async member => {
  try {
    const guild = member.guild;
    const now = Date.now();

    const joins = (joinTracker.get(guild.id) || [])
      .filter(time => now - time < 20_000);

    joins.push(now);
    joinTracker.set(guild.id, joins);

    const raidMode = isRaidMode(guild.id);

    if (joins.length >= 8) {
      await logToGuild(
        guild,
        `🚨 **Possible join raid:** ${joins.length} members joined in 20 seconds. ` +
        `Raid mode is ${raidMode ? "ON" : "OFF"}. Please review the joins.`
      );
    }

    if (raidMode) {
      await logToGuild(
        guild,
        `🛡️ Raid mode: new member joined — ${member.user.tag} (${member.id}).`
      );
    }

    const welcome = guild.channels.cache.find(
      c => c.name === "welcome" && c.type === ChannelType.GuildText
    );

    if (welcome) {
      await welcome.send({
        embeds: [
          makeEmbed(
            "Welcome to PRIZEN",
            `Welcome ${member}!\n\nRead the server rules, meet the community, and check out the gaming and rewards channels.`,
            COLORS.purple
          )
        ],
        allowedMentions: { users: [member.id] }
      });
    }
  } catch (error) {
    console.error("Welcome or join monitor failed:", error.message);
  }
});

// ========================================
// ANTI-SPAM
// ========================================

client.on(Events.MessageCreate, async message => {
  try {
    if (!message.guild || message.author.bot || !message.member) return;

    const member = message.member;

    if (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ManageMessages) ||
      (STAFF_ROLE_ID && member.roles.cache.has(STAFF_ROLE_ID))
    ) {
      return;
    }

    const now = Date.now();
    const key = `${message.guild.id}:${message.author.id}`;

    const entry = spamTracker.get(key) || {
      recent: [],
      lastContent: "",
      duplicates: 0,
      lastActionAt: 0
    };

    entry.recent = entry.recent.filter(time => now - time < 7_000);
    entry.recent.push(now);

    if (message.content && message.content === entry.lastContent) {
      entry.duplicates++;
    } else {
      entry.duplicates = 0;
    }

    entry.lastContent = message.content;
    spamTracker.set(key, entry);

    const tooManyMessages = entry.recent.length >= 6;
    const duplicateSpam = entry.duplicates >= 3;
    const mentionSpam = message.mentions.users.size >= 6;

    if (!tooManyMessages && !duplicateSpam && !mentionSpam) return;

    // Prevent repeated timeout attempts every time the member sends a message.
    if (now - entry.lastActionAt < 60_000) return;
    entry.lastActionAt = now;

    try {
      await message.delete();
    } catch {}

    let reason = "message flood";
    if (duplicateSpam) reason = "repeated duplicate messages";
    if (mentionSpam) reason = "excessive user mentions";

    await logToGuild(
      message.guild,
      `🚫 **Anti-spam action:** ${message.author.tag} (${message.author.id})\n` +
      `Reason: ${reason}\nChannel: ${message.channel}`
    );

    if (member.moderatable) {
      try {
        await member.timeout(60_000, `PRIZEN anti-spam: ${reason}`);
      } catch (error) {
        console.error("Anti-spam timeout failed:", error.message);
      }
    }

    try {
      await message.channel.send({
        content: `${message.author}, slow down. Anti-spam protection detected repeated or excessive messages.`,
        allowedMentions: { users: [message.author.id] }
      });
    } catch {}
  } catch (error) {
    console.error("Anti-spam handler failed:", error.message);
  }
});

// ========================================
// SUSPICIOUS MESSAGE FLAGGING
// Flags messages for staff review; no auto-ban.
// ========================================

client.on(Events.MessageCreate, async message => {
  try {
    if (!message.guild || message.author.bot) return;

    const content = message.content.toLowerCase();

    const suspiciousPatterns = [
      /free nitro/,
      /claim your nitro/,
      /steam gift/,
      /airdrop/,
      /verify your account/,
      /discord-nitro/
    ];

    if (!suspiciousPatterns.some(pattern => pattern.test(content))) return;

    await logToGuild(
      message.guild,
      `🔎 **Review flagged message**\n` +
      `Author: ${message.author.tag} (${message.author.id})\n` +
      `Channel: ${message.channel}\n` +
      `Message: ${message.content.slice(0, 700)}`
    );
  } catch (error) {
    console.error("Suspicious-message scan failed:", error.message);
  }
});

// ========================================
// LOGIN
// ========================================

client.login(TOKEN).catch(error => {
  console.error("Bot login failed. Check BOT_TOKEN and FadeHost environment variables.");
  console.error(error.message);
  process.exit(1);
});
