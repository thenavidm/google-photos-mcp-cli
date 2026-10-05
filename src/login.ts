/**
 * `google-photos-cli login`, also `auth` as 1.2 named it: sign in once and
 * print a refresh token.
 *
 * Exit codes follow the CLI's: 10 when the Google Cloud client is not set yet,
 * 4 when Google refused or returned no refresh token.
 */

import type { CliIO } from "@thenavidm/slipway";
import { cleanEnv, loadConfig } from "./config.js";

export async function runLogin(io: CliIO): Promise<number> {
  const config = loadConfig();
  // Read the client straight from the environment rather than from a
  // configured account. `login` runs before any account exists, which is the
  // whole point of it, so there is nothing in config.accounts to read yet.
  const clientId = cleanEnv(io.env.GOOGLE_PHOTOS_CLIENT_ID);
  const clientSecret = cleanEnv(io.env.GOOGLE_PHOTOS_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    io.stderr(
      `Set GOOGLE_PHOTOS_CLIENT_ID and GOOGLE_PHOTOS_CLIENT_SECRET first. Both come from your own Google Cloud project; the README section 3 walks through creating one.\n`,
    );
    return 10;
  }

  const { runAuthFlow } = await import("./api/auth.js");
  const redirect = `http://localhost:${config.authPort}`;

  try {
    const tokens = await runAuthFlow(clientId, clientSecret, config.authPort, (url) => {
      io.stdout(
        `\nOpen this in a browser and sign in as the Google account whose photos you want to reach:\n\n${url}\n\nWaiting for the redirect on ${redirect} ...\n`,
      );
      // Best effort. On a headless box there is no browser and the printed
      // URL above is the whole interface, which is why it is printed first.
      void import("node:child_process").then(({ spawn }) => {
        const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        try {
          spawn(opener, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
        } catch {
          /* the URL is already on screen */
        }
      });
    });

    if (!tokens.refresh_token) {
      io.stderr(
        `\nGoogle returned no refresh token. That happens when this account has already consented to this client. Remove the app at https://myaccount.google.com/permissions and run \`google-photos-cli login\` again.\n`,
      );
      return 4;
    }

    io.stdout(
      `\nDone. Add this to your MCP client config:\n\n  "GOOGLE_PHOTOS_REFRESH_TOKEN": "${tokens.refresh_token}"\n\nTreat it like a password: it reaches the photo library until it is revoked.\n\nIf your OAuth consent screen is still in Testing mode, this token stops working after 7 days. Publishing the app fixes that.\n`,
    );
    return 0;
  } catch (error) {
    io.stderr(`\n${(error as Error).message}\n`);
    return 4;
  }
}
