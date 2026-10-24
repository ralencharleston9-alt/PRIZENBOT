
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require("discord.js");

const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || "";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error(
    "Missing BOT_TOKEN, CLIENT_ID, or GUILD_ID environment variable."
  );
}

const BRAND = "PRIZEN";
const PURPLE = 0x9333EA;
const DISCORD_INVITE = "https://discord.gg/UG7vCBAHN4";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.MessageReactions
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// Temporary in-memory state; this resets when the bot restarts.
const recentMessages = new Map();
const recentJoins = new Map();
const activeGiveaways = new Map();
const ticketOwners = new Map();
const raidAlerts = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Create or find PRIZEN's basic server channels.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member and log the action.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o =>
      o.setName("member").setDescription("Member to warn").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason for the warning").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Temporarily restrict a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o =>
      o.setName("member").setDescription("Member to timeout").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("minutes").setDescription("Duration in minutes (1–10080)")
        .setRequired(true).setMinValue(1).setMaxValue(10080)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete recent messages in this channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o =>
      o.setName("amount").setDescription("Number of messages (1–100)")
        .setRequired(true).setMinValue(1).setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Prevent @everyone from sending messages in this channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Allow @everyone to send messages in this channel again.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("raidmode")
    .setDescription("Manually lock or unlock a channel during a raid.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addBooleanOption(o =>
      o.setName("enabled").setDescription("True to lock, false to unlock").setRequired(true)
    )
    .addChannelOption(o =>
      o.setName("channel").setDescription("Channel to protect").setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    ),

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Start a simple community giveaway.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName("prize").setDescription("Prize being offered").setRequired(true)
        .setMaxLength(150)
    )
    .addIntegerOption(o =>
      o.setName("minutes").setDescription("Duration (1–10080 minutes)")
        .setRequired(true).setMinValue(1).setMaxValue(10080)
    )
    .addIntegerOption(o =>
      o.setName("winners").setDescription("Number of winners (1–10)")
        .setRequired(false).setMinValue(1).setMaxValue(10)
    ),

  new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("Post the support ticket panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("ticket-close")
    .setDescription("Close the ticket channel you are in.")
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason for closing").setRequired(false)
    )
].map(command => command.toJSON());

function makeEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `${BRAND} • Community & Security` })
    .setTimestamp();
}

function isStaff(member) {
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    (STAFF_ROLE_ID && member.roles.cache.has(STAFF_ROLE_ID));
}

async function findOrCreateTextChannel(guild, name, options = {}) {
  let channel = guild.channels.cache.find(
    c => c.type === ChannelType.GuildText && c.name === name
  );

  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      ...options
    });
  }

  return channel;
}

async function getLogChannel(guild) {
  return guild.channels.cache.find(
    c => c.type === ChannelType.GuildText && c.name === "security-logs"
  ) || null;
}

async function logAction(guild, description) {
  const channel = await getLogChannel(guild);
  if (!channel) return;

  await channel.send({
    embeds: [makeEmbed("Security & Moderation Log", description)]
  }).catch(() => {});
}

async function replyPrivate(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

// Register slash commands for the configured server.
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("PRIZEN slash commands registered.");
}

