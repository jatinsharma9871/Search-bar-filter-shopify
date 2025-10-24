export default async function handler(req, res) {
  // ✅ CORS headers
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const queryParam = req.method === "POST" ? req.body?.query : req.query.query;
    const afterCursor = req.method === "POST" ? req.body?.after : req.query.after;
    const shop = process.env.SHOPIFY_SHOP;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!queryParam || queryParam.trim().length < 2) {
      return res.status(200).json({ total: 0, products: [], hasNextPage: false });
    }

    if (!shop || !token) return res.status(400).json({ error: "Missing env variables" });

    const q = queryParam.trim().toLowerCase();

    // ✅ Shopify query: title, vendor, type, color (assuming variant option1 contains color)
    const gqlQuery = {
      query: `
        query SearchProducts($search: String!, $after: String) {
          products(first: 20, after: $after, query: $search) {
            edges {
              cursor
              node {
                id
                title
                handle
                vendor
                productType
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      option1
                    }
                  }
                }
                images(first: 1) {
                  edges { node { url } }
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
      variables: {
        search: `(title:*${q}* OR vendor:*${q}* OR product_type:*${q}* OR variants.title:*${q}* OR variants.option1:*${q}*)`,
        after: afterCursor || null,
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

    const products = result.data.products.edges.map(edge => ({
      ...edge.node,
      cursor: edge.cursor,
    }));

    return res.status(200).json({
      total: products.length,
      products,
      hasNextPage: result.data.products.pageInfo.hasNextPage,
      endCursor: result.data.products.pageInfo.endCursor,
    });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}
