require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");

function envValue(name, { optional = false } = {}) {
  const value = process.env[name]?.trim();

  if (!value || value.startsWith("paste_")) {
    if (optional) return null;
    throw new Error(`Set ${name} in your .env file.`);
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

function collectComponentUrls(components) {
  const urls = [];

  for (const row of components ?? []) {
    for (const component of row.components ?? []) {
      if (component.url) urls.push(component.url);
    }
  }

  return urls;
}

function collectMessageText(message) {
  const parts = [message.content];

  for (const embed of message.embeds) {
    parts.push(
      embed.title,
      embed.description,
      embed.url,
      embed.author?.name,
      embed.author?.url,
      embed.footer?.text,
      embed.image?.url,
      embed.thumbnail?.url
    );

    for (const field of embed.fields ?? []) {
      parts.push(field.name, field.value);
    }
  }

  parts.push(...collectComponentUrls(message.components));

  for (const attachment of message.attachments.values()) {
    parts.push(attachment.url);
  }

  return parts.filter(Boolean).join("\n");
}

function parseListing(text) {
  const wasMatch = text.match(
    /\bWAS\b\s*(?:PRICE)?\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i
  );
  const nowMatch = text.match(
    /\bNOW\b\s*(?:PRICE)?\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i
  );

  const links = [...text.matchAll(/https?:\/\/[^\s<>()]+/gi)].map(match =>
    match[0].replace(/[.,;!?\])}]+$/, "")
  );

  if (!wasMatch || !nowMatch || links.length === 0) return null;

  const was = Number(wasMatch[1].replaceAll(",", ""));
  const now = Number(nowMatch[1].replaceAll(",", ""));

  if (!Number.isFinite(was) || !Number.isFinite(now) || was <= 0 || now < 0) {
    return null;
  }

  return {
    was,
    now,
    links: [...new Set(links)],
    savings: was - now,
    discountPercent: Math.round(((was - now) / was) * 100),
  };
}

function formatListing(listing) {
  const priceLine = `~~$${listing.was.toFixed(2)}~~ → **$${listing.now.toFixed(2)}**`;
  const savingsLine = listing.savings >= 0
    ? `**${listing.discountPercent}% off** · Save $${listing.savings.toFixed(2)}`
    : "";
  const linkLines = listing.links
    .slice(0, 5)
    .map((url, index) =>
      listing.links.length === 1
        ? `[View deal](${url})`
        : `[Deal link ${index + 1}](${url})`
    );

  return [priceLine, savingsLine, "", ...linkLines].filter(Boolean).join("\n");
}

client.once("ready", readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Watching source channel: ${SOURCE_CHANNEL_ID}`);
  console.log(`Posting to destination channel: ${DESTINATION_CHANNEL_ID}`);

  if (!SOURCE_AUTHOR_ID) {
    console.log(
      "SOURCE_AUTHOR_ID is not set. The first source message will print its author ID."
    );
  }
});

client.on("messageCreate", async message => {
  if (message.channelId !== SOURCE_CHANNEL_ID) return;
  if (message.author.id === client.user.id) return;

  console.log(
    `Source message from ${message.author.tag} | author ID: ${message.author.id}` +
      (message.webhookId ? ` | webhook ID: ${message.webhookId}` : "")
  );

  if (SOURCE_AUTHOR_ID && message.author.id !== SOURCE_AUTHOR_ID) return;

  const listing = parseListing(collectMessageText(message));

  if (!listing) {
    console.log("Skipped: could not find WAS, NOW, and a link in that message.");
    return;
  }

  try {
    const destination = await client.channels.fetch(DESTINATION_CHANNEL_ID);

    if (!destination?.isTextBased() || !destination.isSendable()) {
      throw new Error("The destination channel is not a sendable text channel.");
    }

    await destination.send({
      content: formatListing(listing),
      allowedMentions: { parse: [] },
    });

    console.log("Forwarded listing successfully.");
  } catch (error) {
    console.error("Could not forward listing:", error);
  }
});

client.on("error", error => {
  console.error("Discord client error:", error);
});

client.login(DISCORD_TOKEN);
