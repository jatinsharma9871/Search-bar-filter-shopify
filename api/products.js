export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { query, mode } = req.query;
    const shop = process.env.SHOPIFY_SHOP;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!shop || !token) {
      return res.status(400).json({ error: "Missing env vars" });
    }

    if (mode === 'search') {
      if (!query) return res.status(400).json({ error: "Missing query" });

      const gqlQuery = {
        query: `
          {
            products(first: 250, query: "${query}*") {
              edges {
                node {
                  id
                  title
                  vendor
                  productType
                  handle
                  images(first: 1) {
                    edges {
                      node {
                        src
                      }
                    }
                  }
                }
              }
            }
          }
        `,
      };

      const response = await fetch(`https://${shop}/admin/api/2023-07/graphql.json`, {
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
      return res.status(200).json({ products });
    }

    // ✳️ Add other modes like filter, vendor list, etc.
    else if (mode === 'vendors') {
      const gqlQuery = {
        query: `
          {
            products(first: 250) {
              edges {
                node {
                  vendor
                }
              }
            }
          }
        `,
      };

      const response = await fetch(`https://${shop}/admin/api/2023-07/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify(gqlQuery),
      });

      const result = await response.json();
      if (result.errors) return res.status(500).json({ error: result.errors });

      const uniqueVendors = [
        ...new Set(result.data.products.edges.map(edge => edge.node.vendor)),
      ];

      return res.status(200).json({ vendors: uniqueVendors });
    }

    return res.status(400).json({ error: "Invalid mode" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
}
