export default async function handler(req, res) {
  const { q } = req.query;

  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  const response = await fetch(`https://${shop}/admin/api/2023-10/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: `
        {
          products(first: 250, query: "${q}*", sortKey: TITLE) {
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

  const data = await response.json();
  const products = data.data.products.edges.map(edge => edge.node);
  res.status(200).json({ products });
}