client.once("ready", async () => {
  console.log(`PRIZEN bot online as ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: "over PRIZEN • /setup" }],
    status: "online"
  });

  try {
    await registerCommands();
  } catch (error) {
    console.error("Could not register slash commands:", error);
  }
});

// WELCOME + JOIN-SPIKE DETECTION
client.on("guildMemberAdd", async member => {
  const welcome = member.guild.channels.cache.find(
    c => c.type === ChannelType.GuildText && c.name === "welcome"
  );

  if (welcome) {
    await welcome.send({
      content: `Welcome ${member} to **${BRAND}**!`,
      embeds: [
        makeEmbed(
          "Welcome to PRIZEN",
          `Hey ${member}, glad you're here!\n\n` +
          `• Read the server rules before chatting.\n` +
          `• Explore the gaming and community channels.\n` +
          `• Check official announcements for events and rewards.\n\n` +
          `[Join the community invite](${DISCORD_INVITE})`
        ).setThumbnail(member.user.displayAvatarURL())
      ]
    }).catch(() => {});
  }

  const now = Date.now();
  const joins = (recentJoins.get(member.guild.id) || [])
    .filter(time => now - time < 20_000);

  joins.push(now);
  recentJoins.set(member.guild.id, joins);

  if (joins.length >= 8) {
    const lastAlert = raidAlerts.get(member.guild.id) || 0;

    if (now - lastAlert > 60_000) {
      raidAlerts.set(member.guild.id, now);

      await logAction(
        member.guild,
        `⚠️ **Possible join raid detected.** ${joins.length} members joined within 20 seconds. Staff should review the member list and enable `/raidmode` on affected chat channels if needed. No mass bans were performed.`
      );
    }
  }

  await logAction(
    member.guild,
    `📥 Member joined: ${member.user.tag} (${member.id})`
  );
});

client.on("guildMemberRemove", async member => {
  await logAction(
    member.guild,
    `📤 Member left: ${member.user.tag} (${member.id})`
  );
});

// ANTI-SPAM + MENTION FLOOD PROTECTION
client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot || !message.member) return;

  const content = message.content || "";
  const member = message.member;

  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const now = Date.now();
  const key = `${message.guild.id}:${message.author.id}`;

  const history = (recentMessages.get(key) || [])
    .filter(item => now - item.time < 8_000);

  history.push({ time: now, content });
  recentMessages.set(key, history);

  const repeated = history.filter(item => item.content === content).length >= 4;
  const flood = history.length >= 7;
  const mentionFlood = message.mentions.users.size + message.mentions.roles.size >= 6;

  if (repeated || flood || mentionFlood) {
    await message.delete().catch(() => {});

    const reason = mentionFlood
      ? "excessive mentions"
      : "repeated messages or message flooding";

    try {
      await member.timeout(60_000, `PRIZEN anti-spam: ${reason}`);
      await logAction(
        message.guild,
        `🛡️ Anti-spam action: timed out ${message.author.tag} for 1 minute. Reason: ${reason}.`
      );
    } catch {
      await logAction(
        message.guild,
        `⚠️ Anti-spam detected activity from ${message.author.tag}, but the bot could not timeout the member. Check role hierarchy and permissions.`
      );
    }
  }

  // Flag suspicious giveaway-style messages for staff review.
  const scamPattern =
    /(free nitro|claim your prize|verify your account|steam gift|airdrop)/i;

  if (
    scamPattern.test(content) &&
    /(https?:\/\/|discord\.gg\/|discordapp\.com\/invite\/)/i.test(content)
  ) {
    await logAction(
      message.guild,
      `🔎 Possible scam message from ${message.author.tag} in <#${message.channel.id}>. Please review it.`
    );
  }
});

