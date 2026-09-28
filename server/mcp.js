import { readFileSync } from "node:fs";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const WIDGET_URI = "ui://guitar-hole-count/v3.html";

const rowSchema = z.object({
  label: z.string(),
  starting: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  brokenOut: z.number().int().nonnegative(),
});

const snapshotSchema = z.object({
  initialized: z.boolean(),
  rows: z.array(rowSchema),
  totals: z.object({
    starting: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    brokenOut: z.number().int().nonnegative(),
  }),
  updatedAt: z.string().nullable(),
  revision: z.number().int().nonnegative(),
});

const outputSchema = { snapshot: snapshotSchema };

const modelAndAppVisibility = {
  ui: { visibility: ["model", "app"] },
};

function summarize(snapshot) {
  if (!snapshot.initialized) return "No morning guitar hole count has been entered yet.";
  return `${snapshot.totals.remaining} holes remaining; ${snapshot.totals.brokenOut} guitars broken out.`;
}

async function reply(store, message) {
  const snapshot = await store.snapshot();
  return {
    content: [{ type: "text", text: message || summarize(snapshot) }],
    structuredContent: { snapshot },
  };
}

async function mutate(store, action, message) {
  try {
    await action();
    return reply(store, message);
  } catch (error) {
    const response = await reply(
      store,
      error instanceof Error ? error.message : "Unable to update the hole count."
    );
    return { ...response, isError: true };
  }
}

export function createHoleCountMcpServer({ store, widgetPath }) {
  const widgetHtml = readFileSync(widgetPath, "utf8");
  const server = new McpServer(
    { name: "guitar-hole-count", version: "1.6.0" },
    {
      instructions:
        "This app tracks one current guitar-wall snapshot. Use break_out_guitars for real breakouts, correct_hole_count when an observed count was entered incorrectly, and adjust_hole_balance to undo or correct breakout progress. After a successful model-initiated mutation, call show_hole_count to display the updated interactive card. Never invent categories or allow a balance below zero.",
    }
  );

  registerAppResource(
    server,
    "guitar-hole-count-card",
    WIDGET_URI,
    {},
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: { connectDomains: [], resourceDomains: [] },
            },
            "openai/widgetDescription":
              "Interactive Guitar Wall card with editable remaining counts, one-tap breakout and undo controls, and a zeroed morning-count editor.",
            "openai/widgetPrefersBorder": true,
          },
        },
      ],
    })
  );

  registerAppTool(
    server,
    "show_hole_count",
    {
      title: "Open guitar hole count",
      description:
        "Use this when the user wants to open the Guitar Hole Count card or asks for the current remaining guitar-wall holes or balance.",
      inputSchema: {},
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "Opening guitar wall…",
        "openai/toolInvocation/invoked": "Guitar wall ready",
      },
    },
    async () => reply(store)
  );

  registerAppTool(
    server,
    "set_morning_count",
    {
      title: "Set morning guitar hole count",
      description:
        "Use this when the user gives a new morning count. Replace the entire current snapshot; all prior breakout progress is reset and no history is retained. Afterward call show_hole_count.",
      inputSchema: {
        counts: z
          .array(
            z.object({
              label: z.string().min(1).describe("Brand or category name"),
              count: z.number().int().nonnegative().describe("Morning empty-hole count"),
            })
          )
          .min(1),
      },
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: modelAndAppVisibility,
    },
    async ({ counts }) =>
      mutate(store, () => store.setMorningCount(counts), "Morning count saved.")
  );

  registerAppTool(
    server,
    "break_out_guitars",
    {
      title: "Break out guitars",
      description:
        "Use this when one or more guitars are put onto the wall. Subtract each requested quantity from its matching current remaining-hole balance. Multiple brands/categories can be updated atomically in one call. Afterward call show_hole_count.",
      inputSchema: {
        breakouts: z
          .array(
            z.object({
              label: z.string().min(1).describe("Existing brand or category"),
              quantity: z.number().int().min(1).describe("Guitars broken out"),
            })
          )
          .min(1),
      },
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: modelAndAppVisibility,
    },
    async ({ breakouts }) =>
      mutate(store, () => store.breakOut(breakouts), "Guitar wall balance updated.")
  );

  registerAppTool(
    server,
    "correct_hole_count",
    {
      title: "Correct observed guitar hole count",
      description:
        "Use this when an existing displayed hole count itself was entered or counted incorrectly. Set one or more absolute remaining counts while preserving legitimate guitars already broken out. Do not use this for a new morning or for an actual breakout. Afterward call show_hole_count.",
      inputSchema: {
        corrections: z
          .array(
            z.object({
              label: z.string().min(1).describe("Existing brand or category"),
              remaining: z
                .number()
                .int()
                .nonnegative()
                .describe("Correct absolute number of remaining empty holes"),
            })
          )
          .min(1),
      },
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: modelAndAppVisibility,
    },
    async ({ corrections }) =>
      mutate(store, () => store.correctCount(corrections), "Observed hole count corrected.")
  );

  registerAppTool(
    server,
    "adjust_hole_balance",
    {
      title: "Correct guitar hole balance",
      description:
        "Use this to correct one or more existing balances by signed deltas. A positive delta puts holes back; a negative delta removes holes. The result must stay between zero and the morning count. Afterward call show_hole_count.",
      inputSchema: {
        adjustments: z
          .array(
            z.object({
              label: z.string().min(1).describe("Existing brand or category"),
              delta: z
                .number()
                .int()
                .refine((value) => value !== 0)
                .describe("Signed change, such as +1 or -1"),
            })
          )
          .min(1),
      },
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: modelAndAppVisibility,
    },
    async ({ adjustments }) =>
      mutate(store, () => store.adjustBalance(adjustments), "Guitar wall balance corrected.")
  );

  return server;
}
