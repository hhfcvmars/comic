/**
 * 七牛云上传服务
 */

// 七牛云配置
const QINIU_DOMAIN = "https://img.shuipantech.com";
const QINIU_UPLOAD_URL = "https://upload.qiniup.com";
const QINIU_TOKEN_API = "https://putonghua.shuipantech.com/api/tool/qiniu/uploadToken";

/**
 * 七牛云token API响应接口
 */
interface QiniuTokenResponse {
  code: string;
  data: {
    key: string;
    token: string;
  };
  message: string;
  success: boolean;
}

/**
 * 从服务器获取七牛云上传 Token
 * 调用后端API获取token和key
 */
async function generateUploadToken(): Promise<{ token: string; key: string }> {
  try {
    console.log("正在从API获取七牛云Token...");
    
    const response = await fetch(QINIU_TOKEN_API);
    
    if (!response.ok) {
      throw new Error(`获取Token失败 (${response.status}): ${response.statusText}`);
    }
    
    const result: QiniuTokenResponse = await response.json();
    
    if (!result.success || result.code !== "0000") {
      throw new Error(`获取Token失败: ${result.message || "未知错误"}`);
    }
    
    console.log("成功获取七牛云Token");
    console.log("Token Key:", result.data.key);
    
    return {
      token: result.data.token,
      key: result.data.key,
    };
  } catch (error) {
    console.error("获取七牛云Token失败:", error);
    throw error;
  }
}

/**
 * 上传文件到七牛云
 * @param file 要上传的文件
 * @param key 文件在七牛云中的key（可选，不传则使用API返回的key）
 * @returns 上传后的文件URL
 */
export async function uploadToQiniu(file: File, key?: string): Promise<string> {
  try {
    // 从API获取上传token和key
    const { token, key: apiKey } = await generateUploadToken();
    
    // 使用API返回的key或自定义key
    const fileKey = key || apiKey;

    // 创建FormData
    const formData = new FormData();
    formData.append("file", file);
    formData.append("key", fileKey);
    formData.append("token", token);

    // 打印调试信息
    console.log("上传参数:", {
      url: QINIU_UPLOAD_URL,
      key: fileKey,
      tokenPreview: token.substring(0, 50) + "...",
    });

    // 上传文件
    const response = await fetch(QINIU_UPLOAD_URL, {
      method: "POST",
      body: formData,
    });

    console.log("上传响应状态:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("七牛云上传错误详情:", {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });
      throw new Error(`七牛云上传失败 (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    if (result.error) {
      throw new Error(`七牛云上传失败: ${result.error}`);
    }

    // 使用返回的key或上传时指定的key
    const finalKey = result.key || fileKey;
    // 返回完整的文件URL
    return `${QINIU_DOMAIN}/${finalKey}`;
  } catch (error) {
    console.error("七牛云上传错误:", error);
    throw error;
  }
}

/**
 * 上传base64图片到七牛云
 * @param base64Data base64格式的图片数据（包含data:image/...前缀）
 * @param filename 文件名（可选）
 * @returns 上传后的文件URL
 */
export async function uploadBase64ToQiniu(base64Data: string, filename?: string): Promise<string> {
  try {
    // 解析base64数据
    const matches = base64Data.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
    if (!matches) {
      throw new Error("无效的base64图片数据");
    }

    const mimeType = matches[1];
    const base64Content = matches[2];

    // 将base64转换为Blob
    const byteCharacters = atob(base64Content);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: `image/${mimeType}` });

    // 生成文件名
    const extension = mimeType === "jpeg" ? "jpg" : mimeType;
    const file = new File([blob], filename || `image.${extension}`, { type: `image/${mimeType}` });

    // 上传文件
    return await uploadToQiniu(file);
  } catch (error) {
    console.error("Base64上传到七牛云错误:", error);
    throw error;
  }
}

