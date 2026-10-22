# 添加新主题

本指南说明如何为应用添加新主题。主题系统使用 CSS 自定义属性配合 `[data-theme]` 选择器；当前默认主题由 `active_theme` cookie 决定（无有效值时回退 `DEFAULT_THEME`）。

## 主题添加流程

添加新主题时，请按以下流程操作：

1. **创建主题 CSS 文件** → `src/styles/themes/your-theme-name.css`，使用 `[data-theme='your-theme-name']`
2. **导入主题** → 在 `src/styles/theme.css` 中添加 `@import`
3. **注册主题** → 在 `src/components/themes/theme.config.ts` 的 `THEMES` 数组中添加
4. **添加字体（如需要）** → 如果使用自定义 Google Fonts，在 `src/components/themes/font.config.ts` 中导入
5. **设为默认（可选）** → 更新 `src/components/themes/theme.config.ts` 中的 `DEFAULT_THEME`

详细步骤请参见下方的**逐步指南**部分。

## 快速开始：设置默认主题

要切换默认主题（当前项目没有主题切换器 UI，主题由 `active_theme` cookie 决定；无有效 cookie 时用默认值）：

1. 打开 `src/components/themes/theme.config.ts`
2. 修改 `export const DEFAULT_THEME = 'your-theme-name';`
3. 保存并重启开发服务器

就是这样！你的主题现在将成为未设置偏好用户的默认主题。

> **注意：** 在设置默认主题之前，请确保已完成上方步骤 1-3；建议同时把该主题登记进 `THEMES` 数组——`layout.tsx` 只校验 **cookie 值**是否属于 `THEMES`（不合法则回退 `DEFAULT_THEME`），未登记的主题不会被 cookie 选中；`DEFAULT_THEME` 本身作为兜底值直接生效、不参与该校验。

## 主题结构

所有主题位于 `src/styles/themes/` 目录中。每个主题都是一个完整的、自包含的 CSS 文件，为亮色和暗色模式定义所有设计令牌。

## 文件格式

每个主题文件必须遵循以下结构：

