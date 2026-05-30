import { GoogleGenAI, Type } from "@google/genai";
import OpenAI from "openai";

let aiInstance: GoogleGenAI | null = null;
let openaiInstance: OpenAI | null = null;
let featherlessInstance: OpenAI | null = null;
const OPENAI_MAX_PROMPT_CHARS = 18000;

// Featherless uses OpenAI-compatible API — any model from their catalog can be set
// via FEATHERLESS_MODEL env var; falls back to a reliable instruction-following model.
const FEATHERLESS_MODEL = process.env.FEATHERLESS_MODEL || 'mistralai/Mistral-7B-Instruct-v0.3';

export type OrchestratorToolName = "analyze_document" | "fetch_market_data" | "compare_peers" | "synthesize_verdict" | "synthesize_knowledge";

export interface OrchestratorToolCall {
  name: OrchestratorToolName;
  arguments: {
    ticker?: string;
    options?: string[];
    context?: string;
    topic?: string;
    companyName?: string;
  };
}

export function getGemini(): GoogleGenAI {
  if (!aiInstance) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is missing. Please configure it.");
    }
    aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return aiInstance;
}

function getOpenAI(): OpenAI {
  if (!openaiInstance) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is missing. Gemini fallback is unavailable.");
    }
    openaiInstance = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      dangerouslyAllowBrowser: true
    });
  }
  return openaiInstance;
}

/**
 * Returns an OpenAI-compatible client pointed at the Featherless API.
 * Requires FEATHERLESS_API_KEY in environment.
 * Model is controlled by FEATHERLESS_MODEL env var (default: mistralai/Mistral-7B-Instruct-v0.3).
 */
function getFeatherless(): OpenAI {
  if (!featherlessInstance) {
    if (!process.env.FEATHERLESS_API_KEY) {
      throw new Error("FEATHERLESS_API_KEY is not set.");
    }
    featherlessInstance = new OpenAI({
      apiKey: process.env.FEATHERLESS_API_KEY,
      baseURL: 'https://api.featherless.ai/v1',
      dangerouslyAllowBrowser: true,
    });
  }
  return featherlessInstance;
}

/**
 * Runs a structured-JSON analysis via Featherless (OpenAI-compatible).
 * Uses chat.completions with json_object response_format and a schema hint in the system prompt.
 * Note: conductDialogueStep / planOrchestratorToolCalls always use OpenAI (need function calling).
 */
async function runFeatherlessFallback(
  prompt: string,
  schemaProperties: any,
  requiredFields: string[],
  fileBase64?: string
): Promise<any> {
  if (fileBase64) {
    console.info("Featherless provider: PDF attachment omitted (text-only model).");
  }

  const schemaHint = JSON.stringify(
    { type: 'object', required: requiredFields, properties: toJsonSchema(schemaProperties) },
    null, 2
  ).substring(0, 4000); // keep system prompt lean

  const client = getFeatherless();
  const response = await client.chat.completions.create({
    model: FEATHERLESS_MODEL,
    temperature: 0.1,
    max_tokens: 4000,
    response_format: { type: 'json_object' } as any,
    messages: [
      {
        role: 'system',
        content: `You are a structured financial analysis assistant. Always respond with valid JSON that strictly matches this schema:\n${schemaHint}`
      },
      {
        role: 'user',
        content: trimForOpenAI(prompt)
      }
    ]
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error('Empty response from Featherless');
  return JSON.parse(text);
}

function isGeminiFallbackError(error: unknown): boolean {
  const status = (error as any)?.status || (error as any)?.code;
  const message = String((error as any)?.message || error || "").toLowerCase();

  return (
    status === 401 ||
    status === 403 ||
    status === 429 ||
    message.includes("api key") ||
    message.includes("auth") ||
    message.includes("permission") ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("429")
  );
}

function toJsonSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(toJsonSchema);

  const converted: any = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, toJsonSchema(value)])
  );
  if (typeof converted.type === "string") {
    converted.type = converted.type.toLowerCase();
  }

  return converted;
}

function trimForOpenAI(prompt: string): string {
  if (prompt.length <= OPENAI_MAX_PROMPT_CHARS) return prompt;

  console.info(`OpenAI prompt trimmed from ${prompt.length} to ${OPENAI_MAX_PROMPT_CHARS} characters to stay below rate limits.`);
  return `${prompt.substring(0, OPENAI_MAX_PROMPT_CHARS)}

[Content truncated to stay within the current OpenAI tokens-per-minute limit.]`;
}

