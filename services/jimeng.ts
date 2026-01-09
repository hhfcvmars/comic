/**
 * 即梦 4.0 图片生成服务 - 修复版
 * 基于火山引擎 HMAC-SHA256 V4 签名认证
 * 
 * 主要修复点：
 * 1. SignedHeaders 按字母顺序排序
 * 2. CanonicalHeaders 按字母顺序排序
 * 3. Content-Type 不参与签名（与官方示例一致）
 * 
 * API 流程：
 * 1. 提交任务 (CVSync2AsyncSubmitTask) - 返回 task_id
 * 2. 查询任务 (CVSync2AsyncGetResult) - 使用 task_id 查询结果
 */

import { Character } from "../types";
import { uploadBase64ToQiniu } from "./qiniu";

// 即梦 4.0 API 配置
const JIMENG_HOST = "visual.volcengineapi.com";
const JIMENG_ENDPOINT = `https://${JIMENG_HOST}`;
const JIMENG_SERVICE = "cv";
const JIMENG_REGION = "cn-north-1";
const JIMENG_VERSION = "2022-08-31";
const JIMENG_ACTION_SUBMIT = "CVSync2AsyncSubmitTask";
const JIMENG_ACTION_GET_RESULT = "CVSync2AsyncGetResult";
const JIMENG_REQ_KEY = "jimeng_t2i_v40";

// 任务查询配置
const TASK_POLL_INTERVAL = 3000; // 轮询间隔（毫秒）
const TASK_MAX_RETRIES = 60; // 最大重试次数（约2分钟）

/**
 * 获取即梦认证信息
 */
const getJimengCredentials = (): { accessKeyId: string; secretAccessKey: string } => {
  const accessKeyId = localStorage.getItem("jimeng_access_key_id");
  const secretAccessKey = localStorage.getItem("jimeng_secret_access_key");
  
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("请先在设置中配置即梦 4.0 Access Key");
  }
  
  return { accessKeyId, secretAccessKey };
};

/**
 * HMAC-SHA256 签名
 */
async function sign(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyBuffer = new ArrayBuffer(key.length);
  new Uint8Array(keyBuffer).set(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(msg));
  return new Uint8Array(signature);
}

/**
 * 获取签名密钥
 */
async function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  regionName: string,
  serviceName: string
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const kDate = await sign(encoder.encode(secretKey), dateStamp);
  const kRegion = await sign(kDate, regionName);
  const kService = await sign(kRegion, serviceName);
  const kSigning = await sign(kService, "request");
  return kSigning;
}

/**
 * SHA256 哈希
 */