```css
/* 亮色模式令牌 */
[data-theme='your-theme-name'] {
  /* 颜色令牌 */
  --background: oklch(...);
  --foreground: oklch(...);
  --card: oklch(...);
  --card-foreground: oklch(...);
  --popover: oklch(...);
  --popover-foreground: oklch(...);
  --primary: oklch(...);
  --primary-foreground: oklch(...);
  --secondary: oklch(...);
  --secondary-foreground: oklch(...);
  --muted: oklch(...);
  --muted-foreground: oklch(...);
  --accent: oklch(...);
  --accent-foreground: oklch(...);
  --destructive: oklch(...);
  --destructive-foreground: oklch(...);
  --border: oklch(...);
  --input: oklch(...);
  --ring: oklch(...);

  /* 图表颜色 */
  --chart-1: oklch(...);
  --chart-2: oklch(...);
  --chart-3: oklch(...);
  --chart-4: oklch(...);
  --chart-5: oklch(...);

  /* 侧边栏颜色 */
  --sidebar: oklch(...);
  --sidebar-foreground: oklch(...);
  --sidebar-primary: oklch(...);
  --sidebar-primary-foreground: oklch(...);
  --sidebar-accent: oklch(...);
  --sidebar-accent-foreground: oklch(...);
  --sidebar-border: oklch(...);
  --sidebar-ring: oklch(...);

  /* 排版 */
  /* 方式一：使用 next/font/google 的字体（推荐） */
  --font-sans: 'Font Name', sans-serif; /* 使用字体的显示名称 */
  --font-serif: ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif;
  --font-mono: 'Mono Font Name', monospace;

  /* 方式二：使用系统字体 */
  /* --font-sans: ui-sans-serif, system-ui, -apple-system, sans-serif; */

  /* 间距与布局 */
  --radius: 0.5rem;
  --spacing: 0.25rem;

  /* 阴影（可选） */
  --shadow-x: 0px;
  --shadow-y: 1px;
  --shadow-blur: 3px;
  --shadow-spread: 0px;
  --shadow-opacity: 0.17;
  --shadow-color: #000000;
  --shadow-2xs: 0px 1px 3px 0px hsl(0 0% 0% / 0.09);
  --shadow-xs: 0px 1px 3px 0px hsl(0 0% 0% / 0.09);
  --shadow-sm: 0px 1px 3px 0px hsl(0 0% 0% / 0.17), 0px 1px 2px -1px hsl(0 0% 0% / 0.17);
  --shadow: 0px 1px 3px 0px hsl(0 0% 0% / 0.17), 0px 1px 2px -1px hsl(0 0% 0% / 0.17);
  --shadow-md: 0px 1px 3px 0px hsl(0 0% 0% / 0.17), 0px 2px 4px -1px hsl(0 0% 0% / 0.17);
  --shadow-lg: 0px 1px 3px 0px hsl(0 0% 0% / 0.17), 0px 4px 6px -1px hsl(0 0% 0% / 0.17);
  --shadow-xl: 0px 1px 3px 0px hsl(0 0% 0% / 0.17), 0px 8px 10px -1px hsl(0 0% 0% / 0.17);
  --shadow-2xl: 0px 1px 3px 0px hsl(0 0% 0% / 0.43);

  /* 字母间距（可选） */
  --tracking-normal: 0em;
}

/* 暗色模式令牌 */
[data-theme='your-theme-name'].dark {
  /* 与上方相同的令牌，使用暗色模式的值 */
  --background: oklch(...);
  --foreground: oklch(...);
  /* ... 所有其他令牌使用暗色模式的值 */
}

/* 主题内联映射 */
[data-theme='your-theme-name'] {
  @theme inline {
    /* 颜色映射 */
    --color-background: var(--background);
    --color-foreground: var(--foreground);
    --color-card: var(--card);
    --color-card-foreground: var(--card-foreground);
    --color-popover: var(--popover);
    --color-popover-foreground: var(--popover-foreground);
    --color-primary: var(--primary);
    --color-primary-foreground: var(--primary-foreground);
    --color-secondary: var(--secondary);
    --color-secondary-foreground: var(--secondary-foreground);
    --color-muted: var(--muted);
    --color-muted-foreground: var(--muted-foreground);
    --color-accent: var(--accent);
    --color-accent-foreground: var(--accent-foreground);
    --color-destructive: var(--destructive);
    --color-destructive-foreground: var(--destructive-foreground);
    --color-border: var(--border);
    --color-input: var(--input);
    --color-ring: var(--ring);
    --color-chart-1: var(--chart-1);
    --color-chart-2: var(--chart-2);
    --color-chart-3: var(--chart-3);
    --color-chart-4: var(--chart-4);
    --color-chart-5: var(--chart-5);
    --color-sidebar: var(--sidebar);
    --color-sidebar-foreground: var(--sidebar-foreground);
    --color-sidebar-primary: var(--sidebar-primary);
    --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
    --color-sidebar-accent: var(--sidebar-accent);
    --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
    --color-sidebar-border: var(--sidebar-border);
    --color-sidebar-ring: var(--sidebar-ring);

    /* 字体映射 */
    --font-sans: var(--font-sans);
    --font-mono: var(--font-mono);
    --font-serif: var(--font-serif);

    /* 圆角变体 */
    --radius-sm: calc(var(--radius) - 4px);
    --radius-md: calc(var(--radius) - 2px);
    --radius-lg: var(--radius);
    --radius-xl: calc(var(--radius) + 4px);

    /* 阴影映射（如果定义了阴影） */
    --shadow-2xs: var(--shadow-2xs);
    --shadow-xs: var(--shadow-xs);
    --shadow-sm: var(--shadow-sm);
    --shadow: var(--shadow);
    --shadow-md: var(--shadow-md);
    --shadow-lg: var(--shadow-lg);
    --shadow-xl: var(--shadow-xl);
    --shadow-2xl: var(--shadow-2xl);

    /* 字距变体（如果定义了 tracking-normal） */
    --tracking-tighter: calc(var(--tracking-normal) - 0.05em);
    --tracking-tight: calc(var(--tracking-normal) - 0.025em);
    --tracking-normal: var(--tracking-normal);
    --tracking-wide: calc(var(--tracking-normal) + 0.025em);
    --tracking-wider: calc(var(--tracking-normal) + 0.05em);
    --tracking-widest: calc(var(--tracking-normal) + 0.1em);
  }
}
```

