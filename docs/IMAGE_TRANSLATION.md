# 图片翻译 / Image translation

右键消息图片，选择“翻译概括图片内文字”。支持本地 llama-server（需视觉模型及匹配的 mmproj），或独立的 DeepSeek 服务（使用 deepseek-flash）。通用在线模式暂不支持。

Right-click a message image and choose Translate and summarize image text. Choose local llama-server with a vision model and matching mmproj, or the dedicated DeepSeek service with deepseek-flash. Generic online image processing remains unsupported. See the [llama.cpp multimodal documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md).

## 行为 / Behavior

- 一次视觉生成直接识别、翻译并概括图片内文字，不调用额外 OCR，也不先生成识别正文。请求通过 Chat Completions 的 user content 数组携带文字和 image_url（Base64 data URL）。
- 只翻译并概括图片内可见文字。附带的 Discord 消息正文（如 yup）、附近消息及回复仅用于理解上下文，不并入输出；最后一条用户输入使用图片专属指令，消息附言只放在参考元数据。
- 附带预算筛选后的版面主题、图片消息正文、附近原文、回复和事先匹配的术语。术语按图片说明、版面名称及上下文筛选；仅出现在图片内的词条无法提前命中，不会因此额外调用识别或塞入整份词表。
- 在所选图片后插入小号灰色纯文本，保留原图，不执行模型返回的 HTML。多图分别绑定。标签显示原文语言，点击仅改变本图目标语言，不修改自动翻译默认值。
- 初始目标使用版面自动翻译采用的共享默认值。再次右键选择图片翻译会强制读取当前说明、回复、附近消息及最新术语，重新生成；清除此图其他语言的旧结果。
- 切换至未缓存语言需要一次新视觉生成，尽量复用图片数据；切回已缓存语言、滚动或重新显示消息不生成。保留最多 100 图及每图四种语言结果；图片载荷另限 100 项和 32 Mi 字符（UTF-16 约 64 MiB），超限淘汰后可能重新下载。
- 同目标进行中的重复点击去重。切换目标、离开消息、停用或更改翻译配置会取消相关任务；旧结果不能覆盖新结果。没有文字时提示，格式错误或截断时报错，无自动重试。

One vision generation reads, translates and summarizes only text visible inside the image; no separate OCR step or service is used. Discord captions (such as yup), nearby messages and replies are context only and must not appear in the output. The user turn contains an image-only task instruction; captions stay in reference metadata. Typed user content carries text and an image_url data URL. Budgeted references include area names, captions, nearby original messages, replies and terms matched before the request. Terms appearing only inside the image cannot be matched in advance.

Smaller muted plain-text results appear below the selected image, with a source-language badge for changing only that image's target. Choosing the image action again refreshes context and glossary terms and clears stale language results. Switching to an uncached language generates once; cached language choices and remounts generate nothing. Up to 100 image records and four language results per image are kept. A separate image payload cache is capped at 100 items and 32 Mi characters (roughly 64 MiB in UTF-16); eviction can require downloading again. Repeated pending actions are deduplicated and stale results cannot overwrite newer work. Empty, malformed and cancelled results are handled without automatic retries.

## DeepSeek

- 在服务类型中选择 DeepSeek，配置 API 地址、密钥及 deepseek-flash。兼容旧视觉别名 deepseek-v4-flash-vision-exp；其他模型在下载前拒绝，不会自动改动文字翻译模型。
- 使用现有图片菜单和展示，发送 user 消息中的 text 与 Base64 image_url，一次生成完成翻译概括，detail 使用 original。沿用思考开关、思考强度、超时及输出额度。
- 图片及筛选后的参考上下文会发送至当前配置的 DeepSeek 服务，可能产生费用。请谨慎使用；可在请求用量和 Debug 日志中查看返回的用量。不会上传图片到 Files API 或增加独立 OCR。
- 不调用本地计数接口；按官方单图上限保留 1024 个输入 token，再筛选文本上下文预算。继续保留插件自己的 8 MiB／尺寸上限。DeepSeek 原生接收 WebP，不执行本地转 PNG。

Select DeepSeek and configure its URL, key and deepseek-flash model (the legacy vision alias is also accepted). Other models are rejected before downloading; the plugin does not silently switch your text model. The existing image action sends inline image data in the final user turn, uses original detail, and honors thinking/output settings. Images and reference context leave your machine and API calls may incur charges. No Files API upload, OCR stage or local counting request is added. A 1024-token per-image reserve is applied before text-reference selection, while the plugin retains its stricter size limits. WebP is sent directly. See [DeepSeek vision](https://api-docs.deepseek.com/guides/vision/) and [thinking parameters](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/).

## 限制与预算 / Limits and budget

- 仅下载 Discord CDN 消息附件或 Discord 代理的图片预览，不读取任意网站、本地文件、头像或表情。下载不携带模型 API Key／Cookie，不跟随重定向。
- 下载及转换结果均最多 8 MiB；PNG、JPEG、GIF、WebP 全部先解析头部检查尺寸，单边最多 8192 像素，总计最多 16,777,216 像素。超限提示裁剪，不静默缩小文字。本地模式将 WebP 检查后浏览器解码转 PNG，并再次检查结果；DeepSeek 直接发送检查后的 WebP；不逐帧翻译动画。
- 本地模式生成前尝试 llama-server 的 /v1/chat/completions/input_tokens 原生多模态计数接口，以配置的 contextTokens − maxTokens 检查输入。计数不生成文字，但会另发送一份带图片的本地请求；自动发现模型另有 /models 查询。因此“一次生成”不代表只发生一次 HTTP 请求。
- 本地旧服务返回 404／405／501 时保留字节、像素和文本参考预算限制，再由服务端判断实际视觉容量；此时插件无法保证图片 token 与剩余上下文完全匹配，Debug 明确记录回退。其他接口错误、无效计数或已知超预算会阻止生成。绝不把 Base64 长度当作视觉 token 数。
- 译文及概括合计最多 24000 字符，同时服从输出 token 限制。计数、模型发现与生成共用一次超时期限及已有并发限制。结果质量取决于模型与图片清晰度。
- Debug 省略 Base64，保留图片尺寸、提示词、上下文、术语及结果。分享日志前检查其中聊天内容。

Only Discord-hosted attachments and proxied previews are downloaded, without model credentials, cookies or redirects. Downloads and converted PNGs are limited to 8 MiB. Every supported format is checked before decoding: at most 8192 pixels per side and 16,777,216 total pixels. Oversized images are rejected for cropping rather than silently resized. Local WebP is decoded to PNG and checked again; DeepSeek uses native WebP; animations are not translated frame by frame.

In local mode, the native [llama-server input-token counting endpoint](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#post-v1chatcompletionsinput_tokens-token-counting) is tried before generation, checking input against contextTokens minus maxTokens. Counting is a separate local HTTP request carrying the image, with no text generation; model discovery may also query /models. Older servers returning 404/405/501 fall back to byte/pixel/text-reference limits and server-side capacity validation, so exact visual capacity cannot be guaranteed in that fallback. Other failures or known oversized inputs prevent generation. Base64 length is never treated as visual token count. Translation and summary total at most 24000 characters, subject to output tokens. Counting, discovery and generation share one deadline and existing concurrency limits. Debug omits image Base64 but retains prompts, context, dimensions and results.