async function runOpenAIFallback(prompt: string, schemaProperties: any, requiredFields: string[], fileBase64?: string): Promise<any> {
  const openai = getOpenAI();
  const inputContent: any[] = [{ type: "input_text", text: trimForOpenAI(prompt) }];

  if (fileBase64) {
    console.info("OpenAI provider using extracted report text only; PDF attachment omitted to stay within context limits.");
  }

  const response = await openai.responses.create({
    model: "gpt-4o",
    max_output_tokens: 4000,
    input: [
      {
        role: "user",
        content: inputContent
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "echo_analysis",
        strict: false,
        schema: {
          type: "object",
          required: requiredFields,
          properties: toJsonSchema(schemaProperties)
        }
      }
    }
  } as any);

  const analysisText = response.output_text;
  if (!analysisText) throw new Error("Empty response from OpenAI fallback");
  return JSON.parse(analysisText);
}

// ─── Mode C: LLM-driven dialogue ────────────────────────────────────────────

export type DialogueStep =
  | { type: 'question'; content: string }
  | { type: 'plan'; ticker: string; companyName: string; aspects: string[]; needsPDF: boolean; planSummary: string };

/**
 * Takes the full conversation history and returns either a follow-up question
 * or a confirmed analysis plan, using OpenAI function calling.
 */
export async function conductDialogueStep(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<DialogueStep> {
  const openai = getOpenAI();

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: `You are Echo Orchestrator — an autonomous multi-agent financial intelligence system.
You specialise in:
- Financial report analysis (PDF annual reports, earnings releases)
- Listed company market data: valuation multiples, KPIs, peer comparison
- ESG profiles, investment highlights, strategic risks

Your role in this dialogue:
- Ask ONE focused question at a time to understand what the user wants to analyse.
- Collect: (1) company name or ticker symbol, (2) whether they have a PDF financial report, (3) which aspects matter most (valuation, ESG, risks, peer comparison).
- Be conversational, concise, and professional.
- Do NOT ask for information you already have. Do NOT ask multiple questions at once.
- After 2–4 exchanges, when you have enough information, call confirm_plan.
- If the user already gave you a ticker AND their desired aspects (or said "all"/"everything"), call confirm_plan immediately.`
      },
      ...messages
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'ask_followup',
          description: 'Ask the user a single clarifying question to collect missing information.',
          parameters: {
            type: 'object',
            required: ['question'],
            properties: {
              question: { type: 'string', description: 'The single question to ask' }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'confirm_plan',
          description: 'You have enough information. Present the analysis plan to the user for confirmation before running agents.',
          parameters: {
            type: 'object',
            required: ['ticker', 'companyName', 'aspects', 'needsPDF', 'planSummary'],
            properties: {
              ticker: { type: 'string', description: 'Best-guess Yahoo Finance ticker symbol (e.g. AAPL, 1810.HK)' },
              companyName: { type: 'string' },
              aspects: {
                type: 'array',
                items: { type: 'string', enum: ['highlights', 'risks', 'esg', 'competitors'] },
                description: 'Which analysis sections to run'
              },
              needsPDF: { type: 'boolean', description: 'True if the user mentioned having a PDF report to upload' },
              planSummary: { type: 'string', description: 'One short paragraph summarising what will be analysed and which agents will be used' }
            }
          }
        }
      }
    ],
    tool_choice: 'required'
  } as any);

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error('No tool call returned from dialogue LLM');

  const functionToolCall = toolCall as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;
  const args = JSON.parse(functionToolCall.function.arguments || '{}');
  if (functionToolCall.function.name === 'confirm_plan') {
    return { type: 'plan', ...args };
  }
  return { type: 'question', content: args.question };
}

// ─── Orchestrator tool planner ───────────────────────────────────────────────

