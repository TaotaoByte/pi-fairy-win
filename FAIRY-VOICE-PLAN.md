# Fairy Voice Notification Plan

> 原创行为/文案设计参考，采用根 MIT；不转授第三方角色、声音、模型权利。
> 此公共树附带全部 44 个语音 WAV，不包含合成模型或生成工具。
> 集成模式与缺资源行为以 README、docs/PUBLIC-DISTRIBUTION.md 为准。

## Notification table

| 插播优先级 | 节点 | 精确触发条件 | Fairy 提示语 | 防重复规则 |
|---|---|---|---|---|
| — | 欢迎（进程启动） | `session_start` 且 `reason == "startup"`（仅从终端首次打开 pi 的首个 session） | 七条文案随机一条，不连续重复：① Fairy已就绪。主人，请下达指示。② 新艾利都最强智能管家Fairy，已待命。③ 主人，您终于舍得开工了？Fairy以为您忘记密码了。④ 主人！没有Fairy…您真的能搞定一切吗？⑤ 欢迎回来，主人。Fairy已为您整理好今天的任务清单。⑥ 主人！检测到您上线。今日待办已全部就绪，随时可以开始。⑦ 系统启动完成。我是三型总序式集成泛用人工智能，开发代号Fairy。合作愉快，主人。 | 每次进程启动只播一条且不与上次启动相同；`reload`、`resume`、`new`、`fork` 均不触发 |
| 低 | 起身活动提醒 | pi 打开期间每小时一次（`session_start` 起计时，任何 reason 都会重新计时；shutdown 取消） | 三条文案随机一条，不连续重复：① 健康提醒：主人已连续工作一小时。请起身活动，保护肩颈。② 主人，该活动一下身体了。Fairy可不想您变成一座雕像。③ 主人，我可是不用休息的超级人工智能。但您这具称不上健康的肉身，还是活动一下为好。 | 每小时最多一条；最低优先级（1），若撞上正在播报的中/高优先任务音则放弃本次，不排队。播报后弹原生 pi 对话框（标题"主人，该起来活动一下了。"，选项"好，去活动一下。" / "再工作一会儿。"）：选工作 → 5 分钟后换一条再提醒；Esc 或 10 分钟窗口内无人应答 → 跳过本次等下个整点；弹窗期间若被 permission/其它对话框抢占 → 在 10 分钟窗口内每 5 秒轮询重试直到弹出或窗口到期。对话框不注入上下文、不阻塞 agent、不调用第三方 permission 插件 |
| — | 再见（退出 pi） | `session_shutdown` 且 `reason == "quit"` | 六条文案随机一条，不连续重复：① 主人再见。可别趁Fairy休息，把任务搞砸了。② 主人下线了。Fairy开始后台自检…顺便看看主人的浏览记录。③ 辛苦了，主人。身为新艾利都最强智能管家，Fairy随时等着您。④ 检测到主人离线。Fairy转入待机模式，随时等待唤醒。⑤ 主人慢走。新艾利都最强智能管家已就位，您什么都不用担心。⑥ 主人！休息时间到了。Fairy可不想因为主人过载，被迫解除绑定关系。 | 每次 quit 只播一条且不与上次 quit 相同；在 shutdown handler 内同步启动播放（pi 随即退出，不依赖定时器/微任务）；先放弃仍在播放的其它剪辑。⑥ 句首叹号为强制断句（success 停顿标准）。② 0.95×、③ 1.0×、⑤ 0.975×（语速经用户试听定档） |
| 中 | 任务开始 | 用户 prompt 已被 Pi 接受，进入 `before_agent_start` 并实际启动 agent 任务后 0.5 秒 | 四条文案随机一条，不连续重复：① 了解！任务开始。② 收到，Fairy已接管。③ 开始解析空洞数据。④ 很厉害的fairy已收到您的请求。 | 每个被接受并启动 agent 的新 prompt 播放一次；延迟不阻塞 agent；模型内部的多轮响应、工具调用、自动重试不重复播放；不启动 agent 的命令不播放 |
| 高 | 权限请求 | permission system 弹出确认窗口；同一窗口中的多个请求，以及并发或紧邻出现的请求，视为一个连续的权限确认阶段 | 三条文案随机一条，不连续重复（均以"提问"起手；① ② 用省略号制造停顿（原生 630ms 过长），③ 句号停顿原生仅 90ms；三条的"提问+停顿"头段已统一为 ③ 的标准头（提问 + 250ms 停顿，silence_edit.py / splice_region.py 编辑）：① 提问…检测到权限请求，主人是否授权？② 提问…检测到敏感操作，主人是否允许执行？③ 提问。有一项操作需要您的授权。 | 每个连续的权限确认阶段只播放一次，不按单个 tool call 分别播放；当前权限窗口结束后，后续出现新的独立权限窗口时可以再次播放 |
| 高 | 权限批准 | 与活动权限窗口匹配的 `permissions:decision`，且 `resolution` 为 `user_approved` 或 `user_approved_for_session` | 短电子确认音（批准候选 B） | 在人工批准发生时立即中断权限请求语音并播放；自动策略允许不播放 |
| 高 | 权限拒绝 | 与活动权限窗口匹配的 `permissions:decision`，且 `resolution == "user_denied"` | 短电子否定音（拒绝候选 A） | 在人工拒绝发生时立即中断权限请求语音并播放；非人工失败只停止权限语音，不伪装成用户拒绝 |
| 高 | 其他阻塞式输入 | Pi 弹出非权限类选择框、输入框或确认框 | 主人，请提供进一步指示。 | 每个连续等待阶段只播放一次 |
| 中 | 任务成功 | 到达 `agent_settled`，最终没有 `error` 或 `aborted` | 三条文案随机一条，不连续重复：① 肯定。任务已完成。② 已完成。随时可以开始下一个任务。③ 肯定。空洞出口解析完成。 | 每个完整任务只播放一次；③ 语速 1.05×（更快一档）；② 的语义注意：提问型任务也会播"任务完成"，若嫌怪可改用其它句 |
| 高 | 网络错误 | 到达 `agent_settled`，错误包含 `fetch failed`、`timeout`、`network`、`connection` 等 | 警告！网络异常，任务失败。 | 与一般错误、中止、成功互斥 |
| 高 | 一般错误 | 到达 `agent_settled`，最终为 `error`，但不是网络错误 | 警告！检测到异常，任务失败。 | 与网络错误、中止、成功互斥 |
| 高 | 用户中止 | 到达 `agent_settled`，只有 `aborted`，没有更具体的错误 | 当前任务已中止。 | 与错误和成功互斥 |
| 中 | 自动重试 | 进入自动重试，并且预计等待超过 5 秒 | 提示！检测到连接异常，正在重新尝试。 | 一组连续重试只播放一次 |
| 低 | Context 快耗尽 | Context 首次从低于 80% 上升到不低于 80% | 提示！对话记录即将达到上限。（0.2.24 改稿：原"警告！上下文即将达到上限。"） | 同一 Session 只播放一次；压缩后降到阈值以下才重置 |
| 中 | 压缩进行中（手动） | `session_before_compact` 且 `reason == "manual"`（用户 `/compact`） | 收到！正在为您整理对话记录，请耐心等待。 | 每次压缩只播一次，**立即播放**（用户主动触发，即时反馈） |
| 中 | 压缩进行中（自动） | `session_before_compact` 且 `reason` 为 `threshold`/`overflow`（含 codex-compaction 的 native 压缩，同一事件链） | 提示！对话记录过长，正在整理，请耐心等待。 | 每次压缩只播一次；与手动压缩一样立即播放 |
| 中 | 压缩完成 | `session_compact`（压缩成功） | 对话记录已整理完毕。 | 每次压缩只播一次 |
| 高 | 自动压缩失败 | Context compaction 最终失败，并且没有立即继续成功 | 警告！对话记录整理失败。 | 同一次压缩只播放一次；若随后产生最终任务错误，不再重复播放一般错误 |
| 低 | API 额度过低 | 5 小时额度或周额度首次降到 10% 以下 | 警告！额度即将耗尽。 | 每个额度周期、每种额度只播放一次 |
| 低 | 模型切换 | `model_select` 且 `source` 为手动选择或快捷键切换；忽略启动恢复模型 | 确认模型已切换。 | 每次实际切换播放一次；恢复默认/既有模型时不播放 |
| 低 | 历史会话切换 | `session_start` 且 `reason == "resume"` | 确认会话已切换。 | 每次 `/resume` 成功进入目标会话后播放一次 |
| 低 | 新会话 | `session_start` 且 `reason == "new"` | 已进入新会话。 | 每次 `/new` 成功创建并进入新会话后播放一次；首次 `startup`、`reload` 和 `fork` 不播放 |