## 逐步指南：添加新主题

按以下顺序操作来为应用添加新主题。

### 步骤 1：创建主题 CSS 文件

在 `src/styles/themes/` 中创建一个描述性命名的文件（使用 kebab-case）：

```bash
src/styles/themes/your-theme-name.css
```

**重要：** 文件名应与你将在 CSS 中使用的 `data-theme` 属性值匹配。

### 步骤 2：使用 `[data-theme]` 属性定义主题

复制上方"文件格式"部分的结构，填入你的颜色值。使用 OKLCH 颜色格式以获得更好的颜色一致性：

```css
/* 亮色模式令牌 */
[data-theme='your-theme-name'] {
  --background: oklch(1 0 0); /* 白色 */
  --foreground: oklch(0.145 0 0); /* 深灰色 */
  --card: oklch(...);
  /* ... 所有其他令牌 */
}

/* 暗色模式令牌 */
[data-theme='your-theme-name'].dark {
  --background: oklch(0.145 0 0); /* 深色 */
  --foreground: oklch(0.985 0 0); /* 亮色 */
  /* ... 所有其他令牌使用暗色模式的值 */
}

/* Tailwind 主题内联映射 */
[data-theme='your-theme-name'] {
  @theme inline {
    /* 所有映射如"文件格式"部分所示 */
  }
}
```

**颜色格式：**

- 使用 `oklch()` 格式：`oklch(亮度 色度 色相)`
- 示例：`oklch(0.852 0.199 91.936)` = 浅青绿色
- 亮度：0-1（0 = 黑色，1 = 白色）
- 色度：0+（0 = 灰度，越高越饱和）
- 色相：0-360（色轮位置）

**要点：**

- `[data-theme='your-theme-name']` 选择器是主题生效的关键
- 值 `'your-theme-name'` 必须在所有位置（CSS 文件、配置等）完全匹配
- 始终同时包含亮色和暗色模式变体
- 包含 `@theme inline` 块以集成 Tailwind CSS

### 步骤 3：在 theme.css 中导入主题

在 `src/styles/theme.css` 中添加主题导入：

```css
@import './themes/your-theme-name.css';
```

这使得主题对应用可用。

### 步骤 4：在 theme.config.ts 中添加主题

在 `src/components/themes/theme.config.ts` 的 `THEMES` 数组中添加主题：

```typescript
export const THEMES = [
  // ... 现有主题
  {
    name: 'Your Theme Name', // UI 中显示的名称
    value: 'your-theme-name' // 必须与 [data-theme] 值完全匹配
  }
];
```

**重要：** `value` 字段必须与 CSS 文件中的 `data-theme` 属性值完全匹配。

### 步骤 5：添加自定义字体（如需要）

**仅当你的主题需要尚未加载的自定义 Google Font 时才执行此步骤。**

如果你想在主题中使用 Google Font：

**文件：** `src/components/themes/font.config.ts`

1. **导入字体**，从 `next/font/google`：

```typescript
import { Your_Font_Name } from 'next/font/google';
```

2. **配置字体**，设置 CSS 变量：

```typescript
const fontYourName = Your_Font_Name({
  subsets: ['latin'],
  weight: ['400', '500', '700'], // 按需调整字重
  variable: '--font-your-name' // 可选：自定义变量名
});
```

3. **添加到 `fontVariables` 导出中**：

```typescript
export const fontVariables = cn(
  // ... 现有字体
  fontYourName.variable
);
```

4. **在主题 CSS 中通过显示名称使用字体**（不是 CSS 变量名）：

```css
[data-theme='your-theme-name'] {
  --font-sans: 'Your Font Name', sans-serif; /* 使用实际字体名称 */
  --font-mono: 'Your Mono Font', monospace;
}
```

**重要说明：**

- 在 CSS 中使用字体的**显示名称**（如 `'Geist'`、`'Roboto'`），不是 CSS 变量
- 字体必须在 `font.config.ts` 中导入，Next.js 才会加载它
- `font.config.ts` 中的字体变量会通过 `layout.tsx` 自动应用到 body
- 可以使用 `next/font/google` 中的任何 Google Font
- 添加新字体前先检查 `font.config.ts` 中已有的字体 — 可能可以直接复用

