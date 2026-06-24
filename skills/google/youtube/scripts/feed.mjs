#!/usr/bin/env node
// YouTube account CLI for Core (read-only). Uses the shared Google OAuth token to
// reach the YouTube Data API for the user's subscriptions, then reads each channel's
// free public RSS feed for recent uploads (no API quota for the heavy part).
// No third-party deps (Node built-in fetch).
//
// Commands:
//   node feed.mjs subscriptions          # channels the user is subscribed to
//   node feed.mjs feed [days]            # recent uploads across subscriptions (default 7)
import { accessToken } from "../../_shared/google-auth.mjs";
const API = "https://www.googleapis.com/youtube/v3";

function die(msg) {
  console.error(`youtube: ${msg}`);
  process.exit(1);
}

async function apiJson(path, token) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) die(`YouTube API failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// All subscribed channels (paginated).
async function getSubscriptions(token) {
  const subs = [];
  let pageToken = "";
  do {
    const j = await apiJson(
      `/subscriptions?part=snippet&mine=true&maxResults=50&order=alphabetical${pageToken ? `&pageToken=${pageToken}` : ""}`,
      token,
    );
    for (const it of j.items ?? []) {
      subs.push({ channel: it.snippet.title, channelId: it.snippet.resourceId?.channelId });
    }
    pageToken = j.nextPageToken ?? "";
  } while (pageToken);
  return subs.filter((s) => s.channelId);
}

// Run async tasks with a concurrency cap (avoid hammering with hundreds of RSS fetches).
async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const xmlTag = (block, tag) => block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1]?.trim();
const decode = (s = "") =>
  s.replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");

// Parse a channel's Atom RSS feed into recent {title, videoId, published, channel}.
async function channelUploads(channelId) {
  let xml;
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    xml = await res.text();
  }
  catch {
    return [];
  }
  const channel = decode(xmlTag(xml, "title") ?? "");
  const entries = xml.split("<entry>").slice(1);
  return entries.map((e) => ({
    title: decode(xmlTag(e, "title") ?? ""),
    videoId: xmlTag(e, "yt:videoId"),
    published: xmlTag(e, "published"),
    channel,
  })).filter((v) => v.videoId);
}

const [cmd, arg] = process.argv.slice(2);
const token = await accessToken().catch((e) => die(e.message));

if (cmd === "subscriptions") {
  const subs = await getSubscriptions(token);
  console.log(JSON.stringify({ count: subs.length, subscriptions: subs }, null, 2));
}
else if (cmd === "feed") {
  const days = Math.min(Math.max(parseInt(arg ?? "7", 10) || 7, 1), 30);
  const cutoff = Date.now() - days * 86400000;
  const subs = await getSubscriptions(token);
  const perChannel = await mapLimit(subs, 8, (s) => channelUploads(s.channelId));
  const videos = perChannel
    .flat()
    .filter((v) => v.published && Date.parse(v.published) >= cutoff)
    .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
    .slice(0, 40)
    .map((v) => ({ title: v.title, channel: v.channel, published: v.published, url: `https://www.youtube.com/watch?v=${v.videoId}` }));
  console.log(JSON.stringify({ sinceDays: days, channelsChecked: subs.length, newVideos: videos.length, videos }, null, 2));
}
else {
  die("unknown command. use: subscriptions | feed [days]");
}
