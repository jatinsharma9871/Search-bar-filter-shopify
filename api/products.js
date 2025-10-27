export default async function handler(req, res) {
  // ✅ CORS headers
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const queryParam = req.method === "POST" ? req.body?.query : req.query.query;
    const shop = process.env.SHOPIFY_SHOP;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    // ✅ Trigger search only for 2+ characters
    if (!queryParam || queryParam.trim().length < 2) {
      return res.status(200).json({ total: 0, products: [] });
    }

    if (!shop || !token) return res.status(400).json({ error: "Missing env variables" });

    const q = queryParam.trim().toLowerCase();

    // ✅ Shopify handles search filtering (fast)
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
                images(first: 1) { edges { node { url } } }
              }
            }
          }
        }
      `,
      variables: {
        search: `(title:*${q}* OR vendor:*${q}* OR product_type:*${q}*)`,
      },
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

    if (result.errors) return res.status(500).json({ error: result.errors });

    const products = result.data.products.edges.map(edge => edge.node);

    return res.status(200).json({
      total: products.length,
      products,
    });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}
