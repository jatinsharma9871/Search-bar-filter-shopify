
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
  tokenExpiry =
    Date.now() + ((data.expires_in || 86400) - 300) * 1000;

  console.log("Shopify token refreshed");

  return tokenCache;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    // Get search query
    const queryParam =
      req.method === "POST"
        ? req.body?.query
        : req.query?.query;

    if (
      typeof queryParam !== "string" ||
      queryParam.trim().length < 2
    ) {
      return res.status(200).json({
        total: 0,
        products: [],
      });
    }

    // Check environment variables
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

    const searchTerm = queryParam.trim();
    const q = searchTerm.toLowerCase();

    // Shopify GraphQL query
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

                variants(first: 100) {
                  edges {
                    node {
                      id
                      title
                      barcode
                      sku
                      inventoryQuantity
                      inventoryPolicy

                      inventoryItem {
                        tracked
                      }

                      selectedOptions {
                        name
                        value
                      }
                    }
                  }
                }

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
        search: `title:*${searchTerm}* OR vendor:*${searchTerm}* OR product_type:*${searchTerm}* OR sku:*${searchTerm}* OR barcode:*${searchTerm}*`,
      },
    };

    const shopifyUrl =
      `https://${process.env.SHOPIFY_SHOP}/admin/api/2025-10/graphql.json`;

    async function callShopify(accessToken) {
      return fetch(shopifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify(gqlQuery),
      });
    }

    let response = await callShopify(token);

    // Retry once if token expired unexpectedly
    if (response.status === 401) {
      tokenCache = null;
      tokenExpiry = 0;

      const freshToken = await getShopifyToken();
      response = await callShopify(freshToken);
    }

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `Shopify API error: ${response.status} - ${errorText}`
      );
    }

    const result = await response.json();

    if (result.errors) {
      console.error("Shopify GraphQL errors:", result.errors);

      return res.status(500).json({
        error: result.errors,
      });
    }

    // Convert Shopify products and variants
    const products = (
      result?.data?.products?.edges || []
    )
      .map(({ node }) => {
        const variants = (node.variants?.edges || []).map(
          ({ node: variant }) => ({
            id: variant.id,
            title: variant.title,
            barcode: variant.barcode,
            sku: variant.sku,

            inventoryQuantity: variant.inventoryQuantity,
            inventoryPolicy: variant.inventoryPolicy,
            tracked: variant.inventoryItem?.tracked,

            selectedOptions: variant.selectedOptions || [],

            option1: variant.selectedOptions?.[0]?.value || "",
            option2: variant.selectedOptions?.[1]?.value || "",
            option3: variant.selectedOptions?.[2]?.value || "",
          })
        );

        // Check if at least one variant is purchasable
        const hasAvailableVariant = variants.some((variant) => {
          // Untracked inventory is treated as available
          if (variant.tracked === false) {
            return true;
          }

          // Allow products that support backorders
          if (variant.inventoryPolicy === "CONTINUE") {
            return true;
          }

          // Tracked inventory must be greater than zero
          return Number(variant.inventoryQuantity) > 0;
        });

        return {
          id: node.id,
          title: node.title,
          handle: node.handle,
          vendor: node.vendor,
          productType: node.productType,
          totalInventory: node.totalInventory,

          // Direct product page URL
          url: `/products/${node.handle}`,

          image:
            node.images?.edges?.[0]?.node?.url || "",

          variants,
          hasAvailableVariant,
        };
      })

      // Hide products with no purchasable variants
      .filter((product) => product.hasAvailableVariant);

    // Filter products by search query
    const filteredProducts = products.filter((product) => {
      const barcodeMatch = product.variants.some((variant) =>
        (variant.barcode || "").toLowerCase().includes(q)
      );

      const skuMatch = product.variants.some((variant) =>
        (variant.sku || "").toLowerCase().includes(q)
      );

      return (
        (product.title || "").toLowerCase().includes(q) ||
        (product.vendor || "").toLowerCase().includes(q) ||
        (product.productType || "").toLowerCase().includes(q) ||
        barcodeMatch ||
        skuMatch
      );
    });

    return res.status(200).json({
      total: filteredProducts.length,
      products: filteredProducts,
    });

  } catch (err) {
    console.error("Handler error:", err);

    return res.status(500).json({
      error: err.message,
    });
  }
}
