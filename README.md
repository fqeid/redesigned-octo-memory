# Edge 标签页管理 POC

## 加载与验证

1. 解压 ZIP，在桌面版 Edge 打开 `edge://extensions/`。
2. 打开**开发人员模式**，点**加载解压缩的扩展**，选择含 `manifest.json` 的 `edge-tab-poc` 文件夹。
3. 打开两个测试网站并放到同一个 Edge 标签组里，保留至少一个在后台。点工具栏的扩展图标，选组后点**卸载所选组**，或逐个卸载。扩展会跳过当前标签、已卸载标签、固定标签、正在播放音频的标签及非 HTTP(S) 页面。已卸载标签仍留在原位置，切回时会重新加载。

弹窗展示当前窗口的标签页。**上次激活**来自浏览器的 `lastAccessed`，代表标签页最后一次成为所在窗口的活动标签页。窗口可能在后台，时间也不代表点击次数或阅读时长。页面导航后，这个时间仍是针对标签页本身。

## 接 Telegraf

默认 `config.js` 里的 `telegrafUrl` 留空，扩展仅在本地显示标签页和执行卸载。

1. 将 `config.js` 的 `telegrafUrl` 填为内网 HTTPS 接收地址，例如 `https://metrics.example.com/edge-tabs`。将 `manifest.json` 的占位权限替换为 `https://metrics.example.com/*`。本机假接收端测试允许 `http://localhost:端口/edge-tabs`，对应的站点权限写为 `http://localhost/*`。
2. 复用已有的 Influx Line Protocol 接收入口，或在 Telegraf 添加以下 input。示例假设由已有的 HTTPS 入口转发到同机监听器。

   ```toml
   [[inputs.http_listener_v2]]
     service_address = "tcp://127.0.0.1:8186"
     paths = ["/edge-tabs"]
     methods = ["POST"]
     data_format = "influx"
   ```

3. 在 Edge 扩展页重新加载扩展，点**上报所有窗口**验证。配置有效后，扩展也会每 5 分钟发一次快照。接收端不可用时，本次快照丢弃，下个周期继续。请求超时为 5 秒，卸载功能独立运行。

## 上报字段

Measurement 为 `edge_tab_snapshot`。快照覆盖当前 Edge 配置文件所有普通窗口中的 HTTP(S) 标签，每个标签对应一行。字段如下。

| 字段 | 含义 |
| --- | --- |
| 时间戳 | 快照采集时间，从毫秒转为 Influx 行协议纳秒格式 |
| `browser_id` | 配置上报后生成、保存在扩展本地的随机 ID。标识此扩展安装，无法直接对应用户账号 |
| `snapshot_id` | 同一批行的随机快照 ID |
| `row_index` | 批内行号。相同网址的不同标签仍各占一行 |
| `url` | 主页面 URL。默认保留协议、主机、端口和路径，去掉账号密码、查询参数及 # 片段 |
| `active_in_window` | 是否为所在窗口的当前标签。这不表示该窗口在前台 |
| `discarded` | 是否已经卸载 |
| `last_accessed_ms` | 最后激活时间，毫秒。浏览器未给出时省略 |
| `extension_version` | 扩展版本 |

如确实需要查询参数和片段，可在 `config.js` 将 `includeQueryAndFragment` 改为 `true`。扩展声明 `tabs` 权限用于读取地址。代码不读取网页标题，不注入网页脚本。组名只显示在本地，快照不上报组名或页面内容。