export async function planOrchestratorToolCalls(input: {
  userRequest: string;
  ticker?: string;
  hasDocument: boolean;
  fallbackOptions: string[];
}): Promise<OrchestratorToolCall[]> {
  const openai = getOpenAI();
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are the Echo Orchestrator. Decide which tools to call and in what order based on the user's request and available inputs.
Available tools map to agents:
- analyze_document: FundamentalAgent — extracts highlights, risks, ESG, metrics from an uploaded PDF.
- fetch_market_data: QuantAgent — fetches live market data, valuation multiples, price, ratios for a ticker.
- compare_peers: PeerAgent — discovers competitors and benchmarks them.
- synthesize_verdict: CIOAgent — reconciles multiple agent outputs into a final investment verdict.
- synthesize_knowledge: CIOAgent — generates analysis (esg/highlights/risks/summary) from LLM training knowledge when source documents are insufficient or the topic is unlikely to be in a financial PDF (e.g. detailed ESG breakdown, competitive risks, governance analysis).

Rules:
- Call analyze_document only if a document is available and the request needs report/fundamental/ESG/risk/highlight analysis.
- Call fetch_market_data if a ticker is available and the request needs valuation, market data, quantitative metrics, price, or ratios.
- Call compare_peers only when peer/competitor/industry comparison is requested.
- Call synthesize_verdict when the user asks for a verdict, recommendation, or synthesis across multiple sources.
- Call synthesize_knowledge AFTER analyze_document when: (1) the requested topic is ESG/highlights/risks and financial reports often lack this data, OR (2) you anticipate the document may not cover the requested topic in depth. Pass the company name and topic.
- Respect skip/exclude requests. If the user says skip peers, do not call compare_peers.
- If the request is vague, use the fallback options.`
      },
      {
        role: "user",
        content: JSON.stringify(input)
      }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "analyze_document",
          description: "Run FundamentalAgent on the uploaded financial report PDF.",
          parameters: {
            type: "object",
            properties: {
              options: {
                type: "array",
                items: { type: "string", enum: ["highlights", "risks", "esg"] }
              }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "fetch_market_data",
          description: "Run QuantAgent to fetch market data and perform valuation or quantitative analysis.",
          parameters: {
            type: "object",
            properties: {
              ticker: { type: "string" },
              options: {
                type: "array",
                items: { type: "string", enum: ["highlights", "risks", "esg", "competitors"] }
              }
            },
            required: ["ticker"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "compare_peers",
          description: "Run PeerAgent to identify and compare competitors.",
          parameters: {
            type: "object",
            properties: {
              context: { type: "string" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "synthesize_verdict",
          description: "Run CIOAgent to synthesize prior agent outputs into a verdict or divergence analysis.",
          parameters: {
            type: "object",
            properties: {}
          }
        }
      },
      {
        type: "function",
        function: {
          name: "synthesize_knowledge",
          description: "Use CIOAgent's LLM training knowledge to generate analysis on a topic that was not found in the source document or market data. Use this as a fallback when a requested section (esg, highlights, risks, summary) could not be extracted from available sources.",
          parameters: {
            type: "object",
            required: ["topic", "companyName"],
            properties: {
              topic: { type: "string", enum: ["esg", "highlights", "risks", "summary"] },
              companyName: { type: "string" },
              context: { type: "string", description: "Any known context about the company to guide synthesis" }
            }
          }
        }
      }
    ],
    tool_choice: "auto"
  } as any);

  const toolCalls = response.choices[0]?.message?.tool_calls || [];
  return toolCalls
    .map((toolCall: any) => {
      const name = toolCall.function?.name as OrchestratorToolName;
      if (!["analyze_document", "fetch_market_data", "compare_peers", "synthesize_verdict", "synthesize_knowledge"].includes(name)) return null;
      return {
        name,
        arguments: JSON.parse(toolCall.function?.arguments || "{}")
      };
    })
    .filter(Boolean) as OrchestratorToolCall[];
}

/**
 * Provider priority for structured JSON generation:
 *   1. Featherless  — if FEATHERLESS_API_KEY is set (optional, user-configured)
 *   2. OpenAI       — if OPENAI_API_KEY is set (default)
 *   3. Gemini       — if GEMINI_API_KEY is set; falls back to OpenAI on auth/rate errors
 *
 * conductDialogueStep / planOrchestratorToolCalls always use OpenAI (need function calling).
 */
export async function runGenerativeAI(prompt: string, schemaProperties: any, requiredFields: string[], fileBase64?: string): Promise<any> {
  // ── 1. Featherless (optional) ────────────────────────────────────────────
  if (process.env.FEATHERLESS_API_KEY) {
    try {
      console.info(`[LLM] Using Featherless provider (${FEATHERLESS_MODEL})`);
      return await runFeatherlessFallback(prompt, schemaProperties, requiredFields, fileBase64);
    } catch (err: any) {
      console.warn(`[LLM] Featherless failed (${err.message}), falling back to OpenAI/Gemini`);
    }
  }

  // ── 2. OpenAI (default) ──────────────────────────────────────────────────
  if (process.env.OPENAI_API_KEY) {
    console.info("[LLM] Using OpenAI provider (gpt-4o)");
    return await runOpenAIFallback(prompt, schemaProperties, requiredFields, fileBase64);
  }

  // ── 3. Gemini (with OpenAI fallback on failure) ──────────────────────────
  if (!process.env.GEMINI_API_KEY) {
    // No key at all — last resort: try OpenAI anyway (will throw its own error if missing)
    return await runOpenAIFallback(prompt, schemaProperties, requiredFields, fileBase64);
  }

  try {
    console.info("[LLM] Using Gemini provider (gemini-2.5-flash)");
    const gemini = getGemini();

    const parts: any[] = [{ text: prompt }];
    if (fileBase64) {
      parts.push({ inlineData: { data: fileBase64, mimeType: "application/pdf" } });
    }

    const response = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: requiredFields,
          properties: schemaProperties
        }
      }
    });

    const analysisText = response.text;
    if (!analysisText) throw new Error("Empty response from Gemini");
    return JSON.parse(analysisText);
  } catch (error) {
    if (isGeminiFallbackError(error)) {
      console.warn("[LLM] Gemini unavailable, switching to OpenAI fallback:", (error as any)?.message || error);
      return await runOpenAIFallback(prompt, schemaProperties, requiredFields, fileBase64);
    }
    throw error;
  }
}
