export default async function handler(req, res) {
  try {
    const { query } = req.query;
    const shop = process.env.SHOPIFY_SHOP;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!query || !shop || !token) {
      return res.status(400).json({ error: 'Missing query or env vars' });
    }

    const gqlQuery = {
      query: `
        {
          products(first: 100, query: "${query}*") {
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
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify(gqlQuery),
    });

    const result = await response.json();

    if (result.errors) {
      return res.status(500).json({ error: result.errors });
    }

    const products = result.data.products.edges.map(edge => edge.node);
    res.status(200).json({ products });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}
