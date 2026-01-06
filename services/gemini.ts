
import { GoogleGenAI, Type } from "@google/genai";
import { Character, Panel } from "../types";

/**
 * 获取 Gemini 客户端。
 */
export const getGeminiClient = () => {
  return new GoogleGenAI({ 
    apiKey: process.env.API_KEY
  });
};

/**
 * 使用 Gemini 3 Flash 分析原始剧本并将其分解为结构化的分镜。
 * 强化约束：严禁任何未指定的特效。
 */
export async function analyzeScript(script: string, panelCount: number, characters: Character[]) {
  const ai = getGeminiClient();
  const charNames = characters.map(c => c.name).join(", ");
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{
      role: "user",
      parts: [{
        text: `你是一位专业的漫画分镜师。请分析以下剧本，将其分解为 ${panelCount} 个分镜。
        
        核心规则：
        1. **人物**：仅使用 [${charNames}]。
        2. **背景**：
           - **有角色时**：以“纯白背景 (Pure White Background)”开头，严禁任何环境细节。
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
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          visual_style: { type: Type.STRING },
          panels: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                description: { type: Type.STRING },
                characters: { type: Type.ARRAY, items: { type: Type.STRING } },
                original_text: { type: Type.STRING }
              },
              required: ["description", "characters", "original_text"]
            }
          }
        },
        required: ["visual_style", "panels"]
      }
    }
  });

  const resultText = response.text;
  if (!resultText) throw new Error("剧本分析失败：未获得文本输出");

  try {
    return JSON.parse(resultText);
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
  const ai = getGeminiClient();
  
  const bg = characters.length > 0 
    ? "纯白背景, 极简环境, 角色隔离" 
    : "精细真实环境场景";

  // 构建核心提示词，加入明确的特效禁令
  let fullPrompt = `${style}漫画风格, ${bg}: ${prompt}. `;
  
  // 强调“无特效”
  fullPrompt += "画面必须干净、纯粹。严禁出现速度线、发光、烟雾特效、冲击波或任何装饰性漫画线条。";

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
        inlineData: { mimeType, data: base64Data }
      });
    }
  });

  if (contextImage) {
    const base64Data = contextImage.split(",")[1];
    const mimeType = contextImage.split(";")[0].split(":")[1];
    parts.push({
      inlineData: { mimeType, data: base64Data }
    });
  }

  const generateRequests = Array(batchSize).fill(0).map(async (_, idx) => {
    try {
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: { parts },
        config: {
          imageConfig: {
            aspectRatio: "16:9"
          }
        }
      });

      if (result.candidates?.[0]?.content?.parts) {
        for (const part of result.candidates[0].content.parts) {
          if (part.inlineData) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
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
