# TOKENICODE DeepSeek Alpha

> 桌面版 Claude Code GUI，接入 DeepSeek `deepseek-v4-pro`。基于 [TOKENICODE](https://github.com/yiliqi78/TOKENICODE) 的个人 fork。

## 关于本项目

- **Fork 时间**：2026-08-26，自 [mistydew/tokenicode-deepseek-alpha](https://github.com/mistydew/tokenicode-deepseek-alpha) fork 而来。
- **用途**：保留 TOKENICODE 的桌面 GUI、多会话、文件浏览、Skills 面板与 Claude Code CLI 工作流，并把模型接入 DeepSeek。

## 相比上游做了哪些调整

- 主体 API 与翻译 API 统一改为 DeepSeek `deepseek-v4-pro`（Anthropic 兼容端点 `https://api.deepseek.com/anthropic`）。
- 修复 `SKILL.md` 预览翻译：翻译配置改为从后端读取，不再误报「请先在技能面板齿轮里配置翻译 API」。
- 提供 Windows x64 便携版 Release 与一键安装手册。

## 版本更新

- **v1.0.8**（2026-08-26）：本 fork 首次发布，含上述调整。历史版本见 [上游](https://github.com/mistydew/tokenicode-deepseek-alpha)。

## 下载与安装

从 [最新 Release](https://github.com/ruzhai/tokenicode-deepseek-alpha/releases/latest) 下载 `tokenicode-deepseek-alpha-v1.0.8-windows-x64.exe`（附带 `.sha256` 校验文件）。

### 安装手册（Windows）

#### 方式一：下载 release 便携版（推荐）

```powershell
# 1) 建目录，并把下载的 exe 放到 D:\TOKENICODE\tokenicode-deepseek-alpha.exe
New-Item -ItemType Directory -Force D:\TOKENICODE | Out-Null

# 2) 配置 API（主体 + 翻译都用 deepseek-v4-pro）
$cfg = "$env:USERPROFILE\.tokenicode"
New-Item -ItemType Directory -Force $cfg | Out-Null

$providers = @'
{
  "version": 1,
  "activeProviderId": "deepseek-v4-pro",
  "providers": [
    {
      "id": "deepseek-v4-pro",
      "name": "DeepSeek V4 Pro",
      "baseUrl": "https://api.deepseek.com/anthropic",
      "apiFormat": "anthropic",
      "apiKey": "填入你的DeepSeek_API_Key",
      "modelMappings": [
        { "tier": "opus", "providerModel": "deepseek-v4-pro" },
        { "tier": "sonnet", "providerModel": "deepseek-v4-pro" },
        { "tier": "haiku", "providerModel": "deepseek-v4-pro" }
      ],
      "preset": "deepseek"
    }
  ]
}
'@
$translation = '{"baseUrl":"https://api.deepseek.com/anthropic","apiFormat":"anthropic","apiKey":"填入你的DeepSeek_API_Key","model":"deepseek-v4-pro"}'

# 用 UTF-8 无 BOM 写入（带 BOM 会导致 Rust 解析失败）
$enc = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText("$cfg\providers.json", $providers, $enc)
[System.IO.File]::WriteAllText("$cfg\skill-translation.json", $translation, $enc)

# 3) 桌面快捷方式
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut("$env:USERPROFILE\Desktop\TOKENICODE.lnk")
$sc.TargetPath = "D:\TOKENICODE\tokenicode-deepseek-alpha.exe"
$sc.WorkingDirectory = "D:\TOKENICODE"
$sc.IconLocation = "D:\TOKENICODE\tokenicode-deepseek-alpha.exe,0"
$sc.Save()

# 4) 启动
Start-Process "D:\TOKENICODE\tokenicode-deepseek-alpha.exe"
```

> 两处 `填入你的DeepSeek_API_Key` 换成真实 key；无 D 盘则把 `D:\TOKENICODE` 换成任意路径。

#### 方式二：从源码构建

需 Node.js、pnpm、Rust、MSVC Build Tools：

```powershell
git clone https://github.com/ruzhai/tokenicode-deepseek-alpha
cd tokenicode-deepseek-alpha
pnpm install
pnpm tauri build --no-bundle
```

产物 `src-tauri\target\release\tokenicode.exe`，后续部署与配置同方式一。

## 许可证与致谢

Apache License 2.0。本项目基于 [TOKENICODE](https://github.com/yiliqi78/TOKENICODE)（作者 TinyZ / yiliqi78）与 [mistydew/tokenicode-deepseek-alpha](https://github.com/mistydew/tokenicode-deepseek-alpha) 修改而来，保留原许可与 attribution，详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。
