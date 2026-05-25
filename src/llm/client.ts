import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

/** Model used for every per-item triage loop. */
export const MODEL = "claude-sonnet-4-6";

/** Maximum tool-use turns before forcing a `submit_triage` call. */
export const MAX_TURNS = 6;

/**
 * Construct an Anthropic client from the `ANTHROPIC_API_KEY` environment
 * variable. Fails fast with a clear message if the key is absent so the
 * caller never makes an unauthenticated request.
 */
export function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — set it in .env or the environment.",
    );
  }
  return new Anthropic({ apiKey });
}
