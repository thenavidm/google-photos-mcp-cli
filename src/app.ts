/**
 * The Google Photos app: everything Slipway needs to ship the MCP server and the CLI.
 *
 * This file only describes. It never starts anything, so `slipway check` and
 * tests can import it; `index.ts` is what runs.
 */

import { createRequire } from "node:module";
import { slipway, type CliIO } from "@thenavidm/slipway";
import { ClientPool } from "./api/pool.js";
import { isConfigured, loadConfig } from "./config.js";
import { doctor } from "./doctor.js";
import { INSTRUCTIONS, PROMPTS, RESOURCES } from "./guide.js";
import { ALL_TOOLS } from "./tools/index.js";
import type { AppContext } from "./tools/kit.js";

const require = createRequire(import.meta.url);
export const VERSION: string = (require("../package.json") as { version: string }).version;

const signIn = async (io: CliIO): Promise<number> => {
  const { runLogin } = await import("./login.js");
  return runLogin(io);
};

export const app = slipway<AppContext>({
  name: "google-photos",
  title: "Google Photos",
  version: VERSION,
  package: "@thenavidm/google-photos-mcp-cli",
  description: "picking photos from the user's Google Photos library, uploading, and organizing albums",
  instructions: INSTRUCTIONS,
  envPrefix: "GOOGLE_PHOTOS",
  // Each account's client is built on the first call that names it, so `--help` and doctor work with nothing configured.
  context: () => {
    const config = loadConfig();
    return { pool: new ClientPool(config), config };
  },
  configured: (ctx) => isConfigured(ctx.config),
  secrets: (ctx) => ctx.config.accounts.flatMap((account) => [account.clientSecret, account.refreshToken]),
  tools: ALL_TOOLS,
  // The words people type for what the tools call media, items and adding.
  synonyms: {
    put: ["add"],
    photo: ["media"],
    photos: ["media"],
    picture: ["media"],
    pictures: ["media"],
    video: ["media"],
    videos: ["media"],
    image: ["media"],
    images: ["media"],
    choose: ["pick"],
    select: ["pick"],
  },
  resources: [
    {
      name: "google-photos-status",
      uri: "google-photos://status",
      mimeType: "application/json",
      read: (ctx) => ({ configured: isConfigured(ctx.config), read_only: ctx.config.readOnly, version: VERSION }),
    },
    ...RESOURCES.map((resource) => ({ name: resource.name, uri: resource.uri, mimeType: resource.mimeType, read: () => resource.text })),
  ],
  prompts: PROMPTS.map((prompt) => ({ name: prompt.name, description: prompt.description, render: () => prompt.text })),
  doctor,
  // A revoked token, a missing scope and a quota stop look alike from a tool call, so doctor asks Google every time, as 1.2 did.
  doctorNetwork: true,
  login: {
    usage: "login",
    help: "sign in once in a browser and print a refresh token",
    run: signIn,
  },
  commands: [{ name: "auth", help: "the same as login, by the name 1.2 used", run: signIn }],
  settings: [
    { env: "GOOGLE_PHOTOS_CLIENT_ID", description: "The OAuth client id from your Google Cloud project." },
    { env: "GOOGLE_PHOTOS_CLIENT_SECRET", description: "The matching client secret.", secret: true },
    { env: "GOOGLE_PHOTOS_REFRESH_TOKEN", description: "From `login`.", secret: true },
    { env: "GOOGLE_PHOTOS_ACCOUNTS", description: "Several Google accounts, as a JSON array; replaces the three above.", secret: true },
    { env: "GOOGLE_PHOTOS_DEFAULT_ACCOUNT", description: "Which account acts when a tool names none." },
    { env: "GOOGLE_PHOTOS_REQUEST_TIMEOUT_MS", description: "Per-request deadline. Defaults to 30000.", tuning: true },
    { env: "GOOGLE_PHOTOS_MAX_RETRIES", description: "Retries on 429 and 5xx. Defaults to 2.", tuning: true },
    { env: "GOOGLE_PHOTOS_AUTH_PORT", description: "The loopback port `login` listens on. Defaults to 4180.", tuning: true },
  ],
  links: { repository: "https://github.com/thenavidm/google-photos-mcp-cli" },
});
