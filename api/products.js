export default async function handler(req, res) {
  // ✅ CORS headers
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // ✅ Support GET and POST queries
    const queryParam = req.method === "POST" ? req.body?.query : req.query.query;
    const shop = process.env.SHOPIFY_SHOP;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!queryParam || !shop || !token) {
      return res.status(400).json({
        error: "Missing query or environment variables",
        debug: { query: queryParam, shop, token: !!token },
      });
    }

    let allProducts = [];
    let hasNextPage = true;
    let cursor = null;

    // ✅ Loop to paginate through all products (max 250 per page)
    while (hasNextPage) {
      const gqlQuery = {
        query: `
          query SearchProducts($cursor: String) {
            products(first: 50, after: $cursor) {
              edges {
                cursor
                node {
                  id
                  title
                  vendor
                  productType
                  handle
                  images(first: 1) {
                    edges {
                      node {
                        url
                      }
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        variables: { cursor },
      };

      const response = await fetch(
        `https://${shop}/admin/api/2024-07/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify(gqlQuery),
        }
      );

      const result = await response.json();

      if (result.errors) {
        console.error("Shopify API Error:", result.errors);
        return res.status(500).json({ error: result.errors });
      }

      const products = result.data.products.edges.map((edge) => edge.node);
      allProducts = allProducts.concat(products);

      hasNextPage = result.data.products.pageInfo.hasNextPage;
      cursor = result.data.products.pageInfo.endCursor;

      // Safety cap to prevent infinite loop
      if (allProducts.length > 5000) break;
    }

    // ✅ Substring filtering for dynamic search
    const q = queryParam.toLowerCase();
    const filteredProducts = allProducts.filter(
      (p) =>
        p.title?.toLowerCase().includes(q) ||
        p.vendor?.toLowerCase().includes(q) ||
        p.productType?.toLowerCase().includes(q)
    );

    return res.status(200).json({
      total: filteredProducts.length,
      products: filteredProducts,
    });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
      stack: err.stack,
    });
  }
}
