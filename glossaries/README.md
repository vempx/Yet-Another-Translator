# 可编辑术语表

## 版区与术语表

1. 在 Discord 左侧列表中右键频道、论坛或论坛帖子，选择 **打开自定义翻译**。
2. 打开 BetterDiscord 的 Yet Another Translator 设置，找到 **版区自定义翻译 · 本地术语表**。
3. 在 **术语表路径（JSON）** 中填写或粘贴文件的绝对路径。
4. 点击 **检查术语表**，在该版区路径下方确认检查结果和条数，再点击 **保存并关闭**。修改路径会清除旧检查结果。

自定义翻译为自动翻译、消息上的“译”按钮和本地翻译器提供术语参考。要自动翻译可见消息，仍需开启原来的自动翻译开关。

绑定按 Discord 的版区 ID 保存，重名频道不会互相影响，改名不影响绑定。论坛帖子优先使用自身配置；没有配置时继承父论坛。给某个帖子单独关闭自定义翻译可覆盖父论坛设置；移除帖子配置后恢复继承。

启用鸣潮、Wuthering Waves 或 Arknights/Endfield 相关版区时会预填对应文件路径。其他版区可使用任意术语表；空路径使用普通翻译。失效路径或格式错误会显示明确错误，修正后可以重试。

## 可编辑文件

- `wuthering-waves.json`：鸣潮角色、技能、资源、武器、专有名词及少量聊天简称。
- `arknights-endfield.json`：明日方舟与终末地的角色、技能、资源、专有名词及少量聊天简称；使用 `game` 区分两款游戏。

部署到 BetterDiscord 时，将两个 JSON 文件放到插件目录中的 `YetAnotherTranslator-glossaries` 文件夹。已识别的游戏版区会预填该文件夹中的对应路径。也可以保留工作区文件的位置，并在设置中填写其完整路径。

文件为 **UTF-8 JSON**，记事本、VS Code 等文本编辑器均可修改。一个最小术语表：

```json
{
  "version": 1,
  "name": "我的鸣潮术语表",
  "entries": [
    {
      "game": "Wuthering Waves",
      "category": "character",
      "en": "Iuno",
      "zh": "尤诺",
      "aliases": [],
      "note": "可以在 aliases 中添加自己常用的简称"
    },
    {
      "game": "Wuthering Waves",
      "category": "chat",
      "en": "signature weapon",
      "zh": "专武",
      "aliases": ["sig"],
      "note": "仅在武器或配装语境中使用"
    }
  ]
}
```

`en` 和 `zh` 必填。`game`、`category`、`character`、`aliases`、`note` 为可选参考字段。`category` 可用 `character`、`skill`、`resource`、`weapon`、`term`、`chat`。允许同一英文词对应不同游戏或角色；模型会结合上下文选择。JSON 不支持注释和末尾多余的逗号，Windows 路径若写进 JSON 字符串必须使用 `\\` 或 `/`。

每次新翻译都会检查文件修改时间，编辑并保存术语表后无需重启插件。已显示的译文保留缓存；要使用更新后的词表重新生成某条译文，可右键选择 **重新翻译此消息**。改某个版区的路径只清理受影响版区及其继承帖子的缓存。

只将原文、附近消息中匹配到的名称发送给本地模型；最多 60 条、约 12000 个字符。英文按词边界匹配，中文按名称匹配，优先使用本条消息直接命中的词。简称是参考提示，不进行强制全文替换；文件路径、来源列表和整本术语表不会发送给模型。

## 数据来源与更新

让其他模型生成新的术语表时，可复制 [术语表生成提示词](../GLOSSARY_GENERATION_PROMPT.md)，填写游戏、版区、范围和资料来源。提示词包含插件接受的 JSON 结构、长度限制、名称核对及简称消歧要求。生成文件保存为 UTF-8 JSON 后，在版区配置中指定路径并检查即可。

术语表保留各自的 `sources`、快照提交号或下载内容 SHA-256。只抽取短名称，不包含完整剧情、人物介绍或技能描述。游戏内容版权属于各游戏权利人，以下仓库或接口为社区导出的本地化数据来源：

- 鸣潮：[Arikatsu/WutheringWaves_Data](https://github.com/Arikatsu/WutheringWaves_Data)，Global 发布版 3.7 数据。
- 明日方舟：[国服游戏数据](https://github.com/Kengxxiao/ArknightsGameData)、[海外服游戏数据](https://github.com/Kengxxiao/ArknightsGameData_YoStar)。国服和英文服进度不同；技能和物品按双方存在的同一 ID 对齐，新干员英文名可取自国服 `appellation` 字段并附注。
- 终末地：[公开客户端数据接口](https://endfield-assets.fffdan.com/vfs/Table/)，按同一 64 位本地化 ID 对齐中英名称，记录于 2026-10-13。

这些是初始快照，不保证覆盖之后新增的所有内容。用户补充的简称和修改优先保留在自己的文件中。

维护者可运行 `python scripts/build_glossaries.py` 更新名称数据。生成结果写入 `glossaries/generated/`，**不会覆盖已有的可编辑术语表**；自行比对、合并后再采用。`--refresh` 可重新下载来源。构建仅使用 Python 标准库，缓存位于系统临时目录；插件运行时无需 Python，也不访问这些外部数据网站。

