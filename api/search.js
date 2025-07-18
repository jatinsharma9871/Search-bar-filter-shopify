export default async function handler(req, res) {
  const { q } = req.query;
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!q || !shop || !token) {
    return res.status(400).json({ error: 'Missing query or env vars' });
  }

  let hasNextPage = true;
  let endCursor = null;
  const allProducts = [];

  while (hasNextPage && allProducts.length < 1000) { // optional max cap
    const gqlQuery = {
      query: `
        {
          products(first: 100${endCursor ? `, after: "${endCursor}"` : ''}, query: "*${q}*") {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                title
                vendor
                productType
                tags
                handle
              }
            }
          }
        }
      `
    };

    const response = await fetch(`https://${shop}/admin/api/2024-04/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify(gqlQuery),
    });

    const result = await response.json();

    const products = result?.data?.products?.edges || [];
    allProducts.push(...products.map(e => ({
      title: e.node.title,
      vendor: e.node.vendor,
      product_type: e.node.productType,
      tags: e.node.tags,
      url: `/products/${e.node.handle}`,
    })));

    hasNextPage = result?.data?.products?.pageInfo?.hasNextPage;
    endCursor = result?.data?.products?.pageInfo?.endCursor;
  }

  return res.status(200).json({ products: allProducts });
}
