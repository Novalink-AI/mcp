# Security

Please report vulnerabilities privately to support@novalink.live, or through GitHub's **Report a vulnerability** button on this repository. Do not open a public issue.

## How this package handles credentials

- The installer writes only server URLs and the workflow guide. It never writes tokens or keys.
- The stdio bridge signs in with OAuth 2.1 and PKCE. It stores tokens in `~/.config/novalink/credentials.json` with mode `0600`.
- `npx @novalinkai/mcp logout` revokes the tokens on the server and deletes them locally.
- To cut off any connected agent immediately, go to **API keys > Connected agents** in Novalink.
