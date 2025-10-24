// File: /api/products.js
export default async function handler(req, res) {
  // ✅ CORS headers
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // ✅ Get search query from GET or POST
    const queryParam = req.method === "POST" ? req.body?.query : req.query.query;
    if (!queryParam || queryParam.trim().length < 2)
      return res.status(200).json({ total: 0, products: [] });

    const shop = process.env.SHOPIFY_SHOP;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!shop || !token)
      return res.status(400).json({ error: "Missing environment variables" });

    const q = queryParam.trim().toLowerCase();
    const words = q.split(/\s+/);

    // ✅ Build Shopify multi-word search query with wildcards
    const shopifyQuery = words
      .map(w => `(title:*${w}* OR variants.title:*${w}* OR variants.option1:*${w}* OR product_type:*${w}* OR vendor:*${w}*)`)
      .join(" AND ");

    // ✅ GraphQL query
    const gqlQuery = {
      query: `
        query SearchProducts($search: String!) {
          products(first: 30, query: $search) {
            edges {
              node {
                id
                title
                handle
                vendor
                productType
                images(first: 1) { edges { node { url } } }
                variants(first: 5) { edges { node { title option1 option2 option3 } } }
              }
            }
          }
        }
      `,
      variables: { search: shopifyQuery },
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

    // ✅ Map products
    const products = result.data.products.edges.map(edge => {
      const p = edge.node;
      return {
        id: p.id,
        title: p.title,
        handle: p.handle,
        vendor: p.vendor,
        productType: p.productType,
        image: p.images.edges[0]?.node.url || null,
        variants: p.variants.edges.map(v => v.node),
      };
    });

    return res.status(200).json({ total: products.length, products });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
}
