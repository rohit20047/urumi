import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { textResult } from "./protocol.js";
export function utilityTools(role: string): Tool[] {
  return [
    {
      name: "status",
      description: `Describe the ${role} server.`,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    role === "time"
      ? {
          name: "current_time",
          description: "Current time in an IANA timezone.",
          inputSchema: {
            type: "object",
            properties: { timezone: { type: "string" } },
            additionalProperties: false,
          },
        }
      : {
          name: "calculate",
          description: "Add, subtract, multiply or divide two numbers.",
          inputSchema: {
            type: "object",
            properties: {
              operation: {
                type: "string",
                enum: ["add", "subtract", "multiply", "divide"],
              },
              a: { type: "number" },
              b: { type: "number" },
            },
            required: ["operation", "a", "b"],
            additionalProperties: false,
          },
        },
  ];
}
export async function callUtility(
  role: string,
  name: string,
  args: Record<string, unknown>,
) {
  try {
    if (name === "status") {
      z.object({}).strict().parse(args);
      return textResult({ server: role, transport: "Streamable HTTP" });
    }
    if (role === "time" && name === "current_time") {
      const { timezone } = z
        .object({ timezone: z.string().max(100).default("Asia/Kolkata") })
        .strict()
        .parse(args);
      return textResult({
        utc: new Date().toISOString(),
        timezone,
        local: new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          dateStyle: "full",
          timeStyle: "long",
        }).format(new Date()),
      });
    }
    if (role === "math" && name === "calculate") {
      const { operation, a, b } = z
        .object({
          operation: z.enum(["add", "subtract", "multiply", "divide"]),
          a: z.number().finite(),
          b: z.number().finite(),
        })
        .strict()
        .parse(args);
      if (operation === "divide" && b === 0)
        throw new Error("Cannot divide by zero");
      const value =
        operation === "add"
          ? a + b
          : operation === "subtract"
            ? a - b
            : operation === "multiply"
              ? a * b
              : a / b;
      if (!Number.isFinite(value)) throw new Error("Result is not finite");
      return textResult({ result: value });
    }
    throw new Error("Unknown utility tool");
  } catch {
    return textResult({ error: "Invalid tool name or arguments" }, true);
  }
}
