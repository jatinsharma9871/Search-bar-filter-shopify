// api/search.js
export default async function handler(req, res) {
  const { q } = req.query;

  console.log("🔍 Query received:", q);
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!shop || !token) {
    return res.status(500).json({ error: "Missing env variables" });
  }

  try {
    const response = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
  query: `
    {
      products(first: 100, query: "title:*${q}* OR product_type:*${q}* OR tag:*${q}* OR vendor:*${q}*") {
        edges {
          node {
            id
            handle
            title
            vendor
            productType
            tags
            onlineStoreUrl
          }
        }
      }
    }
  `
})

    });

    const json = await response.json();
    const products = json.data.products.edges.map(edge => edge.node);
    res.status(200).json({ products });
  } catch (error) {
    console.error("❌ Error calling Shopify API", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
