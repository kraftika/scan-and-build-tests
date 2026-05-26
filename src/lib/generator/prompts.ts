import Anthropic from '@anthropic-ai/sdk';
import type { PageCapture } from '@/lib/crawler/types';
import type { TestableAction } from './types';

export class LLMParseError extends Error {
  constructor(message: string, public raw: string) {
    super(message);
    this.name = 'LLMParseError';
  }
}

type MessageParam = Anthropic.MessageParam;

export function buildPagePrompt(capture: PageCapture): MessageParam[] {
  const systemText = `You are a test engineer. Given a web page's accessibility tree and screenshot,
identify testable user-facing behaviours and return them as a JSON array.

Each item must follow this schema exactly:
{
  "type": "navigation" | "form" | "interaction" | "smoke",
  "description": "plain English description of what to test",
  "selector": "CSS or ARIA selector to interact with, or null if not applicable",
  "expectedOutcome": "what should be true after this action"
}

Rules:
- Return ONLY a valid JSON array. No markdown, no explanation, no code fences.
- Maximum 10 items per page.
- Always include at least one "smoke" test: page loads without JS errors.
- "navigation" tests check that links/buttons navigate to the correct URL.
- "form" tests fill inputs with plausible values and submit.
- "interaction" tests click elements and assert a visible response.`;

  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Page URL: ${capture.url}\nPage title: ${capture.title}\n\nAccessibility tree:\n${capture.accessibilityTree || '(empty)'}`,
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: capture.screenshot.toString('base64'),
          },
        },
        {
          type: 'text',
          text: systemText,
        },
      ],
    },
  ];
}

export async function callClaude(messages: MessageParam[]): Promise<TestableAction[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages,
  });

  const raw = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LLMParseError(`Claude returned non-JSON response`, raw);
  }

  if (!Array.isArray(parsed)) {
    throw new LLMParseError('Claude response was not a JSON array', raw);
  }

  return parsed as TestableAction[];
}
