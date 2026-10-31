# Contributing to BiliWhaleMusic

感谢你愿意为 BiliWhaleMusic 贡献。项目规模不大，规则尽量简单，请先读完再动手。

## 行为准则

- 友善、就事论事；中文或英文交流均可。
- 这是一个个人学习/实验项目，接受合理范围内的功能建议与 bug 修复。

## 提交 Issue

- **Bug**：使用 `.github/ISSUE_TEMPLATE/bug_report.md` 模板，务必附带：
  - 操作系统与缩放比例（如 Windows 11、150% DPI）；
  - 启动方式（`npm start` / `start.cmd` / 打包安装版）；
  - 复现步骤、预期行为与实际行为；
  - 控制台报错或 `startup.log` 关键片段。
- **功能建议**：使用 `feature_request.md` 模板，说明场景与期望效果。

## 提交 PR

1. 从最新的 `main` 分支切出自己的分支：`git checkout -b feat/xxx` 或 `fix/xxx`。
2. 只做一件事：一个 PR 一个主题，标题用祈使句概括改动。
3. 改动范围：请遵循 README 中的「目录结构」与「实现要点」，新增桌宠组件时
   按既有卡片模式扩展（`renderer/pet/index.html` + `pet.js`，必要时加 `pet:*` IPC）。
4. 自查清单：
   - [ ] `npm start` 在本机可运行，桌宠窗口与播放器正常；
   - [ ] 没有破坏既有功能（登录、收藏、歌词、托盘）；
   - [ ] 没有把 `userdata/`、`runtime/`、`dist/`、`node_modules/` 提交进仓库；
   - [ ] 涉及 B 站接口的改动已注明接口与可能失效的风险。
5. 推送并提交 PR，说明改动内容与验证方式。

## 开发环境

```bash
npm install
npm start          # 开发运行（内置 --no-sandbox）
npm run dist       # 打包 Windows NSIS 安装包（输出到 dist/）
```

## 第三方素材与许可

- 新增素材请确认许可，并在 NOTICE 中登记来源、作者与许可证。
- 不要引入 Biu（PolyForm Noncommercial）等非商业许可的代码实现；
  如需借鉴，先在 Issue 中讨论合规边界。

## 提交信息风格

建议使用 Conventional Commits 风格：

```
feat: 新增 XX 组件
fix: 修复 XX 问题
docs: 更新 XX 文档
refactor: 重构 XX
```
