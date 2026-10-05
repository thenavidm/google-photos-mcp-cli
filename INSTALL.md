# Install

Google Photos has no API keys, and Google does not allow service accounts for
these APIs. The only way in is an OAuth client you create in a Google Cloud
project you own, signed in to once by the account whose photos you want to
reach. That takes about ten minutes, once, and costs nothing.

## Prerequisites

| You need | Check with | If missing |
|---|---|---|
| Node 22 or newer | `node -v` | [nodejs.org](https://nodejs.org) |
| A Google account | you have one | any account works, personal or Workspace |

## 1. Create the OAuth client

[README section 3](README.md#3-setup-) walks through every screen. In short:

1. [Create a project](https://console.cloud.google.com/projectcreate) in the Google Cloud console.
2. Enable both the [Photos Picker API](https://console.cloud.google.com/apis/library/photospicker.googleapis.com) and the [Photos Library API](https://console.cloud.google.com/apis/library/photoslibrary.googleapis.com), in that project.
3. Under **Google Auth Platform**, set up the consent screen, add yourself as a test user on the **Audience** page, and set the publishing status to **In production**, or the sign-in expires after seven days.
4. On the **Data access** page, add the four scopes:

   ```
   https://www.googleapis.com/auth/photospicker.mediaitems.readonly
   https://www.googleapis.com/auth/photoslibrary.appendonly
   https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata
   https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata
   ```

5. On the **Clients** page, create a **Web application** client with `http://localhost:4180` as an authorized redirect URI, exactly. Copy the client ID and the client secret.

## 2. Sign in once

```bash
export GOOGLE_PHOTOS_CLIENT_ID="your-client-id"
export GOOGLE_PHOTOS_CLIENT_SECRET="your-client-secret"
npx -y @thenavidm/google-photos-mcp-cli@latest login
```

A browser opens. Sign in as the account whose photos you want, click past the
unverified-app warning, and approve the four permissions. The command prints
`GOOGLE_PHOTOS_REFRESH_TOKEN`. 1.2 called this command `auth`, and that name
still works.

If it prints no refresh token, the account has already consented to this client.
Remove the app at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) and
run it again.

## 3. Add it to your client

All three values go in every client's config. The quickest route is the CLI's own
installer, which writes the entry in each client's format and keeps a backup of
the file it changes:

```bash
npx -y -p @thenavidm/google-photos-mcp-cli google-photos-cli install claude-code
npx -y -p @thenavidm/google-photos-mcp-cli google-photos-cli install claude-desktop --dry-run
```

It takes `claude-code`, `codex`, `claude-desktop`, `cursor`, `vscode` or
`gemini`. By hand, in Claude Code:

```bash
claude mcp add google-photos \
  -e GOOGLE_PHOTOS_CLIENT_ID=your-client-id \
  -e GOOGLE_PHOTOS_CLIENT_SECRET=your-client-secret \
  -e GOOGLE_PHOTOS_REFRESH_TOKEN=your-refresh-token \
  -- npx -y @thenavidm/google-photos-mcp-cli@latest
```

Or in any client's MCP config:

```json
{
  "mcpServers": {
    "google-photos": {
      "command": "npx",
      "args": ["-y", "@thenavidm/google-photos-mcp-cli@latest"],
      "env": {
        "GOOGLE_PHOTOS_CLIENT_ID": "your-client-id",
        "GOOGLE_PHOTOS_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_PHOTOS_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

For Claude Desktop, the `.mcpb` on the
[latest release](https://github.com/thenavidm/google-photos-mcp-cli/releases/latest)
installs on a double click and asks for the three values. Every other client is
in [README section 4](README.md#4-connect-your-client-).

## 4. Check it worked

```bash
npx -y @thenavidm/google-photos-mcp-cli@latest doctor
```

It checks the credentials, that the refresh token mints an access token, that
every scope landed in the grant, and one live call, and names the first real
problem.

## Safety settings

| Variable | Effect |
|---|---|
| `GOOGLE_PHOTOS_READ_ONLY=1` | Only the 15 read tools are exposed |
| `GOOGLE_PHOTOS_ALLOW_DESTRUCTIVE=0` | Album writes work, uploading does not |
| `GOOGLE_PHOTOS_AUDIT_LOG=/path/to/log` | Append-only record of every attempted write, and who approved it |
| `GOOGLE_PHOTOS_CONFIRM=model` | Lets `confirm: true` alone approve an upload over MCP, for an agent with no person to ask |

Uploads wait for your approval whatever these settings say: Google has no
delete, so an upload is permanent. Claude Code shows its own prompt for each, a
client that can show forms asks with one, and elsewhere the model must pass
`confirm: true`.

## When it stops working

| Symptom | Fix |
|---|---|
| `invalid_grant` a week after it worked | The consent screen is still in Testing. Set it to In production and run `login` again |
| A permission error on every call | A scope is missing from the grant. Run `login` again; `doctor` names which |
| `redirect_uri_mismatch` during `login` | The redirect URI is not exactly `http://localhost:4180` |

## Links

- [Google Photos APIs](https://developers.google.com/photos)
- [Repository](https://github.com/thenavidm/google-photos-mcp-cli)
