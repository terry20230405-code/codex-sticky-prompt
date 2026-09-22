# Codex 桌面端提问吸顶（Windows）

在 Codex 对话里向下阅读长回复时，已经越过聊天区顶部的最近一条用户提问会显示为两行摘要。点击摘要可回到原提问。选择规则借鉴 [dsh-oil-sticky-prompt](https://github.com/oil-oil/dsh-oil-sticky-prompt)。

当前适配基于 Windows Codex `26.915.4065.0` 的界面标记。功能只操作本地窗口中的 DOM，不调用模型或上传聊天内容，不产生额外 token 用量。

## 使用

需要 Node.js 22 或更新版本。**只需运行一次**下面的安装命令，即可在桌面和开始菜单创建“Codex 吸顶版”快捷方式：

```powershell
& .\Install-CodexStickyShortcut.ps1
```

以后点击“Codex 吸顶版”图标，就会自动启动 Codex 和吸顶注入器，无需手动运行脚本。原来的官方 Codex 图标仍按原样启动；请改用新图标。首次切换前请正常结束正在运行的 Codex 任务并退出 Codex。

聊天顶部工具栏的“聊天操作”按钮旁会出现图钉按钮。点击即可随时切换提问吸顶；图钉填充并带浅色底表示开启。关闭时会立即移除吸顶条和正文渐隐；选择保存在本机，下次启动仍会沿用。

带图片、视频、音频或文件附件的提问，会在吸顶摘要中显示类型和数量，例如“图片 ×1 · 帮我看看”。图片会在左侧显示一个 24 像素的小预览；鼠标悬停约 0.12 秒后，会按原图比例和窗口剩余空间显示大图，最大约 585 × 429 像素。多张图片时可在大图上点击左右箭头切换，并查看当前张数；鼠标移开后收起。大图会避开窗口边缘，点击吸顶条仍可跳回原提问。预览加载失败时保留文字摘要。文件附件能读到文件名时会显示“文件：report.pdf”。如果提问只有附件，也会显示可点击的摘要。图片位于文字上方时，从整个提问块越过顶部的时刻开始吸顶。

也可以在此文件夹打开 PowerShell，直接运行：

```powershell
& .\Start-CodexStickyPrompt.ps1
```

脚本会启动官方 Codex 应用并在本机回环地址开启调试端口，然后启动吸顶注入器。如果 Codex 正在运行且没有调试端口，脚本只提示你稍后退出再运行，不会强制关闭应用。

如需检查连接和界面标记：

```powershell
node .\injector.mjs --probe --port 19177
```

输出中 `scrollers` 应为至少 1；打开包含用户提问的对话后，`userBubbles` 应大于 0，`installed` 应为 `true`。`version` 可确认当前注入版本；`unavailable` 为 `true` 时，图钉右上角会出现提示点，悬停可查看原因。

关闭吸顶功能，无需退出 Codex：

```powershell
& .\Stop-CodexStickyPrompt.ps1
```

每次完整退出并重新打开 Codex 后，请使用“Codex 吸顶版”图标进入，功能会自动生效。注入器在应用关闭后会自行退出。运行日志保存在 `.runtime` 文件夹，不记录聊天内容。

要移除新图标，运行 `Uninstall-CodexStickyShortcut.ps1`；原 Codex 图标不会受到影响。

## 实现与限制

- 通过本地 Chromium DevTools Protocol 注入 `sticky.js`，不修改 Codex 安装包或会话文件。
- 只连接 `127.0.0.1` 上由当前 Codex 安装占用的调试端口。
- 使用 Codex 当前版本的 `.thread-scroll-container`、`data-content-search-unit-key` 和 `data-user-message-bubble` 标记。Codex 更新后若标记变化，需要适配。
- 图片和文件识别依赖当前界面的“用户附件”和 `data-composer-attachment-pill` 标记。图片预览复用当前页面已有的图片地址，不读取附件内容或上传数据。
- 滚动时复用提问文字和可见提问节点；页面持续生成回复时，只在提问或聊天结构改变后重新计算。短暂的节点重建会保留吸顶条约 160 毫秒，避免闪烁。
- 启动脚本会等待注入器实际连接成功，不再固定等待 1 秒；这不会延迟 Codex 窗口打开。
- 这不是 OpenAI 官方插件接口。启动调试端口期间，本机其他进程理论上也可能连接到该端口；用完可运行停止脚本并正常退出 Codex。

借鉴代码的 MIT 许可见 `LICENSE-DSH.txt`。

如需在本地运行模拟测试：`npm install`，然后 `npm test`。正常使用吸顶功能不需要安装 npm 依赖。
