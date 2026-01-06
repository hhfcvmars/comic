# AI 漫画创作室 Pro - 助手指南

本文件包含在此仓库工作的 AI 编码助手的编码指南和命令。

---

## 构建和开发命令

### 开发
- `npm run dev` - 启动开发服务器（端口 3000），支持热重载
- `npm run build` - 构建生产版本（输出到 `dist/`）
- `npm run preview` - 本地预览生产构建

### 环境配置
1. 安装依赖：`npm install`
2. 在 `.env.local` 文件中设置 `GEMINI_API_KEY`
3. 运行 `npm run dev`

**注意：** 当前未配置测试框架。如需测试，请添加测试配置。

---

## 代码风格指南

### TypeScript 与类型
- **强类型化**：始终使用 TypeScript 接口和类型
- **接口定义**：使用 `interface` 定义对象形状，使用 `type` 定义联合类型和基本类型
- **类型注解**：当不明确时，显式标注函数参数和返回值的类型
- **类型守卫**：过滤数组时使用类型守卫：`filter((item): item is Type => condition)`
- **枚举**：对具有语义的字符串常量使用 `enum`（如 GenerationStatus）
- **避免 any**：避免使用 `any` 类型；必要时使用 `unknown`

示例：
```typescript
export interface Character {
  id: string;
  name: string;
  description: string;
  seed: number;
  referenceImage: string | null;
}

export enum GenerationStatus {
  IDLE = 'idle',
  GENERATING = 'generating',
  COMPLETE = 'complete',
  ERROR = 'error'
}
```

### 导入
- **顺序**：第三方库优先，然后是本地导入，用空行分隔
- **分组**：将相关导入分组在一起
- **命名导入**：使用命名导入，除非必要否则避免 `import * as`
- **React 导入**：`import React, { useState, useEffect } from 'react';`
- **图标**：从 lucide-react 一起导入多个图标，用换行符分隔以提高可读性

示例：
```typescript
import React, { useState, useEffect } from 'react';
import { Wand2, Plus, Trash2 } from 'lucide-react';
import JSZip from 'jszip';
import { Character, Panel } from './types';
import { generatePanelImage } from './services/gemini';
```

### 组件结构
- **函数组件**：仅使用带 hooks 的函数组件
- **类型注解**：`const MyComponent: React.FC<Props> = () => { ... }`
- **状态管理**：使用 `useState` 管理本地状态，将相关状态分组
- **副作用**：使用 `useEffect` 处理副作用，明确注释副作用的目的
- **引用**：使用 `useRef` 获取 DOM 元素引用

### 命名约定
- **组件**：PascalCase（App, CharacterList）
- **函数/方法**：camelCase（addCharacter, updateCharacter, handleImageUpload）
- **变量**：camelCase（script, frameCount, activePanelId）
- **常量**：全局常量使用 UPPER_SNAKE_CASE
- **接口/类型**：PascalCase（Character, Panel, ProjectState）
- **枚举**：枚举名使用 PascalCase，值使用 PascalCase（GenerationStatus.IDLE）
- **事件处理**：事件回调使用 `handle` 前缀（handleClick, handleSubmit）
- **布尔变量**：使用 `is`、`has`、`should` 前缀（isGenerating, hasCharacters）

### 格式与样式
- **缩进**：2 空格，不使用制表符
- **分号**：始终使用分号
- **引号**：字符串和 JSX 属性使用双引号
- **行长度**：最多 100 字符，超长行需换行
- **空行**：逻辑部分之间保留一个空行
- **尾随空格**：无尾随空格
- **JSX**：正确缩进的多行 JSX，必要时用括号包裹

### 错误处理
- **Try-catch**：对异步操作使用 try-catch，并正确记录错误
- **用户反馈**：使用 toast 通知面向用户的错误
- **控制台日志**：技术错误使用 `console.error`
- **错误消息**：提供描述性错误消息
- **优雅降级**：优雅处理错误，不要让 UI 崩溃

示例：
```typescript
try {
  const result = await someAsyncOperation();
  showToast("操作成功", "success");
} catch (error) {
  console.error("操作失败", error);
  showToast("操作失败，请稍后重试", "error");
}
```

### 注释与文档
- **语言**：代码注释使用中文（与项目约定一致）
- **函数文档**：导出函数使用 JSDoc 注释
- **内联注释**：为复杂逻辑或非显而易见的代码添加注释
- **部分注释**：使用注释分隔大型组件的逻辑部分

示例：
```typescript
/**
 * 分析剧本并生成分镜结构
 */
export async function analyzeScript(script: string, panelCount: number) {
  // 状态管理
  const [script, setScript] = useState<string>("");
}
```

### 样式（Tailwind CSS）
- **工具类**：所有样式使用 Tailwind 工具类
- **自定义 CSS**：如需要，在 `index.html` 的 `<style>` 块中添加自定义样式
- **响应式**：使用响应式前缀（sm:, md:, lg:, xl:）
- **主题**：默认暗色主题（bg-[#0f0f12], text-gray-200）
- **紫色强调**：主要操作使用 purple-500/600
- **悬停状态**：始终为交互元素提供悬停状态

### React 最佳实践
- **状态更新**：使用函数式更新从先前状态派生的状态
- **副作用依赖**：在 useEffect 依赖数组中包含所有依赖项
- **事件处理**：将事件处理程序定义为独立函数，尽可能不在 JSX 中使用内联箭头函数
- **条件渲染**：使用三元运算符或 && 运算符进行条件渲染
- **列表**：渲染列表时始终提供唯一的 `key` 属性

示例：
```typescript
const updateCharacter = (id: string, updates: Partial<Character>) => {
  setCharacters(characters.map(c => c.id === id ? { ...c, ...updates } : c));
};

// 在 JSX 中
{characters.map(char => (
  <div key={char.id}>{char.name}</div>
))}
```

### 文件组织
- **组件**：将组件放在根目录（App.tsx）
- **类型**：在 `types.ts` 中集中类型定义
- **服务**：将 API/服务调用放在 `services/` 目录中
- **入口点**：`index.tsx` 是应用程序入口点
- **配置**：配置文件保持在根目录（vite.config.ts, tsconfig.json）

### API 集成（Google GenAI）
- **客户端创建**：使用 `getGeminiClient()` 工厂函数
- **API 密钥**：通过 `process.env.API_KEY` 访问（在 vite.config.ts 中定义）
- **图像生成**：使用 `gemini-2.5-flash-image` 模型生成图像
- **文本生成**：使用 `gemini-3-flash-preview` 进行文本分析
- **JSON 响应**：使用 `responseMimeType: "application/json"` 和 `responseSchema` 获取结构化输出
- **Base64 图像**：处理 base64 数据 URI 以进行图像上传和下载

### 性能考虑
- **懒加载**：图像使用 `loading="lazy"`
- **优化**：必要时将大型组件拆分为更小的子组件
- **LocalStorage**：使用 localStorage 进行持久化，处理 QuotaExceededError
- **异步操作**：尽可能使用 Promise.all 进行并行操作

### 可访问性
- **语义化 HTML**：使用语义化 HTML 元素
- **Alt 文本**：始终为图像提供 alt 文本
- **按钮标签**：确保按钮有清晰、描述性的标签
- **键盘导航**：确保交互元素可通过键盘访问

---

## 项目特定说明

- **语言**：面向用户的文本使用中文
- **设计**：暗色主题搭配紫色强调色
- **功能**：漫画分镜生成、角色管理、图像变体选择
- **API**：需要 Google Gemini API 密钥
- **输出**：支持下载单个分镜或 ZIP 导出
- **存储**：使用 LocalStorage 持久化项目状态
