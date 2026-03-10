---
name: xiaohongshu-ops-assistant
description: Use this skill when you need a reusable Xiaohongshu operations workflow, including trend study, topic planning, title/body/cover drafting, guarded posting, and guarded comment replies with anti-duplicate rules.
---

# 小红书运营助手 Skill

这个 Skill 适用于这几类任务：

- 先学习最近 3 天的小红书热帖，再决定当天发什么
- 把技术内容改写成更像小红书的标题、正文和封面
- 通过 `adb` 稳定执行发帖
- 定时巡检评论，并根据上下文回复
- 确保同一条评论只回复一次

## 核心规则

1. 先学习，再生成，不直接从 repo 说明书出稿
2. 先讲场景，再讲配置，不用纯技术博客口吻
3. 发布和回评都要先验屏，再执行动作
4. 同一条可见评论绝不能重复回复
5. 高风险评论保持人工处理

## 执行顺序

1. 跑站内热帖学习
2. 生成当天内容包
3. 预检标题、正文、封面是否一致
4. 打开发帖编辑页并校验输入结果
5. 执行发布
6. 定时巡检评论
7. 带线程上下文生成回复
8. 写回状态，防止重复回复

## 需要查看的文件

- 运营流程树：[`docs/ops-workflow-tree.md`](./docs/ops-workflow-tree.md)
- 核心调度：[`src/scheduler.mjs`](./src/scheduler.mjs)
- 发帖链路：[`src/run-daily-post.mjs`](./src/run-daily-post.mjs)
- 评论链路：[`src/comment-pipeline.mjs`](./src/comment-pipeline.mjs)
- 运行配置：[`src/config.mjs`](./src/config.mjs)
