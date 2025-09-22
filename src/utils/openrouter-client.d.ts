declare module "@/utils/openrouter-client.js" {
  export class OpenRouterClient {
    constructor(apiKey: string);
    chat(
      model: string,
      messages: Array<{ role: string; content: string; name?: string }>,
      functions?: any[] | null,
      options?: Record<string, any>
    ): Promise<any>;
    chatWithStreaming(
      model: string,
      messages: Array<{ role: string; content: string; name?: string }>,
      functions: any[] | null,
      onChunk: ((choice: any) => void) | null,
      options?: Record<string, any> & { onUsage?: (usage: any) => void }
    ): Promise<void>;
    listModels(): Promise<any[]>;
    getModelInfo(modelId: string): Promise<any>;
    selectModelForTask(
      taskType: string,
      context?: Record<string, any>
    ): Promise<any>;
    estimateCost(
      model: any,
      inputTokens: number,
      outputTokens?: number
    ): {
      inputCost: number;
      outputCost: number;
      totalCost: number;
      currency: string;
    } | null;
    validateApiKey(): Promise<boolean>;
    getCredits(): Promise<{
      totalCredits: number;
      totalUsage: number;
      remaining: number;
    }>;
  }

  export const AUTOMATION_FUNCTIONS: any[];
  export const TODO_FUNCTIONS: any[];
  export const SUMMARIZER_FUNCTIONS: any[];
}