async function sha256Hex(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 转换为16进制字符串
 */
function toHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 格式化查询参数 - 按字母顺序排序
 */
function formatQuery(parameters: Record<string, string>): string {
  const sortedKeys = Object.keys(parameters).sort();
  return sortedKeys.map(key => `${key}=${parameters[key]}`).join("&");
}

/**
 * 获取当前 UTC 时间字符串
 */
function getCurrentDate(): { currentDate: string; dateStamp: string } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const seconds = String(now.getUTCSeconds()).padStart(2, "0");
  
  const currentDate = `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  const dateStamp = `${year}${month}${day}`;
  
  return { currentDate, dateStamp };
}

/**
 * 火山引擎 V4 签名请求 - 修复版
 * 关键修复：按照 Java 官方示例的 SignedHeaders 顺序
 * SignedHeaders: host;x-date;x-content-sha256;content-type
 */
async function signV4Request(
  accessKey: string,
  secretKey: string,
  service: string,
  reqQuery: string,
  reqBody: string
): Promise<{ headers: Record<string, string>; requestUrl: string }> {
  const { currentDate, dateStamp } = getCurrentDate();
  
  const canonicalUri = "/";
  const canonicalQueryString = reqQuery;
  
  // 计算 payload hash
  const payloadHash = await sha256Hex(reqBody);
  const contentType = "application/json";
  
  // ==================== 修复点 ====================
  // 按照 Java 官方示例的顺序：host;x-date;x-content-sha256;content-type
  // 注意：这不是字母顺序，而是火山引擎要求的特定顺序
  const signedHeaders = "host;x-date;x-content-sha256;content-type";
  
  // CanonicalHeaders 必须按相同顺序排列
  // 每个 header 后面必须有换行符
  const canonicalHeaders = 
    `host:${JIMENG_HOST}\n` +
    `x-date:${currentDate}\n` +
    `x-content-sha256:${payloadHash}\n` +
    `content-type:${contentType}\n`;
  // ==================== 修复点结束 ====================
  
  // 标准化请求
  const canonicalRequest = 
    "POST" + "\n" +
    canonicalUri + "\n" +
    canonicalQueryString + "\n" +
    canonicalHeaders + "\n" +
    signedHeaders + "\n" +
    payloadHash;
  
  console.log("========== 签名调试信息 ==========");
  console.log("currentDate:", currentDate);
  console.log("dateStamp:", dateStamp);
  console.log("canonicalQueryString:", canonicalQueryString);
  console.log("payloadHash:", payloadHash);
  console.log("signedHeaders:", signedHeaders);
  console.log("canonicalHeaders:\n" + canonicalHeaders);
  console.log("Canonical Request:\n" + canonicalRequest);
  
  // 待签名字符串
  const algorithm = "HMAC-SHA256";
  const credentialScope = `${dateStamp}/${JIMENG_REGION}/${service}/request`;
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
  
  const stringToSign = [
    algorithm,
    currentDate,
    credentialScope,
    hashedCanonicalRequest
  ].join("\n");
  
  console.log("credentialScope:", credentialScope);
  console.log("hashedCanonicalRequest:", hashedCanonicalRequest);
  console.log("String to Sign:\n" + stringToSign);
  
  // 计算签名
  const signingKey = await getSignatureKey(secretKey, dateStamp, JIMENG_REGION, service);
  const signatureBuffer = await sign(signingKey, stringToSign);
  const signature = toHex(signatureBuffer);
  
  console.log("Signature:", signature);
  
  // 构造 Authorization 头
  const authorizationHeader = `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  console.log("Authorization:", authorizationHeader);
  console.log("========== 签名调试信息结束 ==========");
  
  // 请求头
  const headers: Record<string, string> = {
    "Host": JIMENG_HOST,
    "X-Date": currentDate,
    "X-Content-Sha256": payloadHash,
    "Content-Type": contentType,
    "Authorization": authorizationHeader
  };
  
  const requestUrl = `${JIMENG_ENDPOINT}/?${canonicalQueryString}`;
  
  return { headers, requestUrl };
}

/**
 * 火山引擎API响应 - 提交任务
 */
interface VolcengineSubmitResponse {
  code: number;
  message?: string;
  data?: {
    task_id?: string;
  };
  request_id?: string;
  time_elapsed?: string;
}

/**
 * 火山引擎API响应 - 查询任务
 */
interface VolcengineGetResultResponse {
  code: number;
  message?: string;
  data?: {
    task_id?: string;
    status?: string; // 任务状态：processing/running, done/success, failed
    image_urls?: string[];
    binary_data_base64?: string[];
    aigc_meta_tagged?: boolean;
    video_url?: string;
  };
  request_id?: string;
  status?: number; // HTTP状态码
  time_elapsed?: string;
}

/**
 * 调用即梦 API
 */
async function callJimengApi(
  action: string,
  bodyParams: Record<string, unknown>
): Promise<VolcengineSubmitResponse | VolcengineGetResultResponse> {
  const { accessKeyId, secretAccessKey } = getJimengCredentials();
  
  // 查询参数
  const queryParams: Record<string, string> = {
    Action: action,
    Version: JIMENG_VERSION
  };
  const formattedQuery = formatQuery(queryParams);
  
  // 请求体
  const formattedBody = JSON.stringify(bodyParams);
  
  // 签名请求
  const { headers, requestUrl } = await signV4Request(
    accessKeyId,
    secretAccessKey,
    JIMENG_SERVICE,
    formattedQuery,
    formattedBody
  );
  
  console.log("\nBEGIN REQUEST++++++++++++++++++++++++++++++++++++");
  console.log("Action:", action);
  console.log("Request URL =", requestUrl);
  console.log("Headers:", JSON.stringify(headers, null, 2));
  console.log("Body:", formattedBody);
  
  try {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers,
      body: formattedBody
    });
    
    const responseText = await response.text();
    const respStr = responseText.replace(/\\u0026/g, "&");
    
    console.log("\nRESPONSE++++++++++++++++++++++++++++++++++++");
    console.log(`Response code: ${response.status}`);
    console.log(`Response body: ${respStr}`);
    
    if (!response.ok) {
      throw new Error(`即梦 API 请求失败 (${response.status}): ${respStr}`);
    }
    
    return JSON.parse(respStr);
  } catch (error) {
    console.error("即梦 API 调用错误:", error);
    throw error;
  }
}

