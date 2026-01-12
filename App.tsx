
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
import { Character, Panel, GenerationStatus, ImageGenerationMode, AspectRatio } from './types';
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
  const [generationMode, setGenerationMode] = useState<ImageGenerationMode>(ImageGenerationMode.JIMENG);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');

  const batchInputRef = useRef<HTMLInputElement>(null);
  const shouldStopGeneration = useRef<boolean>(false);
  const generationAbortRef = useRef<AbortController | null>(null);

  const cancelInFlightGeneration = () => {
    try {
      generationAbortRef.current?.abort();
    } finally {
      generationAbortRef.current = null;
    }
  };

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
    localStorage.setItem('aspect_ratio', aspectRatio);
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
      // 关键：立刻取消正在进行中的 fetch 和即梦轮询（否则会继续打接口）
      cancelInFlightGeneration();
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
    // 页面刷新时不恢复之前的生成任务（comic_studio_zh_v1），只恢复配置项
    const savedApiKey = localStorage.getItem('comic_api_key');
    if (savedApiKey) setApiKey(savedApiKey);
    const savedJimengAccessKeyId = localStorage.getItem('jimeng_access_key_id');
    if (savedJimengAccessKeyId) setJimengAccessKeyId(savedJimengAccessKeyId);
    const savedJimengSecretAccessKey = localStorage.getItem('jimeng_secret_access_key');
    if (savedJimengSecretAccessKey) setJimengSecretAccessKey(savedJimengSecretAccessKey);
    const savedGenerationMode = localStorage.getItem('generation_mode');
    if (savedGenerationMode) setGenerationMode(savedGenerationMode as ImageGenerationMode);
    const savedAspectRatio = localStorage.getItem('aspect_ratio');
    if (savedAspectRatio) setAspectRatio(savedAspectRatio as AspectRatio);
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

  const processPanelGeneration = async (
    currentPanels: Panel[],
    startIndex: number,
    style: string,
    signal?: AbortSignal
  ) => {
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
        if (signal?.aborted) {
          // 清除/取消时静默退出，避免覆盖 UI 状态
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
          const variations = await generatePanelImageUnified(
            p.prompt,
            style,
            panelChars,
            prevImage,
            1,
            generationMode,
            signal,
            aspectRatio
          );



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
          if (signal?.aborted) {
            return;
          }
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
      if (signal?.aborted) {
        return;
      }
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
      cancelInFlightGeneration();
      const controller = new AbortController();
      generationAbortRef.current = controller;

      const analysis = await analyzeScript(script, frameCount, characters, controller.signal);
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

      await processPanelGeneration(skeletonPanels, 0, analysis.visual_style, controller.signal);

    } catch (error) {
      // 清除/取消触发的 Abort 不视为错误
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
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
    cancelInFlightGeneration();
    const controller = new AbortController();
    generationAbortRef.current = controller;
    await processPanelGeneration([...panels], startIndex, detectedStyle, controller.signal);
  };

  const regeneratePanel = async (panelId: string, customPrompt?: string) => {
    const targetPanel = panels.find(p => p.id === panelId);
    if (!targetPanel) return;
    setPanels(prev => prev.map(p => p.id === panelId ? { ...p, isGenerating: true } : p));
    try {
      cancelInFlightGeneration();
      const controller = new AbortController();
      generationAbortRef.current = controller;

      const panelChars = characters.filter(c => targetPanel.characterNames.includes(c.name));
      const idx = panels.indexOf(targetPanel);
      const prevImage = idx > 0 ? panels[idx - 1].imageUrl : null;
      // 生成 1 张图片
      const variations = await generatePanelImageUnified(
        customPrompt || targetPanel.prompt,
        detectedStyle || "经典漫画",
        panelChars,
        prevImage,
        1,
        generationMode,
        controller.signal,
        aspectRatio
      );
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
      if (e instanceof DOMException && e.name === "AbortError") {
        // 清除/取消时静默
        setPanels(prev => prev.map(p => p.id === panelId ? { ...p, isGenerating: false } : p));
        return;
      }
      console.error("重绘出错:", e);
      const errorMessage = e instanceof Error ? e.message : "未知错误";
      showToast(`重绘失败: ${errorMessage}`, "error");
      setPanels(prev => prev.map(p => p.id === panelId ? { ...p, isGenerating: false } : p));
    }
  };

  const downloadSinglePanel = async (panel: Panel) => {
    if (!panel.imageUrl) return;
    
    try {
      showToast(`正在准备下载分镜 #${panel.index}...`, "info");
      
      let downloadUrl = panel.imageUrl;
      let extension = "png";

      if (panel.imageUrl.startsWith('http')) {
        const response = await fetch(panel.imageUrl, { mode: 'cors' });
        if (!response.ok) throw new Error(`下载失败: ${response.status}`);
        const blob = await response.blob();
        downloadUrl = URL.createObjectURL(blob);
        
        if (blob.type === "image/jpeg") extension = "jpg";
        else if (blob.type === "image/webp") extension = "webp";
      } else if (panel.imageUrl.startsWith('data:image')) {
         const header = panel.imageUrl.split(';')[0];
         if (header.includes('jpeg')) extension = "jpg";
         else if (header.includes('webp')) extension = "webp";
      }

      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `Panel_${panel.index}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      if (downloadUrl.startsWith('blob:')) {
        URL.revokeObjectURL(downloadUrl);
      }
      
      showToast(`分镜 #${panel.index} 下载成功`, "success");
    } catch (error) {
      console.error("下载图片失败:", error);
      showToast("下载图片失败，尝试直接打开", "error");
      // 降级处理：如果 fetch 失败，尝试直接打开
      window.open(panel.imageUrl, '_blank');
    }
  };

  const exportZip = async () => {
    if (panels.length === 0) return showToast("没有可导出的内容。", "info");
    
    showToast("正在下载并打包图片，请稍候...", "info");
    
    try {
      const zip = new JSZip();
      const folder = zip.folder("comic_studio_export");
      
      // 并行处理所有图片下载/添加
      await Promise.all(panels.map(async (p, i) => {
        if (!p.imageUrl) return;
        
        // 尝试从 Content-Type 或 URL 后缀获取正确的文件扩展名，默认为 png
        let extension = "png";
        
        try {
          if (p.imageUrl.startsWith('http')) {
            // 处理网络图片 URL
            const response = await fetch(p.imageUrl, { mode: 'cors' });
            if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
            const blob = await response.blob();
            
            // 尝试从 blob type 获取后缀
            if (blob.type === "image/jpeg") extension = "jpg";
            else if (blob.type === "image/webp") extension = "webp";
            
            folder?.file(`Panel_${p.index}.${extension}`, blob);
          } else if (p.imageUrl.startsWith('data:image')) {
            // 处理 Base64
            // data:image/png;base64,.....
            const header = p.imageUrl.split(';')[0];
            if (header.includes('jpeg')) extension = "jpg";
            else if (header.includes('webp')) extension = "webp";
            
            const base64Data = p.imageUrl.split(',')[1];
            folder?.file(`Panel_${p.index}.${extension}`, base64Data, { base64: true });
          }
        } catch (err) {
          console.error(`分镜 ${p.index} 图片导出失败:`, err);
          // 可以选择创建一个包含错误信息的文本文件代替图片
          folder?.file(`Panel_${p.index}_ERROR.txt`, `Export failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }));

      zip.file("project_info.txt", `Style: ${detectedStyle}\n\nScript:\n${script}`);
      
      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(content);
      link.download = `Comic_Project_${new Date().getTime()}.zip`;
      link.click();
      showToast("项目已打包下载", "success");
    } catch (error) {
      console.error("导出 ZIP 流程发生错误", error);
      showToast("导出失败，请检查网络或控制台日志", "error");
    }
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-[#0a0a0d] via-[#0f0f14] to-[#0d0d12] text-gray-200 selection:bg-purple-500/30">

      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-xl flex items-center gap-3 animate-in slide-in-from-top-4 fade-in duration-300
          ${toast.type === 'error' ? 'bg-red-950/90 border-red-700/50 text-red-100 shadow-red-950/50' :
            toast.type === 'success' ? 'bg-emerald-950/90 border-emerald-700/50 text-emerald-100 shadow-emerald-950/50' :
              'bg-indigo-950/90 border-indigo-700/50 text-indigo-100 shadow-indigo-950/50'}`}>
          <div className={`p-1.5 rounded-lg ${toast.type === 'error' ? 'bg-red-500/20' : toast.type === 'success' ? 'bg-emerald-500/20' : 'bg-indigo-500/20'}`}>
            {toast.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          </div>
          <span className="font-semibold text-sm tracking-tight">{toast.message}</span>
        </div>
      )}

      {showApiKeyModal && (
        <div className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-700/50 rounded-3xl p-8 w-full max-w-md shadow-2xl shadow-black/50 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-xl font-bold text-white flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20">
                  <Settings className="w-5 h-5 text-purple-400" />
                </div>
                API Key 设置
              </h3>
              <button onClick={() => setShowApiKeyModal(false)} className="p-2 hover:bg-zinc-800/80 rounded-xl text-zinc-500 hover:text-zinc-300 transition-all duration-200">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-7">
              <div className="group">
                <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest block mb-3">Gemini API Key</label>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="请输入 Gemini API Key"
                  className="w-full bg-zinc-950/80 border border-zinc-700/60 rounded-xl p-3.5 text-white text-sm focus:border-purple-500/70 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all duration-200 placeholder:text-zinc-600"
                />
                <p className="text-[11px] text-zinc-500 mt-2.5 leading-relaxed">用于分镜分析和图像生成</p>
              </div>
              <div className="space-y-5 p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800/50">
                <div>
                  <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest block mb-3">即梦 4.0 Access Key ID</label>
                  <input
                    type="text"
                    value={jimengAccessKeyIdInput}
                    onChange={(e) => setJimengAccessKeyIdInput(e.target.value)}
                    placeholder="请输入 Access Key ID"
                    className="w-full bg-zinc-950/80 border border-zinc-700/60 rounded-xl p-3.5 text-white text-sm focus:border-purple-500/70 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all duration-200 placeholder:text-zinc-600"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest block mb-3">即梦 4.0 Secret Access Key</label>
                  <input
                    type="password"
                    value={jimengSecretAccessKeyInput}
                    onChange={(e) => setJimengSecretAccessKeyInput(e.target.value)}
                    placeholder="请输入 Secret Access Key"
                    className="w-full bg-zinc-950/80 border border-zinc-700/60 rounded-xl p-3.5 text-white text-sm focus:border-purple-500/70 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all duration-200 placeholder:text-zinc-600"
                  />
                  <p className="text-[11px] text-zinc-500 mt-2.5 leading-relaxed">用于图像生成（可选）</p>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest block mb-4">图像生成方式</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setGenerationMode(ImageGenerationMode.GEMINI)}
                    className={`p-4 rounded-xl border-2 transition-all duration-200 text-left group ${
                      generationMode === ImageGenerationMode.GEMINI
                        ? 'border-purple-500/70 bg-gradient-to-br from-purple-500/15 to-blue-500/10 shadow-lg shadow-purple-500/10'
                        : 'border-zinc-700/60 bg-zinc-900/60 hover:border-zinc-600 hover:bg-zinc-800/60'
                    }`}
                  >
                    <div className={`font-bold mb-1.5 transition-colors ${generationMode === ImageGenerationMode.GEMINI ? 'text-purple-200' : 'text-white'}`}>Gemini</div>
                    <div className="text-[11px] text-zinc-500">Google AI 模型</div>
                  </button>
                  <button
                    onClick={() => setGenerationMode(ImageGenerationMode.JIMENG)}
                    className={`p-4 rounded-xl border-2 transition-all duration-200 text-left group ${
                      generationMode === ImageGenerationMode.JIMENG
                        ? 'border-purple-500/70 bg-gradient-to-br from-purple-500/15 to-blue-500/10 shadow-lg shadow-purple-500/10'
                        : 'border-zinc-700/60 bg-zinc-900/60 hover:border-zinc-600 hover:bg-zinc-800/60'
                    }`}
                  >
                    <div className={`font-bold mb-1.5 transition-colors ${generationMode === ImageGenerationMode.JIMENG ? 'text-purple-200' : 'text-white'}`}>即梦 4.0</div>
                    <div className="text-[11px] text-zinc-500">火山引擎模型</div>
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500 mt-3.5 leading-relaxed">选择用于生成分镜图像的 AI 模型</p>
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest block mb-4">出图比例</label>
                <div className="grid grid-cols-3 gap-3">
                  {(['1:1', '16:9', '9:16'] as AspectRatio[]).map((ratio) => (
                    <button
                      key={ratio}
                      onClick={() => setAspectRatio(ratio)}
                      className={`p-3 rounded-xl border-2 transition-all duration-200 text-center font-bold text-sm ${
                        aspectRatio === ratio
                          ? 'border-purple-500/70 bg-purple-500/10 text-purple-200 shadow-lg shadow-purple-500/10'
                          : 'border-zinc-700/60 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800/60 hover:text-white'
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-500 mt-3.5 leading-relaxed">设置生成图像的宽高比（仅对支持的模型生效）</p>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={handleSaveApiKey} className="flex-1 py-3.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 rounded-xl font-bold text-white transition-all duration-200 shadow-lg shadow-purple-900/30 hover:shadow-purple-900/40 hover:scale-[1.02] active:scale-[0.98]">
                  保存设置
                </button>
                {(apiKey || jimengAccessKeyId || jimengSecretAccessKey) && (
                  <button onClick={() => { handleClearApiKey(); handleClearJimengApiKey(); }} className="py-3.5 px-6 bg-zinc-800/80 hover:bg-red-950/50 border border-zinc-700/50 hover:border-red-700/50 rounded-xl font-bold text-zinc-400 hover:text-red-400 transition-all duration-200">
                    清除
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
          className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-sm flex items-center justify-center p-6 cursor-zoom-out animate-in fade-in duration-200"
          onClick={() => setZoomImageUrl(null)}>
          <button className="absolute top-8 right-8 p-3 rounded-2xl bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-all duration-200">
            <X className="w-8 h-8" />
          </button>
          <img
            src={zoomImageUrl}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-2xl shadow-2xl shadow-black/50 ring-1 ring-white/10 animate-in zoom-in-95 duration-300"
            alt="Zoomed View" />
        </div>
      )}

      {/* 侧边控制面板 */}
      <aside className="w-[380px] border-r border-zinc-800/60 bg-gradient-to-b from-zinc-900/70 via-zinc-900/50 to-zinc-950/60 backdrop-blur-xl flex flex-col custom-scrollbar overflow-y-auto z-10 shadow-2xl shadow-black/20">
        <div className="p-6 border-b border-zinc-800/60 bg-gradient-to-r from-zinc-900/80 to-zinc-950/60">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-black text-white italic tracking-tighter comic-font flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-yellow-400/20 to-orange-500/20 border border-yellow-500/20">
                <Zap className="text-yellow-400 fill-yellow-400 w-5 h-5" />
              </div>
              AI 漫画创作室 <span className="bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">PRO</span>
            </h1>
            <button onClick={() => { setApiKeyInput(apiKey); setJimengAccessKeyIdInput(jimengAccessKeyId); setJimengSecretAccessKeyInput(jimengSecretAccessKey); setShowApiKeyModal(true); }} className={`p-2.5 rounded-xl transition-all duration-200 flex items-center gap-2 border ${apiKey ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20' : 'text-zinc-500 hover:text-white bg-zinc-800/50 border-zinc-700/50 hover:bg-zinc-800'}`} title="API Key 设置">
              <Settings className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-zinc-500 mt-2 uppercase font-bold tracking-[0.2em]">大师创作版</p>
        </div>

        <div className="p-6 space-y-8">
          <section className={`${status === GenerationStatus.GENERATING || status === GenerationStatus.ANALYZING ? 'opacity-40 pointer-events-none' : ''} transition-opacity duration-300`}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-400 flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-zinc-800/80 border border-zinc-700/50">
                  <Users className="w-3.5 h-3.5" />
                </div>
                角色管理
              </h2>
              <div className="flex items-center gap-1.5">
                <button onClick={() => batchInputRef.current?.click()} className="p-2 hover:bg-zinc-800/80 rounded-xl text-zinc-500 hover:text-white transition-all duration-200 border border-transparent hover:border-zinc-700/50" title="批量导入角色图片">
                  <Upload className="w-4 h-4" /><input type="file" multiple ref={batchInputRef} className="hidden" accept="image/*" onChange={handleBatchUpload} />
                </button>
                <button onClick={addCharacter} className="p-2 hover:bg-purple-500/10 rounded-xl text-zinc-500 hover:text-purple-400 transition-all duration-200 border border-transparent hover:border-purple-500/30" title="添加单个角色"><Plus className="w-4 h-4" /></button>
                {characters.length > 0 && (
                  <button onClick={deleteAllCharacters} className="p-2 hover:bg-red-500/10 rounded-xl text-zinc-500 hover:text-red-400 transition-all duration-200 border border-transparent hover:border-red-500/30" title="清空所有角色">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-3">
              {characters.map(char => (
                <div key={char.id} className="group p-4 rounded-2xl bg-gradient-to-br from-zinc-800/50 to-zinc-900/50 border border-zinc-700/40 hover:border-zinc-600/60 hover:from-zinc-800/60 hover:to-zinc-900/60 transition-all duration-300 shadow-lg shadow-black/10 hover:shadow-black/20">
                  <div className="flex gap-4 mb-3">
                    <label htmlFor={`upload-${char.id}`} className="w-16 h-16 rounded-xl bg-zinc-950/60 border border-zinc-700/50 flex-shrink-0 relative overflow-hidden group/img cursor-pointer block ring-2 ring-transparent hover:ring-purple-500/30 transition-all duration-200">
                      {char.referenceImage ? <img src={char.referenceImage} className="w-full h-full object-cover" alt={char.name} /> : <div className="w-full h-full flex items-center justify-center text-zinc-700"><ImageIcon className="w-6 h-6" /></div>}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover/img:opacity-100 flex items-end justify-center pb-2 text-[9px] font-bold transition-all duration-200 text-white/90">上传</div>
                      <input type="file" id={`upload-${char.id}`} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(char.id, e)} />
                    </label>
                    <div className="flex-1 space-y-2.5">
                      <input className="w-full bg-transparent border-none p-0 text-sm font-bold text-white focus:ring-0 placeholder:text-zinc-600 outline-none" value={char.name} onChange={(e) => updateCharacter(char.id, { name: e.target.value })} />
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wide px-2 py-0.5 bg-zinc-900/60 rounded-md border border-zinc-800/60">种子: {char.seed}</span>
                        <button onClick={() => updateCharacter(char.id, { seed: Math.floor(Math.random() * 99999) })} className="p-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-700/80 border border-zinc-700/40 hover:border-zinc-600/60 transition-all duration-200" title="随机化种子"><RefreshCw className="w-3 h-3 text-zinc-400" /></button>
                      </div>
                    </div>
                    <button onClick={() => removeCharacter(char.id)} className="h-fit opacity-0 group-hover:opacity-100 p-2 hover:bg-red-500/15 hover:text-red-400 text-zinc-600 rounded-xl transition-all duration-200 border border-transparent hover:border-red-500/30"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <textarea className="w-full bg-zinc-950/50 rounded-xl border border-zinc-700/40 p-3 text-xs text-zinc-300 focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/10 outline-none resize-none h-16 transition-all duration-200 placeholder:text-zinc-600" placeholder="视觉特征 (发色、眼神、服装...)" value={char.description} onChange={(e) => updateCharacter(char.id, { description: e.target.value })} />
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-400 flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-zinc-800/80 border border-zinc-700/50">
                  <FileText className="w-3.5 h-3.5" />
                </div>
                故事剧本
              </h2>
              <div className="flex items-center gap-2 bg-zinc-800/60 px-3 py-1.5 rounded-xl border border-zinc-700/50 shadow-inner shadow-black/20" title="分镜数量">
                <Hash className="w-3 h-3 text-zinc-500" />
                <input type="number" className="w-8 bg-transparent border-none p-0 text-xs font-bold text-white focus:ring-0 outline-none" value={frameCount} onChange={(e) => setFrameCount(Math.max(1, parseInt(e.target.value) || 1))} />
                <span className="text-[10px] text-zinc-600 font-medium">帧</span>
              </div>
            </div>
            <textarea
              disabled={status === GenerationStatus.GENERATING || status === GenerationStatus.ANALYZING}
              className="w-full bg-gradient-to-b from-zinc-900/60 to-zinc-950/60 border border-zinc-700/40 rounded-2xl p-4 text-sm text-zinc-200 h-48 focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/10 outline-none leading-relaxed transition-all duration-200 disabled:opacity-40 placeholder:text-zinc-600 shadow-inner shadow-black/10"
              placeholder="请输入分镜剧本..."
              value={script}
              onChange={(e) => { setScript(e.target.value); setLastError(null); }} />


            <button
              disabled={status === GenerationStatus.ANALYZING || status === GenerationStatus.GENERATING}
              onClick={startGeneration}
              className="w-full py-4 mt-2 bg-gradient-to-r from-purple-600 via-purple-600 to-blue-600 hover:from-purple-500 hover:via-purple-500 hover:to-blue-500 rounded-2xl font-black italic tracking-tight text-white shadow-xl shadow-purple-900/30 disabled:opacity-40 disabled:shadow-none flex items-center justify-center gap-3 transition-all duration-300 active:scale-[0.98] border border-purple-500/20 hover:border-purple-400/30 hover:shadow-2xl hover:shadow-purple-900/40 group">
              {status === GenerationStatus.GENERATING ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />}
              {status === GenerationStatus.ANALYZING ? '正在分析剧本...' : status === GenerationStatus.GENERATING ? '正在绘制分镜...' : '开始生成漫画'}
            </button>
          </section>
        </div>
      </aside>

      <main className="flex-1 bg-gradient-to-br from-[#08080a] via-[#0a0a0d] to-[#0c0c10] relative flex flex-col overflow-hidden">
        <header className="h-20 border-b border-zinc-800/50 flex items-center justify-between px-8 bg-gradient-to-r from-zinc-900/40 via-zinc-900/20 to-zinc-900/40 backdrop-blur-xl shadow-lg shadow-black/10">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20 shadow-lg shadow-purple-500/10">
                <Layout className="w-4 h-4 text-purple-400" />
              </div>
              <span className="font-bold text-white tracking-tight">创作画布</span>
            </div>
            <div className="h-6 w-px bg-gradient-to-b from-transparent via-zinc-700/50 to-transparent"></div>
            <div className="flex items-center gap-4">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-600"></span>
                分镜: {panels.length}
              </span>
              {detectedStyle && <span className="text-[10px] bg-gradient-to-r from-purple-500/15 to-blue-500/15 text-purple-300 px-4 py-1.5 rounded-full border border-purple-500/20 font-bold uppercase tracking-wide shadow-lg shadow-purple-500/10">风格: {detectedStyle}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {status === GenerationStatus.GENERATING || status === GenerationStatus.ANALYZING ? (
              <button
                onClick={handlePauseGeneration}
                disabled={status === GenerationStatus.ANALYZING}
                className={`px-6 py-2.5 rounded-xl font-bold text-white shadow-lg shadow-orange-900/30 flex items-center justify-center gap-2 transition-all duration-200 active:scale-95 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 border border-orange-500/30 hover:shadow-xl hover:shadow-orange-900/40 ${status === GenerationStatus.ANALYZING ? 'opacity-40 cursor-not-allowed' : ''}`}>
                <Zap className="w-4 h-4" />
                {status === GenerationStatus.ANALYZING ? '分镜中' : '暂停'}
              </button>
            ) : status === GenerationStatus.PAUSED ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={resumeGeneration}
                  className="px-6 py-2.5 rounded-xl font-bold text-white shadow-lg shadow-purple-900/30 flex items-center justify-center gap-2 transition-all duration-200 active:scale-95 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 border border-purple-500/30 hover:shadow-xl hover:shadow-purple-900/40">
                  <Play className="w-4 h-4 fill-current" />
                  继续 ({panels.filter(p => !!p.imageUrl).length}/{panels.length})
                </button>
              </div>
            ) : null}



            {panels.length > 0 && (
              <button
                onClick={handleClearTask}
                className="flex items-center gap-2 px-5 py-2.5 bg-zinc-800/80 hover:bg-red-950/50 border border-zinc-700/50 hover:border-red-700/40 rounded-xl text-sm font-bold text-zinc-400 hover:text-red-400 transition-all duration-200 shadow-lg active:scale-95"
                title="清除任务">
                <Trash2 className="w-4 h-4" /> 清除
              </button>
            )}

            <div className="h-6 w-px bg-gradient-to-b from-transparent via-zinc-700/50 to-transparent"></div>

            <button
              disabled={!panels.some(p => !!p.imageUrl)}
              onClick={exportZip}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-zinc-800/80 to-zinc-800/60 hover:from-zinc-700/80 hover:to-zinc-700/60 disabled:opacity-40 border border-zinc-700/50 hover:border-zinc-600/60 rounded-xl text-sm font-bold text-white transition-all duration-200 shadow-lg active:scale-95 disabled:shadow-none">
              <Package className="w-4 h-4" /> 导出 ZIP
            </button>
          </div>
        </header>

        {(status === GenerationStatus.GENERATING || status === GenerationStatus.ANALYZING || status === GenerationStatus.PAUSED) && (
          <div className="h-1.5 bg-zinc-900/80 w-full overflow-hidden shadow-inner">
            <div className={`h-full transition-all duration-700 ease-out ${status === GenerationStatus.PAUSED ? 'bg-gradient-to-r from-orange-500 via-red-500 to-orange-500' : 'bg-gradient-to-r from-purple-500 via-blue-500 to-purple-500'} shadow-lg ${status === GenerationStatus.PAUSED ? 'shadow-orange-500/50' : 'shadow-purple-500/50'}`} style={{ width: `${progress}%` }} />
          </div>
        )}

        {/* 画布等待弹框：仅在“分析分镜结构”阶段显示，不影响后续逐张出图 */}
        {status === GenerationStatus.ANALYZING && (
          <div className="absolute inset-x-0 top-20 bottom-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
            <div className="w-full max-w-md mx-6 rounded-3xl border border-zinc-700/60 bg-gradient-to-b from-zinc-900/95 to-zinc-950/95 shadow-2xl shadow-purple-900/20 p-8 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
              <div className="flex items-start gap-5">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600/20 to-blue-600/20 border border-purple-500/30 flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/10">
                  <RefreshCw className="w-7 h-7 text-purple-400 animate-spin" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-black text-white tracking-tight">正在生成分镜</h3>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400 bg-purple-500/10 px-2.5 py-1 rounded-lg border border-purple-500/20">
                      {Math.round(Math.max(0, Math.min(100, progress)))}%
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
                    正在拆解剧情并生成分镜结构，请稍候…
                  </p>
                </div>
              </div>

              <div className="mt-8">
                <div className="h-2.5 bg-zinc-800/80 rounded-full overflow-hidden border border-zinc-700/40 shadow-inner shadow-black/30">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 via-blue-500 to-purple-500 transition-all duration-500 ease-out shadow-lg shadow-purple-500/50"
                    style={{ width: `${Math.round(Math.max(0, Math.min(100, progress)))}%` }}
                  />
                </div>
                <div className="mt-4 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  <span>画布处理中</span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse shadow-lg shadow-purple-500/50" />
                    <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse shadow-lg shadow-purple-500/50" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse shadow-lg shadow-purple-500/50" style={{ animationDelay: "300ms" }} />
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-10 custom-scrollbar bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900/20 via-transparent to-transparent">
          {panels.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-700 space-y-6">
              <div className="relative">
                <div className="w-36 h-36 rounded-full bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 border-2 border-dashed border-zinc-700/50 flex items-center justify-center shadow-2xl shadow-black/30">
                  <ImageIcon className="w-14 h-14 text-zinc-600" />
                </div>
                <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30 flex items-center justify-center">
                  <Wand2 className="w-4 h-4 text-purple-400" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <p className="text-xl font-bold text-zinc-400 tracking-tight">画布当前为空</p>
                <p className="text-sm text-zinc-600 max-w-xs leading-relaxed">在左侧输入剧本并点击生成即可开始创作您的漫画作品</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 pb-12">
              {panels.map((panel) => (
                <div
                  key={panel.id}
                  onClick={() => setActivePanelId(panel.id)}
                  className={`group relative aspect-square rounded-[1.75rem] border-2 overflow-hidden cursor-pointer transition-all duration-300 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80
                      ${activePanelId === panel.id ? 'border-purple-500/80 shadow-2xl shadow-purple-500/20 scale-[1.02] z-20 ring-4 ring-purple-500/10' : 'border-zinc-700/40 hover:border-zinc-600/60 shadow-xl shadow-black/30 hover:shadow-2xl hover:shadow-black/40'}`}>

                  <div className="absolute top-5 left-5 z-30 bg-black/70 backdrop-blur-xl rounded-xl px-4 py-2 border border-white/10 flex items-center gap-2 shadow-lg">
                    <span className="text-xs font-black italic tracking-tight text-white">分镜 #{panel.index}</span>
                  </div>

                  <div className="w-full h-full relative overflow-hidden bg-gradient-to-br from-zinc-950 to-black">
                    {panel.isGenerating ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-zinc-950/90 backdrop-blur-sm z-20">
                        <div className="p-4 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30">
                          <RefreshCw className="w-8 h-8 text-purple-400 animate-spin" />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">绘制中...</span>
                      </div>
                    ) : panel.imageUrl ? (
                      <img
                        src={panel.imageUrl}
                        className="w-full h-full object-contain animate-in fade-in duration-500"
                        alt={`Panel ${panel.index}`}
                        loading="lazy"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <ImageIcon className="w-16 h-16 text-zinc-800" />
                      </div>
                    )}
                  </div>

                  <div className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-black via-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none translate-y-2 group-hover:translate-y-0">
                    <div className="flex gap-2 flex-wrap mb-3">
                      {panel.characterNames.map(name => (
                        <span key={name} className="px-3 py-1.5 bg-gradient-to-r from-purple-600/25 to-blue-600/25 border border-purple-500/30 text-[10px] font-bold text-purple-200 rounded-lg uppercase tracking-wide shadow-lg shadow-purple-500/10">{name}</span>
                      ))}
                    </div>
                    <p className="text-sm text-zinc-300 line-clamp-2 leading-relaxed font-medium">{panel.prompt}</p>
                  </div>

                  <div className="absolute top-5 right-5 opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col gap-2 z-30 translate-x-2 group-hover:translate-x-0">
                    <button onClick={(e) => { e.stopPropagation(); if (panel.imageUrl) setZoomImageUrl(panel.imageUrl); }} className="p-2.5 bg-black/70 backdrop-blur-xl rounded-xl hover:bg-zinc-800/90 text-white/80 hover:text-white border border-white/10 hover:border-white/20 transition-all duration-200 shadow-xl hover:scale-105" title="放大查看"><Maximize2 className="w-4 h-4" /></button>
                    <button onClick={(e) => { e.stopPropagation(); downloadSinglePanel(panel); }} className="p-2.5 bg-black/70 backdrop-blur-xl rounded-xl hover:bg-zinc-800/90 text-white/80 hover:text-white border border-white/10 hover:border-white/20 transition-all duration-200 shadow-xl hover:scale-105" title="下载此分镜"><Download className="w-4 h-4" /></button>
                    <button onClick={(e) => { e.stopPropagation(); regeneratePanel(panel.id); }} className="p-2.5 bg-black/70 backdrop-blur-xl rounded-xl hover:bg-purple-600/90 text-white/80 hover:text-white border border-white/10 hover:border-purple-500/50 transition-all duration-200 shadow-xl hover:scale-105" title="重新绘制"><RefreshCw className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="h-14 border-t border-zinc-800/50 bg-gradient-to-r from-zinc-950/90 via-zinc-900/50 to-zinc-950/90 backdrop-blur-xl flex items-center justify-between px-8 shadow-lg shadow-black/10">
          <div className="flex items-center gap-5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            <span className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-zinc-900/50 border border-zinc-800/50">
              <div className={`w-2 h-2 rounded-full shadow-lg ${apiKey ? 'bg-emerald-500 shadow-emerald-500/50' : 'bg-red-500 shadow-red-500/50'}`} />
              API: {apiKey ? '已配置' : '未配置'}
            </span>
            <span className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-zinc-900/50 border border-zinc-800/50">
              <div className={`w-2 h-2 rounded-full shadow-lg ${generationMode === ImageGenerationMode.JIMENG ? 'bg-orange-500 shadow-orange-500/50' : 'bg-blue-500 shadow-blue-500/50'}`} />
              模型: {generationMode === ImageGenerationMode.JIMENG ? '即梦 4.0' : 'GEMINI 2.5 FLASH'}
            </span>
          </div>
          <div className="text-[10px] text-zinc-600 font-bold uppercase tracking-[0.2em] flex items-center gap-2">
            <span className="w-1 h-1 rounded-full bg-purple-500/50"></span>
            AI COMIC STUDIO PRO
            <span className="w-1 h-1 rounded-full bg-blue-500/50"></span>
          </div>
        </footer>
      </main>

      {/* 侧边编辑器 */}
      {
        activePanelId && (
          <div className="w-[450px] border-l border-zinc-800/50 bg-gradient-to-b from-[#0c0c0e] to-[#09090b] flex flex-col z-40 animate-in slide-in-from-right duration-300 shadow-2xl shadow-black/50 overflow-y-auto custom-scrollbar">
            <div className="h-20 border-b border-zinc-800/50 flex items-center justify-between px-8 flex-shrink-0 bg-gradient-to-r from-zinc-900/50 to-transparent">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-600/25 to-blue-600/25 border border-purple-500/30 flex items-center justify-center text-purple-400 font-black italic shadow-lg shadow-purple-500/10">E</div>
                <h2 className="font-bold text-white uppercase tracking-tight">分镜详情</h2>
              </div>
              <button onClick={() => setActivePanelId(null)} className="p-2.5 hover:bg-zinc-800/80 rounded-xl text-zinc-500 hover:text-zinc-300 transition-all duration-200 border border-transparent hover:border-zinc-700/50"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-8 space-y-10">
              {(() => {
                const panel = panels.find(p => p.id === activePanelId);
                if (!panel) return null;
                return (
                  <>
                    <section>
                      <h3 className="text-xs font-black text-zinc-400 uppercase tracking-[0.15em] mb-5 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-purple-500"></div>
                        分镜绑定的角色
                      </h3>
                      <div className="grid grid-cols-2 gap-3">
                        {characters.map(char => {
                          const isBound = panel.characterNames.includes(char.name);
                          return (
                            <button
                              key={char.id}
                              onClick={() => toggleCharacterInPanel(panel.id, char.name)}
                              className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-200 text-xs font-bold
                                ${isBound ? 'bg-gradient-to-r from-purple-600/15 to-blue-600/15 border-purple-500/40 text-purple-300 shadow-lg shadow-purple-500/10' : 'bg-zinc-900/60 border-zinc-700/40 text-zinc-500 hover:border-zinc-600/60 hover:bg-zinc-800/60'}`}>
                              {isBound ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                              {char.name}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-4 text-[10px] text-zinc-500 leading-relaxed italic bg-zinc-900/30 p-3 rounded-lg border border-zinc-800/40">提示：更改绑定的角色后，请点击下方"立即重绘"以应用更改。</p>
                    </section>

                    <section>
                      <h3 className="text-xs font-black text-zinc-400 uppercase tracking-[0.15em] mb-5 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                        对应剧本
                      </h3>
                      <div className="p-5 rounded-2xl bg-gradient-to-br from-zinc-900/60 to-zinc-950/60 border border-zinc-700/40 italic text-zinc-400 text-sm leading-relaxed shadow-inner shadow-black/10">"{panel.scriptContent}"</div>
                    </section>

                    <section>
                      <div className="flex items-center justify-between mb-5">
                        <h3 className="text-xs font-black text-zinc-400 uppercase tracking-[0.15em] flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                          生图提示词 (Prompt)
                        </h3>
                        <button onClick={() => regeneratePanel(panel.id)} className="text-[10px] font-bold text-purple-400 hover:text-purple-300 uppercase px-2.5 py-1 rounded-lg hover:bg-purple-500/10 transition-all duration-200">重置描述</button>
                      </div>
                      <textarea className="w-full bg-gradient-to-b from-zinc-900/60 to-zinc-950/60 border border-zinc-700/40 rounded-2xl p-5 text-sm text-white focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/10 outline-none h-40 leading-relaxed transition-all duration-200 shadow-inner shadow-black/10" value={panel.prompt} onChange={(e) => setPanels(prev => prev.map(p => p.id === activePanelId ? { ...p, prompt: e.target.value } : p))} />
                      <button disabled={panel.isGenerating} onClick={() => regeneratePanel(panel.id, panel.prompt)} className="w-full mt-5 py-4 bg-gradient-to-r from-zinc-800/90 to-zinc-800/70 hover:from-zinc-700/90 hover:to-zinc-700/70 border border-zinc-700/50 hover:border-zinc-600/60 rounded-2xl text-sm font-black italic text-white flex items-center justify-center gap-3 transition-all duration-200 active:scale-[0.98] shadow-lg shadow-black/20 disabled:opacity-40">
                        {panel.isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 text-purple-400" />}
                        立即重绘此分镜
                      </button>
                    </section>

                    <section>
                      <h3 className="text-xs font-black text-zinc-400 uppercase tracking-[0.15em] mb-6 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>
                        变体库
                      </h3>
                      <div className="grid grid-cols-1 gap-4">
                        {panel.variations.map((v, i) => (
                          <div key={i} onClick={() => setPanels(prev => prev.map(p => p.id === panel.id ? { ...p, imageUrl: v } : p))} className={`aspect-square rounded-2xl overflow-hidden border-2 cursor-pointer transition-all duration-300 hover:scale-[1.02] ${panel.imageUrl === v ? 'border-purple-500/70 ring-4 ring-purple-500/20 shadow-lg shadow-purple-500/20' : 'border-zinc-700/40 opacity-60 hover:opacity-100 hover:border-zinc-600/60'}`}>
                            <img src={v} className="w-full h-full object-contain bg-zinc-950" alt={`Variation ${i}`} loading="lazy" />
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
