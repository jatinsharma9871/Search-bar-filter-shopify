let tokenCache = null;
let tokenExpiry = 0;

async function getShopifyToken() {
  if (tokenCache && Date.now() < tokenExpiry) {
    return tokenCache;
  }

  const response = await fetch(
    `https://${process.env.SHOPIFY_SHOP}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json();

  tokenCache = data.access_token;
  tokenExpiry =
    Date.now() + ((data.expires_in || 86400) - 300) * 1000;

  console.log("Shopify token refreshed");

  return tokenCache;
}

export default async function handler(req, res) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    req.headers.origin || "*"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const query =
      req.method === "POST"
        ? req.body?.query
        : req.query.query;

    if (!query || query.trim().length < 2) {
      return res.status(200).json({
        total: 0,
        products: [],
      });
    }

    const token = await getShopifyToken();

    const q = query.trim().toLowerCase();

    const graphql = {
      query: `
      query SearchProducts($search:String!){
        products(first:100,query:$search){
          edges{
            node{
              id
              title
              handle
              vendor
              productType
              totalInventory

              images(first:1){
                edges{
                  node{
                    url
                  }
                }
              }

              variants(first:100){
                edges{
                  node{
                    id
                    title
                    option1
                    option2
                    option3
                    inventoryQuantity
                  }
                }
              }
            }
          }
        }
      }
      `,
      variables: {
        search: `(title:*${q}* OR vendor:*${q}* OR product_type:*${q}*)`,
      },
    };

    let response = await fetch(
      `https://${process.env.SHOPIFY_SHOP}/admin/api/2025-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify(graphql),
      }
    );

    if (response.status === 401) {
      tokenCache = null;

      const freshToken = await getShopifyToken();

      response = await fetch(
        `https://${process.env.SHOPIFY_SHOP}/admin/api/2025-10/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": freshToken,
          },
          body: JSON.stringify(graphql),
        }
      );
    }

    const result = await response.json();

    if (result.errors) {
      return res.status(500).json({
        error: result.errors,
      });
    }

    const products =
      result?.data?.products?.edges?.map(({ node }) => ({
        id: node.id,
        title: node.title,
        handle: node.handle,
        url: `/products/${node.handle}`,
        vendor: node.vendor,
        productType: node.productType,
        totalInventory: node.totalInventory,

        image:
          node.images?.edges?.[0]?.node?.url || "",

        variants:
          node.variants?.edges?.map(({ node }) => ({
            id: node.id,
            title: node.title,
            option1: node.option1,
            option2: node.option2,
            option3: node.option3,
            inventoryQuantity: node.inventoryQuantity,
          })) || [],
      })) || [];

    return res.status(200).json({
      total: products.length,
      products,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      error: err.message,
    });
  }
}