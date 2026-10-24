
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

const spamTracker = new Map();
const joinTracker = new Map();
const giveaways = new Map();
const warnedUsers = new Map();
const raidModeGuilds = new Set();

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function makeEmbed(title, description, color = COLORS.purple) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

function isStaff(interaction) {
  if (!interaction.inGuild()) return false;

  const perms = interaction.memberPermissions;

  return Boolean(
    perms?.has(PermissionFlagsBits.Administrator) ||
    perms?.has(PermissionFlagsBits.ManageGuild) ||
    (STAFF_ROLE_ID &&
      interaction.member?.roles?.cache?.has(STAFF_ROLE_ID))
  );
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

    if (channel) await channel.send(message);
  } catch (error) {
    console.error("Could not send security log:", error.message);
  }
}

async function requireStaff(interaction) {
  if (isStaff(interaction)) return true;

  await interaction.reply({
    content: "You need the required staff permissions to use this command.",
    ephemeral: true
  });

  return false;
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
    .addUserOption(option =>
      option.setName("member")
        .setDescription("Member to warn")
        .setRequired(true))
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Reason for the warning")
        .setRequired(true)
        .setMaxLength(500)),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Temporarily timeout a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName("member")
        .setDescription("Member to timeout")
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName("minutes")
        .setDescription("Timeout length in minutes, maximum 40320")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320))
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Reason for timeout")
        .setRequired(false)
        .setMaxLength(500)),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete recent messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(option =>
      option.setName("amount")
        .setDescription("Number of messages to delete, from 1 to 100")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Prevent members from sending messages in this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Allow members to send messages in this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("raidmode")
    .setDescription("Toggle PRIZEN raid-protection mode")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Start a button-entry giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option.setName("prize")
        .setDescription("What the winner receives")
        .setRequired(true)
        .setMaxLength(200))
    .addIntegerOption(option =>
      option.setName("minutes")
        .setDescription("Duration in minutes")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10080)),

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
// REGISTER COMMANDS
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
// STARTUP
// ========================================

