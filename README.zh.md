# DSH Remote Access

[English](README.md) | 中文

`dsh-plugin-remote-access` 是 DeepSeek Harness Web profile 的可安装组合包。它在设置面板添加“远程连接”，可按需开启局域网访问或通过 `frpc` 连接现有 `frps` 服务，并生成可复制的认证链接供电脑、平板和手机访问完整 Web UI。

## 安装

从本地 checkout 安装：

```sh
dsh plugin --profile web add ./dsh-plugin-remote-access
```

从 Git 仓库安装时请固定提交：

```sh
dsh plugin --profile web add github:<owner>/dsh-plugin-remote-access#<commit>
```

Git 安装会运行本包的 `prepare` 构建。pnpm 首次会拒绝未授权的构建脚本；按 `dsh` 输出的提示，在 Web profile 的 `pnpm-workspace.yaml` 中授权后重新执行安装：

```yaml
allowBuilds:
  dsh-plugin-remote-access: true
```

此授权允许安装包在宿主机执行构建代码。仅安装可信来源并固定提交。发布到 npm 或使用包含 `lib/` 的 tarball 时不需要 Git `prepare` 授权。

## 局域网连接

1. 启动 `dsh --profile web`，打开“设置 > 远程连接”。
2. 选择“局域网”，设置本地端口，然后保存并开启。
3. 复制下方链接，在同一局域网内的其他设备打开。

链接中的 token 是访问凭据。首次打开时，插件把 token 换成 `HttpOnly`、`SameSite=Strict` Cookie，然后从地址栏移除 token。关闭、重新开启或修改运行中的配置都会撤销旧链接。

## 隧道连接

宿主机必须能执行与服务器 `frps` 版本兼容的 `frpc`。默认从 `PATH` 查找 `frpc`；可在 Web profile 的 `cordis.patch.yml` 覆盖路径和运行限制：

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

在设置面板选择“隧道”并填写：

- 服务器地址：`frps` 控制地址或 IP。
- 服务器端口：`frps.bindPort`，通常为 `7000`。
- `server.token`：与服务端 `[auth].token` 相同的认证 token。
- 访问协议和公网域名：用户实际打开的完整 HTTP(S) authority，例如 `https://dsh.example.com`。

插件为 `frpc` 生成 HTTP 类型代理并设置 `customDomains`。公网 HTTP 可直接使用 `frps.vhostHTTPPort`。公网 HTTPS 应在服务器反向代理或负载均衡器终止 TLS，再转发到 `frps` 的 HTTP vhost；该插件不会把本地 Web UI 伪装成 TLS 源站。公网访问必须使用受信任的 HTTPS 证书。

## 安全模型

- 主 Web server 保持回环监听；插件另起认证代理，局域网模式监听所有网卡，隧道模式只监听回环。
- 未携带有效 Cookie 的 HTTP 和 WebSocket 请求都在认证代理处返回 `401`。
- `server.token` 保存在 Harness 设置的 secret 字段中，仅写入随机私有目录内权限为 `0600` 的临时 TOML，不进入命令行、浏览器响应或访问链接。
- 控制 API 只接受回环套接字、回环 Host 和同源浏览器请求。远程浏览器必须经过认证代理，由代理重写为回环上游请求。
- 访问链接本身是 bearer credential。不要发到聊天群、工单或日志；怀疑泄露时关闭后重新开启服务。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

`pnpm pack` 生成可直接通过 `dsh plugin --profile web add ./dsh-plugin-remote-access-0.1.0.tgz` 安装的预构建包。
