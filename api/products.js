let tokenCache = null;
let tokenExpiry = 0;

async function getShopifyToken() {
  if (tokenCache && Date.now() < tokenExpiry) {
    return tokenCache;
  }

  const response = await fetch(
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
    const errorText = await response.text();
    throw new Error(
      `Failed to get Shopify token: ${response.status} - ${errorText}`
    );
  }

  const data = await response.json();

  tokenCache = data.access_token;

  // Refresh 5 minutes before expiry
  tokenExpiry = Date.now() + ((data.expires_in || 86400) - 300) * 1000;

  console.log("Shopify token refreshed");

  return tokenCache;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const queryParam =
      req.method === "POST"
        ? req.body?.query
        : req.query.query;

    if (!queryParam || queryParam.trim().length < 2) {
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
      return res.status(500).json({
        error: "Missing Shopify environment variables",
      });
    }

    const token = await getShopifyToken();
    const q = queryParam.trim().toLowerCase();

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
                totalInventory

                images(first: 1) {
                  edges {
                    node {
                      url
                    }
                  }
                }

                variants(first: 100) {
                  edges {
                    node {
                      inventoryQuantity
                    }
                  }
                }
              }
            }
          }
        }
      `,
      variables: {
        search: `(title:*${q}* OR vendor:*${q}* OR product_type:*${q}*)`,
      },
    };

    let response = await fetch(
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

    // Retry once if token expired
    if (response.status === 401) {
      tokenCache = null;

      const freshToken = await getShopifyToken();

      response = await fetch(
        `https://${process.env.SHOPIFY_SHOP}/admin/api/2025-10/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": freshToken,
          },
          body: JSON.stringify(gqlQuery),
        }
      );
    }

    const result = await response.json();

    if (result.errors) {
      return res.status(500).json({
        error: result.errors,
      });
    }

    // Extract products
    let products =
      result?.data?.products?.edges?.map((edge) => edge.node) || [];

    // Hide products with zero inventory
    products = products.filter((product) => {
      // Prefer totalInventory if available
      if (typeof product.totalInventory === "number") {
        return product.totalInventory > 0;
      }

      // Fallback: sum variant inventory
      const total =
        product.variants?.edges?.reduce((sum, variant) => {
          return sum + (variant.node.inventoryQuantity || 0);
        }, 0) || 0;

      return total > 0;
    });

    return res.status(200).json({
      total: products.length,
      products,
    });
  } catch (err) {
    console.error("Handler error:", err);

    return res.status(500).json({
      error: err.message,
    });
  }
}