client.once(Events.ClientReady, async readyClient => {
  console.log(`PRIZEN is online as ${readyClient.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Slash command registration failed:", error);
  }
});

client.on(Events.Error, error => {
  console.error("Discord client error:", error);
});

// ========================================
// SERVER SETUP
// ========================================

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName, guild, channel } = interaction;

      if (!guild) {
        return interaction.reply({
          content: "Use this command inside the PRIZEN server.",
          ephemeral: true
        });
      }

      if (commandName === "setup") {
        if (!await requireStaff(interaction)) return;

        await interaction.deferReply({ ephemeral: true });

        const welcome = await getTextChannel(guild, "welcome");
        const logs = await getTextChannel(guild, "security-logs");
        await getTextChannel(guild, "general");
        await getTextChannel(guild, "support");

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
          `Setup complete. Created or found: ${welcome}, ${logs}, #general, and #support.`
        );
        return;
      }

      // All remaining commands require staff authorization.
      if (commandName !== "ticket-close" &&
          !await requireStaff(interaction)) return;

      if (commandName === "warn") {
        const user = interaction.options.getUser("member");
        const reason = interaction.options.getString("reason");
        const key = `${guild.id}:${user.id}`;

        const warnings = warnedUsers.get(key) || [];
        warnings.push({
          reason,
          moderator: interaction.user.id,
          at: Date.now()
        });
        warnedUsers.set(key, warnings);

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
          `⚠️ **Warning:** ${user.tag} (${user.id})\nModerator: ${interaction.user.tag}\nReason: ${reason}`
        );

        await interaction.reply({
          content: `Warned ${user.tag}. Total warnings this session: ${warnings.length}.`,
          ephemeral: true
        });
        return;
      }

      if (commandName === "timeout") {
        const user = interaction.options.getUser("member");
        const minutes = interaction.options.getInteger("minutes");
        const reason = interaction.options.getString("reason") ||
          "No reason supplied";

        const member = await guild.members.fetch(user.id);

        if (!member.moderatable) {
          return interaction.reply({
            content: "I cannot timeout that member. Check my role position and permissions.",
            ephemeral: true
          });
        }

        await member.timeout(minutes * 60 * 1000, reason);

        await logToGuild(
          guild,
          `⏱️ **Timeout:** ${user.tag}\nDuration: ${minutes} minutes\nModerator: ${interaction.user.tag}\nReason: ${reason}`
        );

        await interaction.reply({
          content: `Timed out ${user.tag} for ${minutes} minute(s).`,
          ephemeral: true
        });
        return;
      }

      if (commandName === "purge") {
        if (!channel || !channel.isTextBased() ||
            !channel.messages || !channel.bulkDelete) {
          return interaction.reply({
            content: "This command requires a text channel.",
            ephemeral: true
          });
        }

        const amount = interaction.options.getInteger("amount");
        const deleted = await channel.bulkDelete(amount, true);

        await interaction.reply({
          content: `Deleted ${deleted.size} recent message(s). Messages older than 14 days cannot be bulk-deleted.`,
          ephemeral: true
        });
        return;
      }

      if (commandName === "lock" || commandName === "unlock") {
        if (!channel || !channel.isTextBased()) {
          return interaction.reply({
            content: "Use this command in a text channel.",
            ephemeral: true
          });
        }

        const shouldLock = commandName === "lock";

        await channel.permissionOverwrites.edit(
          guild.roles.everyone,
          { SendMessages: shouldLock ? false : null }
        );

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

      if (commandName === "raidmode") {
        const wasEnabled = raidModeGuilds.has(guild.id);

        if (wasEnabled) raidModeGuilds.delete(guild.id);
        else raidModeGuilds.add(guild.id);

        const enabled = !wasEnabled;

        await interaction.reply({
          content: enabled
            ? "🛡️ Raid mode enabled. New-member joins will be monitored more strictly."
            : "Raid mode disabled. Standard monitoring remains active.",
          ephemeral: true
        });

        await logToGuild(
          guild,
          `🛡️ Raid mode ${enabled ? "ENABLED" : "DISABLED"} by ${interaction.user.tag}.`
        );
        return;
      }

      if (commandName === "giveaway") {
        const prize = interaction.options.getString("prize");
        const minutes = interaction.options.getInteger("minutes");
        const endAt = Date.now() + minutes * 60 * 1000;
        const giveawayId = `${guild.id}-${Date.now()}`;

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`prizen_enter:${giveawayId}`)
            .setLabel("Enter Giveaway")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("🎉")
        );

        const embed = makeEmbed(
          "🎉 PRIZEN GIVEAWAY",
          `**Prize:** ${prize}\n**Hosted by:** ${interaction.user}\n**Entries:** 0\n**Ends:** <t:${Math.floor(endAt / 1000)}:R>`,
          COLORS.purple
        );

        await interaction.reply({
          embeds: [embed],
          components: [row]
        });

        const message = await interaction.fetchReply();

        giveaways.set(giveawayId, {
          guildId: guild.id,
          channelId: channel.id,
          messageId: message.id,
          prize,
          endAt,
          entries: new Set()
        });

        setTimeout(async () => {
          const giveaway = giveaways.get(giveawayId);
          if (!giveaway) return;

          try {
            const giveawayChannel = await guild.channels.fetch(
              giveaway.channelId
            );
            const giveawayMessage = await giveawayChannel.messages.fetch(
              giveaway.messageId
            );

            const entrants = [...giveaway.entries];
            const winnerId = entrants.length
              ? entrants[Math.floor(Math.random() * entrants.length)]
              : null;

            const endedEmbed = makeEmbed(
              "🎉 GIVEAWAY ENDED",
              `**Prize:** ${giveaway.prize}\n` +
              `**Entries:** ${entrants.length}\n` +
              (winnerId
                ? `**Winner:** <@${winnerId}>`
                : "No one entered, so there is no winner."),
              COLORS.green
            );

            const disabledRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`prizen_ended:${giveawayId}`)
                .setLabel("Giveaway Ended")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
            );

            await giveawayMessage.edit({
              embeds: [endedEmbed],
              components: [disabledRow]
            });

            if (winnerId) {
              await giveawayChannel.send(
                `🎉 Congratulations <@${winnerId}>! You won **${giveaway.prize}**. Contact the PRIZEN staff to claim it.`
              );
            }

            giveaways.delete(giveawayId);
          } catch (error) {
            console.error("Giveaway finish error:", error);
            giveaways.delete(giveawayId);
          }
        }, minutes * 60 * 1000);

        return;
      }

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
              "Need help? Open a private support ticket below. Please explain your issue clearly."
            )
          ],
          components: [row]
        });
        return;
      }

      if (commandName === "ticket-close") {
        if (!channel.name.startsWith("ticket-")) {
          return interaction.reply({
            content: "This command can only be used inside a ticket channel.",
            ephemeral: true
          });
        }

        await interaction.reply("This ticket will close in 3 seconds.");
        await wait(3000);
        await channel.delete("PRIZEN ticket closed by staff");
        return;
      }
    }

    // ====================================
    // BUTTON INTERACTIONS
    // ====================================

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("prizen_enter:")) {
        const giveawayId = interaction.customId.slice(
          "prizen_enter:".length
        );
        const giveaway = giveaways.get(giveawayId);

        if (!giveaway || giveaway.endAt <= Date.now()) {
          return interaction.reply({
            content: "This giveaway has ended.",
            ephemeral: true
          });
        }

        if (giveaway.entries.has(interaction.user.id)) {
          return interaction.reply({
            content: "You have already entered this giveaway.",
            ephemeral: true
          });
        }

        giveaway.entries.add(interaction.user.id);

        await interaction.reply({
          content: "🎉 You're entered! Good luck.",
          ephemeral: true
        });

        try {
          const message = interaction.message;
          const oldEmbed = message.embeds[0];

          if (oldEmbed) {
            const updated = EmbedBuilder.from(oldEmbed)
              .setDescription(
                `**Prize:** ${giveaway.prize}\n` +
                `**Hosted by:** <@${oldEmbed.description?.match(/Hosted by: <@!?(\d+)>/)?.[1] || client.user.id}>\n` +
                `**Entries:** ${giveaway.entries.size}\n` +
                `**Ends:** <t:${Math.floor(giveaway.endAt / 1000)}:R>`
              );

            await message.edit({ embeds: [updated] });
          }
        } catch (error) {
          console.error("Could not update giveaway count:", error.message);
        }
        return;
      }

      if (interaction.customId === "prizen_ticket_open") {
        const guild = interaction.guild;

        if (!guild) {
          return interaction.reply({
            content: "Use this button in the PRIZEN server.",
            ephemeral: true
          });
        }

        const existing = guild.channels.cache.find(
          c =>
            c.type === ChannelType.GuildText &&
            c.name === `ticket-${interaction.user.id}`
        );

        if (existing) {
          return interaction.reply({
            content: `You already have a ticket: ${existing}`,
            ephemeral: true
          });
        }

        const overwrites = [
          {
            id: guild.roles.everyone.id,
            deny: ["ViewChannel"]
          },
          {
            id: interaction.user.id,
            allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"]
          },
          {
            id: client.user.id,
            allow: [
              "ViewChannel",
              "SendMessages",
              "ReadMessageHistory",
              "ManageChannels"
            ]
          }
        ];

        if (STAFF_ROLE_ID) {
          overwrites.push({
            id: STAFF_ROLE_ID,
            allow: [
              "ViewChannel",
              "SendMessages",
              "ReadMessageHistory"
            ]
          });
        }

        const ticket = await guild.channels.create({
          name: `ticket-${interaction.user.id}`,
          type: ChannelType.GuildText,
          permissionOverwrites: overwrites,
          reason: `Support ticket opened by ${interaction.user.tag}`
        });

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("prizen_ticket_close")
            .setLabel("Close Ticket")
            .setStyle(ButtonStyle.Danger)
        );

        await ticket.send({
          content: `${interaction.user}${STAFF_ROLE_ID ? ` <@&${STAFF_ROLE_ID}>` : ""}`,
          embeds: [
            makeEmbed(
              "PRIZEN Support Ticket",
              "Describe the issue you need help with. A staff member will respond when available."
            )
          ],
          components: [closeRow]
        });

        await interaction.reply({
          content: `Your private ticket is ready: ${ticket}`,
          ephemeral: true
        });

        await logToGuild(
          guild,
          `🎫 Ticket opened by ${interaction.user.tag}: ${ticket}`
        );
        return;
      }

      if (interaction.customId === "prizen_ticket_close") {
        const channel = interaction.channel;

        if (!channel || !channel.name.startsWith("ticket-")) {
          return interaction.reply({
            content: "This button only works in a ticket channel.",
            ephemeral: true
          });
        }

        const isTicketOwner =
          channel.name === `ticket-${interaction.user.id}`;

        if (!isTicketOwner && !isStaff(interaction)) {
          return interaction.reply({
            content: "Only the ticket owner or staff can close this ticket.",
            ephemeral: true
          });
        }

        await interaction.reply("Ticket closing in 3 seconds.");
        await wait(3000);
        await channel.delete("PRIZEN support ticket closed");
        return;
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);

    const reply = {
      content: "Something went wrong. Check the bot console for details.",
      ephemeral: true
    };

    try {
      if (interaction.deferred) {
        await interaction.editReply(reply);
      } else if (interaction.replied) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    } catch {}
  }
});

