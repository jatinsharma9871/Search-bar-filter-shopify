export default async function handler(req, res) {
  // ✅ Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // ✅ Handle preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { query } = req.query;
    const shop = process.env.SHOPIFY_SHOP;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    // ✅ Validate environment variables and query
    if (!query || !shop || !token) {
      console.error("Missing environment variables or query:", { query, shop, token });
      return res.status(400).json({ error: "Missing query or environment variables" });
    }

    // ✅ GraphQL query with variables
    const gqlQuery = {
      query: `
        query SearchProducts($search: String!) {
          products(first: 250, query: $search) {
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
        search: `${query}*`,
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

    // ✅ Handle Shopify errors clearly
    if (result.errors) {
      console.error("Shopify API errors:", result.errors);
      return res.status(500).json({
        error: "Shopify API Error",
        details: result.errors,
        note: "Check if the token is valid, has proper permissions, and is active.",
      });
    }

    if (!result.data || !result.data.products) {
      console.error("No products returned:", result);
      return res.status(500).json({
        error: "No data returned from Shopify",
        note: "Verify your token, API version, and query format.",
      });
    }

    const products = result.data.products.edges.map(edge => edge.node);
    return res.status(200).json({ products });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
      stack: err.stack,
    });
  }
}