// SLASH COMMANDS + BUTTONS
client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton()) {
      // Giveaway entry
      if (interaction.customId.startsWith("giveaway:")) {
        const giveawayId = interaction.customId.slice("giveaway:".length);
        const giveaway = activeGiveaways.get(giveawayId);

        if (!giveaway || giveaway.ended) {
          return replyPrivate(interaction, "This giveaway has ended.");
        }

        giveaway.entries.add(interaction.user.id);
        return replyPrivate(interaction, "You're entered! Good luck.");
      }

      // Ticket creation
      if (interaction.customId === "prizen:create-ticket") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guild = interaction.guild;
        const category = guild.channels.cache.find(
          c => c.type === ChannelType.GuildCategory && c.name === "PRIZEN TICKETS"
        );

        if (!category) {
          return interaction.editReply(
            "Ticket setup is incomplete. Ask a moderator to run `/setup`."
          );
        }

        const existing = guild.channels.cache.find(
          c => c.type === ChannelType.GuildText &&
            c.topic === `ticket-owner:${interaction.user.id}`
        );

        if (existing) {
          return interaction.editReply(`You already have a ticket: ${existing}`);
        }

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
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles
            ]
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ReadMessageHistory
            ]
          }
        ];

        if (STAFF_ROLE_ID && guild.roles.cache.has(STAFF_ROLE_ID)) {
          overwrites.push({
            id: STAFF_ROLE_ID,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory
            ]
          });
        }

        const channel = await guild.channels.create({
          name: `ticket-${interaction.user.username}`
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "")
            .slice(0, 80),
          type: ChannelType.GuildText,
          parent: category.id,
          topic: `ticket-owner:${interaction.user.id}`,
          permissionOverwrites: overwrites
        });

        ticketOwners.set(channel.id, interaction.user.id);

        await channel.send({
          content: `${interaction.user}`,
          embeds: [
            makeEmbed(
              "PRIZEN Support Ticket",
              "Please explain what you need help with. A staff member will respond when available."
            )
          ],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("prizen:close-ticket")
                .setLabel("Close Ticket")
                .setStyle(ButtonStyle.Secondary)
            )
          ]
        });

        return interaction.editReply(`Your ticket is ready: ${channel}`);
      }

      // Close ticket button
      if (interaction.customId === "prizen:close-ticket") {
        const channel = interaction.channel;
        const ownerId = ticketOwners.get(channel.id) ||
          (channel.topic || "").replace("ticket-owner:", "");

        if (interaction.user.id !== ownerId && !isStaff(interaction.member)) {
          return replyPrivate(interaction, "Only the ticket owner or staff can close this ticket.");
        }

        await interaction.reply({
          embeds: [makeEmbed("Ticket Closed", `Closed by ${interaction.user.tag}.`)]
        });

        await logAction(
          interaction.guild,
          `🎫 Ticket ${channel.name} closed by ${interaction.user.tag}.`
        );

        await channel.setName(`closed-${channel.name}`.slice(0, 100)).catch(() => {});

        if (ownerId) {
          await channel.permissionOverwrites.edit(ownerId, {
            SendMessages: false
          }).catch(() => {});
        }

        return;
      }

      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName, guild, member } = interaction;

    if (!guild) {
      return replyPrivate(interaction, "Use this command inside the PRIZEN server.");
    }

    // SETUP
    if (commandName === "setup") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const welcome = await findOrCreateTextChannel(guild, "welcome");
      const logs = await findOrCreateTextChannel(guild, "security-logs", {
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.ReadMessageHistory
            ]
          },
          ...(STAFF_ROLE_ID && guild.roles.cache.has(STAFF_ROLE_ID)
            ? [{
                id: STAFF_ROLE_ID,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.ReadMessageHistory
                ]
              }]
            : [])
        ]
      });

      let ticketCategory = guild.channels.cache.find(
        c => c.type === ChannelType.GuildCategory && c.name === "PRIZEN TICKETS"
      );

      if (!ticketCategory) {
        ticketCategory = await guild.channels.create({
          name: "PRIZEN TICKETS",
          type: ChannelType.GuildCategory,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel]
            }
          ]
        });
      }

      await interaction.editReply(
        `PRIZEN setup complete!\n` +
        `Welcome channel: ${welcome}\n` +
        `Security logs: ${logs}\n` +
        `Ticket category: **${ticketCategory.name}**\n\n` +
        `Next, use \`/ticket-panel\` in the channel where you want the support panel.`
      );

      await logAction(guild, `⚙️ Server setup run by ${interaction.user.tag}.`);
      return;
    }

    // WARN
    if (commandName === "warn") {
      const target = interaction.options.getUser("member", true);
      const reason = interaction.options.getString("reason", true);

      await logAction(
        guild,
        `⚠️ ${target.tag} (${target.id}) was warned by ${interaction.user.tag}. Reason: ${reason}`
      );

      return interaction.reply({
        embeds: [makeEmbed("Warning Logged", `${target} was warned.\n**Reason:** ${reason}`)],
        flags: MessageFlags.Ephemeral
      });
    }

    // TIMEOUT
    if (commandName === "timeout") {
      const target = interaction.options.getUser("member", true);
      const minutes = interaction.options.getInteger("minutes", true);
      const reason = interaction.options.getString("reason") || "No reason provided.";

      const targetMember = await guild.members.fetch(target.id).catch(() => null);

      if (!targetMember) {
        return replyPrivate(interaction, "That member is no longer in this server.");
      }

      if (target.id === interaction.user.id || target.id === client.user.id) {
        return replyPrivate(interaction, "You cannot timeout yourself or the bot.");
      }

      if (!targetMember.moderatable) {
        return replyPrivate(interaction, "I cannot timeout that member. Check my permissions and role position.");
      }

      await targetMember.timeout(minutes * 60_000, reason);

      await logAction(
        guild,
        `⏱️ ${target.tag} was timed out for ${minutes} minute(s) by ${interaction.user.tag}. Reason: ${reason}`
      );

      return replyPrivate(interaction, `Timed out ${target.tag} for ${minutes} minute(s).`);
    }

    // PURGE
    if (commandName === "purge") {
      const amount = interaction.options.getInteger("amount", true);

      if (!interaction.channel || !interaction.channel.isTextBased()) {
        return replyPrivate(interaction, "This command needs a text channel.");
      }

      const deleted = await interaction.channel.bulkDelete(amount, true);

      await logAction(
        guild,
        `🧹 ${interaction.user.tag} deleted ${deleted.size} message(s) in <#${interaction.channel.id}>.`
      );

      return replyPrivate(interaction, `Deleted ${deleted.size} recent message(s). Discord won't bulk-delete messages older than 14 days.`);
    }

    // LOCK / UNLOCK
    if (commandName === "lock" || commandName === "unlock") {
      const channel = interaction.channel;

      if (!channel || !channel.permissionOverwrites) {
        return replyPrivate(interaction, "This channel cannot be locked with this command.");
      }

      const shouldLock = commandName === "lock";

      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: shouldLock ? false : null
      });

      await logAction(
        guild,
        `${shouldLock ? "🔒" : "🔓"} ${channel} was ${shouldLock ? "locked" : "unlocked"} by ${interaction.user.tag}.`
      );

      return replyPrivate(
        interaction,
        `${channel} is now ${shouldLock ? "locked for @everyone" : "unlocked for @everyone"}.`
      );
    }

    // RAID MODE
    if (commandName === "raidmode") {
      const enabled = interaction.options.getBoolean("enabled", true);
      const channel = interaction.options.getChannel("channel", true);

      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: enabled ? false : null
      });

      await logAction(
        guild,
        `🚨 Raid mode ${enabled ? "enabled" : "disabled"} by ${interaction.user.tag} in ${channel}.`
      );

      return replyPrivate(
        interaction,
        `Raid mode ${enabled ? "enabled" : "disabled"} for ${channel}.`
      );
    }

    // GIVEAWAY
    if (commandName === "giveaway") {
      const prize = interaction.options.getString("prize", true);
      const minutes = interaction.options.getInteger("minutes", true);
      const winnersCount = interaction.options.getInteger("winners") || 1;

      const giveawayId = `${interaction.id}`;
      const endsAt = Date.now() + minutes * 60_000;

      const embed = makeEmbed(
        "🎉 PRIZEN GIVEAWAY",
        `**Prize:** ${prize}\n\n` +
        `**Winners:** ${winnersCount}\n` +
        `**Ends:** <t:${Math.floor(endsAt / 1000)}:R>\n\n` +
        `Press **Enter Giveaway** to participate.\n` +
        `Follow the official rules and never share your password or login codes.`
      );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`giveaway:${giveawayId}`)
          .setLabel("Enter Giveaway")
          .setStyle(ButtonStyle.Primary)
      );

      const post = await interaction.channel.send({
        embeds: [embed],
        components: [row]
      });

      const giveaway = {
        id: giveawayId,
        guildId: guild.id,
        channelId: interaction.channel.id,
        messageId: post.id,
        prize,
        winnersCount,
        endsAt,
        entries: new Set(),
        ended: false
      };

      activeGiveaways.set(giveawayId, giveaway);

      await logAction(
        guild,
        `🎁 Giveaway started by ${interaction.user.tag}: **${prize}**, ending in ${minutes} minute(s).`
      );

      await interaction.reply({
        content: `Giveaway posted in ${interaction.channel}.`,
        flags: MessageFlags.Ephemeral
      });

      setTimeout(async () => {
        const current = activeGiveaways.get(giveawayId);
        if (!current || current.ended) return;

        current.ended = true;

        const entrants = [...current.entries];
        const winners = [];

        while (entrants.length && winners.length < current.winnersCount) {
          const index = Math.floor(Math.random() * entrants.length);
          winners.push(entrants.splice(index, 1)[0]);
        }

        const channel = await client.channels.fetch(current.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return;

        const message = await channel.messages.fetch(current.messageId).catch(() => null);
        if (message) {
          const endedEmbed = makeEmbed(
            "🏁 GIVEAWAY ENDED",
            `**Prize:** ${current.prize}\n\n` +
            (winners.length
              ? `**Winner(s):** ${winners.map(id => `<@${id}>`).join(", ")}`
              : "No valid entries were received.") +
            `\n\nEntries received: ${current.entries.size}`
          );

          await message.edit({
            embeds: [endedEmbed],
            components: []
          }).catch(() => {});
        }

        await channel.send(
          winners.length
            ? `Congratulations ${winners.map(id => `<@${id}>`).join(", ")}! You won **${current.prize}**. Please follow the official claim instructions from PRIZEN staff.`
            : `The giveaway for **${current.prize}** ended without entries.`
        ).catch(() => {});

        await logAction(
          guild,
          `🏁 Giveaway ended: **${current.prize}**. ${winners.length ? `Winner(s): ${winners.join(", ")}` : "No entries."}`
        );

        activeGiveaways.delete(giveawayId);
      }, minutes * 60_000);

      return;
    }

    // TICKET PANEL
    if (commandName === "ticket-panel") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("prizen:create-ticket")
          .setLabel("Create Support Ticket")
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.channel.send({
        embeds: [
          makeEmbed(
            "PRIZEN Support Center",
            "Need help with the server, an event, or a report?\n\n" +
            "Press the button below to open a private support channel. Please do not share passwords or login codes."
          )
        ],
        components: [row]
      });

      return replyPrivate(interaction, "Support ticket panel posted.");
    }

    // TICKET CLOSE SLASH COMMAND
    if (commandName === "ticket-close") {
      const channel = interaction.channel;
      const ownerId = ticketOwners.get(channel.id) ||
        (channel.topic || "").replace("ticket-owner:", "");

      if (!channel || channel.type !== ChannelType.GuildText || !ownerId) {
        return replyPrivate(interaction, "This does not look like a PRIZEN ticket channel.");
      }

      if (interaction.user.id !== ownerId && !isStaff(member)) {
        return replyPrivate(interaction, "Only the ticket owner or staff can close this ticket.");
      }

      await channel.send({
        embeds: [makeEmbed("Ticket Closed", `Closed by ${interaction.user.tag}.`)]
      });

      await channel.setName(`closed-${channel.name}`.slice(0, 100)).catch(() => {});
      await channel.permissionOverwrites.edit(ownerId, {
        SendMessages: false
      }).catch(() => {});

      await logAction(
        guild,
        `🎫 Ticket ${channel.name} closed by ${interaction.user.tag}.`
      );

      return replyPrivate(interaction, "Ticket closed.");
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.isRepliable()) {
      await replyPrivate(
        interaction,
        "Something went wrong. Check the bot logs and permissions, then try again."
      ).catch(() => {});
    }
  }
});

client.on("error", error => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

client.login(TOKEN);
