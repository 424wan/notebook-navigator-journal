# Notebook Navigator 单文件日记修改版

基于 Johan Sanneblad 的 Notebook Navigator 3.4.3，源提交为
`2fcb1200febd3765e288ba8fb0ebdcbc14cb17be`。本地修改日期：2026-10-10 至 2026-10-11。这是个人修改版，尚未合并到上游仓库。

## 使用

1. 安装后重新启动 Obsidian，或在第三方插件中关闭再开启 Notebook Navigator。
2. 在 Notebook Navigator 设置中搜索“日记来源”，选择“单文件日记（一级日期标题）”。
3. 在“单文件日记路径”中填写仓库内的路径，默认是 `日记.md`，也可以填写 `Journal/日记.md`。
4. 点击 Notebook Navigator 日历里的日期。首次使用会创建目标文档；新日期会在文末追加一个一级标题，已有日期会直接跳转。

```markdown
# 2026-10-10

今天的记录。

## 生活

当天的小标题仍可使用二级标题。

# 2026-10-11

另一天的记录。
```

日期标题固定为
`# YYYY-MM-DD`。日历上的标记表示文档中已经存在该日期标题。新日期按点击顺序追加到文末，不移动或重排已有记录。开启原有的“创建前确认”选项时，添加新日期会先询问；打开已有日期不会重复询问。

命令面板中的 Notebook
Navigator“打开日记”“打开下一个周期笔记”“打开上一个周期笔记”也使用同一文档。上一天、下一天以当前光标所在的日期标题为基准。在此模式下，Notebook
Navigator 不创建周记、月记、季记或年记文件。

这项修改作用于 Notebook Navigator 的日历和命令。Obsidian 核心“日记”插件自己的按钮和命令仍沿用原有逻辑；请从 Notebook
Navigator 日历进入单文件日记。如果不再需要核心日记按钮，可以自行关闭该核心插件。

原有每日文件不会自动合并或删除。单文件模式的日期右键菜单也不会删除整篇日记。需要删除某天记录时，在文档中手动删除对应标题及其内容。单文件模式不显示整篇文档的封面图或任务计数，以免把它们错误地重复显示在每个日期上。

## 手动安装与恢复

安装包中的 `notebook-navigator` 文件夹包含以下运行文件：

- `main.js`
- `manifest.json`
- `styles.css`
- `languages.json`（新增设置所需的匹配语言包，包含简体中文，支持离线加载）

关闭 Notebook Navigator 后，将这四个文件复制到仓库的 `.obsidian/plugins/notebook-navigator/`，再开启插件。保留自己原来的
`data.json`，不要使用其他仓库的设置文件覆盖它。本次直接安装会事先备份原插件，并为当前仓库设置单文件模式及 `日记.md`
路径。

恢复原版时，先退出 Obsidian，再把备份目录中的文件复制回插件目录。官方插件更新会覆盖本地修改；需要保留此功能时，请保留修改版安装包和源码。

## 源码与验证

随附的 `notebook-navigator-single-file-source.zip` 是对应的完整修改后源码，包含构建脚本和依赖锁文件。使用 Node.js
24 或更高版本，在源码目录执行 `npm ci`、`npm run build` 可重新构建运行文件。 `npm test`、`npm run lint` 和
`npm run format:check` 分别运行自动测试、静态检查与格式检查。

主要修改涉及日历日期解析与打开、一级标题安全追加、日历日期高亮、日历右键菜单、周期笔记命令、日记主页、日历设置和本地语言包加载；对应测试保存在
`tests/utils/singleFileDailyNotes.test.ts`、 `tests/components/calendarActiveEditorState.test.ts` 及
`tests/i18n/languages.test.ts`。原作者署名及 `LICENSE` 保留。本地修改遵循源码文件所声明的 GNU GPL 第 3 版或更新版本。
