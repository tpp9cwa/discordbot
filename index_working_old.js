require("dotenv").config();

const {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
} = require("discord.js");

function envValue(name, { optional = false } = {}) {
  const value = process.env[name]?.trim();

  if (!value || value.startsWith("paste_")) {
    if (optional) return null;
    throw new Error(`Set ${name} in your environment variables.`);
  }

  return value;
}

const DISCORD_TOKEN = envValue("DISCORD_TOKEN");
const SOURCE_CHANNEL_ID = envValue("SOURCE_CHANNEL_ID");
const DESTINATION_CHANNEL_ID = envValue("DESTINATION_CHANNEL_ID");
const SOURCE_AUTHOR_ID = envValue("SOURCE_AUTHOR_ID", { optional: true });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function copyEmbed(embed) {
  const copy = new EmbedBuilder();
  let hasContent = false;

  if (embed.color !== null) copy.setColor(embed.color);
  if (embed.title) {
    copy.setTitle(embed.title.slice(0, 256));
    hasContent = true;
  }
  if (embed.url) copy.setURL(embed.url);
  if (embed.description) {
    copy.setDescription(embed.description.slice(0, 4096));
    hasContent = true;
  }
  if (embed.author?.name) {
    copy.setAuthor({
      name: embed.author.name.slice(0, 256),
      url: embed.author.url ?? undefined,
      iconURL: embed.author.iconURL ?? undefined,
    });
    hasContent = true;
  }
  if (embed.fields?.length) {
    copy.addFields(
      embed.fields.slice(0, 25).map(field => ({
        name: field.name.slice(0, 256),
        value: field.value.slice(0, 1024),
        inline: field.inline,
      }))
    );
    hasContent = true;
  }
  if (embed.thumbnail?.url) {
    copy.setThumbnail(embed.thumbnail.url);
    hasContent = true;
  }
  if (embed.image?.url) {
    copy.setImage(embed.image.url);
    hasContent = true;
  }
  if (embed.footer?.text) {
    copy.setFooter({
      text: embed.footer.text.slice(0, 2048),
      iconURL: embed.footer.iconURL ?? undefined,
    });
    hasContent = true;
  }
  if (embed.timestamp) copy.setTimestamp(new Date(embed.timestamp));

  return hasContent ? copy : null;
}

function buildFallbackText(message) {
  const lines = [];

  for (const embed of message.embeds) {
    lines.push(embed.title, embed.description, embed.url);
  }

  for (const row of message.components ?? []) {
    for (const component of row.components ?? []) {
      if (component.url) lines.push(component.url);
    }
  }

  return [...new Set(lines.filter(Boolean))].join("\n").slice(0, 2000);
}

client.once(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Watching source channel: ${SOURCE_CHANNEL_ID}`);
  console.log(`Posting to destination channel: ${DESTINATION_CHANNEL_ID}`);
  console.log(
    SOURCE_AUTHOR_ID
      ? `Filtering source author: ${SOURCE_AUTHOR_ID}`
      : "SOURCE_AUTHOR_ID is blank; accepting every message in the intake channel."
  );
});

client.on(Events.MessageCreate, async message => {
  if (message.channelId !== SOURCE_CHANNEL_ID) return;
  if (message.author.id === client.user.id) return;
  if (SOURCE_AUTHOR_ID && message.author.id !== SOURCE_AUTHOR_ID) return;

  console.log(
    `Received source message ${message.id} from ${message.author.tag}` +
      (message.webhookId ? ` via webhook ${message.webhookId}` : "")
  );

  try {
    const destination = await client.channels.fetch(DESTINATION_CHANNEL_ID);

    if (!destination?.isTextBased() || !destination.isSendable()) {
      throw new Error("The destination channel is not a sendable text channel.");
    }

    const embeds = message.embeds
      .slice(0, 10)
      .map(copyEmbed)
      .filter(Boolean);

    const files = [...message.attachments.values()].slice(0, 10).map(file => ({
      attachment: file.url,
      name: file.name ?? `attachment-${file.id}`,
      description: file.description ?? undefined,
    }));

    let content = message.content?.trim() ?? "";
    if (!content && embeds.length === 0 && files.length === 0) {
      content = buildFallbackText(message);
    }

    if (!content && embeds.length === 0 && files.length === 0) {
      console.log(`Skipped empty source message ${message.id}.`);
      return;
    }

    await destination.send({
      content: content || undefined,
      embeds,
      files,
      allowedMentions: { parse: [] },
    });

    console.log(`Forwarded source message ${message.id} successfully.`);
  } catch (error) {
    console.error(`Could not forward source message ${message.id}:`, error);
  }
});

client.on(Events.Error, error => {
  console.error("Discord client error:", error);
});

client.login(DISCORD_TOKEN);
