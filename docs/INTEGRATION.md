# 安装、迁移与回滚

本包包含完整资源。平台、依赖与安装命令见 [README](../README.md)，验证限制见 [PUBLIC-DISTRIBUTION](PUBLIC-DISTRIBUTION.md)。

## 正常安装

可使用 `pi install https://github.com/ymd-physics/pi-fairy`。
Pi 会访问网络、安装依赖并修改设置，须先取得用户许可。不要未经许可代为执行。
所有运行资源从包内相对路径解析，不应复制作者的机器路径。

1. 只读盘点全局与项目 `packages`、`extensions`，包括自动发现的扩展；备份设置须获批。
2. 与用户确认只保留一个集成入口 `index.ts`。移除旧动画/独立语音的加载条目而非删除原包；不要另载内部模块。不同本地副本不会按内容去重。
3. 按批准的安装级别定点更改条目，绝不覆盖整个设置文件。保留原有其他插件与顺序；需及时压缩通知时 Fairy 在 codex-compaction 前。
4. 由用户在所有 Pi 中 `/fairy-anim off` 或正常退出，等待旧 owner 租约释放后再重启全部 Pi。`/reload` 不保证换掉共享 helper 或其声音资源目录。
5. 不杀死其他会话的 helper，不删除状态/cache；FAIRY2 与旧 FAIRY1 不兼容。原 IPC `/tmp/pi-fairy-UID/` 与设置 `~/Library/Application Support/pi-fairy-animation/settings.json` 有意保持兼容命名。

## 可选提前入口

另见 [STARTUP-ENTRY.md](STARTUP-ENTRY.md)。普通插件不保证早于 TUI。提前入口要求已准备原生缓存、特定交互调用和全局未过滤的本地路径，不把 Git URL 当作已支持配置。调整路径、编译缓存、临时 source 和持久 shell 修改都需分别批准。

## 回滚

由用户正常释放全部新租约，然后只恢复获批改动的包条目；不要把整个旧备份覆盖到已有后续更改的设置。若启用了 shell 函数，`command pi` 绕过它，当前 shell 可用 `unfunction pi` 撤销；持久 source 行仅按实际审查记录删除。保持原独立包可用，但不要同时加载两份语音。
