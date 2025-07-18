export default async function handler(req, res) {
  const { q } = req.query;
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!q || !shop || !token) {
    return res.status(400).json({ error: 'Missing query or env vars' });
  }

  const graphqlQuery = {
    query: `
      {
        products(first: 100, query: "${q}*") {
          edges {
            node {
              id
              title
              vendor
              productType
              tags
              handle
              featuredImage {
                url
              }
              variants(first: 1) {
                edges {
                  node {
                    price {
                      amount
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
  };

  const response = await fetch(`https://${shop}/admin/api/2024-04/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify(graphqlQuery),
  });

  const result = await response.json();
  const edges = result?.data?.products?.edges || [];

  const products = edges.map(({ node }) => {
    const price = node.variants.edges[0]?.node?.price.amount || '0.00';
    return {
      title: node.title,
      vendor: node.vendor,
      productType: node.productType,
      tags: node.tags,
      handle: node.handle,
      image: node.featuredImage?.url,
      url: `/products/${node.handle}`,
      price,
    };
  });

  // Match logic
  const qLower = q.toLowerCase();
  let matchType = 'general';

  const matchedVendors = products.filter(p => p.vendor.toLowerCase().includes(qLower));
  const matchedColors = products.filter(p => p.tags.some(tag => tag.toLowerCase().includes(qLower)));

  if (matchedVendors.length) {
    matchType = 'vendor';
  } else if (matchedColors.length) {
    matchType = 'color';
  }

  // Group by product type
  const grouped = {};
  (matchType === 'vendor' ? matchedVendors :
   matchType === 'color' ? matchedColors : products
  ).forEach(product => {
    const key = product.productType || 'Other';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(product);
  });

  res.status(200).json({ matchType, grouped });
}
