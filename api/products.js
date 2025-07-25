export default async function handler(req, res) {
  // Set CORS headers
  // res.setHeader("Access-Control-Allow-Origin", "*"); // or specify your domain
  res.setHeader("Access-Control-Allow-Origin", "https://02hylc72yddquwgy-56868241501.shopifypreview.com");

  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
 
  // Handle preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { query } = req.query;
    const shop = process.env.SHOPIFY_SHOP;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!query || !shop || !token) {
      return res.status(400).json({ error: "Missing query or env vars" });
    }

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

    if (result.errors) {
      return res.status(500).json({ error: result.errors });
    }

    const products = result.data.products.edges.map((edge) => edge.node);
    return res.status(200).json({ products });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
}
