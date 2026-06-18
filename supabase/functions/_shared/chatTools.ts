/**
 * Chat tool registry.
 *
 * TIER_1_TOOLS: empty — the bot can only reply with text.
 * TIER_2_TOOLS: action tools. Switch the Edge Function to use these when ready.
 *
 * To add a Tier 2 action:
 *  1. Add a tool definition below.
 *  2. Add a handler case in the agent loop in functions/chat/index.ts.
 *  3. Flip the active tools constant in index.ts from TIER_1_TOOLS to TIER_2_TOOLS.
 */

// deno-lint-ignore no-explicit-any
export const TIER_1_TOOLS: any[] = [];

export const TIER_2_TOOLS = [
  {
    type: "function",
    function: {
      name: "navigate_to_page",
      description:
        "Tell the frontend to navigate the user to a specific page in the app. Use this when the user asks where to find a feature.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "App route path, e.g. /campaigns/create or /targeting/zones",
          },
          reason: {
            type: "string",
            description: "Brief explanation of why you are sending the user there",
          },
        },
        required: ["path", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_confirmation",
      description:
        "Ask the user to confirm before you execute any write action. Always call this before create, update, delete, or send operations.",
      parameters: {
        type: "object",
        properties: {
          action_description: {
            type: "string",
            description:
              "Plain-English description of what will happen, e.g. 'Create a campaign named Summer2025'",
          },
          action_type: {
            type: "string",
            enum: ["create", "update", "delete", "send"],
          },
        },
        required: ["action_description", "action_type"],
      },
    },
  },
];

// Active tools used by the chat Edge Function — change this line to upgrade tiers
export const ACTIVE_TOOLS = TIER_1_TOOLS;