> 当前 `font.config.ts` 只加载 Geist / Geist Mono；如需其它字体，按上述步骤自行添加。

### 步骤 6：设为默认主题（可选）

如果你希望主题在未设置偏好的用户首次访问时自动加载（当前无主题切换器 UI），更新默认主题常量：

**文件：** `src/components/themes/theme.config.ts`

```typescript
/**
 * 未设置用户偏好时加载的默认主题
 * 修改此值以设置不同的默认主题
 */
export const DEFAULT_THEME = 'your-theme-name'; // 从 'vercel' 改为你的主题名
```

**注意：**

- 这是默认主题的**唯一真实来源** — 服务端渲染和客户端代码都会自动使用它
- 这会使你的主题成为未设置偏好用户的默认主题
- 手动写入 `active_theme` cookie 的用户仍会看到其偏好（cookie 值合法时优先于 `DEFAULT_THEME`）
- 默认主题在页面加载时立即应用（无未样式内容闪烁）

### 步骤 7：测试你的主题

1. 启动开发服务器
2. 把 `DEFAULT_THEME` 设为你的主题（或手动把 `active_theme` cookie 写成主题名）
3. 验证亮色和暗色模式都正常工作（暗色由 next-themes 在 `<html>` 上加 `.dark` 类）
4. 清除浏览器 cookie 并刷新，确认回退到 `DEFAULT_THEME`

## 快速参考：文件位置

添加新主题时，按以下顺序操作这些文件：

1. ✅ `src/styles/themes/your-theme-name.css` — 创建主题文件，使用 `[data-theme]` 属性
2. ✅ `src/styles/theme.css` — 导入主题文件
3. ✅ `src/components/themes/theme.config.ts` — 在 `THEMES` 数组中添加主题
4. ⚠️ `src/components/themes/font.config.ts` — 仅在需要时添加字体
5. ⚠️ `src/components/themes/theme.config.ts` — 仅在需要时设为默认

## 必需令牌

### 最低要求

你的主题至少应定义以下令牌：

- `--background`
- `--foreground`
- `--card` 和 `--card-foreground`
- `--popover` 和 `--popover-foreground`
- `--primary` 和 `--primary-foreground`
- `--secondary` 和 `--secondary-foreground`
- `--muted` 和 `--muted-foreground`
- `--accent` 和 `--accent-foreground`
- `--destructive` 和 `--destructive-foreground`
- `--border`
- `--input`
- `--ring`
- `--radius`

### 可选令牌

不需要时可以省略：

- `--chart-1` 到 `--chart-5`（默认使用主题色）
- `--sidebar-*` 令牌（默认使用卡片颜色）
- `--font-*` 令牌（使用系统默认）
- `--shadow-*` 令牌（省略则无阴影）
- `--tracking-normal`（省略则无字母间距）
- `--spacing`（使用默认值）

## 示例：完整主题

完整示例请参见 `src/styles/themes/vercel.css`，其中定义了所有令牌。

## 示例：最小主题

对于最小主题，你可以复制一个现有主题，仅修改你想更改的颜色。系统会为任何缺失的令牌回退到默认值。

## 颜色格式参考

### OKLCH 格式

```
oklch(亮度 色度 色相)
```

- **亮度**：0-1（0 = 黑色，1 = 白色）
- **色度**：0+（0 = 灰度，0.2+ = 彩色）
- **色相**：0-360 度
  - 0/360 = 红色
  - 60 = 黄色
  - 120 = 绿色
  - 180 = 青色
  - 240 = 蓝色
  - 300 = 品红色

### 示例

```css
/* 纯白 */
--background: oklch(1 0 0);

/* 纯黑 */
--foreground: oklch(0 0 0);

/* 亮蓝 */
--primary: oklch(0.7 0.2 240);

/* 灰色 */
--muted: oklch(0.5 0 0);
```

## 最佳实践

1. **使用描述性主题名**：使用 kebab-case（如 `ocean-blue`、`forest-green`）
2. **同时提供亮色和暗色模式**：始终定义两种变体
3. **测试可访问性**：确保前景色和背景色之间有足够的对比度
4. **保持令牌一致性**：相关颜色使用相似的亮度/色度值
5. **记录特殊功能**：如果主题有独特特征（如无阴影或自定义字体），添加注释说明

