// /api/products.js
export default async function handler(req, res) {
  const { query } = req.query;

  const storefrontAccessToken = process.env.SHOPIFY_STOREFRONT_TOKEN;
  const shop = process.env.SHOPIFY_DOMAIN;

  const endpoint = `https://${shop}/api/2023-07/graphql.json`;

  const gqlQuery = {
    query: `
      query($query: String!) {
        products(first: 50, query: $query) {
          edges {
            node {
              id
              title
              vendor
              productType
              handle
              onlineStoreUrl
            }
          }
        }
      }
    `,
    variables: { query }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': storefrontAccessToken,
    },
    body: JSON.stringify(gqlQuery),
  });

  const data = await response.json();
  const products = data.data.products.edges.map(e => e.node);

  res.status(200).json({ products });
}
