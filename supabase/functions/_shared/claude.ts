import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import { AppError } from './http.ts';

// One place for Claude calls. The model id comes from the CLAUDE_MODEL secret so it can
// change without a code deploy; the default is the cheapest current model with vision
// and structured outputs (Haiku 4.5).
// Secrets: ANTHROPIC_API_KEY (required), ANTHROPIC_WORKSPACE_ID (if the key isn't
// workspace-scoped), CLAUDE_MODEL (optional).

export const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-haiku-4-5-20251001';

function client(): Anthropic {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new AppError('Suggestions are not set up on the server.', 500);
  const workspaceId = Deno.env.get('ANTHROPIC_WORKSPACE_ID');
  return new Anthropic({ apiKey, defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined });
}

function rethrow(err: unknown): never {
  if (err instanceof Anthropic.RateLimitError) throw new AppError('Busy right now. Try again in a minute.', 429);
  if (err instanceof Anthropic.AuthenticationError) throw new AppError('Suggestions are not set up on the server.', 500);
  if (err instanceof Anthropic.BadRequestError) {
    console.error('[claude] bad request:', err.message);
    throw new AppError("Couldn't process that request.", 502);
  }
  if (err instanceof Anthropic.APIError) {
    console.error('[claude] API error:', err.status, err.message);
    throw new AppError('Unavailable right now. Try again in a minute.', 502);
  }
  throw err;
}

type Content = string | Anthropic.ContentBlockParam[];

/** One call whose answer must match `schema` (structured outputs). */
export async function askJson<T>(opts: {
  system: string; content: Content; schema: Record<string, unknown>; maxTokens: number; label: string;
  /** A model for this call instead of CLAUDE_MODEL (imports pick theirs by measured accuracy). */
  model?: string;
  /** Thinking effort, on models that take it. */
  effort?: 'low' | 'medium' | 'high';
  /** Called with what the call used, for logging and cost checks. */
  onUsage?: (usage: { model: string; input: number; output: number }) => void;
}): Promise<T> {
  let response;
  const model = opts.model || MODEL;
  try {
    response = await client().messages.create({
      model,
      max_tokens: opts.maxTokens,
      output_config: { format: { type: 'json_schema', schema: opts.schema }, ...(opts.effort ? { effort: opts.effort } : {}) },
      system: opts.system,
      messages: [{ role: 'user', content: opts.content }],
    });
  } catch (err) {
    rethrow(err);
  }
  console.log(`[claude] ${opts.label}: model=${model} in=${response.usage.input_tokens} out=${response.usage.output_tokens}/${opts.maxTokens} stop=${response.stop_reason}`);
  opts.onUsage?.({ model, input: response.usage.input_tokens, output: response.usage.output_tokens });
  if (response.stop_reason === 'refusal') throw new AppError("Couldn't help with that one. Try different wording.", 422);
  if (response.stop_reason === 'max_tokens') throw new AppError('The answer was cut off. Try again.', 502);
  const text = response.content.find(b => b.type === 'text');
  if (!text || text.type !== 'text') throw new AppError('No answer came back. Try again.', 502);
  try {
    return JSON.parse(text.text) as T;
  } catch {
    throw new AppError('The answer was unreadable. Try again.', 502);
  }
}

/** One call forced to answer through a single tool; returns the tool input. */
export async function askTool<T>(opts: { system: string; content: Content; tool: Anthropic.Tool; maxTokens: number; label: string }): Promise<T> {
  let response;
  try {
    response = await client().messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens,
      system: opts.system,
      tools: [opts.tool],
      tool_choice: { type: 'tool', name: opts.tool.name },
      messages: [{ role: 'user', content: opts.content }],
    });
  } catch (err) {
    rethrow(err);
  }
  console.log(`[claude] ${opts.label}: in=${response.usage.input_tokens} out=${response.usage.output_tokens}/${opts.maxTokens} stop=${response.stop_reason}`);
  if (response.stop_reason === 'refusal') throw new AppError("Couldn't look at that photo. Try another one.", 422);
  if (response.stop_reason === 'max_tokens') throw new AppError('The answer was cut off. Try again.', 502);
  const use = response.content.find(b => b.type === 'tool_use');
  if (!use || use.type !== 'tool_use') throw new AppError('No answer came back. Try again.', 502);
  return use.input as T;
}