// ========================================
// WELCOME + ANTI-RAID JOIN MONITOR
// ========================================

client.on(Events.GuildMemberAdd, async member => {
  const guild = member.guild;
  const now = Date.now();

  const joins = (joinTracker.get(guild.id) || [])
    .filter(time => now - time < 20_000);

  joins.push(now);
  joinTracker.set(guild.id, joins);

  const raidMode = raidModeGuilds.has(guild.id);

  if (joins.length >= 8) {
    await logToGuild(
      guild,
      `🚨 **Possible join raid:** ${joins.length} members joined in 20 seconds. Raid mode is ${raidMode ? "ON" : "OFF"}. Please review the joins.`
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
          `Welcome ${member}!\n\nRead the server rules, meet the community, and check out our gaming and rewards channels.`,
          COLORS.purple
        )
      ]
    }).catch(error => {
      console.error("Welcome message failed:", error.message);
    });
  }
});

// ========================================
// BASIC ANTI-SPAM
// ========================================

client.on(Events.MessageCreate, async message => {
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

  const data = spamTracker.get(key) || {
    recent: [],
    lastContent: "",
    duplicates: 0
  };

  data.recent = data.recent.filter(time => now - time < 7000);
  data.recent.push(now);

  if (message.content && message.content === data.lastContent) {
    data.duplicates++;
  } else {
    data.duplicates = 0;
  }

  data.lastContent = message.content;
  spamTracker.set(key, data);

  const mentionCount = message.mentions.users.size;
  const tooManyMessages = data.recent.length >= 6;
  const duplicateSpam = data.duplicates >= 3;
  const mentionSpam = mentionCount >= 6;

  if (!tooManyMessages && !duplicateSpam && !mentionSpam) return;

  try {
    await message.delete();
  } catch {}

  let reason = "message flood";
  if (duplicateSpam) reason = "repeated duplicate messages";
  if (mentionSpam) reason = "excessive user mentions";

  await logToGuild(
    message.guild,
    `🚫 **Anti-spam action:** ${message.author.tag} (${message.author.id})\nReason: ${reason}\nChannel: ${message.channel}`
  );

  if (member.moderatable) {
    try {
      await member.timeout(60_000, `PRIZEN anti-spam: ${reason}`);
    } catch (error) {
      console.error("Timeout failed:", error.message);
    }
  }

  try {
    await message.channel.send({
      content: `${message.author}, slow down. Anti-spam protection detected repeated or excessive messages.`,
      allowedMentions: { users: [message.author.id] }
    });
  } catch {}
});

// ========================================
// BASIC SCAM-LIKE MESSAGE FLAGGING
// Logs suspicious-looking links; it does not
// automatically ban people or claim certainty.
// ========================================

client.on(Events.MessageCreate, async message => {
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
    `🔎 **Review flagged message**\nAuthor: ${message.author.tag} (${message.author.id})\nChannel: ${message.channel}\nMessage: ${message.content.slice(0, 700)}`
  );
});

// ========================================
// LOGIN
// ========================================

client.login(TOKEN).catch(error => {
  console.error("Bot login failed. Check BOT_TOKEN:", error.message);
  process.exit(1);
});