/**
 * 判断字符串是否为URL
 */
function isUrl(str: string): boolean {
  return str.startsWith("http://") || str.startsWith("https://");
}

/**
 * 提交即梦图片生成任务
 * @returns 任务ID
 */
async function submitJimengTask(prompt: string, options: {
  width?: number;
  height?: number;
  seed?: number;
  image_urls?: string[]; // 图片URL数组，用于以图生图
  scale?: number; // 修改程度，0-1之间，默认0.5
} = {}): Promise<string> {
  const bodyParams: Record<string, unknown> = {
    req_key: JIMENG_REQ_KEY,
    prompt: prompt,
    force_single: true, // 强制生成单张图片
    logo_info: {
      add_logo: false
    }
  };
  
  // 统一的图片尺寸：1024x1024 正方形
  const imageWidth = options.width || 1024;
  const imageHeight = options.height || 1024;
  
  // 如果传入了 image_urls，使用以图生图模式
  if (options.image_urls && options.image_urls.length > 0) {
    bodyParams.image_urls = options.image_urls;
    // 以图生图模式也需要指定输出尺寸，确保是正方形
    bodyParams.width = imageWidth;
    bodyParams.height = imageHeight;
    // scale 参数只在以图生图模式下有效，范围应该在 0-1 之间
    if (options.scale !== undefined) {
      // 确保 scale 在合理范围内
      const scaleValue = Math.max(0, Math.min(1, options.scale));
      bodyParams.scale = scaleValue;
      if (scaleValue !== options.scale) {
        console.warn(`scale 参数 ${options.scale} 超出范围 [0, 1]，已调整为 ${scaleValue}`);
      }
    } else {
      // 默认 scale 为 0.5
      bodyParams.scale = 0.5;
    }
  } else {
    // 文生图模式，需要 width、height、seed
    bodyParams.width = imageWidth;
    bodyParams.height = imageHeight;
    bodyParams.seed = options.seed || Math.floor(Math.random() * 999999);
  }
  
  const result = await callJimengApi(JIMENG_ACTION_SUBMIT, bodyParams) as VolcengineSubmitResponse;
  
  if (result.code !== 10000) {
    throw new Error(`即梦 API 错误 (${result.code}): ${result.message || "未知错误"}`);
  }
  
  const taskId = result.data?.task_id;
  if (!taskId) {
    throw new Error("即梦 API 未返回任务ID");
  }
  
  console.log(`即梦任务已提交，task_id: ${taskId}`);
  return taskId;
}

/**
 * 查询即梦任务结果
 * @param taskId 任务ID
 * @param returnUrl 是否以图片链接形式返回（默认 true）
 * @returns 任务结果响应
 */
async function getJimengTaskResult(
  taskId: string,
  returnUrl: boolean = true
): Promise<VolcengineGetResultResponse> {
  const bodyParams: Record<string, unknown> = {
    req_key: JIMENG_REQ_KEY,
    task_id: taskId
  };
  
  // 可选参数：通过 req_json 配置返回格式
  if (returnUrl) {
    bodyParams.req_json = JSON.stringify({
      return_url: true,
      logo_info: {
        add_logo: false
      }
    });
  }
  
  const result = await callJimengApi(JIMENG_ACTION_GET_RESULT, bodyParams) as VolcengineGetResultResponse;
  
  if (result.code !== 10000) {
    throw new Error(`即梦 API 查询错误 (${result.code}): ${result.message || "未知错误"}`);
  }
  
  return result;
}

/**
 * 等待即梦任务完成并获取结果
 * @param taskId 任务ID
 * @param returnUrl 是否以图片链接形式返回
 * @returns 图片URL或Base64数据
 */
