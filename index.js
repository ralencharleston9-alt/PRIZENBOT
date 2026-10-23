const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const token = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error("Set BOT_TOKEN, CLIENT_ID, and GUILD_ID.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check Gitklub's response time"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show Gitklub bot information")
].map(command => command.toJSON());

client.once(Events.ClientReady, async () => {
  console.log(`Gitklub online as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(token);

  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commands }
  );

  console.log("Gitklub commands registered!");
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply(`🏓 Pong! ${client.ws.ping}ms`);
  }

  if (interaction.commandName === "help") {
    await interaction.reply({
      content:
        "**GITKLUB COMMANDS**\n" +
        "`/ping` — Check bot response\n" +
        "`/help` — View commands\n\n" +
        "PRIZEN • Community & Rewards",
      ephemeral: true
    });
  }
});

client.login(token);