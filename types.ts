
export interface Character {
  id: string;
  name: string;
  description: string;
  seed: number;
  referenceImage: string | null;
}

export interface Panel {
  id: string;
  index: number;
  prompt: string;
  scriptContent: string;
  characterNames: string[];
  imageUrl: string | null;
  variations: string[];
  isGenerating: boolean;
}

export enum GenerationStatus {
  IDLE = 'idle',
  ANALYZING = 'analyzing',
  GENERATING = 'generating',
  COMPLETE = 'complete',
  ERROR = 'error',
  PAUSED = 'paused'
}

export enum ImageGenerationMode {
  GEMINI = 'gemini',
  JIMENG = 'jimeng'
}

export type AspectRatio = '1:1' | '16:9' | '9:16';

export interface ProjectState {
  characters: Character[];
  panels: Panel[];
  script: string;
  frameCount: number;
  detectedStyle: string;
  generationMode?: ImageGenerationMode;
  aspectRatio?: AspectRatio;
}