async function waitForJimengTask(
  taskId: string,
  returnUrl: boolean = true
): Promise<string[]> {
  let retries = 0;
  
  while (retries < TASK_MAX_RETRIES) {
    try {
      const result = await getJimengTaskResult(taskId, returnUrl);
      const status = result.data?.status;
      
      console.log(`即梦任务 ${taskId} 状态: ${status} (第 ${retries + 1} 次查询)`);
      
      // 支持 "done" 和 "success" 两种状态
      if (status === "done" || status === "success") {
        // 任务成功，返回图片数据
        const imageUrls = result.data?.image_urls;
        const base64Data = result.data?.binary_data_base64;
        
        if (base64Data && base64Data.length > 0) {
          return base64Data.map(b64 => `data:image/png;base64,${b64}`);
        }
        
        if (imageUrls && imageUrls.length > 0) {
          // 处理URL中的转义字符 \u0026 -> &
          return imageUrls.map(url => url.replace(/\\u0026/g, "&"));
        }
        
        throw new Error("即梦任务成功但未返回图片数据");
      } else if (status === "failed") {
        throw new Error(`即梦任务失败: ${result.message || "未知错误"}`);
      } else if (status === "processing" || status === "running") {
        // 任务处理中，继续等待
        await new Promise(resolve => setTimeout(resolve, TASK_POLL_INTERVAL));
        retries++;
      } else {
        // 未知状态，继续等待
        console.warn(`即梦任务未知状态: ${status}，继续等待...`);
        await new Promise(resolve => setTimeout(resolve, TASK_POLL_INTERVAL));
        retries++;
      }
    } catch (error) {
      // 如果是明确的任务失败，直接抛出
      if (error instanceof Error && error.message.includes("失败")) {
        throw error;
      }
      
      // 其他错误，记录日志后继续重试
      console.warn(`即梦任务查询出错 (第 ${retries + 1} 次):`, error);
      
      if (retries >= TASK_MAX_RETRIES - 1) {
        throw new Error(`即梦任务查询超时: ${error instanceof Error ? error.message : "未知错误"}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, TASK_POLL_INTERVAL));
      retries++;
    }
  }
  
  throw new Error(`即梦任务查询超时，已重试 ${TASK_MAX_RETRIES} 次`);
}

/**
 * 使用即梦 4.0 为特定分镜生成图像
 * 完整流程：提交任务 -> 轮询查询 -> 获取结果
 * 支持文生图和以图生图两种模式
 */
export async function generatePanelImageWithJimeng(
  prompt: string,
  style: string,
  characters: Character[],
  contextImage: string | null = null,
  batchSize: number = 1,
  scale: number = 0.5 // 以图生图时的修改程度，默认0.5
): Promise<string[]> {
  const bg = characters.length > 0 ? "纯白背景, 极简环境" : "精细真实环境场景";
  let fullPrompt = `${style}漫画风格, ${bg}: ${prompt}. `;
  
  if (characters.length > 0) {
    const charInfo = characters.map((c) => `${c.name}(${c.description})`).join(", ");
    fullPrompt += `角色特征: ${charInfo}. `;
  }

  fullPrompt += "画面必须干净、纯粹。构图清晰稳定, 线条准确, 无文字, 无对话框.";

  console.log("即梦生成提示词:", fullPrompt);
  console.log("角色列表:", characters.map(c => ({ name: c.name, hasReferenceImage: !!c.referenceImage })));

  // 收集所有需要作为参考的图片URL（角色图片 + contextImage）
  const imageUrls: string[] = [];

  // 处理角色的参考图片
  for (const character of characters) {
    if (character.referenceImage) {
      console.log(`处理角色 ${character.name} 的参考图片...`);
      try {
        if (isUrl(character.referenceImage)) {
          // 已经是 URL，直接使用
          imageUrls.push(character.referenceImage);
          console.log(`✓ 角色 ${character.name} 使用参考图片 URL:`, character.referenceImage);
        } else {
          // 是 base64 数据，需要上传到七牛云
          console.log(`角色 ${character.name} 的参考图片是 base64 格式，正在上传到七牛云...`);
          const characterImageUrl = await uploadBase64ToQiniu(
            character.referenceImage,
            `character_${character.name}_${Date.now()}.png`
          );
          imageUrls.push(characterImageUrl);
          console.log(`✓ 角色 ${character.name} 参考图片已上传，URL:`, characterImageUrl);
        }
      } catch (error) {
        console.error(`✗ 上传角色 ${character.name} 的参考图片失败:`, error);
        // 单个角色图片上传失败不影响整体流程，但记录警告
        console.warn(`角色 ${character.name} 的参考图片上传失败，将跳过该角色的参考图片`);
      }
    } else {
      console.log(`角色 ${character.name} 没有参考图片，跳过`);
    }
  }

  // 处理 contextImage
  if (contextImage) {
    console.log("处理 contextImage...");
    try {
      if (isUrl(contextImage)) {
        // 已经是 URL，直接使用
        imageUrls.push(contextImage);
        console.log("✓ 使用 contextImage URL:", contextImage);
      } else {
        // 是 base64 数据，需要上传到七牛云
        console.log("contextImage 是 base64 格式，正在上传到七牛云...");
        const contextImageUrl = await uploadBase64ToQiniu(contextImage, `context_${Date.now()}.png`);
        imageUrls.push(contextImageUrl);
        console.log("✓ contextImage 已上传，URL:", contextImageUrl);
      }
    } catch (error) {
      console.error("✗ 上传 contextImage 失败:", error);
      // contextImage 上传失败不影响流程
    }
  } else {
    console.log("没有 contextImage，跳过");
  }

  // 打印收集到的所有参考图片URL
  console.log("========== 参考图片URL汇总 ==========");
  console.log(`共收集到 ${imageUrls.length} 张参考图片:`);
  imageUrls.forEach((url, index) => {
    console.log(`  [${index + 1}] ${url}`);
  });
  console.log("=====================================");

  const results: string[] = [];

  // 提交所有任务
  const taskIds: string[] = [];
  for (let i = 0; i < batchSize; i++) {
    try {
      let taskId: string;
      
      // 如果有参考图片（角色图片或 contextImage），使用以图生图模式
      if (imageUrls.length > 0) {
        // 以图生图模式
        console.log(`========== 即梦任务 ${i + 1} 使用以图生图模式 ==========`);
        console.log(`参考图片数量: ${imageUrls.length}`);
        console.log(`Scale: ${scale}`);
        console.log(`图片URLs:`, imageUrls);
        taskId = await submitJimengTask(fullPrompt, {
          image_urls: imageUrls,
          scale: scale,
          width: 1024,
          height: 1024
        });
      } else {
        // 文生图模式
        console.log(`========== 即梦任务 ${i + 1} 使用文生图模式 ==========`);
        console.log("注意：没有收集到任何参考图片，将使用文生图模式");
        taskId = await submitJimengTask(fullPrompt, {
          width: 1024,
          height: 1024,
          seed: Math.floor(Math.random() * 999999)
        });
      }
      
      taskIds.push(taskId);
      console.log(`即梦任务 ${i + 1} 已提交，task_id: ${taskId}`);
    } catch (error) {
      console.error(`即梦任务 ${i + 1} 提交失败:`, error);
    }
  }

  if (taskIds.length === 0) {
    throw new Error("即梦生成失败：所有任务提交都失败了");
  }

  // 等待所有任务完成
  const taskPromises = taskIds.map(async (taskId, index) => {
    try {
      console.log(`开始等待即梦任务 ${index + 1} (task_id: ${taskId}) 完成...`);
      const imageData = await waitForJimengTask(taskId, true);
      console.log(`即梦任务 ${index + 1} 完成，获得 ${imageData.length} 张图片`);
      return imageData;
    } catch (error) {
      console.error(`即梦任务 ${index + 1} (task_id: ${taskId}) 失败:`, error);
      return [];
    }
  });

  // 并行等待所有任务
  const allResults = await Promise.all(taskPromises);
  
  // 直接返回图片URL，不进行下载转换或上传
  for (const imageData of allResults.flat()) {
    if (imageData.startsWith("http://") || imageData.startsWith("https://")) {
      // 直接使用返回的URL
      results.push(imageData);
    } else if (imageData.startsWith("data:image")) {
      // 如果是 base64 数据，直接使用（理论上即梦API应该返回URL，这里作为兜底）
      results.push(imageData);
    } else {
      // 其他格式，直接添加
      results.push(imageData);
    }
  }

  if (results.length === 0) {
    throw new Error("即梦生成失败：所有任务都失败了");
  }

  return results;
}