
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  ChannelType,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const token = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error("Set BOT_TOKEN, CLIENT_ID, and GUILD_ID in FadeHost.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const purple = 0x8B5CF6;
const giveaways = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check Gitklub's connection"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show Gitklub's commands"),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Create the PRIZEN server layout")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Start a giveaway")
    .addStringOption(o =>
      o.setName("prize")
        .setDescription("What members can win")
        .setRequired(true))
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Duration in minutes")
        .setMinValue(1)
        .setMaxValue(10080)
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("endgiveaway")
    .setDescription("End a giveaway early")
    .addStringOption(o =>
      o.setName("message_id")
        .setDescription("Giveaway message ID")
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("Choose another giveaway winner")
    .addStringOption(o =>
      o.setName("message_id")
        .setDescription("Giveaway message ID")
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("Post the support ticket panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("ticket-close")
    .setDescription("Close the current ticket")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock the current channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Unlock the current channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Delete recent messages")
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("Number of messages, 1–100")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member")
    .addUserOption(o =>
      o.setName("member")
        .setDescription("Member to warn")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason for the warning")
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member")
    .addUserOption(o =>
      o.setName("member")
        .setDescription("Member to kick")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member")
    .addUserOption(o =>
      o.setName("member")
        .setDescription("Member to ban")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Temporarily timeout a member")
    .addUserOption(o =>
      o.setName("member")
        .setDescription("Member to timeout")
        .setRequired(true))
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Duration, 1–40320 minutes")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true))
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

async function registerCommands() {
  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commands }
  );
  console.log("Gitklub commands registered.");
}

function embed(title, description) {
  return new EmbedBuilder()
    .setColor(purple)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "PRIZEN • Powered by Gitklub" })
    .setTimestamp();
}

function isStaff(interaction, permission) {
  return interaction.memberPermissions?.has(permission);
}

async function finishGiveaway(messageId, channel, reroll = false) {
  const giveaway = giveaways.get(messageId);

  if (!giveaway) {
    return { error: "Giveaway data was not found. It may have ended or the bot may have restarted." };
  }

  if (giveaway.timer) clearTimeout(giveaway.timer);

  const entries = [...giveaway.entries];
  if (!entries.length) {
    giveaways.delete(messageId);
    return { winner: null };
  }

  const winner = entries[Math.floor(Math.random() * entries.length)];

  if (!reroll) giveaways.delete(messageId);

  await channel.send({
    embeds: [
      embed(
        reroll ? "🎉 New Giveaway Winner!" : "🎉 Giveaway Ended!",
        `**Prize:** ${giveaway.prize}\n**Winner:** <@${winner}>`
      )
    ]
  });

  return { winner };
}

client.once("ready", async () => {
  console.log(`Gitklub online as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Command registration failed:", error);
  }
});

client.on("guildMemberAdd", async member => {
  const channel = member.guild.channels.cache.find(
    c => c.name === "welcome" && c.isTextBased()
  );

  if (!channel) return;

  channel.send({
    embeds: [
      embed(
        "Welcome to PRIZEN",
        `Welcome, ${member}! Enjoy the community and check out the server channels.`
      )
    ]
  }).catch(console.error);
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === "ping") {
        return interaction.reply({
          content: `🏓 Pong! ${client.ws.ping}ms`,
          ephemeral: true
        });
      }

      if (commandName === "help") {
        return interaction.reply({
          embeds: [
            embed(
              "Gitklub Commands",
              "**Server:** `/setup`, `/lock`, `/unlock`, `/clear`\n" +
              "**Giveaways:** `/giveaway`, `/endgiveaway`, `/reroll`\n" +
              "**Tickets:** `/ticket-panel`, `/ticket-close`\n" +
              "**Moderation:** `/warn`, `/kick`, `/ban`, `/timeout`\n" +
              "**Other:** `/ping`, `/help`"
            )
          ],
          ephemeral: true
        });
      }

      if (commandName === "setup") {
        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        const categories = [
          {
            name: "INFORMATION",
            channels: ["welcome", "rules", "announcements"]
          },
          {
            name: "COMMUNITY",
            channels: ["general", "media", "bot-commands"]
          },
          {
            name: "REWARDS",
            channels: ["giveaways", "rewards"]
          },
          {
            name: "SUPPORT",
            channels: ["support"]
          },
          {
            name: "STAFF",
            channels: ["staff-chat", "mod-logs"]
          }
        ];

        for (const group of categories) {
          let category = guild.channels.cache.find(
            c => c.type === ChannelType.GuildCategory &&
                 c.name === group.name
          );

          if (!category) {
            category = await guild.channels.create({
              name: group.name,
              type: ChannelType.GuildCategory,
              ...(group.name === "STAFF" ? {
                permissionOverwrites: [{
                  id: guild.roles.everyone.id,
                  deny: [PermissionFlagsBits.ViewChannel]
                }]
              } : {})
            });
          }

          for (const name of group.channels) {
            const exists = guild.channels.cache.find(
              c => c.name === name && c.parentId === category.id
            );

            if (!exists) {
              await guild.channels.create({
                name,
                type: ChannelType.GuildText,
                parent: category.id
              });
            }
          }
        }

        return interaction.editReply(
          "✅ PRIZEN layout created! Existing matching channels were kept."
        );
      }

      if (commandName === "giveaway") {
        const prize = interaction.options.getString("prize");
        const minutes = interaction.options.getInteger("minutes");

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("giveaway_enter")
            .setLabel("Enter Giveaway")
            .setEmoji("🎉")
            .setStyle(ButtonStyle.Primary)
        );

        const message = await interaction.channel.send({
          embeds: [
            embed(
              "🎉 PRIZEN GIVEAWAY",
              `**Prize:** ${prize}\n` +
              `**Hosted by:** ${interaction.user}\n` +
              `**Duration:** ${minutes} minute(s)\n\n` +
              "Press the button below to enter!"
            )
          ],
          components: [row]
        });

        const giveaway = {
          prize,
          entries: new Set(),
          timer: null
        };

        giveaways.set(message.id, giveaway);

        giveaway.timer = setTimeout(async () => {
          try {
            const result = await finishGiveaway(
              message.id,
              interaction.channel
            );

            if (result.error) {
              await interaction.channel.send(result.error);
            } else if (!result.winner) {
              await interaction.channel.send(
                `The giveaway for **${prize}** ended with no entries.`
              );
            }
          } catch (error) {
            console.error("Giveaway finish failed:", error);
          }
        }, minutes * 60 * 1000);

        return interaction.reply({
          content: `✅ Giveaway posted! Message ID: \`${message.id}\``,
          ephemeral: true
        });
      }

      if (commandName === "endgiveaway" ||
          commandName === "reroll") {
        const id = interaction.options.getString("message_id");
        const result = await finishGiveaway(
          id,
          interaction.channel,
          commandName === "reroll"
        );

        if (result.error) {
          return interaction.reply({
            content: result.error,
            ephemeral: true
          });
        }

        if (!result.winner) {
          return interaction.reply({
            content: "No entries were recorded for that giveaway.",
            ephemeral: true
          });
        }

        return interaction.reply({
          content: `✅ Winner selected: <@${result.winner}>`,
          ephemeral: true
        });
      }

      if (commandName === "ticket-panel") {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("ticket_create")
            .setLabel("Open a Ticket")
            .setEmoji("🎫")
            .setStyle(ButtonStyle.Primary)
        );

        await interaction.channel.send({
          embeds: [
            embed(
              "PRIZEN Support",
              "Need help? Press the button below to open a private support ticket."
            )
          ],
          components: [row]
        });

        return interaction.reply({
          content: "✅ Ticket panel posted.",
          ephemeral: true
        });
      }

      if (commandName === "ticket-close") {
        if (!interaction.channel.name.startsWith("ticket-")) {
          return interaction.reply({
            content: "Use this command inside a ticket channel.",
            ephemeral: true
          });
        }

        await interaction.reply("🔒 Closing this ticket...");
        setTimeout(() => {
          interaction.channel.delete().catch(console.error);
        }, 2000);
        return;
      }

      if (commandName === "lock" || commandName === "unlock") {
        const locked = commandName === "lock";

        await interaction.channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          { SendMessages: locked ? false : null }
        );

        return interaction.reply({
          content: locked
            ? "🔒 Channel locked."
            : "🔓 Channel unlocked."
        });
      }

      if (commandName === "clear") {
        const amount = interaction.options.getInteger("amount");

        const deleted = await interaction.channel.bulkDelete(
          amount,
          true
        );

        return interaction.reply({
          content: `🧹 Deleted ${deleted.size} recent message(s).`,
          ephemeral: true
        });
      }

      if (["warn", "kick", "ban", "timeout"].includes(commandName)) {
        const user = interaction.options.getUser("member");
        const reason =
          interaction.options.getString("reason") || "No reason provided.";

        if (user.id === interaction.user.id) {
          return interaction.reply({
            content: "You cannot moderate yourself.",
            ephemeral: true
          });
        }

        const member = await interaction.guild.members
          .fetch(user.id).catch(() => null);

        if (!member) {
          return interaction.reply({
            content: "That member is no longer in this server.",
            ephemeral: true
          });
        }

        if (member.id === interaction.guild.ownerId) {
          return interaction.reply({
            content: "The server owner cannot be moderated by this bot.",
            ephemeral: true
          });
        }

        if (!member.moderatable &&
            ["kick", "ban", "timeout"].includes(commandName)) {
          return interaction.reply({
            content: "I cannot moderate that member. Check my role position and permissions.",
            ephemeral: true
          });
        }

        if (commandName === "warn") {
          await user.send(
            `You received a warning in **${interaction.guild.name}**.\nReason: ${reason}`
          ).catch(() => null);

          return interaction.reply({
            content: `⚠️ ${user} was warned. Reason: ${reason}`
          });
        }

        if (commandName === "kick") {
          await member.kick(reason);
        } else if (commandName === "ban") {
          await interaction.guild.members.ban(user.id, { reason });
        } else if (commandName === "timeout") {
          const minutes = interaction.options.getInteger("minutes");
          await member.timeout(minutes * 60 * 1000, reason);
        }

        return interaction.reply({
          content: `✅ ${user.tag} action completed: **${commandName}**. Reason: ${reason}`
        });
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "giveaway_enter") {
        const messageId = interaction.message.id;
        const giveaway = giveaways.get(messageId);

        if (!giveaway) {
          return interaction.reply({
            content: "This giveaway has ended or its data is unavailable.",
            ephemeral: true
          });
        }

        if (giveaway.entries.has(interaction.user.id)) {
          return interaction.reply({
            content: "You're already entered!",
            ephemeral: true
          });
        }

        giveaway.entries.add(interaction.user.id);

        return interaction.reply({
          content: "🎉 You're entered in the giveaway!",
          ephemeral: true
        });
      }

      if (interaction.customId === "ticket_create") {
        const guild = interaction.guild;
        const existing = guild.channels.cache.find(
          c => c.name === `ticket-${interaction.user.id}`
        );

        if (existing) {
          return interaction.reply({
            content: `You already have a ticket: ${existing}`,
            ephemeral: true
          });
        }

        const support = guild.channels.cache.find(
          c => c.name === "SUPPORT" &&
               c.type === ChannelType.GuildCategory
        );

        const ticket = await guild.channels.create({
          name: `ticket-${interaction.user.id}`,
          type: ChannelType.GuildText,
          ...(support ? { parent: support.id } : {}),
          permissionOverwrites: [
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
          ]
        });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("ticket_close")
            .setLabel("Close Ticket")
            .setStyle(ButtonStyle.Danger)
        );

        await ticket.send({
          content: `${interaction.user} Welcome to your private ticket. Describe your issue here.`,
          components: [row]
        });

        return interaction.reply({
          content: `✅ Ticket created: ${ticket}`,
          ephemeral: true
        });
      }

      if (interaction.customId === "ticket_close") {
        const isOwner = interaction.channel.name ===
          `ticket-${interaction.user.id}`;

        const canManage = interaction.memberPermissions?.has(
          PermissionFlagsBits.ManageChannels
        );

        if (!isOwner && !canManage) {
          return interaction.reply({
            content: "Only the ticket opener or staff with Manage Channels can close this ticket.",
            ephemeral: true
          });
        }

        await interaction.reply("🔒 Ticket closing...");
        setTimeout(() => {
          interaction.channel.delete().catch(console.error);
        }, 2000);
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.isRepliable() && !interaction.replied &&
        !interaction.deferred) {
      await interaction.reply({
        content: "Something went wrong. Check the FadeHost console.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

client.login(token);
