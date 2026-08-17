# DSH Remote Access

English | [中文](README.zh.md)

`@xiaosenho/dsh-plugin-remote-access` is an installable bundle for the DeepSeek Harness Web profile. It adds a Remote Access settings section, starts LAN access or an `frpc` tunnel on demand, and produces authenticated links for controlling the full Web UI from another computer, tablet, or phone.

## Install

Install from npm:

```sh
dsh plugin --profile web add @xiaosenho/dsh-plugin-remote-access
```

Install a local checkout:

```sh
dsh plugin --profile web add ./dsh-plugin-remote-access
```

Pin a commit when installing from a Git repository:

```sh
dsh plugin --profile web add github:xiaosenho/dsh-plugin-remote-access#<commit>
```

A Git install runs this package's `prepare` build. pnpm initially refuses an unapproved dependency build; follow the `dsh` diagnostic, allow the package in the Web profile's `pnpm-workspace.yaml`, then repeat the install:

```yaml
allowBuilds:
  '@xiaosenho/dsh-plugin-remote-access': true
```

This permission lets the dependency execute build code on the host. Install only trusted source and pin a commit. An npm release or tarball containing `lib/` needs no Git `prepare` permission.

## LAN access

1. Start `dsh --profile web` and open Settings > Remote access.
2. Select LAN, choose the local port, save, and enable the connection.
3. Copy the displayed link and open it on another device in the same LAN.

The token in the link is an access credential. The first request exchanges it for an `HttpOnly`, `SameSite=Strict` cookie and removes the token from the address bar. Disabling, re-enabling, or changing an active configuration revokes the old link.

## Tunnel access

The host must provide an `frpc` executable compatible with the server's `frps` version. In Settings, enter its absolute path or use the file button to select the local executable. The plugin resolves `frpc` from `PATH` by default; `frpcPath` in the Web profile remains the deployment fallback and the other process limits are configured there:

```yaml
- id: remote-access
  config:
    listenPort: 3081
    frpcPath: /opt/homebrew/bin/frpc
    processGraceMs: 3000
    frpcStartupTimeoutMs: 500
    frpcOutputMaxBytes: 32768
    requestMaxBytes: 16384
```

Select Tunnel in Settings and provide:

- frpc client: the local executable path, selected with the host's native file chooser or entered manually.
- Server address: the `frps` control hostname or IP.
- Server port: `frps.bindPort`, commonly `7000`.
- `server.token`: the same token configured as `[auth].token` on the server.
- Public endpoint: choose Domain or IP + port.
- Domain: choose HTTP or HTTPS and enter the authority users open, such as `https://dsh.example.com`.
- IP + port: enter the public frps IP and the dedicated `remotePort`, such as `203.0.113.10:18080`.

Domain mode creates an [HTTP-type frpc proxy](https://gofrp.org/en/docs/examples/vhost-http/) with `customDomains`. Public HTTP can use `frps.vhostHTTPPort` directly. For public HTTPS, terminate TLS at a server-side reverse proxy or load balancer and forward to the frps HTTP vhost; this plugin does not present the local Web UI as a TLS origin. IP + port mode creates an frp [TCP proxy](https://gofrp.org/en/docs/features/tcp-udp/) and sets `remotePort`, so users open `http://<public-ip>:<remote-port>` without DNS. The frps `allowPorts` policy must permit that port. Direct IP mode is HTTP-only; use Domain mode with a trusted certificate for HTTPS.

The plugin also installs a browser-side `crypto.randomUUID()` compatibility method when an HTTP origin provides `crypto.getRandomValues()` but not `randomUUID()`. This keeps Harness workspace RPC calls usable on ordinary LAN HTTP pages without changing the DeepSeek Harness repository.

## Security model

- The primary Web server stays on loopback. A separate authenticated proxy listens on all interfaces for LAN mode and loopback only for tunnel mode.
- HTTP and WebSocket requests without a valid cookie receive `401` at the authenticated proxy.
- `server.token` is a secret Harness setting. It is written only to a `0600` TOML file in a random private directory and never appears in argv, browser responses, or access links.
- The control API accepts only a loopback socket, loopback Host, and same-origin browser context. Remote browsers reach it only through the authenticated proxy, which rewrites the upstream request to loopback.
- The native frpc file chooser is host-only. An authenticated remote browser can edit a path manually but cannot open a dialog on the host desktop.
- Treat each access link as a bearer credential. Do not post it in chat, tickets, or logs. Disable and re-enable remote access if a link may have leaked.

## Develop

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

`pnpm pack` creates a prebuilt archive installable with `dsh plugin --profile web add ./xiaosenho-dsh-plugin-remote-access-0.1.3.tgz`.
