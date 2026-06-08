---
name: cli-tools-manager
description: 当用户要安装/更新/管理命令行工具（CLI），或问"能不能装个 xxx 工具"时使用——走 Agent Shell 的 as_cli_* 工具，别自己手动跑安装脚本。
autoInject: true
---

# 管理命令行工具（CLI Tools）

当用户表达「装个 / 更新 / 看看有哪些」命令行工具时：

- **先 `as_cli_list`** 看目录与已装状态，别凭空假设装没装。
- **安装走 `as_cli_install`**（传工具 `id`），不要自己拼 `brew/npm install` 在 shell 里跑——Agent Shell 会按当前系统选对方式、跑完安装、并登记元数据。
- **本机已装但不在目录里的工具**，用 `as_cli_add` 按可执行**绝对路径**登记进来。
- **登记/安装自定义或冷门工具时，顺手用 `description` 入参写一句它是干嘛的**——这句会进系统提示，让后续会话知道这工具能用。
- 更新用 `as_cli_check_updates` 查、`as_cli_update` 更。
- 拿到返回如实向用户汇报（装了/已是最新/失败原因）。

> 注：`as_cli_*` 工具当前仅 Claude 引擎可用。