## Final-state precedence

When multiple terminal states occur in one task, play exactly one notification according to this precedence:

```text
网络错误 > 一般错误 > 用户中止 > 任务成功
```

## Playback interruption policy

At most one Fairy clip may be active or pending at a time. Notifications use the
`高 > 中 > 低` priority in the table above:

- A new notification of equal or higher priority interrupts the active clip (or
  cancels a delayed pending clip) and starts immediately, subject only to its own
  intentional delay such as the 0.5-second task-start delay.
- A new lower-priority notification is dropped instead of waiting behind a more
  important clip.
- An interrupted or dropped clip is never resumed or added to a backlog.
- Interruption cancels only the player process started by `pi-fairy-voice`, using its
  own abort signal. Never use `killall afplay` or affect unrelated system audio.

## Implementation constraints

- Voice output has a process-wide mute switch: `/fairy-voice off` silences every
  clip (including the hourly activity round: no voice, no dialog, re-armed for
  the next hour) and aborts whatever is playing; `/fairy-voice on` restores;
  `/fairy-voice status` reports the state. The switch lives in memory only — a
  new pi process always starts unmuted. Muting never unloads the extension or
  stops its bookkeeping; it only gates audio/dialog output.
- The switch confirmations are exempt from the mute: `/fairy-voice off` answers
  with "语音模组已禁用。" and `/fairy-voice on` with "语音模组已加载。" — the
  user's only audible feedback that the switch took effect (priority 3, same
  class as permission approvals; playback of anything already running is
  aborted first).

- Listen to existing Pi lifecycle and UI events only.
- Use the priority-based interruption policy above; clips never overlap.
- Do not inject system, user, assistant, or custom context messages.
- Do not make additional model or API calls at runtime.
- Generate Fairy audio offline, then play static local audio files asynchronously.
- Do not modify, block, cancel, or delay agent and tool execution.
- Do not play a completion sound for intermediate failures that Pi will automatically retry.
