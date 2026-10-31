# 设计画布编辑器

LV999 Dashboard 的可视化创作模块：一个 Canva/Figma 式的**设计画布**，在画布上摆放文字、图形、图片（含引用 Agent 生成的图片资产），可选中/移动/缩放/旋转、撤销重做、导出 PNG，并把可编辑文档统一沉淀为 `kind='design'` 的资产。**AI 原生**：不出画布即可「AI 生成图片」（T2I）与「AI 修改选中图片」（I2I），产出即时整合进画布并沉淀为资产；在对话里一句话即可「生成整版设计」（Agent 工具 `composeDesign`：文生图 + 版式模板排版），产出直接可在本画布微调。

> 基于 **Konva + react-konva**。文档模型自持有、可序列化；与「我的资产」共用同一套 assets 落库与查询体系，不新增数据库表。

---

## 1. 概览

- **入口**：`/dashboard/design`（新建空白画布）与 `/dashboard/design/[id]`（打开已存设计）；产出在 `/dashboard/assets`（我的资产）统一管理，行操作有「编辑」直达编辑器。
- **技术形态**：react-konva 纯客户端组件，经 `next/dynamic({ ssr: false })` 挂载（canvas 无法 SSR），**不走**项目的 SSR+Suspense 数据范式。
- **能力**：加文字 / 矩形 / 圆 / 图片（从资产选 **或本地上传**）、**画布内 AI 生图（工具栏）/ AI 改图（属性面板，替换当前对象或作为新对象插入）**、**对话内一句话生成整版（`composeDesign` 产出直接在本画布打开）**、选中/移动/缩放/旋转、**多选（Shift 点选）**、**复制粘贴（Ctrl+C/V/D）**、**拖拽吸附对齐 + 参考线**、删除、图层前后、批量对齐、**文字水平对齐（左/中/右，需换行宽度）**、撤销重做、缩放平移、文字 overlay 编辑（中文 IME 安全）、属性面板（单选编辑 / 多选批量）、保存 / 打开 / 导出 PNG / 回存资产。

**核心设计原则（Konva 官方铁律）**：Konva 节点只是交互层，文档是独立的可序列化纯数据；拖拽/变换只在**操作结束**（`onDragEnd`/`onTransformEnd`）提交回 React；图片对象只存**资产引用 `assetId`**，不存图片字节。

---

## 2. 依赖与约束

- `konva@10.9.0` + `react-konva@19.3.2`（与 React 19.3.1 对齐，package.json 中精确锁定）。
- **react-konva 主/次版本必须匹配 React**（React 19.3 → react-konva 19.3.x）。
- 未新增状态库；编辑器状态用 `useReducer` + Context（zustand 列为后备，面板增多/性能痛点时再平滑替换）。
- **本地图片上传**复用现有基建：`FileUploader`（已本地化）+ OSS + `apiClient`（FormData）+ `sharp`（读图片尺寸，项目已有依赖，首次使用）；激活 assets 既有但未用的 `source='upload'`。
- **未改数据库 schema**（复用 assets 现有列 `kind`/`content`/`storageKey`/`mime`/`source`）。
- **画布内 AI 生图/改图**全部复用 agent 域现有能力：`generateImage`（T2I/I2I 同核）/ `createImageAsset` / `editImageAssetCore` + Credits 计费包裹（`checkBalance` + `chargeOnGenerationResult` + `priceImage`）。**零新增依赖、无 DB 迁移**（产出仍为 `kind='image'` 资产）。

---

## 3. 数据模型（复用 assets 表，kind='design'）

design 是 assets 的第 4 类（见 [`agent/constants/kinds.ts`](../src/features/agent/constants/kinds.ts)：`markdown` / `html` / `image` / `design` / `video`；video 为第 5 类）。落库约定：

| 字段 | design 资产取值 |
| --- | --- |
| `kind` | `'design'` |
| `content` | `JSON.stringify(DesignDocument)`（可编辑文档） |
| `mime` | `'application/json'` |
| `storageKey` | 导出 PNG 预览的 OSS key（用于列表缩略 / 预览 / 下载） |
| `sizeBytes` | **预览 PNG 字节数**（与 image/video 同口径：`sizeBytes` = 下载产物体积，避免列表显示几百 B 而下载文件上 MB；无预览时回退文档 JSON 字节）|
| `source` | `'agent'` |

