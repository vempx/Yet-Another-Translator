# 图片翻译 / Image translation

右键消息图片，选择“翻译概括图片内文字”。本功能仅使用已配置的本机 llama-server，不会转发给在线模型。需要加载支持图片的视觉模型及匹配的 mmproj；只加载文字模型无法接收图片。设置方式参考 [llama.cpp 多模态文档](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md)。

Right-click a message image and choose Translate and summarize image text. This feature uses the configured local llama-server only, with a vision-capable model and matching mmproj. It does not route images to online services. See the [llama.cpp multimodal documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md).

## 行为 / Behavior

- 在被选中的图片后显示结果，不替换原图；同一消息多张图片分别绑定。文字较小、灰色，无引用边框。输出作为纯文本显示，模型输出不会作为 HTML 执行。
- 初始目标语言使用版面自动翻译的共享默认值；标签表示识别出的原文语言。点击标签只改变这张图片的目标语言，不修改默认语言、不启用自动翻译。
- 第一阶段通过 Chat Completions 的 user content 数组发送文字与 image_url（Base64 data URL），要求返回原文及原文语言。第二阶段发送识别出的文字及预算筛选后的版面、图片消息正文、附近消息、回复和术语参考，生成译文与简短概括。两阶段均只调用本机服务。
- 切换语言复用已识别原文，保留每图最近四种目标语言结果；最多保留 100 张图片记录。滚动或切换频道后可恢复已完成结果，停用或更改翻译配置后清空。断开显示的待处理任务会取消；可右键重试。
- 模糊、过长、截断或格式不完整的识别结果不会被当作成功译文。没有文字时直接提示，不生成概括。不进行自动重试。

Results appear below the selected image, with smaller muted text and a clickable source-language badge. Multiple images remain independent. Model output is displayed as plain text. The initial target follows the shared automatic-translation default; badge choices affect this image only. OCR runs first, followed by contextual translation and summarization. Switching language reuses OCR; up to four target results per image and 100 image records are retained. Finished results restore after remounts; pending disconnected work is cancelled. Disabling or changing translation configuration clears results. Empty images skip summarization; truncated or malformed output is rejected without automatic retries.

## 限制 / Limits

- 仅处理消息中的 Discord CDN 附件或 Discord 代理的图片预览，不获取任意网页、本地文件、头像或表情图片。图片下载不携带模型 API Key、Cookie 或登录凭据，不跟随跳转。
- 单张下载最多 8 MB，按文件内容识别 PNG、JPEG、GIF、WebP；WebP 在浏览器解码为 PNG，再发送给 llama-server。WebP 转换限制为约 1600 万像素，转换结果同样限制为 8 MB。其余格式由后端解码；不进行动画逐帧翻译。
- 识别正文最多 12000 字符，翻译与概括合计最多 24000 字符，并服从现有输出 token 上限。图像 token 消耗由视觉模型决定，不能按 Base64 字符数当作文字 token 估算。
- 使用现有超时与并发限制。两阶段各有请求超时；图像过大、模型未启用视觉、上下文不足或输出额度不足都会显示错误。识别质量取决于图片清晰度和视觉模型。
- Debug 记录图片任务阶段、模型、格式、字节数、提示词和结果，但省略 Base64 图像数据。OCR 原文、聊天上下文与术语仍会写入已启用的日志，请留意其隐私内容。

Only Discord-hosted message attachments and Discord-proxied previews are fetched. Arbitrary websites, local files, avatars and emoji are excluded. Downloads omit model credentials and do not follow redirects. Input is limited to 8 MB and recognized from file signatures. WebP conversion is limited to roughly 16 million pixels and an 8 MB PNG output. Animation frames are not translated individually. OCR text is capped at 12000 characters; translation plus summary at 24000, subject to the configured output-token budget. Image token costs depend on the model. Existing concurrency and per-request timeouts apply. Debug omits Base64 image content but retains recognized text, context, prompts and results.
