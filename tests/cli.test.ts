/**
 * The two surfaces, now that Slipway builds both from ALL_TOOLS.
 *
 * Parsing, help and the exit-code contract are Slipway's and tested there. What
 * matters here: every tool arrives on both surfaces intact, the guard behaves as
 * the README promises, `auth` still signs in as 1.2 named it, Google's errors
 * keep their exit codes and their hints, and the docs stay in step with the code.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT } from "@thenavidm/slipway";
import { checkApp, cli, connect } from "@thenavidm/slipway/testing";
import { AuthError, PhotosError } from "../src/api/errors.js";
import { app } from "../src/app.js";
import { ALL_TOOLS } from "../src/tools/index.js";
import { toSlipway } from "../src/tools/kit.js";

const env = {};
afterEach(() => vi.unstubAllEnvs());

const CREDENTIALS = ["GOOGLE_PHOTOS_CLIENT_ID", "GOOGLE_PHOTOS_CLIENT_SECRET", "GOOGLE_PHOTOS_REFRESH_TOKEN"];
/** The account is read from the environment, so tests set it there; nothing here reaches Google. */
const connected = () => CREDENTIALS.forEach((name, i) => vi.stubEnv(name, ["id", "secret", "refresh"][i]!));
const nothing = () => [...CREDENTIALS, "GOOGLE_PHOTOS_ACCOUNTS"].forEach((name) => vi.stubEnv(name, ""));

