import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { textResult } from "./protocol.js";

const enc = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
export function wooSigningUrl(publicUrl: URL, internalUrl: URL) {
  const signed = new URL(publicUrl);
  // WooCommerce uses the public home hostname, but the scheme observed by PHP.
  // A direct internal HTTP Service stays HTTP even with public TLS at Ingress.
  signed.protocol = internalUrl.protocol;
  return signed;
}
export function oauthHeader(
  url: URL,
  method: string,
  key: string,
  secret: string,
) {
  const auth: Record<string, string> = {
    oauth_consumer_key: key,
    oauth_nonce: randomBytes(18).toString("hex"),
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
  };
  const params = [...url.searchParams.entries(), ...Object.entries(auth)]
    .map(([k, v]) => [enc(k), enc(v)])
    .sort(([a, av], [b, bv]) =>
      a === b ? av.localeCompare(bv) : a.localeCompare(b),
    );
  const base = [
    method.toUpperCase(),
    enc(url.origin + url.pathname),
    enc(params.map(([k, v]) => `${k}=${v}`).join("&")),
  ].join("&");
  auth.oauth_signature = createHmac("sha256", enc(secret) + "&")
    .update(base)
    .digest("base64");
  return (
    "OAuth " +
    Object.entries(auth)
      .map(([k, v]) => `${enc(k)}="${enc(v)}"`)
      .join(", ")
  );
}
export async function wooRequest(
  method: string,
  path: string,
  query: Record<string, string | number> = {},
  body?: unknown,
) {
  const publicBase = process.env.WOO_PUBLIC_URL!;
  const publicUrl = new URL(
    publicBase.replace(/\/$/, "") + "/wp-json/wc/v3/" + path,
  );
  Object.entries(query).forEach(([k, v]) =>
    publicUrl.searchParams.set(k, String(v)),
  );
  const internal = new URL(process.env.WOO_INTERNAL_URL!);
  internal.pathname = publicUrl.pathname;
  internal.search = publicUrl.search;
  const response = await fetch(internal, {
    method,
    headers: {
      Host: publicUrl.host,
      Authorization: oauthHeader(
        wooSigningUrl(publicUrl, internal),
        method,
        process.env.WOO_CONSUMER_KEY!,
        process.env.WOO_CONSUMER_SECRET!,
      ),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`WooCommerce returned HTTP ${response.status}`);
  return response.json();
}
const id = z.number().int().positive();
const listing = z
  .object({
    page: z.number().int().min(1).default(1),
    per_page: z.number().int().min(1).max(50).default(10),
  })
  .strict();
const schemas = {
  list_products: listing,
  create_product: z
    .object({
      name: z.string().trim().min(1).max(200),
      price: z.string().regex(/^\d+(\.\d{1,2})?$/),
      description: z.string().max(2000).default(""),
    })
    .strict(),
  list_orders: listing
    .extend({
      after: z.string().datetime({ offset: true }).optional(),
      before: z.string().datetime({ offset: true }).optional(),
    })
    .strict(),
  get_order: z.object({ id }).strict(),
  update_order_status: z
    .object({
      id,
      status: z.enum([
        "pending",
        "processing",
        "on-hold",
        "completed",
        "cancelled",
        "refunded",
        "failed",
      ]),
    })
    .strict(),
};
const obj = (properties: Record<string, object>, required: string[] = []) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});
const pages = {
  page: { type: "integer", minimum: 1 },
  per_page: { type: "integer", minimum: 1, maximum: 50 },
};
export const wooTools: Tool[] = [
  {
    name: "list_products",
    description: "List store products with pagination.",
    inputSchema: obj(pages),
  },
  {
    name: "create_product",
    description:
      "Create a published simple product with a name and price in the store currency.",
    inputSchema: obj(
      {
        name: { type: "string" },
        price: { type: "string", pattern: "^\\d+(\\.\\d{1,2})?$" },
        description: { type: "string" },
      },
      ["name", "price"],
    ),
  },
  {
    name: "list_orders",
    description:
      "List orders. Optional after/before are ISO 8601 timestamps; use explicit timezone offsets for today.",
    inputSchema: obj({
      ...pages,
      after: { type: "string" },
      before: { type: "string" },
    }),
  },
  {
    name: "get_order",
    description: "Get one order by ID.",
    inputSchema: obj({ id: { type: "integer", minimum: 1 } }, ["id"]),
  },
  {
    name: "update_order_status",
    description: "Change the status of an existing order.",
    inputSchema: obj(
      {
        id: { type: "integer", minimum: 1 },
        status: {
          type: "string",
          enum: [
            "pending",
            "processing",
            "on-hold",
            "completed",
            "cancelled",
            "refunded",
            "failed",
          ],
        },
      },
      ["id", "status"],
    ),
  },
];
export async function callWoo(name: string, args: Record<string, unknown>) {
  try {
    if (!(name in schemas)) throw new Error("Unknown WooCommerce tool");
    const a = schemas[name as keyof typeof schemas].parse(args) as Record<
      string,
      any
    >;
    if (name === "list_products")
      return textResult(await wooRequest("GET", "products", a));
    if (name === "create_product")
      return textResult(
        await wooRequest(
          "POST",
          "products",
          {},
          {
            name: a.name,
            regular_price: a.price,
            description: a.description,
            type: "simple",
            status: "publish",
            virtual: true,
          },
        ),
      );
    if (name === "list_orders")
      return textResult(await wooRequest("GET", "orders", a));
    if (name === "get_order")
      return textResult(await wooRequest("GET", `orders/${a.id}`));
    return textResult(
      await wooRequest("PUT", `orders/${a.id}`, {}, { status: a.status }),
    );
  } catch (error) {
    return textResult(
      {
        error:
          error instanceof z.ZodError
            ? "Invalid tool arguments"
            : (error as Error).message,
      },
      true,
    );
  }
}
