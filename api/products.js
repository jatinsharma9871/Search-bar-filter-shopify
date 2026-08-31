// ─────────────────────────────────────────────────────────────
// Shopify Product Search API Handler
// Fixes applied:
//  - Locked-down CORS (no more reflecting any origin + credentials)
//  - Request timeouts via AbortController
//  - Sanitized error responses (no internal leakage)
//  - Escaped user input before injecting into Shopify search syntax
//  - Clearer inventory filtering with a note on availableForSale vs stock
// ─────────────────────────────────────────────────────────────

let tokenCache = null;
let tokenExpiry = 0;

// Set this to the actual domain(s) allowed to call this endpoint.
// Avoid "*" combined with credentials — that's an open CORS hole.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const FETCH_TIMEOUT_MS = 8000;

/**
 * fetch() with a hard timeout so a hung upstream request
 * doesn't hang the whole handler.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Escapes characters that have special meaning in Shopify's search
 * query syntax so user input can't manipulate the query structure.
 * Shopify search treats: * : ( ) " as syntactically meaningful.
 */
function escapeShopifySearchTerm(term) {
  return term.replace(/[*:"()]/g, (char) => `\\${char}`);
}

async function getShopifyToken() {
  if (tokenCache && Date.now() < tokenExpiry) {
    return tokenCache;
  }

  const response = await fetchWithTimeout(
    `https://${process.env.SHOPIFY_SHOP}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      }),
    }
  );

  if (!response.ok) {
    // Log full detail server-side; don't leak it to the client.
    const errorText = await response.text();
    console.error(`Failed to get Shopify token: ${response.status} - ${errorText}`);
    throw new Error("Failed to authenticate with Shopify");
  }

  const data = await response.json();

  tokenCache = data.access_token;

  // Refresh 5 minutes before actual expiry.
  // Note: on serverless platforms, module-level caching only persists
  // within a warm instance — cold starts will always re-fetch. That's
  // expected behavior there, not a bug, but don't rely on this cache
  // being consistently hot in a serverless deployment.
  tokenExpiry = Date.now() + ((data.expires_in || 86400) - 300) * 1000;

  console.log("Shopify token refreshed");

  return tokenCache;
}

function applyCors(req, res) {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  // If origin isn't in the allowlist, no CORS headers are set,
  // and the browser will block the response from being read.

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function runProductSearch(token, searchTerm) {
  const escapedTerm = escapeShopifySearchTerm(searchTerm);

  const gqlQuery = {
    query: `
      query SearchProducts($search: String!) {
        products(first: 100, query: $search) {
          edges {
            node {
              id
              title
              handle
              vendor
              productType
              availableForSale
              totalInventory
              images(first: 1) {
                edges {
                  node {
                    url
                  }
                }
              }
            }
          }
        }
      }
    `,
    variables: {
      search: `(title:*${escapedTerm}* OR vendor:*${escapedTerm}* OR product_type:*${escapedTerm}*)`,
    },
  };

  return fetchWithTimeout(
    `https://${process.env.SHOPIFY_SHOP}/admin/api/2025-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify(gqlQuery),
    }
  );
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const queryParam = req.method === "POST" ? req.body?.query : req.query.query;

    if (!queryParam || typeof queryParam !== "string" || queryParam.trim().length < 2) {
      return res.status(200).json({
        total: 0,
        products: [],
      });
    }

    if (
      !process.env.SHOPIFY_SHOP ||
      !process.env.SHOPIFY_CLIENT_ID ||
      !process.env.SHOPIFY_CLIENT_SECRET
    ) {
      console.error("Missing Shopify environment variables");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const q = queryParam.trim().toLowerCase().slice(0, 100); // cap length defensively
    const token = await getShopifyToken();

    let response = await runProductSearch(token, q);

    // Retry once if token expired unexpectedly.
    if (response.status === 401) {
      tokenCache = null;
      const freshToken = await getShopifyToken();
      response = await runProductSearch(freshToken, q);
    }

    if (!response.ok) {
      console.error(`Shopify API error: ${response.status}`);
      return res.status(502).json({ error: "Upstream error from Shopify" });
    }

    const result = await response.json();

    if (result.errors) {
      console.error("Shopify GraphQL errors:", result.errors);
      return res.status(502).json({ error: "Search query failed" });
    }

    // availableForSale reflects purchasability (accounts for backorder
    // settings), not strictly "inventory > 0". If you want to hide items
    // that are strictly out of stock (even if backorder is allowed),
    // filter on totalInventory > 0 instead, or combine both checks.
    const products =
      result?.data?.products?.edges
        ?.map((edge) => edge.node)
        .filter((product) => product.availableForSale) || [];

    return res.status(200).json({
      total: products.length,
      products,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      console.error("Shopify request timed out");
      return res.status(504).json({ error: "Request to Shopify timed out" });
    }

    console.error("Handler error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}