### 文档结构 `DesignDocument`

定义与 Zod 校验在 [`features/design/api/types.ts`](../src/features/design/api/types.ts)（前后端共用）：

```
DesignDocument = { version: 1, width, height, background, objects: DesignObject[] }

DesignObject（按 type 判别联合）：
  rect   : { id, x, y, rotation, width, height, fill, cornerRadius }
  circle : { id, x, y, rotation, radius, fill }
  text   : { id, x, y, rotation, text, fontSize, fill, fontStyle, width?, align? }
  image  : { id, x, y, rotation, assetId(引用图片资产), width, height }
```

- `objects` 上限 `MAX_DOCUMENT_OBJECTS = 500`（防御性；请求体另有 4MB 上限）。
- image 对象只存 `assetId`；渲染时经 `/raw` 同源代理解析为图片（见第 5 节）。
- text 对象的 `align`（`'left'|'center'|'right'`，默认 `'left'`）对应 Konva Text 的 `align`，**仅在设了换行宽度 `width` 时可见生效**；overlay 编辑态同步为 `text-align`。为可选 + 带默认值，**旧文档无该字段仍合法（无 DB 迁移）**；AI 整版产出的标题/副标题均带 `width`，因此居中标题可直接生效。

---

## 4. 服务端与 API

design 本质是一种 asset，故复用现有资产 API 命名空间（`/api/agent/assets`），新增写入端点：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/agent/assets` | 创建 design：Zod 校验文档 → 解码预览 PNG → `createDesignAsset` → 返回 `{ id }`。限流 scope `design`（30 次/分/用户，带 `Retry-After`）|
| PATCH | `/api/agent/assets/[id]` | 更新 design：`isUuid` + 归属且 `kind==='design'` 校验 → `updateDesignAsset`。同限流 |
| POST | `/api/agent/assets/upload` | **本地图片上传**（multipart）：限流 scope `upload`（30/分）→ 校验（File 实例 / ≤10MB / mime 粗筛 / **魔数** PNG·JPEG·WebP）→ `sharp` 读尺寸（失败降级可空）→ `createUploadedImageAsset` → 返回 `{ id, width?, height? }`。上传仅存储、不调付费 API，**不消耗 Credits**（无余额拦截）|
| POST | `/api/agent/assets/generate` | **画布内 AI 生图（直连 T2I，不经聊天）**：限流 scope `image-generate`（20/分）→ Zod 校验 `{ prompt: 1..2000, aspect?, title? }`（trim 后二次校验）→ `checkBalance` **402** → `chargeOnGenerationResult(priceImage(false))` 包裹 `generateImage` + `createImageAsset`（`source='agent'`、`conversationId=null`、`content=prompt`，title 缺省按 prompt 截断）→ 返回 `{ id }`。`runtime='nodejs'`、`maxDuration=300` |
| POST | `/api/agent/assets/[id]/edit` | **画布内 AI 改图（直连 I2I）**：与「我的资产 · 继续修改」**同一端点**（画布零后端新增）。body `{ instruction, aspect? }` → 派生新资产（`sourceAssetId` 记录血缘）→ `{ id }`；计费 `priceImage(true)`、限流 `image-edit` 20/分、402 拦截、源图归属/≤10MB 预检均自带 |
| GET | `/api/agent/assets/[id]/raw` | **同源图片字节代理**（见第 5 节）；`?snapshot=1` 视频截帧封面、`?thumb=1` 图片/设计缩略图（OSS 等比缩放）|

- 服务函数在 [`agent/api/service.ts`](../src/features/agent/api/service.ts)：`createDesignAsset` / `updateDesignAsset`，仿 `createImageAsset` 的「预生成 id → `putObject` 存 PNG → 一次性 insert / 按所有权 update」。
- **本地上传**：[`agent/lib/upload-image.ts`](../src/features/agent/lib/upload-image.ts)（`detectImageType` 魔数判定真实类型 / `readImageDimensions` 用 sharp 读尺寸，失败降级 null / `imageTypeToExt`·`imageTypeToMime`）+ `createUploadedImageAsset`（预生成 id → `putObject` → insert `kind='image'`、`source='upload'`、`conversationId=null`、`content=null`，ext 由魔数真实类型定）。与 Agent 生图（`createImageAsset`，source='agent'）隔离，互不影响。
- 预览 PNG 以 base64 传入，经 [`design/lib/preview-png.ts`](../src/features/design/lib/preview-png.ts) `decodePreviewPng` 做 PNG 魔数 + 体积校验；畸形/超限按 400 处理。
- **生成失败文案单一来源**：两个图片端点将 `GenerationError`（审核拒绝 / 上游限流 / 鉴权 / 参数 / 超时，已由 [`image-generation.ts`](../src/features/agent/api/image-generation.ts) 的 `toUserFacingError` 映射为中文）以 `apiError(502, 'generation_failed', <中文>)` 透传（`api-error.ts` 信封的例外，见其注释）；客户端 [`design/lib/ai-image-error.ts`](../src/features/design/lib/ai-image-error.ts) `resolveAiImageError` 统一映射（402 → `INSUFFICIENT_CREDITS_MESSAGE`、429/413/404 → 中文提示、`generation_failed` → 原样展示）。计费口径沿用 billable 分类（审核拒绝不扣、abort/超时/下载失败照扣）。
- 资产详情 `GET /assets/[id]` 的 `previewUrl` 签发条件为 **`asset.storageKey` 存在**（覆盖 image / video / design），每次查询重新签发（3600s）。
- 下载 `GET /assets/[id]/download`：`design` 有 storageKey 时走 302 签名 URL 分支，文件名扩展名映射 `design → png`；**下载到的 PNG 尺寸 = 画布尺寸**（保存预览走 `exportPreviewBase64`，预设画布 1:1 不缩不放，详见第 6 节）；**无预览的 design**（AI 整版首轮产出，`storageKey=null`）返回 **501**（`content` 是文档 JSON，不能当 PNG 下发），列表行操作与预览弹窗相应隐藏/禁用下载。
- 客户端契约在 [`design/api/mutations.ts`](../src/features/design/api/mutations.ts)（`createDesignMutation` / `updateDesignMutation` / `uploadImageMutation` / **`aiGenerateImageMutation`**，写操作结束后失效 `agentKeys.assetsRoot()` + `assetRoot()`）与 [`design/api/queries.ts`](../src/features/design/api/queries.ts)（直接复用 agent 的 `assetQueryOptions` / `assetsQueryOptions`，与「我的资产」共享缓存）。画布内 AI 改图不重复定义 mutation，直接用 agent 域的 `editImageAssetMutation`（同端点、同失效逻辑）。

---

## 5. 图片同源代理（规避 canvas 跨域污染）

画布内引用的图片一律经 [`/api/agent/assets/[id]/raw`](../src/app/api/agent/assets/[id]/raw/route.ts) 加载：服务端用短期签名 URL（300s）拉取 OSS 对象，以**同源**流式回传字节。

- **为什么**：`stage.toDataURL()` 导出时，若画布含跨域图片且未正确 CORS，canvas 会被 taint 而无法导出。经同源代理后画布不被污染，**无需为 OSS 桶配置 CORS**。
- 客户端 [`hooks/use-asset-image.ts`](../src/features/design/hooks/use-asset-image.ts) 经 `/raw` 加载（`crossOrigin='anonymous'`）；另导出一次性 `loadNaturalSize(assetId)`（加载失败返回 null）——AI 生图/改图端点只返回 `{ id }`，上传也可能不带尺寸，据此经 `/raw` 读自然尺寸后等比插入/适配（与缩略图 `onLoad` 记尺寸同模式）。
- 图片资产内容不可变（编辑产出新资产、新 id），故 `/raw` 响应可做浏览器私有缓存（`Cache-Control: private, max-age=3600`）。
- **缩略图不走本路径**：资产列表与「插入图片」网格只需 36~150px，直拉原图（AI 产出 1~2MB/张，网格一次列 60 张）会白白吃掉十几到几十 MB 的函数出口带宽。它们改用 [`lib/asset-url.ts`](../src/features/agent/lib/asset-url.ts) 的 `assetThumbUrl()` → `/raw?thumb=1&v=updatedAt`：
  - `thumb=1` → 服务端改签 `imageThumbUrl()`（OSS 原生图片处理 `image/resize,w_320`，**只等比缩放不裁切**），单张从 MB 降到十几 KB；`process` 必须经 `signatureUrl` 选项纳入签名（同视频截帧，先签名再手拼会 `SignatureDoesNotMatch`）；图片处理不可用（bucket 未开通等）时路由**自动回退原图**，不让图裂掉。
  - 为何缩小不影响插入尺寸：`createImageObject` / `imageReplacePatch` **只消费宽高比**（绝对尺寸由 `maxBox` / 原外接框决定），而 resize 保持比例 → 插入几何完全一致；因此该参数**不得改成 `m_fill` 等裁切模式**。
  - `v=updatedAt` 是必需的且**只给 design 加**：design 预览 PNG **覆盖同一 storageKey**（保存即重写），与上面“内容不可变”的假设仅对 image 成立；不带版本号会命中 3600s 私有缓存，保存后列表缩略图最长 1 小时仍是旧图。image 不加 v：否则收藏切换这类只刷新 `updatedAt` 的操作会把整页不可变图全部打回源。
  - 画布渲染与导出仍走不带 `thumb` 的 `assetRawUrl`（需要原尺寸像素）。

---

## 6. 编辑器前端 `src/features/design/`

- `lib/editor-context.tsx`：`EditorProvider` —— 组合 reducer + 相机（zoom/position）+ 文字编辑态 + save/export + **会话内剪贴板**（`clipboardRef` 快照 + `pasteCountRef` 累加偏移 + `clipboardCount` 供按钮 disabled）；暴露多选（`select(ids)`/`toggleSelect`/`clearSelection`）、批量提交（`commitObjects`/`removeObjects`）、复制粘贴（`copy`/`paste`/`duplicate`）、`insertImage(assetId, natural)`（AI 生图/改图与选图/上传共用插入入口）；latest-ref 保持回调稳定。**快捷键让位**：除了输入框/文字编辑态，存在 `[role="dialog"]` 弹层（插入图片 / AI 生成 / AI 修改 / 命令面板）时整体跳过画布快捷键，避免焦点在弹层内时 Delete/方向键误改（误删）画布。**预览按需导出**：`save()` 仅在「文档真有改动」或「打开时无预览」（`dirty || !initialHasPreview`）时才导出并附带 `previewPng`——预览上传是 2.5MB 级且 `toDataURL` 同步阻塞主线程，只改标题或重复保存不必重做（服务端 `updateDesignAsset` 按 `previewPng` 存在性更新，不传则不动 storageKey/sizeBytes）；注意不能整体早退（title 不在 document 里，`isDirty` 不反映标题变化）。`hasPreviewRef` 的语义是「预览与已存文档一致」：仅当本次尝试过导出才由结果决定（尝试了但失败/超预算 → false，下次保存补导）。另有 `savingRef` 并发闸门：工具栏按钮有 `disabled={isSaving}` 但 Ctrl/Cmd+S 的 keydown 没有，按住连发会重复导出/重复上传，**新建页上还会开出两条资产**。`isDirty` 已 memo 化（避免每次滚轮/平移都 stringify 整份文档），保存成功后写回 `savedSnapshot` state 触发重算（快照用 state 而非 ref，memo 依赖才与读取值一致）。
- `hooks/use-editor-reducer.ts`：`{ past, present(document), future, selectedIds[] }`（原单选 `selectedId` 已废弃）；action 含批量 `update-objects`/`remove-objects`/`reorder-many`/`duplicate-objects`/`paste-objects` + `select`/`toggle-select`/`clear-select`；**一次完整操作（含批量）提交一条历史**。`ObjectPatch` 含 **`assetId`**（仅 image 对象有意义），使「AI 改图 → 替换当前对象」就是一次 `update-object`（一条历史，undo 可回退替换）；亦含 **`align`**（仅 text 对象有意义，属性面板的对齐切换就是一次 `update-object`）。
- `lib/document.ts`：对象工厂 / `reorderObject`·`reorderObjects`（图层）/ `objectBounds`（对象→AABB；rect/image 取旋转后的真实 AABB，text 为估算框，circle 旋转不变）/ `unionBox`（多框并集）/ `cloneObjectWithOffset`（克隆 + 新 `generateObjectId` + 偏移）/ **`imageReplacePatch`（AI 改图替换：只换 `assetId` 引用 + 按新图自然尺寸 contain 等比适配原外接框、保持视觉中心（含旋转：Konva 绕节点原点旋转，按旋转后中心反推新原点），绝不拉伸变形；natural 缺省时沿用原框）** / `parseDesignDocument`（读库 JSON，损坏回退空白）。
- `lib/snap.ts`：`computeSnap`（移动框的 left/center-x/right × top/center-y/bottom 对齐到其他对象 + 画布，阈值内取最近，返回吸附坐标 + 参考线）/ `snapThreshold`（屏幕px / zoom）/ `sameGuides`（避免拖拽中频繁 setState）。纯函数无 Konva 依赖。
- `lib/layouts.ts`：**版式模板（服务端纯函数，无 Konva / 无 IO，不进客户端 bundle）**——见 6.1。
- `lib/export.ts`：`exportStageToDataURL` —— 导出前隐藏 Transformer、临时把相机归一并将 Stage 尺寸设为文档尺寸，`pixelRatio` 按最长边上限折算（默认 maxDimension 2560）。**`maxPixelRatio` 默认 1（只缩不放）**：上采样不增细节只增体积，且保存用预览 PNG 同时是「我的资产」的**下载产物**（`sizeBytes` 口径 = 下载体积），缩边会让下载图小于画布。`exportPreviewBase64` 按 `maxDimension 1920 × pixelRatio 1` 导出并校验是否落在 `PREVIEW_BASE64_BUDGET`（3MB base64 ≈ 2.25MB PNG，留出文档 JSON 与 4MB 请求体余量）内，**超预算则返回 undefined 丢预览保文档**（带超限载荷必撞 413、整次保存含文档都存不下；不传 previewPng 只是本次不刷新预览，下次保存再试）——**5 个预设画布均 1:1 原尺寸导出**（1920×1080 不再是 1280×720）；当前 UI 只提供预设尺寸（最长边 ≤1920），1920 上限是为未来自定义尺寸预留的缩边兜底（届时如需体积降级再恢复降档阶梯）。工具栏「导出」同口径（2560 上限、不上采样）。
- `constants/canvas.ts`：画布尺寸预设 `CANVAS_PRESETS`、默认画布、填充色 `FILL_SWATCHES`、字号预设、缩放范围、`createEmptyDocument()`。
- 组件：
  - `design-editor-island.tsx`（`next/dynamic(ssr:false)` 包装，客户端边界）、`design-editor.tsx`（根组件：Provider + 布局）
  - `editor-canvas.tsx`：**共享 Transformer 单例**（canvas 层）+ `shapeRegistry`(id→Konva.Shape) + `registerShape` 回调；`selectedIds`/`objects`/`editingTextId` 变化时 `transformer.nodes(选中节点)` + batchDraw（文字编辑态 nodes=[])；拖拽三段（Start 预计算 groupBox/otherBoxes/canvasBox → Move `computeSnap` 修正节点位置 + setGuides → End 提交吸附后坐标）；多选拖选中项整体移动；`onTransformEnd` 逐节点 `foldScale` 折算回尺寸一次 commit；参考线 `Line`（listening=false，strokeWidth/dash 随 zoom 归一，拖拽结束清空，不入导出）。
  - `editable-object.tsx`：按 type 渲染 + 主 shape 设 `id={object.id}` + ref 回调 `registerShape` 上报节点；**不再内置 Transformer**（移至 canvas 层共享）；onClick 带 `shiftKey` → toggleSelect；onDragStart/Move/End 委托 canvas；`memo` 化。
  - `editor-toolbar.tsx`：加图形/文字/图片、**AI 生成图片**（`Icons.sparkles` → `AiGenerateDialog`）、**复制/粘贴**（`Icons.copy`/`Icons.clipboard`，disabled 依选中/剪贴板）、撤销重做、缩放、保存、导出。
  - `properties-panel.tsx`：单选 → 对象属性编辑（**单选 image 时额外给「AI 修改」按钮** → `AiEditDialog`，面板以对象 id 为 key，切换选中即重建并重置弹层状态；**单选带换行宽度的 text 时给「对齐」左/中/右**）；**多选 → 「已选 N 个」+ 批量删除/图层/对齐**（左中右·上中下，以选区 unionBox 为基准）；图层镜像列表支持 Shift 多选。
  - `ai-generate-dialog.tsx`：**画布内 AI 生图**——prompt textarea（必填 1-2000 + 计数）+ 比例 Select（`ASPECT_KEYS`，默认自动）→ `aiGenerateImageMutation` → `loadNaturalSize` → `insertImage`（等比居中插入并选中）+ toast + 失效资产域。
  - `ai-edit-dialog.tsx`：**画布内 AI 改图**——instruction textarea（必填 1-2000）+ 可选比例 + **结果处置 RadioGroup**（「替换当前对象」默认 / 「作为新对象插入」）→ agent 域 `editImageAssetMutation`（以对象 `assetId` 为源，血缘由端点记录）→ `loadNaturalSize` → 替换走 `commitObject(id, imageReplacePatch(...))`、新增走 `insertImage`。
  - 两个 AI 对话框共同约束：生成中（10-60s）**锁定弹层**（spinner + 「请勿关闭」提示、禁重复提交、禁关闭、禁改输入，MVP 不提供 abort）；失败**保留输入**并就地（`role='alert'`）+ toast 展示中文错误（`resolveAiImageError`）；每次打开重置草稿。
  - `asset-image-picker.tsx`：从「我的资产」image 选图 **+ 顶部「上传本地图片」区**（FileUploader accept image/png·jpeg·webp、10MB → `uploadImageMutation` → 拿 `{id,width,height}` → `insertImage` 居中插入 + 关弹窗 + 失效资产列表）。网格缩略图走 `assetThumbUrl()`（本弹窗一次列 60 张，不拉原图）；`onLoad` 记的 `naturalWidth/Height` 仅用于取宽高比，因此缩放安全（详见第 5 节）。
  - `text-overlay.tsx`（双击文字 → 覆盖原生 `<textarea>` 编辑、失焦提交；保证中文 IME）

### 6.1 一句话生成整版设计（Agent 工具 `composeDesign`）

入口在**对话**而非画布：用户说「做一张秋日漫步的小红书封面，标题《杭州秋日漫步》」→ Agent 调 [`composeDesign`](../src/features/agent/api/agent.ts) → 对话内返回可点卡片（[`tool-design-part.tsx`](../src/features/agent/components/chat/tool-design-part.tsx)）→ 进本画布微调。

**职责划分（布局质量不交给模型）**：模型只给内容（标题文案 / 图片 prompt / 选哪个版式）；**坐标、字号、对齐、留白全由服务端代码计算**，因此不存在自由坐标导致的乱排。

[`lib/layouts.ts`](../src/features/design/lib/layouts.ts)（纯函数）：

- `composeDesignDocument({ layout, aspect?, image, text })` → 完整 `DesignDocument`：解析画布尺寸 → 执行版式 → sanitize → `designDocumentSchema.safeParse` 终校验（失败回落「主图 + 标题」兜底版式）。
- **3 个版式**：`top-image`（上图下文：主图贴顶占上部 ~60%，文字块在剩余空间垂直居中，带装饰条）、`full-image-bar`（全图 + 底部半透明标题条，条高按文字块自适应、钳制在画布高 16%~42%）、`left-image`（左图右文，主图占左 56%；**竖版画布自动退化为 top-image**）。
- **contain 适配**：主图一律等比缩放至完全落入区域（不裁切不变形，与 `imageReplacePatch` 同口径），比例不合时的留白由背景色承担。`imageRegionRatio(layout, aspect)` 回传版式主图区域的宽高比，供工具从文生图比例档中挑最接近的一档（主图贴合区域 → 几乎无留白；画布比例仍由 `aspect` 决定）。
- **文字度量**：`estimateTextWidth`（CJK ≈ 1×fontSize、其余 ≈ 0.55×，带安全系数）+ `estimateLines` + `fitFontSize`（超长标题逐档缩字号直到满足最大行数）+ **`pickFontSize`（短文案优先单行）**：只需缩 ≤15% 字号就能一行排下时按单行，避免 Konva 对 CJK 按字断行把「城市漫步地图」拆成「城市漫步地 / 图」；长标题仍走多行（缩到单行会小到不可读）。字号再按画布宽相对 1080 等比缩放并钳制上下限；文字块高度按 Konva `lineHeight=1` 的口径（行数 × 字号）累加，保证与渲染一致。
- **配色**：MVP 固定两套（浅底深字 / 深底浅字），由版式自选（`full-image-bar` 用深色），模型不参与配色决策。
- **sanitize**：对象坐标/尺寸钳制到画布内、对象数 ≤ `MAX_DOCUMENT_OBJECTS`、image 的 `assetId` 只允许本次文生图产出的主图（防模型臆造 id）。
- **无预览落库**：`createDesignAsset(previewPng=null)` → `storageKey=null`、`sizeBytes` 回退文档 JSON 字节；服务端不渲染预览（规避 serverless 无中文字体、sharp-SVG 渲染中文失败的风险），用户打开画布保存时由客户端 Konva 导出补上（`updateDesignAsset` 重传 previewPng 同时更正 `sizeBytes`）。
- **计费**：仅内含的一次文生图计费（image 档，流水 meta 记 `assetId` + `compose: true`）；design 落库为纯 JSON 组装、不调付费 API → **不额外计费**。余额不足在工具入口抛中文错误（无上游调用）；生图失败沿用 `GenerationError` 中文透传（审核拒绝不扣费）。

---

## 7. 页面路由

- [`app/dashboard/design/page.tsx`](../src/app/dashboard/design/page.tsx)（server）：渲染空白画布（`assetId=null`）；首次保存时 `createDesignMutation` → `router.replace('/dashboard/design/[id]')`（沿用 agent 新建会话的真实导航范式，非 `history.replaceState`）。
- [`app/dashboard/design/[id]/page.tsx`](../src/app/dashboard/design/[id]/page.tsx)（server）：`auth` + `isUuid` + 归属且 `kind==='design'` 校验（否则 `notFound()`），把 `parseDesignDocument(content)` 作为初始文档传入客户端编辑器（`key={asset.id}`），并传 `initialHasPreview={asset.storageKey !== null && parsed !== null}`（无改动保存时据此跳过预览重导；文档解析失败而回退空白时旧 PNG 已不对应内容，必须视为无预览强制重导）。
- [`app/dashboard/design/loading.tsx`](../src/app/dashboard/design/loading.tsx)：骨架。
- 导航：[`config/nav-config.ts`](../src/config/nav-config.ts) 「概览」组新增「设计画布」（`icon: 'palette'`）。
- 我的资产：预览弹窗对 `design` 展示导出 PNG + 「编辑」入口；表格行操作对 design 显示「编辑」。**无预览的 design**（`composeDesign` 产出后尚未在画布保存）：列表缩略图显示虚线占位 tile（不发必然 404 的 `/raw` 请求）+ 标题下提示「AI 整版 · 打开编辑生成预览」，点击直接进画布；预览弹窗内同样给「尚无预览 + 打开编辑」引导（`Asset.hasPreview` 由服务端按 `storageKey` 是否存在下发）。

---

## 8. Konva 官方最佳实践（本模块遵循项）

1. 文档数据与 Konva 节点分离；读值只在拖拽/变换结束时。
2. Transformer 用改变 scale 缩放——提交前把 scale 折算回对象自身的 width/height/radius/fontSize。
3. 历史边界：一次完整用户操作记一条 undo。
4. 导出前隐藏 Transformer；有相机变换时归一相机与 Stage 尺寸再导出，`pixelRatio` 归一。
5. 跨域图片会污染画布——本模块用同源 `/raw` 代理规避。
6. 可达性：canvas 内部对辅助技术不可见，属性面板提供图层镜像列表（支持 Shift 多选）。
7. 图片只存资产引用，绝不放进历史数组（复制亦然，只克隆 `assetId`）。
8. **多选用 canvas 层共享 Transformer 单例**（`transformer.nodes([...])` 挂多个选中节点），非每对象一个；变换结束逐节点把 scale 折算回自身尺寸并归一。
9. **拖拽吸附遵循“拖拽中不入文档”铁律**：`onDragMove` 只改节点视觉位置（吸附修正）+ 渲染参考线，`onDragEnd` 才提交最终坐标；参考线 `listening=false` 且拖拽结束清空，绝不进导出 PNG。

官方文档参考：react-konva 入口 <https://konvajs.org/docs/react/index.html>、Canvas Editor 范式 <https://konvajs.org/docs/sandbox/Canvas_Editor.html>、高质量导出 <https://konvajs.org/docs/data_and_serialization/High-Quality-Export.html>。

---

## 9. 手动验收清单

新建 → 拖拽/缩放/旋转 → 加资产图片 → **上传本地图片（PNG/JPEG/WebP→插入画布 + 资产列表现「上传」来源）** → **工具栏「AI 生成图片」：填 prompt + 选比例 → 生成中 spinner/禁重复提交/禁关闭 → 图插入画布（等比居中选中）+「我的资产」新增 image（content=prompt）+ Credits 扣 image 档（流水 meta 记 assetId）；余额 0 → 402 文案且无上游调用；审核拒绝 → 中文错误 + 不扣费** → **选中 image → 属性面板「AI 修改」：填指令 →「替换」后对象 assetId 变为新资产（位置保持、不变形、**undo 一步回退替换**）；「新增」则多一个对象；新资产 `sourceAssetId` 指向源；Credits 扣 image 档（edit=true）** → **Shift 多选多个对象→整体拖动/删除/对齐** → **Ctrl+C/V 复制粘贴、Ctrl+D 快速复制（新 id + 偏移）** → **拖动吸附到其他对象边缘/中心与画布中线（蓝色参考线，松手即对齐）** → **旋转 45°/90° 的矩形/图片拖到另一对象左侧：参考线贴旋转后最左沿、松手后视觉边齐平；多选含旋转对象做左/右/顶/底对齐：视觉边齐平（非按旋转前原点）** → 改文字（中文输入法）→ **选中标题改对齐（左/中/右，仅带换行宽度的文字展示该组）** → 撤销重做（批量操作一步回退）→ 保存 → 在「我的资产」见 design 预览 → 点「编辑」重新打开 → 导出 PNG。

**AI 整版（对话入口）**：对话说「做一张 3:4 小红书封面，主题是秋日漫步，标题《杭州秋日漫步》，副标题『周末去哪儿』」→ 工具 loading（含文生图 20-70s）→ 对话现 design 卡片 → 点「打开编辑」进画布：主图不变形、标题居中且有字号层次、无越界/乱排；**3 种版式各试一次**（`top-image` / `full-image-bar` / `left-image`），横版 `aspect` 试 `left-image`、竖版试 `left-image` 应退化为上图下文；Credits 只扣 image 档（流水详情为「图片生成（整版设计主图）」）、design 不额外扣；余额 0 → 中文余额不足且无上游调用；该 design 在资产列表为虚线占位 + 「AI 整版 · 打开编辑生成预览」，画布保存后缩略图出现、`sizeBytes` 更正为 PNG 体积、**下载到的 PNG 尺寸 = 画布尺寸**（1920×1080 画布不得出现 1280×720 这种缩边）。

> 弹层内快捷键隔离：打开任一画布对话框（插入图片 / AI 生成 / AI 修改）后按 Delete/Backspace 不应删除已选中的画布对象。

**缩略图性能（DevTools Network 可零成本验收）**：资产列表行首图响应体应为**十几~几十 KB**而不是 1~2MB（URL 带 `?thumb=1&v=…`）；打开「插入图片」网格同样如此，且点选后插入的对象宽高与改前一致（证明 resize 只缩不裁）；改标题→保存→回列表看缩略图应**立即更新**（`v` 参数生效，不再命中 3600s 缓存）；若 bucket 未开通图片处理，服务端会回退原图（图不裂，日志有 `oss image resize failed, fallback to original object`）。
