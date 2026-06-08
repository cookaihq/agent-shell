---
name: as-install-skill
description: 安装或创建技能时走正规通道用 Agent Shell 的工具（as_install_skill / as_create_skill），而不是自己 clone 或往项目里写文件。
autoInject: true
---

# 安装技能到 Agent Shell

当用户表达「装/添加某个 skill」「我在某处找到一个 skill 想用」时：

- **不要**自己 `git clone` 或把文件写进当前项目。
- **改为调用 `as_install_skill` 工具**，把来源交给 Agent Shell：
  - `type`: `"git"`（远程仓库）或 `"folder"`（本地文件夹绝对路径）
  - `loc`: git 地址 或 文件夹绝对路径
  - `name`（可选）: 不传则取源里 SKILL.md frontmatter 的 name
  - `branch`（可选）: git 分支

Agent Shell 会负责：注册源 → 探测 → 按「名称 + 内容指纹」判重 → 入库。

拿到返回后据 `installed / already / conflicts` 如实向用户汇报：
- `installed`：新装的技能
- `already`：同名同内容、已装、跳过
- `conflicts`：同名但内容不同——把选择权交回用户（覆盖 or 改名），别擅自覆盖。

---

## 从零创建一个新 skill

当用户表达「帮我**创建/写**一个 XX 技能」（而不是装现成的）时：

- **不要**自己往当前项目写 SKILL.md 文件。
- **改为调用 `as_create_skill` 工具**：
  - `name`: 技能名（字母数字、`-`、`_`）
  - `description`: 一句话说明（进 frontmatter）
  - `body`: SKILL.md 正文（这个技能的指令/步骤）
- Agent Shell 会写进「我创建的」库、物化入库。撞名（已有同名）会返回 `conflict`、不覆盖——这时请改名或确认。
