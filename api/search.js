export default async function handler(req, res) {
  const { q } = req.query;
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!q || !shop || !token) {
    return res.status(400).json({ error: 'Missing query or env vars' });
  }

  const gqlQuery = {
    query: `
      {
        products(first: 20, query: "${q}*") {
          edges {
            node {
              id
              title
              handle
              vendor
              productType
              onlineStoreUrl
              images(first: 1) {
                edges {
                  node {
                    url
                    altText
                  }
                }
              }
            }
          }
        }
      }
    `,
  };

  try {
    const response = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify(gqlQuery),
    });

    const json = await response.json();

    const products = json.data.products.edges.map(({ node }) => ({
      title: node.title,
      handle: node.handle,
      url: node.onlineStoreUrl || `/products/${node.handle}`,
      vendor: node.vendor,
      product_type: node.productType,
      image: node.images.edges[0]?.node?.url || null,
      alt: node.images.edges[0]?.node?.altText || node.title,
    }));

    res.status(200).json({ products });
  } catch (error) {
    console.error('App Proxy Search Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
