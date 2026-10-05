/**
 * Tests run against the tools and a faked fetch, never the network.
 *
 * The things worth pinning down are the ones that silently produce a wrong
 * answer rather than an error: an upload that is not marked irreversible, an
 * account picked by a loose prefix, a filter that builds the wrong request body.
 * The guard itself is Slipway's; tests/cli.test.ts checks it from the outside.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, cleanEnv, isConfigured, missingCredentials, selectAccount } from "../src/config.js";
import { ClientPool } from "../src/api/pool.js";
import { shapeItem, shapeAlbum, page } from "../src/format/items.js";
import { ALL_TOOLS } from "../src/tools/index.js";

const account = { name: "default", clientId: "id", clientSecret: "secret", refreshToken: "refresh" };

const baseConfig = {
  accounts: [account],
  preferred: [],
  readOnly: false,
  allowDestructive: true,
  requestTimeoutMs: 1000,
  maxRetries: 0,
  userAgent: "test",
  authPort: 4180,
};

describe("config", () => {
  it("strips the literal backslash-n a copy-paste leaves behind", () => {
    // A secret pasted out of a quoted shell string carries "\n" as two
    // characters. trim() cannot see it and Google rejects the result as
    // invalid_client, which reads like the wrong secret entirely.
    expect(cleanEnv("abc\\n")).toBe("abc");
    expect(cleanEnv("  abc  ")).toBe("abc");
    expect(cleanEnv(undefined)).toBe("");
  });

  it("names exactly what is missing", () => {
    const broken = { ...baseConfig, accounts: [{ ...account, refreshToken: "" }] };
    expect(isConfigured(broken)).toBe(false);
    expect(missingCredentials(broken)).toEqual(["GOOGLE_PHOTOS_REFRESH_TOKEN"]);
  });

  it("prefers an exact account name over a prefix of a longer one", () => {
    // "navid" is a prefix of "navid-brand". A pure prefix match would be
    // ambiguous and could send an upload to the wrong library.
    const multi = {
      ...baseConfig,
      accounts: [
        { ...account, name: "navid-brand" },
        { ...account, name: "navid" },
      ],
    };
    expect(selectAccount(multi, "navid").name).toBe("navid");
    expect(selectAccount(multi, "navid-brand").name).toBe("navid-brand");
  });

  it("refuses an ambiguous prefix rather than guessing", () => {
    const multi = {
      ...baseConfig,
      accounts: [
        { ...account, name: "work-one" },
        { ...account, name: "work-two" },
      ],
    };
    expect(() => selectAccount(multi, "work")).toThrow(/more than one account/);
  });

  it("honours the preferred account when a tool names none", () => {
    const multi = {
      ...baseConfig,
      accounts: [{ ...account, name: "personal" }, { ...account, name: "brand" }],
      preferred: ["brand"],
    };
    expect(selectAccount(multi).name).toBe("brand");
  });

  it("names the configured accounts when asked for one that does not exist", () => {
    expect(() => selectAccount(baseConfig, "nope")).toThrow(/Configured: default/);
  });

  it("defaults to writes enabled", () => {
    const config = loadConfig();
    expect(config.readOnly).toBe(false);
    expect(config.allowDestructive).toBe(true);
  });
});

describe("tool surface", () => {
  it("gives every tool a description long enough to be useful to a model", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length, `${tool.name} description`).toBeGreaterThan(80);
      expect(tool.title.length, `${tool.name} title`).toBeGreaterThan(0);
    }
  });

  it("marks the uploads as the destructive ones", () => {
    const destructive = ALL_TOOLS.filter((t) => t.risk === "destructive").map((t) => t.name).sort();
    expect(destructive).toEqual([
      "create_album_with_media",
      "save_to_library",
      "upload_file",
      "upload_from_url",
    ]);
  });
});

describe("formatting", () => {
  it("keeps what a model reasons about and drops camera noise", () => {
    const shaped = shapeItem({
      id: "abc",
      filename: "IMG_1.jpg",
      mimeType: "image/jpeg",
      baseUrl: "https://lh3.googleusercontent.com/x",
      mediaMetadata: {
        creationTime: "2026-01-02T03:04:05Z",
        width: "4032",
        height: "3024",
        photo: { cameraMake: "Apple", focalLength: 4.2 },
      },
    });
    expect(shaped).toMatchObject({ id: "abc", kind: "photo", width: 4032, height: 3024 });
    expect(JSON.stringify(shaped)).not.toContain("focalLength");
  });

  it("reads a video as a video", () => {
    expect(shapeItem({ mimeType: "video/mp4", mediaMetadata: { video: { status: "READY" } } }).kind).toBe("video");
  });

  it("reports an album that this app cannot edit", () => {
    expect(shapeAlbum({ id: "a", title: "T", mediaItemsCount: "4", isWriteable: false })).toMatchObject({
      item_count: 4,
      writeable: false,
    });
  });

  it("signals more pages only when there is a token", () => {
    expect(page([1], "tok")).toMatchObject({ more: true, next_page_token: "tok" });
    expect(page([1], undefined)).toMatchObject({ more: false });
  });
});

describe("search filters", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    // The token refresh comes first on any call.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "tok", expires_in: 3600 }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  async function callSearch(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ mediaItems: [] }),
    });
    const { mediaTools } = await import("../src/tools/media.js");
    const tool = mediaTools.find((t) => t.name === "search_library");
    // What Slipway hands every tool; the kit binds the account per call.
    const app = { pool: new ClientPool(baseConfig), config: baseConfig };
    await (tool as { handler: (a: unknown, c: unknown) => Promise<unknown> }).handler(args, app);
    const body = fetchMock.mock.calls.at(-1)?.[1]?.body;
    return JSON.parse(body as string) as Record<string, unknown>;
  }

  it("turns a one-sided date range into a valid two-sided one", async () => {
    // Google rejects a range with only one end, so an open-ended search has to
    // supply a bound wide enough to mean "everything".
    const body = await callSearch({ start_date: "2026-01-01" });
    expect(body.filters).toMatchObject({
      dateFilter: { ranges: [{ startDate: { year: 2026, month: 1, day: 1 }, endDate: { year: 2100, month: 12, day: 31 } }] },
    });
  });

  it("sends an album search with no filters, which Google requires", async () => {
    const body = await callSearch({ album_id: "album-1" });
    expect(body.albumId).toBe("album-1");
    expect(body.filters).toBeUndefined();
  });

  it("passes categories and media type through", async () => {
    const body = await callSearch({ categories: ["TRAVEL"], media_type: "VIDEO" });
    expect(body.filters).toMatchObject({
      contentFilter: { includedContentCategories: ["TRAVEL"] },
      mediaTypeFilter: { mediaTypes: ["VIDEO"] },
    });
  });

  it("rejects a malformed date rather than sending it", async () => {
    await expect(callSearch({ start_date: "01/02/2026" })).rejects.toThrow(/YYYY-MM-DD/);
  });
});
