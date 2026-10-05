/**
 * `google-photos-cli doctor`
 *
 * The setup has four independent things that can be wrong, and they produce
 * similar symptoms from inside an MCP client, where stderr is usually hidden:
 * a credential missing, a refresh token that no longer mints an access token,
 * a grant without a scope a tool needs, and an API that does not answer. These
 * checks run in that order for each account and stop at the first failure,
 * because a report listing four problems when the second is caused by the
 * first sends people fixing the wrong thing. Slipway runs them on every
 * `doctor`, as 1.2 did, after its own checks.
 */

import type { DoctorCheck } from "@thenavidm/slipway";
import { isConfigured, missingCredentials, SCOPES } from "./config.js";
import type { AppContext } from "./tools/kit.js";

const LOGIN = "Run `google-photos-cli login` to consent again; a refresh token never gains a scope or comes back in place.";

export async function doctor(ctx: AppContext, options: { network: boolean }): Promise<DoctorCheck[]> {
  const { config, pool } = ctx;
  if (config.accounts.length === 0) return [];
  if (!isConfigured(config)) {
    return [
      {
        name: "Missing",
        ok: false,
        detail: missingCredentials(config).join(", "),
        fix: "GOOGLE_PHOTOS_CLIENT_ID and GOOGLE_PHOTOS_CLIENT_SECRET come from a Google Cloud project you create, README section 3. GOOGLE_PHOTOS_REFRESH_TOKEN comes from `google-photos-cli login`.",
      },
    ];
  }

  const checks: DoctorCheck[] = [
    { name: "Accounts", ok: true, detail: config.accounts.map((account) => account.name).join(", ") },
  ];
  if (!options.network) return checks;

  for (const account of config.accounts) {
    const at = config.accounts.length > 1 ? `${account.name}: ` : "";
    const client = pool.for(account.name);

    let token: string;
    try {
      token = await client.accessToken();
      checks.push({ name: `${at}Refresh token`, ok: true, detail: "mints an access token" });
    } catch (error) {
      checks.push({ name: `${at}Refresh token`, ok: false, detail: (error as Error).message, fix: LOGIN });
      continue;
    }

    // A token minted before a scope was added keeps the old set forever, and the
    // resulting 403s name the endpoint rather than the missing consent.
    try {
      const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
      const data = (await response.json()) as { scope?: string; email?: string };
      const granted = (data.scope ?? "").split(/\s+/).filter(Boolean);
      const missing = SCOPES.filter((scope) => !granted.includes(scope));
      if (missing.length > 0) {
        checks.push({ name: `${at}Scopes`, ok: false, detail: `the grant is missing ${missing.join(", ")}`, fix: LOGIN });
        continue;
      }
      checks.push({ name: `${at}Scopes`, ok: true, detail: `all ${SCOPES.length} granted${data.email ? `, as ${data.email}` : ""}` });
    } catch {
      checks.push({ name: `${at}Scopes`, ok: false, warn: true, detail: "could not read the token info, so the scopes were not checked" });
    }

    // A real call, not just a token check.
    try {
      await client.request("library", "/albums", { query: { pageSize: 1 } });
      checks.push({ name: `${at}Google Photos API`, ok: true, detail: "answers" });
    } catch (error) {
      checks.push({ name: `${at}Google Photos API`, ok: false, detail: (error as Error).message });
    }
  }
  return checks;
}
