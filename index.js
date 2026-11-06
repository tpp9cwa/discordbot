
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
const FREE_DESTINATION_CHANNEL_ID = envValue("FREE_DESTINATION_CHANNEL_ID");
const SOURCE_AUTHOR_ID = envValue("SOURCE_AUTHOR_ID", { optional: true });

if (new Set([
  SOURCE_CHANNEL_ID,
  DESTINATION_CHANNEL_ID,
  FREE_DESTINATION_CHANNEL_ID,
]).size !== 3) {
  throw new Error(
    "Source, paid destination, and free destination must have different channel IDs."
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const LITE_SERVER_DISCLAIMER =
  /Deals in Lite Server are delayed,\s*join now for Price Errors,\s*Glitches,\s*and Deals in real time/gi;

function stripDisclaimer(text) {
  if (!text) return "";

  const cleaned = text.replace(LITE_SERVER_DISCLAIMER, "");

  if (cleaned === text) return text;

  return cleaned
    .replace(/^[\s\-–—|:]+|[\s\-–—|:]+$/g, "")
    .trim();
}

function copyEmbed(embed) {
  const copy = new EmbedBuilder();
  let hasContent = false;

  const title = stripDisclaimer(embed.title);
  const description = stripDisclaimer(embed.description);

  if (embed.color !== null) copy.setColor(embed.color);

  if (title) {
    copy.setTitle(title.slice(0, 256));
    hasContent = true;
  }

  if (embed.url) copy.setURL(embed.url);

  if (description) {
    copy.setDescription(description.slice(0, 4096));
    hasContent = true;
  }

  if (embed.author?.name) {
    copy.setAuthor({
      name: stripDisclaimer(embed.author.name).slice(0, 256) || "Deal",
      url: embed.author.url ?? undefined,
      iconURL: embed.author.iconURL ?? undefined,
    });
    hasContent = true;
  }

  const fields = (embed.fields ?? [])
    .slice(0, 25)
    .map(field => ({
      name: stripDisclaimer(field.name).slice(0, 256) || "Details",
      value: stripDisclaimer(field.value).slice(0, 1024) || "—",
      inline: field.inline,
    }))
    .filter(field => field.name && field.value);

  if (fields.length) {
    copy.addFields(fields);
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
    const footer = stripDisclaimer(embed.footer.text);

    if (footer) {
      copy.setFooter({
        text: footer.slice(0, 2048),
        iconURL: embed.footer.iconURL ?? undefined,
      });
      hasContent = true;
    }
  }

  if (embed.timestamp) {
    copy.setTimestamp(new Date(embed.timestamp));
  }

  return hasContent ? copy : null;
}

function buildFallbackText(message) {
  const lines = [];

  for (const embed of message.embeds) {
    lines.push(
      stripDisclaimer(embed.title),
      stripDisclaimer(embed.description),
      embed.url
    );
  }

  for (const row of message.components ?? []) {
    for (const component of row.components ?? []) {
      if (component.url) lines.push(component.url);
    }
  }

  return [...new Set(lines.filter(Boolean))]
    .join("\n")
    .slice(0, 2000);
}

async function forwardTo(channelId, payload, messageId) {
  try {
    const destination = await client.channels.fetch(channelId);

    if (!destination?.isTextBased() || !destination.isSendable()) {
      throw new Error("Channel is not a sendable text channel.");
    }

    await destination.send(payload);

    console.log(`Forwarded ${messageId} to ${channelId}.`);
  } catch (error) {
    console.error(
      `Could not forward ${messageId} to ${channelId}:`,
      error
    );
  }
}

client.once(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Watching source channel: ${SOURCE_CHANNEL_ID}`);
  console.log(`Paid destination: ${DESTINATION_CHANNEL_ID}`);
  console.log(
    `Free destination (deals-aw-yea): ${FREE_DESTINATION_CHANNEL_ID}`
  );

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
    const embeds = message.embeds
      .slice(0, 10)
      .map(copyEmbed)
      .filter(Boolean);

    const files = [...message.attachments.values()]
      .slice(0, 10)
      .map(file => ({
        attachment: file.url,
        name: file.name ?? `attachment-${file.id}`,
        description: file.description ?? undefined,
      }));

    let content = stripDisclaimer(message.content);

    if (!content && embeds.length === 0 && files.length === 0) {
      content = buildFallbackText(message);
    }

    if (!content && embeds.length === 0 && files.length === 0) {
      console.log(`Skipped empty source message ${message.id}.`);
      return;
    }

    const payload = {
      content: content ? content.slice(0, 2000) : undefined,
      embeds,
      files,
      allowedMentions: { parse: [] },
    };

    await Promise.all([
      forwardTo(DESTINATION_CHANNEL_ID, payload, message.id),
      forwardTo(FREE_DESTINATION_CHANNEL_ID, payload, message.id),
    ]);

  } catch (error) {
    console.error(
      `Could not process source message ${message.id}:`,
      error
    );
  }
});

client.on(Events.Error, error => {
  console.error("Discord client error:", error);
});

client.login(DISCORD_TOKEN);
