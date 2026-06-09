<div align="center">

# AUM WP Studio

**A desktop app for managing local WordPress development environments — with a Shared Theme Pool at its core.**

本地 WordPress 开发环境管理工具 —— 核心是「共享主题池」。

[Download / 下载](https://github.com/aumcreate/wp-studio/releases/latest) · [Website 中文](https://app.aumcreate.cn) · [Website EN](https://app.aumcreate.com)

</div>

---

## English

### What it is
AUM WP Studio creates and manages local WordPress sites on `.test` domains. Its defining feature is a **Shared Theme Pool**: a theme is stored once in a central directory and linked into every site via symlinks — edit the theme once, and all sites using it update instantly.

Everything is bundled — **no external dependencies to install**. MariaDB, PHP, Caddy, and WP-CLI are downloaded and managed by the app on first launch.

### Features
- 🎨 **Shared Theme Pool** — one theme, symlinked across all sites
- 🚀 **One-click WordPress sites** — no browser setup wizard (WP-CLI does it)
- 🧩 **Bundled services** — MariaDB 10.11, PHP (7.4–8.5), Caddy, WP-CLI
- 🌐 **`.test` domains** — managed automatically via the system hosts file
- 🗄️ **Built-in database UI** — phpMyAdmin per site
- 🌍 **Export POT** — generate translation templates for any theme or plugin
- 💻 **Open in VS Code / terminal** — `wp` CLI ready in the site shell
- 🔄 **Auto-updates** — new versions delivered via GitHub Releases

### System requirements
- **Windows 10 / 11, 64-bit**
- **Administrator rights** — required to edit the hosts file and bind port 80
- ~**500 MB** free space for bundled services (downloaded on first launch)

### Installation & the SmartScreen warning ⚠️
This app is **not code-signed** (code-signing certificates cost money; this is a free project). Windows will therefore show a **"Windows protected your PC"** warning the first time you run the installer. **This is expected and the app is safe** — you can verify the download with the checksum below.

To proceed:
1. Run the downloaded `AUM WP Studio Setup x.y.z.exe`.
2. On the blue **"Windows protected your PC"** screen, click **More info**.
3. Click **Run anyway**.

> Auto-updates after the first install happen inside the running app and do **not** trigger this warning again.

### Verify your download (optional but recommended)
Each release lists a SHA-256 checksum. To verify in PowerShell:
```powershell
Get-FileHash ".\AUM WP Studio Setup x.y.z.exe" -Algorithm SHA256
```
Compare the result to the value in the release notes. If they don't match, **do not run it** — re-download from the official releases page.

---

## 中文

### 这是什么
AUM WP Studio 在本地 `.test` 域名下创建和管理 WordPress 站点。核心特色是 **共享主题池**:主题只存一份在中央目录,通过符号链接接入每个站点 —— 改一次主题,所有使用它的站点立即同步更新。

所有服务**全部内置,无需额外安装任何环境**。MariaDB、PHP、Caddy、WP-CLI 都由软件在首次启动时自动下载并管理。

### 功能
- 🎨 **共享主题池** —— 一份主题,符号链接到所有站点
- 🚀 **一键创建 WordPress 站点** —— 无需浏览器安装向导(由 WP-CLI 完成)
- 🧩 **内置服务** —— MariaDB 10.11、PHP(7.4–8.5)、Caddy、WP-CLI
- 🌐 **`.test` 域名** —— 自动写入系统 hosts 文件
- 🗄️ **内置数据库管理** —— 每个站点独立 phpMyAdmin
- 🌍 **导出 POT** —— 为任意主题或插件生成翻译模板
- 💻 **VS Code / 终端打开** —— 站点终端内可直接用 `wp` 命令
- 🔄 **自动更新** —— 通过 GitHub Releases 推送新版本

### 系统要求
- **Windows 10 / 11,64 位**
- **管理员权限** —— 用于写入 hosts 文件和占用 80 端口
- 约 **500 MB** 可用空间(内置服务首次启动时下载)

### 安装 与 SmartScreen 警告 ⚠️
本软件**未做代码签名**(签名证书要花钱,本项目免费)。因此首次运行安装包时,Windows 会弹出 **「Windows 已保护你的电脑」** 警告。**这是正常现象,软件是安全的** —— 你可以用下方的校验和验证安装包未被篡改。

继续安装:
1. 运行下载好的 `AUM WP Studio Setup x.y.z.exe`。
2. 在蓝色的 **「Windows 已保护你的电脑」** 界面,点击 **更多信息**。
3. 点击 **仍要运行**。

> 首次安装后的自动更新在软件内部完成,**不会再次触发**该警告。

### 验证下载(可选,推荐)
每个版本都会附带 SHA-256 校验和。在 PowerShell 中验证:
```powershell
Get-FileHash ".\AUM WP Studio Setup x.y.z.exe" -Algorithm SHA256
```
将结果与发布说明中的值比对。若**不一致,请勿运行**,并从官方发布页重新下载。

---

## Development / 开发

```bash
# Requires Node 20 LTS
npm install
.\node_modules\.bin\electron-rebuild -f -w better-sqlite3   # rebuild native SQLite for Electron
npm run dev
```

### Build a release / 打包发布
```powershell
$env:GH_TOKEN = "<your GitHub token>"   # token with 'repo' scope
npm run release                          # builds, publishes a draft GitHub Release, writes checksums.txt
```
Then publish the draft Release on GitHub and paste the values from `dist-electron/checksums.txt` into the release notes.

---

<div align="center">

Made with ☕ by [AumCreate](https://app.aumcreate.com) · Free & open for everyone

</div>
