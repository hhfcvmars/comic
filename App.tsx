
import React, { useState, useEffect, useRef } from 'react';
import {
  Wand2,
  Plus,
  Trash2,
  Layout,
  FileText,
  Download,
  RefreshCw,
  Settings,
  Users,
  Image as ImageIcon,
  X,
  Package,
  Zap,
  CheckCircle2,
  AlertCircle,
  Hash,
  Upload,
  Maximize2,
  UserCheck,
  UserPlus,
  Play
} from 'lucide-react';
import JSZip from 'jszip';
import { Character, Panel, GenerationStatus, ImageGenerationMode } from './types';
import { analyzeScript, generatePanelImageUnified } from './services/gemini';
import { uploadToQiniu, uploadBase64ToQiniu } from './services/qiniu';

const App: React.FC = () => {
  // 状态管理
  const [script, setScript] = useState<string>("");
  const [frameCount, setFrameCount] = useState<number>(5);
  const [characters, setCharacters] = useState<Character[]>([
    { id: '1', name: '主角', description: '蓝发刺头少年，穿着红色皮夹克。', seed: 1234, referenceImage: null }
  ]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [status, setStatus] = useState<GenerationStatus>(GenerationStatus.IDLE);
  const [lastError, setLastError] = useState<{ message: string; canResume: boolean } | null>(null);
  const [detectedStyle, setDetectedStyle] = useState<string>("");
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [apiKey, setApiKey] = useState<string>("");
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [jimengAccessKeyId, setJimengAccessKeyId] = useState<string>("");
  const [jimengSecretAccessKey, setJimengSecretAccessKey] = useState<string>("");
  const [jimengAccessKeyIdInput, setJimengAccessKeyIdInput] = useState<string>("");
  const [jimengSecretAccessKeyInput, setJimengSecretAccessKeyInput] = useState<string>("");
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [generationMode, setGenerationMode] = useState<ImageGenerationMode>(ImageGenerationMode.GEMINI);

  const batchInputRef = useRef<HTMLInputElement>(null);
  const shouldStopGeneration = useRef<boolean>(false);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) {
      localStorage.setItem('comic_api_key', apiKeyInput.trim());
      setApiKey(apiKeyInput.trim());
    }
    if (jimengAccessKeyIdInput.trim()) {
      localStorage.setItem('jimeng_access_key_id', jimengAccessKeyIdInput.trim());
      setJimengAccessKeyId(jimengAccessKeyIdInput.trim());
    }
    if (jimengSecretAccessKeyInput.trim()) {
      localStorage.setItem('jimeng_secret_access_key', jimengSecretAccessKeyInput.trim());
      setJimengSecretAccessKey(jimengSecretAccessKeyInput.trim());
    }
    localStorage.setItem('generation_mode', generationMode);
    setShowApiKeyModal(false);
    showToast("设置已保存", "success");
  };

  const handleClearApiKey = () => {
    localStorage.removeItem('comic_api_key');
    setApiKey("");
    setApiKeyInput("");
    showToast("API Key 已清除", "success");
  };

  const handleClearJimengApiKey = () => {
    localStorage.removeItem('jimeng_access_key_id');
    localStorage.removeItem('jimeng_secret_access_key');
    setJimengAccessKeyId("");
    setJimengSecretAccessKey("");
    setJimengAccessKeyIdInput("");
    setJimengSecretAccessKeyInput("");
    showToast("即梦 API Key 已清除", "success");
  };

  const handlePauseGeneration = () => {
    shouldStopGeneration.current = true;
    setStatus(GenerationStatus.PAUSED);
    setLastError({ message: "已手动暂停生成", canResume: true });
    showToast("生成已暂停，正在等待当前任务完成...", "info");
  };

  const handleClearTask = () => {
    if (panels.length === 0) return;
    if (window.confirm("确定要终止任务并清除所有生成的分镜和图片吗？此操作无法撤销。")) {
      shouldStopGeneration.current = true;
      setStatus(GenerationStatus.IDLE);
      setPanels([]);
      setLastError(null);
      setProgress(0);
      showToast("任务已清除", "success");
    }
  };

  // 判断是否为URL（以http://或https://开头）
  const isUrl = (str: string): boolean => {
    return str.startsWith('http://') || str.startsWith('https://');
  };

  // 本地存储持久化 - 读取
  useEffect(() => {
    const saved = localStorage.getItem('comic_studio_zh_v1');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed) {
          setScript(parsed.script || "");
          setFrameCount(parsed.frameCount || 5);
          setDetectedStyle(parsed.detectedStyle || "");
          if (Array.isArray(parsed.characters)) {
            // 检查是否有base64格式的图片需要上传到七牛云
            const charactersWithBase64 = parsed.characters.filter((char: Character) => 
              char.referenceImage && !isUrl(char.referenceImage)
            );
            
            // 先设置角色数据
            setCharacters(parsed.characters);
            
            // 如果有base64格式的图片，异步上传到七牛云
            if (charactersWithBase64.length > 0) {
              // 延迟显示提示，避免在组件初始化时立即显示
              setTimeout(() => {
                showToast(`检测到 ${charactersWithBase64.length} 个角色图片，正在上传到七牛云...`, "info");
              }, 500);
              
              // 异步上传base64图片到七牛云
              Promise.all(
                charactersWithBase64.map(async (char: Character) => {
                  try {
                    if (char.referenceImage && !isUrl(char.referenceImage)) {
                      const imageUrl = await uploadBase64ToQiniu(char.referenceImage, `${char.name || 'character'}.png`);
                      return { id: char.id, imageUrl };
                    }
                    return null;
                  } catch (error) {
                    console.error(`上传角色 ${char.name} 的图片失败:`, error);
                    return null;
                  }
                })
              ).then((uploadResults) => {
                // 更新成功上传的角色图片
                setCharacters(prev => prev.map((char: Character) => {
                  const result = uploadResults.find((r) => r && r.id === char.id);
                  if (result && result.imageUrl) {
                    return { ...char, referenceImage: result.imageUrl };
                  }
                  return char;
                }));
                
                const successCount = uploadResults.filter(r => r !== null).length;
                if (successCount > 0) {
                  showToast(`${successCount} 个角色图片已上传到七牛云`, "success");
                }
              }).catch((error) => {
                console.error("批量上传角色图片失败:", error);
                showToast("部分角色图片上传失败", "error");
              });
            }
          }
          if (Array.isArray(parsed.panels)) {
            setPanels(parsed.panels);
            const hasIncomplete = parsed.panels.some((p: Panel) => !p.imageUrl);
            if (hasIncomplete && parsed.panels.length > 0) {
              setStatus(GenerationStatus.PAUSED);
              setLastError({ message: "上次生成未完成，可继续生成", canResume: true });
            }
          }
        }
      } catch (e) {
        console.error("无法加载存档数据", e);
      }
    }
    const savedApiKey = localStorage.getItem('comic_api_key');
    if (savedApiKey) setApiKey(savedApiKey);
    const savedJimengAccessKeyId = localStorage.getItem('jimeng_access_key_id');
    if (savedJimengAccessKeyId) setJimengAccessKeyId(savedJimengAccessKeyId);
    const savedJimengSecretAccessKey = localStorage.getItem('jimeng_secret_access_key');
    if (savedJimengSecretAccessKey) setJimengSecretAccessKey(savedJimengSecretAccessKey);
    const savedGenerationMode = localStorage.getItem('generation_mode');
    if (savedGenerationMode) setGenerationMode(savedGenerationMode as ImageGenerationMode);
    setIsLoaded(true);
  }, []);

  // 本地存储持久化 - 写入
  useEffect(() => {
    if (!isLoaded) return;
    try {
      const dataToSave = JSON.stringify({ script, frameCount, characters, panels, detectedStyle });
      localStorage.setItem('comic_studio_zh_v1', dataToSave);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        console.warn("存储空间已满");
      } else {
        console.error("存档保存失败", e);
      }
    }
  }, [script, frameCount, characters, panels, detectedStyle]);

  const addCharacter = () => {
    const newChar: Character = {
      id: Math.random().toString(36).substr(2, 9),
      name: `新角色 ${characters.length + 1}`,
      description: '',
      seed: Math.floor(Math.random() * 99999),
      referenceImage: null
    };
    setCharacters([...characters, newChar]);
  };

  const handleBatchUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files) as File[];
    try {
      showToast("正在上传图片到七牛云...", "info");
      const results = await Promise.all(fileList.map(async (file: File) => {
        if (!file.type.startsWith('image/')) return null;
        try {
          // 上传到七牛云
          const imageUrl = await uploadToQiniu(file);
          const name = file.name.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, "") || "未知角色";
          return {
            id: Math.random().toString(36).substr(2, 9),
            name: name,
            description: '',
            seed: Math.floor(Math.random() * 99999),
            referenceImage: imageUrl
          };
        } catch (error) {
          console.error("上传失败:", error);
          return null;
        }
      }));
      const newCharacters = results.filter((c): c is Character => c !== null);
      if (newCharacters.length > 0) {
        setCharacters(prev => {
          const existingNames = new Set(prev.map(p => p.name));
          const filteredNew = newCharacters.filter(nc => !existingNames.has(nc.name));
          return [...prev, ...filteredNew];
        });
        showToast(`成功导入 ${newCharacters.length} 个新角色`, "success");
      } else {
        showToast("导入失败，请检查图片格式", "error");
      }
    } catch (err) {
      console.error("导入角色时发生错误", err);
      showToast("导入角色时发生错误", "error");
    } finally { e.target.value = ""; }
  };

  const removeCharacter = (id: string) => {
    setCharacters(characters.filter(c => c.id !== id));
  };

  const deleteAllCharacters = () => {
    if (characters.length === 0) return;
    if (window.confirm("确定要清空所有角色吗？此操作无法撤销。")) {
      setCharacters([]);
      showToast("已清空所有角色", "success");
    }
  };

  const updateCharacter = (id: string, updates: Partial<Character>) => {
    setCharacters(characters.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const handleImageUpload = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        showToast("正在上传图片到七牛云...", "info");
        const imageUrl = await uploadToQiniu(file);
        updateCharacter(id, { referenceImage: imageUrl });
        showToast("图片上传成功", "success");
      } catch (error) {
        console.error("上传失败:", error);
        showToast("图片上传失败，请重试", "error");
      }
    }
  };

  const toggleCharacterInPanel = (panelId: string, charName: string) => {
    setPanels(prev => prev.map(p => {
      if (p.id === panelId) {
        const hasChar = p.characterNames.includes(charName);
        const newChars = hasChar
          ? p.characterNames.filter(n => n !== charName)
          : [...p.characterNames, charName];
        return { ...p, characterNames: newChars };
      }
      return p;
    }));
  };

  const processPanelGeneration = async (currentPanels: Panel[], startIndex: number, style: string) => {
    setStatus(GenerationStatus.GENERATING);
    shouldStopGeneration.current = false;
    let prevImage: string | null = null;

    if (startIndex > 0) {
      prevImage = currentPanels[startIndex - 1].imageUrl;
    }

    try {
      for (let i = startIndex; i < currentPanels.length; i++) {
        if (shouldStopGeneration.current) {
          setStatus(GenerationStatus.PAUSED);
          setLastError({ message: "已手动暂停生成", canResume: true });
          showToast("生成已暂停，可点击继续生成恢复", "info");
          return;
        }

        const p = currentPanels[i];

        if (p.imageUrl) {
          prevImage = p.imageUrl;
          continue;
        }

        setProgress(10 + ((i + 1) / currentPanels.length) * 90);

        setPanels(prev => prev.map(fp => {
          if (fp.id === p.id) return { ...fp, isGenerating: true };
          return fp;
        }));

        try {
          const panelChars = characters.filter(c => p.characterNames.includes(c.name));
          const variations = await generatePanelImageUnified(p.prompt, style, panelChars, prevImage, 1, generationMode);



          if (!variations || variations.length === 0) {
            throw new Error("生成失败：API 未返回图片数据（可能是余额不足或网络问题）");
          }

          const newUrl = variations[0] || null;
          if (newUrl) prevImage = newUrl;

          setPanels(prev => prev.map(fp => {
            if (fp.id === p.id) return { ...fp, imageUrl: newUrl, variations, isGenerating: false };
            return fp;
          }));

          currentPanels[i] = { ...currentPanels[i], imageUrl: newUrl, variations, isGenerating: false };

        } catch (err) {
          console.error(`Panel ${i + 1} generation error:`, err);
          setPanels(prev => prev.map(fp => {
            if (fp.id === p.id) return { ...fp, isGenerating: false };
            return fp;
          }));

          const errorMessage = err instanceof Error ? err.message : "生成失败";
          setStatus(GenerationStatus.PAUSED);
          setLastError({ message: errorMessage, canResume: true });
          showToast(`生成暂停：${errorMessage}，可点击继续生成恢复`, "error");
          return;
        }
      }
      setStatus(GenerationStatus.COMPLETE);
      setLastError(null);
      showToast("项目生成完成！", "success");
    } catch (error) {
      // 兜底错误处理：只要有分镜数据，就尝试进入暂停状态，而不是直接报错结束
      if (currentPanels && currentPanels.length > 0) {
        setStatus(GenerationStatus.PAUSED);
        const errorMessage = error instanceof Error ? error.message : "生成过程发生异常";
        setLastError({ message: errorMessage, canResume: true });
        showToast(`已自动暂停：${errorMessage}`, "error");
      } else {
        setStatus(GenerationStatus.ERROR);
        const errorMessage = error instanceof Error ? error.message : "生成过程发生未预期的错误";
        setLastError({ message: errorMessage, canResume: true });
        showToast("生成过程发生未预期的错误", "error");
      }
    }
  };

  const startGeneration = async () => {
    if (!apiKey.trim()) {
      setApiKeyInput("");
      setShowApiKeyModal(true);
      return showToast("请先配置 Gemini API Key", "error");
    }
    if (generationMode === ImageGenerationMode.JIMENG && (!jimengAccessKeyId.trim() || !jimengSecretAccessKey.trim())) {
      setJimengAccessKeyIdInput("");
      setJimengSecretAccessKeyInput("");
      setShowApiKeyModal(true);
      return showToast("请先配置即梦 4.0 Access Key", "error");
    }
    if (!script.trim()) return showToast("请先输入剧本内容！", "error");
    if (status === GenerationStatus.GENERATING) return;

    setStatus(GenerationStatus.ANALYZING);
    setProgress(5);
    setLastError(null);
    try {
      const analysis = await analyzeScript(script, frameCount, characters);
      setDetectedStyle(analysis.visual_style);
      const skeletonPanels: Panel[] = analysis.panels.map((p: any, i: number) => ({
        id: Math.random().toString(36).substr(2, 9),
        index: i + 1,
        prompt: p.description,
        scriptContent: p.original_text,
        characterNames: p.characters,
        imageUrl: null,
        variations: [],
        isGenerating: false
      }));
      setPanels(skeletonPanels);

      await processPanelGeneration(skeletonPanels, 0, analysis.visual_style);

    } catch (error) {
      setStatus(GenerationStatus.ERROR);
      const errorMessage = error instanceof Error ? error.message : "生成失败";
      setLastError({ message: errorMessage, canResume: false });
      console.error("生成失败", error);
      showToast("生成失败，请稍后重试。", "error");
    }
  };

  const resumeGeneration = async () => {
    if (panels.length === 0) return;
    const startIndex = panels.findIndex(p => !p.imageUrl);
    if (startIndex === -1) {
      setStatus(GenerationStatus.COMPLETE);
      setLastError(null);
      return showToast("所有分镜已完成", "success");
    }
    setLastError(null);
    await processPanelGeneration([...panels], startIndex, detectedStyle);
  };

  const regeneratePanel = async (panelId: string, customPrompt?: string) => {
    const targetPanel = panels.find(p => p.id === panelId);
    if (!targetPanel) return;
    setPanels(prev => prev.map(p => p.id === panelId ? { ...p, isGenerating: true } : p));
    try {
      const panelChars = characters.filter(c => targetPanel.characterNames.includes(c.name));
      const idx = panels.indexOf(targetPanel);
      const prevImage = idx > 0 ? panels[idx - 1].imageUrl : null;
      // 生成 1 张图片
      const variations = await generatePanelImageUnified(customPrompt || targetPanel.prompt, detectedStyle || "经典漫画", panelChars, prevImage, 1, generationMode);
      setPanels(prev => prev.map(p => {
        if (p.id === panelId) {
          return {
            ...p,
            imageUrl: variations[0],
            variations: [...variations, ...p.variations].slice(0, 6),
            isGenerating: false,
            prompt: customPrompt || p.prompt
          };
        }
        return p;
      }));
      showToast("重绘成功", "success");
    } catch (e) {
      showToast("重绘失败", "error");
      setPanels(prev => prev.map(p => p.id === panelId ? { ...p, isGenerating: false } : p));
    }
  };

  const downloadSinglePanel = (panel: Panel) => {
    if (!panel.imageUrl) return;
    const link = document.createElement('a');
    link.href = panel.imageUrl;
    link.download = `Panel_${panel.index}.png`;
    link.click();
    showToast(`分镜 #${panel.index} 已开始下载`, "success");
  };

  const exportZip = async () => {
    if (panels.length === 0) return showToast("没有可导出的内容。", "info");
    const zip = new JSZip();
    const folder = zip.folder("comic_studio_export");
    panels.forEach((p, i) => {
      if (p.imageUrl) {
        const base64Data = p.imageUrl.split(',')[1];
        folder?.file(`Panel_${i + 1}.png`, base64Data, { base64: true });
      }
    });
    zip.file("project_info.txt", `Style: ${detectedStyle}\n\nScript:\n${script}`);
    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = `Comic_Project_${new Date().getTime()}.zip`;
    link.click();
    showToast("项目已打包下载", "success");
  };

  return (
    <div className="flex h-screen bg-[#0f0f12] text-gray-200 selection:bg-purple-500/30">

      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-xl shadow-2xl border flex items-center gap-3 animate-bounce
          ${toast.type === 'error' ? 'bg-red-950 border-red-800 text-red-200' :
            toast.type === 'success' ? 'bg-emerald-950 border-emerald-800 text-emerald-200' :
              'bg-blue-950 border-blue-800 text-blue-200'}`}>
          {toast.type === 'error' ? <AlertCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
          <span className="font-medium text-sm">{toast.message}</span>
        </div>
      )}

      {showApiKeyModal && (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-purple-500" />
                API Key 设置
              </h3>
              <button onClick={() => setShowApiKeyModal(false)} className="p-1 hover:bg-zinc-800 rounded-lg text-zinc-500 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-6">
              <div>
                <label className="text-sm font-bold text-zinc-400 uppercase tracking-wider block mb-2">Gemini API Key</label>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="请输入 Gemini API Key"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none transition-all"
                />
                <p className="text-xs text-zinc-500 mt-2">用于分镜分析和图像生成</p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-bold text-zinc-400 uppercase tracking-wider block mb-2">即梦 4.0 Access Key ID</label>
                  <input
                    type="text"
                    value={jimengAccessKeyIdInput}
                    onChange={(e) => setJimengAccessKeyIdInput(e.target.value)}
                    placeholder="请输入 Access Key ID"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-zinc-400 uppercase tracking-wider block mb-2">即梦 4.0 Secret Access Key</label>
                  <input
                    type="password"
                    value={jimengSecretAccessKeyInput}
                    onChange={(e) => setJimengSecretAccessKeyInput(e.target.value)}
                    placeholder="请输入 Secret Access Key"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none transition-all"
                  />
                  <p className="text-xs text-zinc-500 mt-2">用于图像生成（可选）</p>
                </div>
              </div>
              <div>
                <label className="text-sm font-bold text-zinc-400 uppercase tracking-wider block mb-3">图像生成方式</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setGenerationMode(ImageGenerationMode.GEMINI)}
                    className={`p-4 rounded-xl border-2 transition-all text-left ${
                      generationMode === ImageGenerationMode.GEMINI
                        ? 'border-purple-500 bg-purple-500/10'
                        : 'border-zinc-700 bg-zinc-900 hover:border-zinc-600'
                    }`}
                  >
                    <div className="font-bold text-white mb-1">Gemini</div>
                    <div className="text-xs text-zinc-500">Google AI 模型</div>
                  </button>
                  <button
                    onClick={() => setGenerationMode(ImageGenerationMode.JIMENG)}
                    className={`p-4 rounded-xl border-2 transition-all text-left ${
                      generationMode === ImageGenerationMode.JIMENG
                        ? 'border-purple-500 bg-purple-500/10'
                        : 'border-zinc-700 bg-zinc-900 hover:border-zinc-600'
                    }`}
                  >
                    <div className="font-bold text-white mb-1">即梦 4.0</div>
                    <div className="text-xs text-zinc-500">火山引擎模型</div>
                  </button>
                </div>
                <p className="text-xs text-zinc-500 mt-3">选择用于生成分镜图像的 AI 模型</p>
              </div>
              <div className="flex gap-3">
                <button onClick={handleSaveApiKey} className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 rounded-xl font-bold text-white transition-all">
                  保存
                </button>
                {(apiKey || jimengAccessKeyId || jimengSecretAccessKey) && (
                  <button onClick={() => { handleClearApiKey(); handleClearJimengApiKey(); }} className="py-3 px-6 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold text-red-400 transition-all">
                    清除全部
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 放大查看模态框 */}
      {zoomImageUrl && (
        <div
          className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setZoomImageUrl(null)}>
          <button className="absolute top-8 right-8 text-white/50 hover:text-white transition-colors">
            <X className="w-10 h-10" />
          </button>
          <img
            src={zoomImageUrl}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-in zoom-in duration-300"
            alt="Zoomed View" />
        </div>
      )}

      {/* 侧边控制面板 */}
      <aside className="w-[380px] border-r border-zinc-800 bg-zinc-900/40 backdrop-blur-xl flex flex-col custom-scrollbar overflow-y-auto z-10">
        <div className="p-6 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-black text-white italic tracking-tighter comic-font flex items-center gap-2">
              <Zap className="text-yellow-400 fill-yellow-400 w-6 h-6" />
              AI 漫画创作室 <span className="text-purple-500">PRO</span>
            </h1>
            <button onClick={() => { setApiKeyInput(apiKey); setJimengAccessKeyIdInput(jimengAccessKeyId); setJimengSecretAccessKeyInput(jimengSecretAccessKey); setShowApiKeyModal(true); }} className={`p-2 hover:bg-zinc-800 rounded-lg transition-all flex items-center gap-2 ${apiKey ? 'text-green-400' : 'text-zinc-500 hover:text-white'}`} title="API Key 设置">
              <Settings className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-zinc-500 mt-1 uppercase font-bold tracking-widest">大师创作版</p>
        </div>

        <div className="p-6 space-y-8">
          <section className={`${status === GenerationStatus.GENERATING || status === GenerationStatus.ANALYZING ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <Users className="w-4 h-4" /> 角色管理
              </h2>
              <div className="flex items-center gap-2">
                <button onClick={() => batchInputRef.current?.click()} className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors" title="批量导入角色图片">
                  <Upload className="w-5 h-5" /><input type="file" multiple ref={batchInputRef} className="hidden" accept="image/*" onChange={handleBatchUpload} />
                </button>
                <button onClick={addCharacter} className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors" title="添加单个角色"><Plus className="w-5 h-5" /></button>
                {characters.length > 0 && (
                  <button onClick={deleteAllCharacters} className="p-1.5 hover:bg-red-900/30 rounded-lg text-zinc-400 hover:text-red-400 transition-colors" title="清空所有角色">
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-3">
              {characters.map(char => (
                <div key={char.id} className="group p-4 rounded-2xl bg-zinc-800/40 border border-zinc-800 hover:border-zinc-700 transition-all">
                  <div className="flex gap-4 mb-3">
                    <label htmlFor={`upload-${char.id}`} className="w-16 h-16 rounded-xl bg-zinc-900 border border-zinc-700 flex-shrink-0 relative overflow-hidden group/img cursor-pointer block">
                      {char.referenceImage ? <img src={char.referenceImage} className="w-full h-full object-cover" alt={char.name} /> : <div className="w-full h-full flex items-center justify-center text-zinc-600"><ImageIcon className="w-6 h-6" /></div>}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/img:opacity-100 flex items-center justify-center text-[10px] font-bold transition-opacity text-white">上传</div>
                      <input type="file" id={`upload-${char.id}`} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(char.id, e)} />
                    </label>
                    <div className="flex-1 space-y-2">
                      <input className="w-full bg-transparent border-none p-0 text-sm font-bold text-white focus:ring-0 placeholder:text-zinc-600 outline-none" value={char.name} onChange={(e) => updateCharacter(char.id, { name: e.target.value })} />
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-zinc-500 uppercase">种子: {char.seed}</span>
                        <button onClick={() => updateCharacter(char.id, { seed: Math.floor(Math.random() * 99999) })} className="p-1 rounded bg-zinc-800 hover:bg-zinc-700" title="随机化种子"><RefreshCw className="w-3 h-3 text-zinc-400" /></button>
                      </div>
                    </div>
                    <button onClick={() => removeCharacter(char.id)} className="h-fit opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/10 hover:text-red-500 text-zinc-600 transition-all"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <textarea className="w-full bg-zinc-900/50 rounded-xl border border-zinc-700 p-2 text-xs text-zinc-300 focus:border-purple-500 outline-none resize-none h-16 transition-all" placeholder="视觉特征 (发色、眼神、服装...)" value={char.description} onChange={(e) => updateCharacter(char.id, { description: e.target.value })} />
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2"><FileText className="w-4 h-4" /> 故事剧本</h2>
              <div className="flex items-center gap-2 bg-zinc-800/50 px-2 py-1 rounded-lg border border-zinc-700" title="分镜数量">
                <Hash className="w-3 h-3 text-zinc-500" />
                <input type="number" className="w-8 bg-transparent border-none p-0 text-xs font-bold text-white focus:ring-0 outline-none" value={frameCount} onChange={(e) => setFrameCount(Math.max(1, parseInt(e.target.value) || 1))} />
              </div>
            </div>
            <textarea
              disabled={status === GenerationStatus.GENERATING || status === GenerationStatus.ANALYZING}
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 text-sm text-zinc-200 h-48 focus:border-purple-500 outline-none leading-relaxed transition-all disabled:opacity-50"
              placeholder="请输入分镜剧本..."
              value={script}
              onChange={(e) => { setScript(e.target.value); setLastError(null); }} />


            <button
              disabled={status === GenerationStatus.ANALYZING || status === GenerationStatus.GENERATING}
              onClick={startGeneration}
              className="w-full py-4 mt-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 rounded-2xl font-black italic tracking-tight text-white shadow-xl shadow-purple-900/20 disabled:opacity-50 flex items-center justify-center gap-3 transition-all active:scale-95">
              {status === GenerationStatus.GENERATING ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
              {status === GenerationStatus.ANALYZING ? '正在分析剧本...' : status === GenerationStatus.GENERATING ? '正在绘制分镜...' : '开始生成漫画'}
            </button>
          </section>
        </div>
      </aside>

      <main className="flex-1 bg-[#09090b] relative flex flex-col overflow-hidden">
        <header className="h-20 border-b border-zinc-800 flex items-center justify-between px-8 bg-zinc-900/20 backdrop-blur-md">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2"><Layout className="w-5 h-5 text-purple-500" /><span className="font-bold text-white tracking-tight">创作画布</span></div>
            <div className="h-4 w-px bg-zinc-800"></div>
            <div className="flex items-center gap-4">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">分镜: {panels.length}</span>
              {detectedStyle && <span className="text-[10px] bg-purple-500/10 text-purple-400 px-3 py-1 rounded-full border border-purple-500/20 font-bold uppercase">风格: {detectedStyle}</span>}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {status === GenerationStatus.GENERATING || status === GenerationStatus.ANALYZING ? (
              <button
                onClick={handlePauseGeneration}
                disabled={status === GenerationStatus.ANALYZING}
                className={`px-6 py-2.5 rounded-xl font-bold text-white shadow-lg shadow-orange-900/20 flex items-center justify-center gap-2 transition-all active:scale-95 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 ${status === GenerationStatus.ANALYZING ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <Zap className="w-4 h-4" />
                {status === GenerationStatus.ANALYZING ? '分镜中' : '暂停'}
              </button>
            ) : status === GenerationStatus.PAUSED ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={resumeGeneration}
                  className="px-6 py-2.5 rounded-xl font-bold text-white shadow-lg shadow-purple-900/20 flex items-center justify-center gap-2 transition-all active:scale-95 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500">
                  <Play className="w-4 h-4 fill-current" />
                  继续 ({panels.filter(p => !!p.imageUrl).length}/{panels.length})
                </button>
              </div>
            ) : null}



            {panels.length > 0 && (
              <button
                onClick={handleClearTask}
                className="flex items-center gap-2 px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 hover:text-red-400 rounded-xl text-sm font-bold text-zinc-400 transition-all shadow-lg active:scale-95"
                title="清除任务">
                <Trash2 className="w-4 h-4" /> 清除
              </button>
            )}

            <div className="h-6 w-px bg-zinc-800"></div>

            <button
              disabled={!panels.some(p => !!p.imageUrl)}
              onClick={exportZip}
              className="flex items-center gap-2 px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded-xl text-sm font-bold text-white transition-all shadow-lg active:scale-95">
              <Package className="w-4 h-4" /> 导出 ZIP
            </button>
          </div>
        </header>

        {(status === GenerationStatus.GENERATING || status === GenerationStatus.ANALYZING || status === GenerationStatus.PAUSED) && (
          <div className="h-1 bg-zinc-800 w-full overflow-hidden">
            <div className={`h-full transition-all duration-1000 ${status === GenerationStatus.PAUSED ? 'bg-gradient-to-r from-orange-500 to-red-500' : 'bg-gradient-to-r from-purple-500 via-blue-500 to-purple-500'}`} style={{ width: `${progress}%` }} />
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
          {panels.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-700 space-y-4 opacity-50">
              <div className="w-32 h-32 rounded-full bg-zinc-900 border-4 border-dashed border-zinc-800 flex items-center justify-center"><ImageIcon className="w-12 h-12" /></div>
              <div className="text-center"><p className="text-xl font-bold text-zinc-500">画布当前为空</p><p className="text-sm">在左侧输入剧本并点击生成即可开始。</p></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8 pb-12">
              {panels.map((panel) => (
                <div
                  key={panel.id}
                  onClick={() => setActivePanelId(panel.id)}
                  className={`group relative aspect-[16/10] bg-zinc-900 rounded-[2rem] border-2 overflow-hidden cursor-pointer transition-all duration-300
                      ${activePanelId === panel.id ? 'border-purple-500 shadow-2xl shadow-purple-900/20 scale-[1.02] z-20' : 'border-zinc-800 hover:border-zinc-700 shadow-md'}`}>

                  <div className="absolute top-6 left-6 z-30 bg-black/80 backdrop-blur rounded-xl px-4 py-1.5 border border-white/10 flex items-center gap-2">
                    <span className="text-xs font-black italic tracking-tighter text-white">分镜 #{panel.index}</span>
                  </div>

                  <div className="w-full h-full relative overflow-hidden bg-zinc-950">
                    {panel.isGenerating ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950/80 backdrop-blur-sm z-20">
                        <RefreshCw className="w-10 h-10 text-purple-500 animate-spin" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">绘制中...</span>
                      </div>
                    ) : panel.imageUrl ? (
                      <img src={panel.imageUrl} className="w-full h-full object-cover animate-in fade-in duration-700" alt={`Panel ${panel.index}`} loading="lazy" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-zinc-800"><ImageIcon className="w-20 h-20" /></div>
                    )}
                  </div>

                  <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-black via-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                    <div className="flex gap-2 flex-wrap mb-4">
                      {panel.characterNames.map(name => (
                        <span key={name} className="px-3 py-1 bg-purple-600/20 border border-purple-500/40 text-[10px] font-bold text-purple-300 rounded-full uppercase">{name}</span>
                      ))}
                    </div>
                    <p className="text-sm text-zinc-300 line-clamp-2 leading-relaxed font-medium">{panel.prompt}</p>
                  </div>

                  <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2 z-30">
                    <button onClick={(e) => { e.stopPropagation(); if (panel.imageUrl) setZoomImageUrl(panel.imageUrl); }} className="p-3 bg-black/80 backdrop-blur rounded-2xl hover:bg-zinc-800 text-white border border-white/10 transition-all shadow-xl" title="放大查看"><Maximize2 className="w-5 h-5" /></button>
                    <button onClick={(e) => { e.stopPropagation(); downloadSinglePanel(panel); }} className="p-3 bg-black/80 backdrop-blur rounded-2xl hover:bg-zinc-800 text-white border border-white/10 transition-all shadow-xl" title="下载此分镜"><Download className="w-5 h-5" /></button>
                    <button onClick={(e) => { e.stopPropagation(); regeneratePanel(panel.id); }} className="p-3 bg-black/80 backdrop-blur rounded-2xl hover:bg-purple-600 text-white border border-white/10 transition-all shadow-xl" title="重新绘制"><RefreshCw className="w-5 h-5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="h-12 border-t border-zinc-900 bg-zinc-950 flex items-center justify-between px-8">
          <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
            <span className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${apiKey ? 'bg-green-500' : 'bg-red-500'}`} />
              API: {apiKey ? '已配置' : '未配置'}
            </span>
            <span className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${generationMode === ImageGenerationMode.JIMENG ? 'bg-orange-500' : 'bg-blue-500'}`} />
              模型: {generationMode === ImageGenerationMode.JIMENG ? '即梦 4.0' : 'GEMINI 2.5 FLASH IMAGE'}
            </span>
          </div>
          <div className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">AI COMIC STUDIO PRO • CREATIVE TOOL</div>
        </footer>
      </main>

      {/* 侧边编辑器 */}
      {
        activePanelId && (
          <div className="w-[450px] border-l border-zinc-800 bg-[#0c0c0e] flex flex-col z-40 animate-in slide-in-from-right duration-300 shadow-2xl overflow-y-auto custom-scrollbar">
            <div className="h-20 border-b border-zinc-800 flex items-center justify-between px-8 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-600/20 flex items-center justify-center text-purple-500 font-black italic">E</div>
                <h2 className="font-bold text-white uppercase tracking-tighter">分镜详情</h2>
              </div>
              <button onClick={() => setActivePanelId(null)} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-500 transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-8 space-y-10">
              {(() => {
                const panel = panels.find(p => p.id === activePanelId);
                if (!panel) return null;
                return (
                  <>
                    <section>
                      <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-4">分镜绑定的角色</h3>
                      <div className="grid grid-cols-2 gap-3">
                        {characters.map(char => {
                          const isBound = panel.characterNames.includes(char.name);
                          return (
                            <button
                              key={char.id}
                              onClick={() => toggleCharacterInPanel(panel.id, char.name)}
                              className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-xs font-bold
                                ${isBound ? 'bg-purple-600/10 border-purple-500/50 text-purple-400' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
                              {isBound ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                              {char.name}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-3 text-[10px] text-zinc-500 leading-relaxed italic">提示：更改绑定的角色后，请点击下方“立即重绘”以应用更改。</p>
                    </section>

                    <section>
                      <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-4">对应剧本</h3>
                      <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 italic text-zinc-400 text-sm leading-relaxed">"{panel.scriptContent}"</div>
                    </section>

                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest">生图提示词 (Prompt)</h3>
                        <button onClick={() => regeneratePanel(panel.id)} className="text-[10px] font-bold text-purple-400 hover:text-purple-300 uppercase underline">重置描述</button>
                      </div>
                      <textarea className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-sm text-white focus:border-purple-500 outline-none h-40 leading-relaxed transition-all" value={panel.prompt} onChange={(e) => setPanels(prev => prev.map(p => p.id === activePanelId ? { ...p, prompt: e.target.value } : p))} />
                      <button disabled={panel.isGenerating} onClick={() => regeneratePanel(panel.id, panel.prompt)} className="w-full mt-4 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-sm font-black italic text-white flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg">
                        {panel.isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 text-purple-500" />}
                        立即重绘此分镜
                      </button>
                    </section>

                    <section>
                      <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-6">变体库</h3>
                      <div className="grid grid-cols-1 gap-4">
                        {panel.variations.map((v, i) => (
                          <div key={i} onClick={() => setPanels(prev => prev.map(p => p.id === panel.id ? { ...p, imageUrl: v } : p))} className={`aspect-square rounded-2xl overflow-hidden border-2 cursor-pointer transition-all hover:scale-105 ${panel.imageUrl === v ? 'border-purple-500 ring-4 ring-purple-500/20' : 'border-zinc-800 opacity-60 hover:opacity-100'}`}>
                            <img src={v} className="w-full h-full object-cover" alt={`Variation ${i}`} loading="lazy" />
                          </div>
                        ))}
                      </div>
                    </section>
                  </>
                );
              })()}
            </div>
          </div>
        )
      }

    </div >
  );
};

export default App;
