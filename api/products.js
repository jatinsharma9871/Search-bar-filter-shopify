export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const queryParam = req.method === "POST" ? req.body?.query : req.query.query;
    const shop = process.env.SHOPIFY_SHOP;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!queryParam || queryParam.trim().length < 2) {
      return res.status(200).json({ total: 0, products: [] });
    }
    if (!shop || !token) return res.status(400).json({ error: "Missing env variables" });

    const q = queryParam.trim().toLowerCase();
    const gqlQuery = {
      query: `
        query SearchProducts($search: String!) {
          products(first: 50, query: $search) {
            edges {
              node {
                id
                title
                handle
                vendor
                productType
                variants(first: 5) {
                  edges { node { title option1 option2 option3 } }
                }
                images(first: 1) { edges { node { url } } }
              }
            }
          }
        }
      `,
      variables: {
        search: `(title:*${q}* OR vendor:*${q}* OR product_type:*${q}* OR variants.title:*${q}* OR variants.option1:*${q}* OR variants.option2:*${q}* OR variants.option3:*${q}*)`,
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

    let products = result.data.products.edges.map(edge => edge.node);

    // ✅ Multi-word substring match
    const searchWords = q.split(/\s+/); // split query into words
    products = products.filter(product => {
      const haystack = [
        product.title,
        product.productType,
        product.vendor,
        ...(product.variants?.edges.map(v => v.node.title || "")),
        ...(product.variants?.edges.map(v => v.node.option1 || "")),
        ...(product.variants?.edges.map(v => v.node.option2 || "")),
        ...(product.variants?.edges.map(v => v.node.option3 || "")),
      ]
        .join(" ")
        .toLowerCase();

      // Only include product if ALL search words appear in the combined string
      return searchWords.every(word => haystack.includes(word));
    });

    return res.status(200).json({ total: products.length, products });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}
