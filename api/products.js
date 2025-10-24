export default async function handler(req, res) {
  // ✅ CORS headers
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // ✅ Get query
    const queryParam = req.method === "POST" ? req.body?.query : req.query.query;
    const shop = process.env.SHOPIFY_SHOP;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    // ✅ Validate query length
    if (!queryParam || queryParam.trim().length < 3) {
      return res.status(200).json({ total: 0, products: [] });
    }

    if (!shop || !token) {
      return res.status(400).json({ error: "Missing environment variables" });
    }

    const q = queryParam.trim().toLowerCase();
    let allProducts = [];
    let hasNextPage = true;
    let cursor = null;

    // ✅ Pagination loop (max 250 per page)
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
                  handle
                  productType
                  images(first: 1) { edges { node { url } } }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        `,
        variables: { cursor },
      };

      const response = await fetch(`https://${shop}/admin/api/2024-07/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify(gqlQuery),
      });

      const result = await response.json();

      if (result.errors) {
        console.error("Shopify API Error:", result.errors);
        return res.status(500).json({ error: result.errors });
      }

      const products = result.data.products.edges.map(edge => edge.node);
      allProducts = allProducts.concat(products);

      hasNextPage = result.data.products.pageInfo.hasNextPage;
      cursor = result.data.products.pageInfo.endCursor;

      // ✅ Safety limit to avoid infinite loops
      if (allProducts.length > 5000) break;
    }

    // ✅ Filter products by substring match
    const filteredProducts = allProducts.filter(p =>
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
    });
  }
}