describe("Google Photos on Slipway", () => {
  it("offers every tool as a command and over MCP, under the same names", async () => {
    const list = await cli(app, [], { env });
    for (const tool of ALL_TOOLS) expect(list.stdout).toContain(tool.command);
    const mcp = await connect(app, { env });
    const names = (await mcp.listTools()).map((tool) => tool.name).sort();
    await mcp.close();
    expect(names).toEqual(ALL_TOOLS.map((tool) => tool.name).sort());
  });

  it("refuses an upload without --confirm, before anything reaches Google", async () => {
    connected();
    const run = await cli(app, ["upload-from-url", "--urls", "https://example.com/a.jpg"], { env });
    expect(run.code).toBe(2);
    expect(JSON.parse(run.stderr).code).toBe("refused");
    expect(run.stderr).toContain("--confirm");
  });

  it("asks for approval on the four uploads and on no other tool", async () => {
    const mcp = await connect(app, { env });
    const tools = await mcp.listTools();
    await mcp.close();
    const confirming = tools.filter((tool) => "confirm" in ((tool.inputSchema as { properties?: object }).properties ?? {})).map((tool) => tool.name);
    expect(confirming.sort()).toEqual(["create_album_with_media", "save_to_library", "upload_file", "upload_from_url"]);
  });

  it("hides every write when GOOGLE_PHOTOS_READ_ONLY is set", async () => {
    const mcp = await connect(app, { env: { GOOGLE_PHOTOS_READ_ONLY: "1" } });
    const tools = await mcp.listTools();
    await mcp.close();
    expect(tools.length).toBe(ALL_TOOLS.filter((tool) => tool.risk === "read").length);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("blocks uploads with GOOGLE_PHOTOS_ALLOW_DESTRUCTIVE=0 and keeps the reversible writes", async () => {
    connected();
    const off = { GOOGLE_PHOTOS_ALLOW_DESTRUCTIVE: "0" };
    expect((await cli(app, ["upload-from-url", "--urls", "https://example.com/a.jpg", "--confirm", "--dry-run"], { env: off })).code).toBe(2);
    expect((await cli(app, ["update-album", "--album-id", "a", "--title", "Trip", "--dry-run"], { env: off })).code).toBe(0);
  });

  it("calls a run with no account connected not configured, exit 10", async () => {
    nothing();
    expect((await cli(app, ["list-albums"], { env })).code).toBe(EXIT.notConfigured);
  });

  it("keeps 1.2's `auth` beside `login`, and both say what they need first", async () => {
    nothing();
    const auth = await cli(app, ["auth"], { env });
    expect(auth.code).toBe(EXIT.notConfigured);
    expect(auth.stderr).toContain("GOOGLE_PHOTOS_CLIENT_ID");
    expect((await cli(app, ["login"], { env })).code).toBe(EXIT.notConfigured);
  });

  it("finds the tool for the words people type, not only the ones the tools use", async () => {
    const first = async (words: string[]) => (await cli(app, ["which", ...words], { env })).stdout.trim().split("\n")[0];
    expect(await first(["put", "photos", "in", "an", "album"])).toContain("add-to-album");
    expect(await first(["let", "me", "choose", "photos"])).toContain("start-pick-session");
  });

  it("passes slipway check", async () => {
    const report = await checkApp(app, { env });
    expect(report.findings.filter((finding) => finding.level === "error")).toEqual([]);
  });
});

describe("Google's errors keep their exit codes and their hints", () => {
  it.each([
    [401, "UNAUTHENTICATED", EXIT.auth],
    [403, "PERMISSION_DENIED", EXIT.auth],
    [404, "NOT_FOUND", EXIT.notFound],
    [429, "RESOURCE_EXHAUSTED", EXIT.rateLimited],
    [400, "INVALID_ARGUMENT", EXIT.usage],
    [500, "INTERNAL", EXIT.api],
  ])("HTTP %i %s exits %i", (status, reason, code) => {
    const error = toSlipway(new PhotosError("GET /albums: failed", status, reason, "What to do next."));
    expect(error.exitCode).toBe(code);
    expect(error.hint).toBe("What to do next.");
    expect(error.details).toMatchObject({ reason });
  });

  it("calls a refused or failed sign-in an auth error", () => {
    expect(toSlipway(new AuthError("Authorisation refused: access_denied")).exitCode).toBe(EXIT.auth);
  });
});

describe("documentation stays in step with the code", () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf-8");
  const names = (text: string): Set<string> => new Set((text.match(/GOOGLE_PHOTOS_[A-Z_]+/g) ?? []).filter((name) => !name.endsWith("_")));
  const source = (dir: string): string =>
    readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
      .map((entry) => (entry.isDirectory() ? source(`${dir}${entry.name}/`) : entry.name.endsWith(".ts") ? read(`${dir}${entry.name}`) : ""))
      .join("\n");

  /** Every variable the server reads: this repo's code, and Slipway's as agent-context lists them. */
  const used = async (): Promise<Set<string>> => {
    const context = JSON.parse((await cli(app, ["agent-context"], { env })).stdout);
    return new Set([...names(source("../src/")), ...context.settings.map((setting: { env: string }) => setting.env)]);
  };

  /**
   * Five variables shipped undocumented and three never reached `--help`, which
   * is the kind of drift nobody notices because both sides look complete on
   * their own.
   */
  it("documents every environment variable the code reads", async () => {
    const documented = names(read("../README.md"));
    expect([...(await used())].filter((v) => !documented.has(v))).toEqual([]);
  });

  it("lists every environment variable in --help", async () => {
    const help = (await cli(app, ["--help"], { env })).stdout;
    // The help groups the HTTP ones as `GOOGLE_PHOTOS_HTTP_PORT / _HOST / _TOKEN / _ALLOWED_ORIGINS`.
    const shorthand = new Set(["GOOGLE_PHOTOS_HTTP_HOST", "GOOGLE_PHOTOS_HTTP_TOKEN", "GOOGLE_PHOTOS_HTTP_ALLOWED_ORIGINS"]);
    expect([...(await used())].filter((v) => !help.includes(v) && !shorthand.has(v))).toEqual([]);
  });

  /**
   * Two in-page links pointed at headings that had been renamed, including the
   * one row routing a shell user to the CLI. The ship checklist's link pass only
   * greps http, so a dead `#anchor` is the kind that ships quietly.
   */
  it.each(["../README.md", "../INSTALL.md"])("has no dead in-page anchors in %s", (file) => {
    if (!existsSync(new URL(file, import.meta.url))) return; // repo may ship one doc
    const md = read(file);
    const slugs = new Set<string>();
    for (const [, heading] of md.matchAll(/^#{2,4} (.+)$/gm)) {
      const stripped = (heading as string).toLowerCase().replace(/[^\w\s-]/g, "");
      // GitHub keeps the trailing hyphen when a heading ends in an emoji.
      slugs.add(stripped.trim().replace(/\s+/g, "-"));
      slugs.add(stripped.replace(/\s+/g, "-"));
    }
    const dead = [...md.matchAll(/\[[^\]]+\]\(#([^)]+)\)/g)]
      .map((m) => m[1] as string)
      .filter((a) => !slugs.has(a));
    expect(dead).toEqual([]);
  });
});