## 故障排查

### 主题不显示

- 检查文件是否在 `src/styles/theme.css` 中导入
- 验证主题名称与 `theme.config.ts` 中 `THEMES[].value` 完全一致（大小写敏感）
- 确保文件已保存且开发服务器已重新加载

### 颜色不生效

- 验证所有必需令牌已定义
- 检查 `@theme inline` 块是否包含所有颜色映射
- 确保 OKLCH 格式正确（无拼写错误）

### 暗色模式不工作

- 验证 `.dark` 选择器正确：`[data-theme='name'].dark`
- 检查暗色模式令牌是否已定义
- 确保 `next-themes` 配置正确

## 设置默认主题

应用默认使用 `vercel` 主题。要更改未设置偏好用户的默认主题：

### 修改默认主题常量

编辑 `src/components/themes/theme.config.ts` 并更新 `DEFAULT_THEME` 常量：

```typescript
/**
 * 未设置用户偏好时加载的默认主题
 * 修改此值以设置不同的默认主题
 */
export const DEFAULT_THEME = 'your-theme-name'; // 修改此值
```

**工作原理：**

- **唯一真实来源**：`DEFAULT_THEME` 定义在 `theme.config.ts` 中，在所有需要的地方导入
- **服务端**：立即应用在 HTML 的 `data-theme` 属性中（无闪烁）
- **客户端**：作为无 cookie 偏好时的回退值
- **用户偏好**：手动写入 `active_theme` cookie 时优先使用该值（仅限 `THEMES` 中的合法值）
- **自动化**：无需更新多个文件 — 修改一次即可全局生效

**此方式的优势：**

✅ 无代码重复 — 定义一次，处处使用
✅ 类型安全 — TypeScript 确保一致性
✅ 易于修改 — 在一个文件中改一行
✅ 文档清晰 — 注释说明用途
✅ 即时应用 — 无未样式内容闪烁

## 在主题中使用 Google Fonts

> **注意：** 本节提供字体的额外细节。完整的分步流程请参见上方**逐步指南**中的**步骤 5**。

### 何时需要添加字体

仅在以下情况需要在 `font.config.ts` 中添加字体：

- 你的主题使用了尚未导入的 Google Font
- 你想使用需要加载的自定义字体

**提示：** 先检查 `src/components/themes/font.config.ts` — 许多字体可能已经可用！

### 字体加载流程

1. 在 `src/components/themes/font.config.ts` 中**导入字体**：

```typescript
import { Roboto, Roboto_Mono } from 'next/font/google';
```

2. **配置字体**，设置 CSS 变量：

```typescript
const fontRoboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-roboto'
});
```

3. **添加到 fontVariables 导出**：

```typescript
export const fontVariables = cn(
  // ... 现有字体
  fontRoboto.variable
);
```

4. **在主题 CSS 中使用字体显示名称**：

```css
[data-theme='your-theme'] {
  --font-sans: 'Roboto', sans-serif; /* 使用显示名称，不是 CSS 变量 */
  --font-mono: 'Roboto Mono', monospace;
}
```

### 重要说明

- **字体名称**：在 CSS 中使用字体的显示名称（如 `'Roboto'`、`'Open Sans'`），不是 CSS 变量名
- **字体加载**：字体必须在 `font.config.ts` 中导入，Next.js 才会加载
- **自动应用**：字体变量通过 `layout.tsx` 自动应用到 body 元素
- **可用字体**：参见 [Next.js 字体优化文档](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) 了解可用的 Google Fonts

> 当前 `font.config.ts` 只加载 Geist / Geist Mono；如需其它字体，须先在 `font.config.ts` 中导入（见步骤 5）。

## 参考文件

- **完整主题示例**：`src/styles/themes/vercel.css`
- **主题聚合器**：`src/styles/theme.css`
- **主题提供者**：`src/components/themes/active-theme.tsx`
- **明暗切换组件**：`src/components/themes/theme-mode-toggle.tsx`
- **主题配置**（含默认主题）：`src/components/themes/theme.config.ts`
- **字体配置**：`src/components/themes/font.config.ts`
