# Versions

| Component | Version | Checked |
|---|---|---|
| Slipway | ^0.1.9 | 2026-10-05 |
| MCP TypeScript SDK, through Slipway | 2.3.0 | 2026-10-05 |
| zod | ^4.2.0 | 2026-10-05 |
| Node | >=22 | 2026-10-05 |
| Google Photos Picker API | v1 | 2026-09-04 |
| Google Photos Library API | v1 | 2026-09-04 |
| actions/checkout | v7 | 2026-09-04 |
| actions/setup-node | v7 | 2026-09-04 |

## 2.0.0, 2026-10-05

Built on [Slipway](https://github.com/thenavidm/slipway) 0.1.9. The 26 tools keep their names and arguments, and every difference below was measured against 1.2.0, the last version on npm, before release.

- **A person approves each upload over MCP.** Google has no delete, so an upload is permanent. Claude Code (2.1.246 and later) shows its own prompt for each of the four uploading tools, and a client that can show forms asks with an approval form whose one box starts unticked. Approvals are signed, bound to the exact call and work once. Where a client can do neither, the model's `confirm: true` still counts, and `GOOGLE_PHOTOS_CONFIRM=model` makes it enough everywhere, for an agent with no person to ask. The audit log records who approved each write.
- **A smaller tool list.** 10,183 tokens in Claude Code with every tool loaded, down from 11,124: the per-tool `$schema` line, an `execution` field and `additionalProperties: false` are gone. The last one advertised strict input while unknown keys were dropped anyway; the schema now says what happens.
- **Exit codes follow the house contract everywhere.** An unknown command and a write in read-only mode exit 2 instead of 1, and `doctor` with nothing configured 10 instead of 1. An account name that matches none or several, a date that is not YYYY-MM-DD and an update with nothing to change exit 2 instead of 5, a malformed `GOOGLE_PHOTOS_ACCOUNTS` 10 instead of 4 or 5, and a 400 from Google 2 instead of 5. 1 now means an unexpected error. Errors keep Google's own status enum in `details` and the hint that names the cause.
- **`which <words>` finds a command in the words people use.** "put photos in an album" finds `add-to-album` and "let me choose photos" finds `start-pick-session`; `agent-context` describes every command, flag and setting as JSON. In Codex, finding the command that puts photos into an existing album took 83,618 input tokens against 83,623 (median of five), since 1.2.0's command list already named it; over MCP the same task read 25 more out of about 48,600, all of it in the part of the tool list Codex keeps when it cuts a long printout.
- **`login`**, which 1.2 called `auth`. Both names work.
- **`install <client>`** adds the server to Claude Code, Codex, Claude Desktop, Cursor, VS Code or Gemini CLI in each one's own format.
- **Less work to start.** The entry turns on Node's compile cache, and the server spends 161 ms of CPU before its first answer where 1.2.0 spent 194 (median of 21 runs, taking turns on one busy Mac). npx installs 4 dependencies instead of 94.
- **Releases reach npm again.** The publish workflow ran only when a GitHub release was created, so 1.2.1 was tagged and never published; 2.0.0 publishes on the tag, attaches the desktop extension to the release, and carries 1.2.1's fixes: `npx -y` always starts the server, and `--port 8790` works as well as `--port=8790`.
- **Docs fixes.** SKILL.md told agents to create a Desktop app OAuth client, which cannot take the redirect URI `login` needs; it now says Web application, as the README always did. Its `--select albums.id` example selected nothing, since lists come back as `items`. INSTALL.md exists now, the README has a Features table, the icon and terminal recording load from cdn.navid.me, and THIRD_PARTY_NOTICES.md lists the production dependencies' licenses.

### Upgrading

Node 22 or newer; 1.2 ran on 20. Scripts keep working for success, a refused upload and missing setup; one that read exit 1 as an unknown command or read-only mode, or 5 as a bad argument, should read 2. Over MCP, expect an approval prompt or form for each upload; a headless agent that should upload with `confirm: true` alone needs `GOOGLE_PHOTOS_CONFIRM=model`. A script that pipes JSON-RPC into the server must keep stdin open until it reads the answer: the server now stops when its input ends, as the MCP stdio binding asks. `--http` will not start on an address other than localhost without `GOOGLE_PHOTOS_HTTP_TOKEN`, and refuses a page from another site unless `GOOGLE_PHOTOS_HTTP_ALLOWED_ORIGINS` lists it. Some terminal screens grew: the general help by 150 tokens, for `which`, `install`, the flags, the exit codes and the safety settings it now lists; the command list by 25, for the lines that point to `which` and `--help`; `create-album --help` by 8, for `--dry-run`, which is new; and a missing argument's error by 16, for its code and the help to read.

## 1.2.1, 2026-10-04

- **`npx -y @thenavidm/google-photos-mcp-cli` starts the MCP server whatever order npm keeps.** npx starts whichever binary the npm registry lists first when they share one file, and the registry does not keep the published order. For this package that happened to be the server; for 23 others it was the CLI. A third binary named after the package, on its own file, now always starts the server, and npx picks it by name.
- **`--port 8790` works, not only `--port=8790`.** The space form fell through to the default port without a word. A bare `--port`, `--portable` or a port that is not a positive number now falls back to `GOOGLE_PHOTOS_HTTP_PORT`, then 8787, and the flag beats the environment variable.

## 1.2.0

Renamed. The repository is now `google-photos-mcp-cli` and the package
`@thenavidm/google-photos-mcp-cli`, matching the two surfaces it actually ships.
The binaries are unchanged: `google-photos-mcp` and `google-photos-cli`.

**Removed the three sharing tools.** `share_album`, `unshare_album` and
`list_shared_albums` called `albums.share`, `albums.unshare` and `sharedAlbums`,
which Google removed on 31 March 2025 along with the `photoslibrary.sharing`
scope. Every one of them returned `403 PERMISSION_DENIED`, and this server never
requested the scope they needed in the first place. Google's own guidance is
that the user shares an album by hand in the Google Photos app. Three tools that
always failed are worse than three tools that are not there, so the tool count
drops from 29 to 26 and read-only mode from 16 to 15.

Four CLI adapter fixes:

- An enum inside an array is now a scalar flag, so `--categories LANDSCAPES` works rather than demanding `'"LANDSCAPES"'`
- "Nothing configured" is tested before authentication and only when there is no HTTP status, so it exits 10 rather than 4 while a real 401 still exits 4
- A write the guard refused exits 2, a usage error, rather than 5, an API error
- Confirmed the `auth`, `doctor` and `help` passthrough on the CLI binary still reaches the entry point rather than being rejected as an unknown command

**`--select` no longer drops fields.** Two paths sharing a head overwrote each
other, so `--select items.id,items.filename` returned the filename and said
nothing about the id it had thrown away. Silent data loss in the flag whose
entire purpose is choosing what you keep. Paths are now grouped by their first
segment before recursing, with three regression tests.

**`--version` reads package.json.** The version was written out in `server.ts`
and again in the User-Agent, so a release that bumped one and not the other left
`--version` and `doctor` answering for a build that was not running. Both now
read the running package.

Adds a Claude Desktop extension: `desktop-extension/`, built with
`npm run build:mcpb`, vendoring its own dependencies so it installs on a double
click and asking for the client id, secret and refresh token in the install
dialog.

The README now names both surfaces, shows runnable examples of each, and
publishes the measured context cost: 7,271 tokens of tool definitions plus 352
of server instructions, from a real `tools/list` handshake against this build.

## 1.1.0

Several Google accounts at once. `GOOGLE_PHOTOS_ACCOUNTS` takes a JSON array,
every scoped tool takes an optional `account`, and `list_accounts` shows what is
connected. An exact name beats a prefix when resolving, so two similar names
cannot silently resolve to the wrong library.

Fixes the FAQ, where a single newline rendered each question and its answer as
one run-on paragraph, and the npm `author` field, where the website was written
in angle brackets and published as an email address.

## 1.0.0

First release.

29 tools across both halves of the Google Photos API: the Picker API for
reaching the user's whole library through them, and the Library API for media
this server uploaded.

Built around what the API offers after Google removed whole-library read access
on 1 April 2025, rather than around what it used to offer. The tool
descriptions, the `google-photos://capabilities` resource and
`describe_filter_capabilities` all state the limits plainly, so a model reports
"this server has uploaded nothing" instead of "your library is empty".

- Picker flow: `start_pick_session`, `check_pick_session`, `list_picked_media`, `download_picked`
- Albums: create, list, get, update, share, unshare, list shared, add and remove items, enrichments
- Media: list, search, get one, get many, set description, download
- Uploads: from URL, from a local file, from a picker selection, or album and contents in one call
- Connection: `list_accounts`, `auth_status`, `quota_status`, and a `raw` escape hatch
- Several Google accounts at once via `GOOGLE_PHOTOS_ACCOUNTS`, with `account` on every scoped tool and an exact name beating a prefix so two similar names cannot resolve to the wrong library
- Both daily quotas tracked locally (10,000 API requests, 75,000 media-byte requests, midnight UTC) so the ceiling refuses before the call rather than returning a 429 a model reads as transient
- `google-photos-mcp auth` runs the one-time sign-in and prints a refresh token
- `google-photos-mcp doctor` checks credentials, scopes and a live API call, in the order they fail
- stdio and streamable HTTP transports
- `GOOGLE_PHOTOS_READ_ONLY=1` drops the tool list to the 16 reads
- Uploading and sharing require `confirm: true`, because Google exposes no delete endpoint and a share link cannot be recalled
