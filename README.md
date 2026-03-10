# 小红书运营助手 Skill

一个可公开复用的小红书运营工作流仓库，覆盖这几件事：

- 站内热帖学习
- 选题与文案生成
- 封面图生成
- ADB 发帖执行
- 评论巡检与上下文回复
- 去重和运行状态管理

这套仓库目前偏向 `OpenClaw / GitHub 热门项目 / AI 自动化工作流` 账号，但工作流本身可以改造成其他垂类。

## 仓库里有什么

- `src/`
  核心脚本，包含学习、生成、发帖、评论、调度等链路
- `docs/`
  运营 SOP、流程树和演示图片
- `launchd/`
  macOS 定时任务模板
- `scripts/`
  调度启动脚本
- `SKILL.md`
  可作为本地 Skill 使用的说明入口

## 这套流程长什么样



![小红书运营工作流 SOP](./docs/images/ops-workflow-sop-poster.png)


## 适合的场景

- 想做技术向小红书账号，但不想只发“项目介绍卡片”
- 想先学习平台热帖，再生成更像小红书语境的内容
- 想把发帖和回评流程固化成可重复执行的脚本
- 想做多账号矩阵前，先打通单账号 SOP

## 快速开始

1. 安装 Node.js 20+ 和 `adb`
2. 复制 `.env.example` 为 `.env`
3. 打开手机开发者模式和 USB 调试
4. 如需稳定中文输入，安装 `ADB Keyboard`
5. 先跑学习和生成，再接发帖和评论链路

```bash
npm run xhs:study -- --keyword OpenClaw --force
npm run xhs:generate -- --offline
npm run xhs:post-daily
npm run xhs:comments
```

## 常用命令

```bash
# 学习最近 3 天的小红书热帖
npm run xhs:study -- --keyword OpenClaw --force

# 只生成当天内容，不碰手机
npm run xhs:generate -- --offline

# 生成并打开手机里的发帖编辑页
npm run xhs:post-daily

# 直接执行发布
npm run xhs:post-daily -- --publish

# 扫描评论并生成回复草稿
npm run xhs:comments

# 守护式自动回复少量安全评论
npm run xhs:comments -- --auto-send --max-replies 3

# 定时器单次执行
npm run xhs:tick -- --publish --comments
```

## 关键环境变量

基础运行：

- `ADB_BIN`
- `ADB_VENDOR_KEYS`
- `XHS_DEVICE_PROFILE`
- `XHS_TEXT_MODE`
- `XHS_TIMEZONE`
- `XHS_POST_SLOTS`
- `XHS_COMMENT_SWEEP_INTERVAL_HOURS`
- `XHS_MAX_AUTO_REPLIES`

内容生成：

- `GITHUB_TOKEN`
- `XHS_GEMINI_API_KEYS`
- `XHS_GEMINI_TRANSPORT`
- `XHS_REMOTE_OPENCLAW`
- `XHS_REMOTE_TEXT_COMMAND_TEMPLATE`
- `XHS_REMOTE_IMAGE_COMMAND_TEMPLATE`

## 注意事项

- 每次设备动作前都要先确认亮屏
- 同一条可见评论绝不能重复回复
- 回复必须带线程上下文，不能只看最后一句
- 高风险、引战、争议评论不要全自动回复
- 这套仓库不包含绕过审核或伪装真人行为

## 公开版里刻意去掉了什么

- 个人目录路径
- 本地密钥和环境文件
- 实际账号数据
- 评论历史、运行状态、日志
- 本机安装过的 LaunchAgent 配置

## 定时任务模板

`launchd/com.openclaw.xhs-automation.plist.template` 使用了 `__WORKDIR__` 占位符。使用前请替换成你自己的绝对路径，再通过 `launchctl` 加载。
