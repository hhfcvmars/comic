
import { Character, Panel } from "../types";

const BASE_URL = "https://yibuapi.com/v1beta/models";

const getApiKey = (): string => {
  const apiKey = localStorage.getItem("comic_api_key");
  if (!apiKey) {
    throw new Error("请先在设置中配置 API Key");
  }
  return apiKey;
};

const getJimengApiKey = (): string | null => {
  return localStorage.getItem("jimeng_api_key");
};

/**
 * 使用 Gemini 3 Flash 分析原始剧本并将其分解为结构化的分镜。
 * 强化约束：严禁任何未指定的特效。
 */
export async function analyzeScript(script: string, panelCount: number, characters: Character[]) {
  const apiKey = getApiKey();
  const charNames = characters.map(c => c.name).join(", ");

  const response = await fetch(
    `${BASE_URL}/gemini-3-flash-preview:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: `你是一位专业的漫画分镜师。请分析以下剧本，将其分解为 ${panelCount} 个分镜。

        核心规则：
        1. **人物**：仅使用 [${charNames}]。
        2. **背景**：
           - **有角色时**：以"纯白背景 (Pure White Background)"开头，严禁任何环境细节。
           - **无角色时**：描述具体环境。
        3. **特效禁用（核心）**：除非剧本明确要求（如：大爆炸），否则画面描述中**严禁出现任何漫画特效**（例如：速度线、冲击线、发光气场、拟声词、闪电效果、烟雾装饰等）。保持画面极端干净、写实。
        4. **语言**：提示词需简洁有力，直接描述画面核心。

        剧本：
        ${script}

        输出 JSON：
        {
          "visual_style": "风格关键词 (如: 写实、平涂、复古)",
          "panels": [
            {
              "description": "简洁的画面视觉描述，不含任何未授权特效",
              "characters": ["角色名数组"],
              "original_text": "对应剧本原文"
            }
          ]
        }`
          }]
        }],
        generationConfig: {
          responseModalities: ["TEXT"]
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`剧本分析失败 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!resultText) throw new Error("剧本分析失败：未获得文本输出");

  try {
    const jsonText = resultText.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(jsonText);
  } catch (e) {
    console.error("解析剧本分析结果失败", e);
    throw new Error("剧本分析解析失败");
  }
}

/**
 * 使用 Gemini 2.5 Flash Image 为特定分镜生成图像。
 * 强制要求干净画面，无额外特效。
 */
export async function generatePanelImage(
  prompt: string,
  style: string,
  characters: Character[],
  contextImage: string | null = null,
  batchSize: number = 2
) {
  const apiKey = getApiKey();

  const bg = characters.length > 0
    ? "纯白背景, 极简环境, 角色隔离"
    : "精细真实环境场景";

  let fullPrompt = `${style}漫画风格, ${bg}: ${prompt}. `;
  fullPrompt += "画面必须干净、纯粹。严禁出现速度线、发光、烟雾特效、冲击波或任何装饰性漫画线条。";
  fullPrompt += "重要：直接生成图片数据，不要使用markdown格式，不要在图片前后添加任何文字说明。";

  if (characters.length > 0) {
    const charInfo = characters.map(c => `${c.name}(${c.description})`).join(", ");
    fullPrompt += `角色特征: ${charInfo}. `;
  }

  fullPrompt += "构图清晰稳定, 线条准确, 无文字, 无对话框.";

  const parts: any[] = [{ text: fullPrompt }];

  characters.forEach(char => {
    if (char.referenceImage) {
      const base64Data = char.referenceImage.split(",")[1];
      const mimeType = char.referenceImage.split(";")[0].split(":")[1];
      parts.push({
        inline_data: { mime_type: mimeType, data: base64Data }
      });
    }
  });

  if (contextImage) {
    const base64Data = contextImage.split(",")[1];
    const mimeType = contextImage.split(";")[0].split(":")[1];
    parts.push({
      inline_data: { mime_type: mimeType, data: base64Data }
    });
  }

  const generateRequests = Array(batchSize).fill(0).map(async (_, idx) => {
    try {
      const response = await fetch(
        `${BASE_URL}/gemini-2.5-flash-image-preview:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseModalities: ["IMAGE"]
            }
          })
        }
      );

      if (!response.ok) {
        console.error(`生成变体 ${idx} 失败 (${response.status})`);
        return null;
      }

      const data = await response.json();
      if (data.candidates?.[0]?.content?.parts) {
        for (const part of data.candidates[0].content.parts) {
          if (part.inline_data) {
            return `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
          }
          if (part.text && part.text.includes('data:image')) {
            const match = part.text.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
            if (match) {
              const mimeType = match[0].split(';')[0].split(':')[1];
              return `data:${mimeType};base64,${match[1]}`;
            }
          }
        }
      }
      return null;
    } catch (e) {
      console.error(`生成变体 ${idx} 时出错`, e);
      return null;
    }
  });

  const results = await Promise.all(generateRequests);
  return results.filter((img): img is string => img !== null);
}

/**
 * 统一的图片生成接口，根据用户选择的模式调用不同的生成服务
 */
export async function generatePanelImageUnified(
  prompt: string,
  style: string,
  characters: Character[],
  contextImage: string | null = null,
  batchSize: number = 2,
  mode: 'gemini' | 'jimeng' = 'gemini'
): Promise<string[]> {
  // 动态导入即梦服务，避免未使用时的加载
  if (mode === 'jimeng') {
    const { generatePanelImageWithJimeng } = await import('./jimeng');
    return generatePanelImageWithJimeng(prompt, style, characters, contextImage, batchSize);
  } else {
    return generatePanelImage(prompt, style, characters, contextImage, batchSize);
  }
}
