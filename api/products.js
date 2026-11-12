
let tokenCache = null;
let tokenExpiry = 0;

/* =========================================
   SHOPIFY ACCESS TOKEN
========================================= */

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
    throw new Error(
      `Shopify token error: ${response.status} - ${await response.text()}`
    );
  }

  const data = await response.json();

  tokenCache = data.access_token;

  tokenExpiry =
    Date.now() + ((data.expires_in || 86400) - 300) * 1000;

  console.log("Shopify token refreshed");

  return tokenCache;
}


/* =========================================
   TEXT NORMALIZATION
========================================= */

function normalizeText(value) {

  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

}


/* =========================================
   SEARCH QUERY BUILDER
========================================= */

function buildShopifySearchQuery(query) {

  const words = normalizeText(query)
    .split(" ")
    .filter(word => word.length >= 2);

  const uniqueWords = [...new Set(words)];

  const clauses = [];

  uniqueWords.forEach(word => {

    clauses.push(`title:*${word}*`);
    clauses.push(`vendor:*${word}*`);
    clauses.push(`product_type:*${word}*`);
    clauses.push(`sku:*${word}*`);
    clauses.push(`barcode:*${word}*`);

  });

  return clauses.join(" OR ");

}


/* =========================================
   EXTRACT PRODUCT COLORS
========================================= */

function getProductColors(product) {

  const colors = [];

  function addColor(value) {

    if (typeof value !== "string") return;

    const color = value.trim();

    if (!color) return;

    if (!colors.some(existing =>
      normalizeText(existing) === normalizeText(color)
    )) {
      colors.push(color);
    }

  }

  // Shopify product metafield
  addColor(product.color1);

  // Variant color options
  (product.variants || []).forEach(variant => {

    (variant.selectedOptions || []).forEach(option => {

      if (
        /^(color|colour)$/i.test(
          String(option.name || "").trim()
        )
      ) {
        addColor(option.value);
      }

    });

  });

  return colors;

}


/* =========================================
   PRODUCT MATCH SCORE
========================================= */

function calculateProductScore(product, query) {

  const normalizedQuery = normalizeText(query);

  const queryWords = normalizedQuery.split(" ");

  const title = normalizeText(product.title);
  const vendor = normalizeText(product.vendor);
  const productType = normalizeText(product.productType);

  const titleWords = title.split(" ").filter(Boolean);

  const colors = getProductColors(product);

  // Remove actual color words from query
  // so title matching is independent of color.

  const colorWords = colors.flatMap(color =>
    normalizeText(color).split(" ")
  );

  const vendorWords = vendor.split(" ");

  const remainingWords = queryWords.filter(word =>
    !colorWords.includes(word) &&
    !vendorWords.includes(word)
  );

  const remainingQuery = remainingWords.join(" ");

  const matchedTitleWords = titleWords.filter(word =>
    remainingWords.includes(word)
  );

  const titleRatio = titleWords.length
    ? matchedTitleWords.length / titleWords.length
    : 0;

  const exactTitle = title === remainingQuery;

  const fullTitleMatch =
    titleWords.length > 0 &&
    titleWords.every(word => remainingWords.includes(word));

  const vendorMatch =
    vendor && normalizedQuery.includes(vendor);

  const typeMatch =
    productType &&
    normalizedQuery.includes(productType);

  const colorQueryWords = queryWords.filter(word =>
    colorWords.includes(word)
  );

  const colorMatch =
    colorQueryWords.length > 0 &&
    colorQueryWords.every(word => colorWords.includes(word));

  // Do not show a product with a conflicting color.
  if (colorQueryWords.length > 0 && !colorMatch) {
    return 0;
  }

  let score = 0;

  if (exactTitle) {
    score += 1000;
  } else if (fullTitleMatch) {
    score += 800;
  } else {
    score += Math.round(titleRatio * 500);
  }

  if (colorMatch) score += 250;
  if (vendorMatch) score += 100;
  if (typeMatch) score += 50;

  // Require meaningful title relevance.
  if (
    !exactTitle &&
    !fullTitleMatch &&
    titleRatio < 0.5 &&
    !vendorMatch &&
    !typeMatch
  ) {
    return 0;
  }

  return score;

}


/* =========================================
   MAIN API HANDLER
========================================= */

export default async function handler(req, res) {

  /* CORS */

  const origin = req.headers.origin;

  res.setHeader(
    "Access-Control-Allow-Origin",
    origin || "*"
  );

  res.setHeader(
    "Vary",
    "Origin"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    /* =====================================
       GET SEARCH QUERY
    ===================================== */

    const queryParam =
      req.method === "POST"
        ? req.body?.query
        : req.query?.query;

    if (
      typeof queryParam !== "string" ||
      queryParam.trim().length < 2
    ) {
      return res.status(200).json({
        total: 0,
        products: []
      });
    }

    const searchTerm = queryParam.trim();

    /* =====================================
       ENVIRONMENT VARIABLES
    ===================================== */

    if (
      !process.env.SHOPIFY_SHOP ||
      !process.env.SHOPIFY_CLIENT_ID ||
      !process.env.SHOPIFY_CLIENT_SECRET
    ) {
      return res.status(500).json({
        error: "Missing Shopify environment variables"
      });
    }

    /* =====================================
       GET TOKEN
    ===================================== */

    let token = await getShopifyToken();

    /* =====================================
       BUILD SEARCH QUERY
    ===================================== */

    const shopifySearch = buildShopifySearchQuery(searchTerm);

    console.log("Search query:", searchTerm);
    console.log("Shopify query:", shopifySearch);

    /* =====================================
       SHOPIFY GRAPHQL QUERY

       ADDED:
       - Product metafield custom.color1
       - Product options and positions
       - All selected variant options
       - Product handle
    ===================================== */

    const gqlQuery = {

      query: `

        query SearchProducts($search: String!) {

          products(
            first: 100,
            query: $search
          ) {

            edges {

              node {

                id
                title
                handle
                vendor
                productType
                totalInventory

                metafield(
                  namespace: "custom",
                  key: "color1"
                ) {
                  value
                  type
                }

                options {
                  name
                  position
                }

                variants(first: 100) {

                  edges {

                    node {

                      id
                      title
                      barcode
                      sku

                      selectedOptions {
                        name
                        value
                      }

                    }

                  }

                }

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
        search: shopifySearch
      }

    };


    /* =====================================
       SHOPIFY REQUEST
    ===================================== */

    async function fetchShopify(accessToken) {

      return fetch(
        `https://${process.env.SHOPIFY_SHOP}/admin/api/2025-10/graphql.json`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken
          },

          body: JSON.stringify(gqlQuery)
        }
      );

    }

    let response = await fetchShopify(token);


    /* =====================================
       RETRY IF TOKEN EXPIRED
    ===================================== */

    if (response.status === 401) {

      tokenCache = null;
      tokenExpiry = 0;

      token = await getShopifyToken();

      response = await fetchShopify(token);

    }

    if (!response.ok) {

      const errorText = await response.text();

      throw new Error(
        `Shopify API error: ${response.status} - ${errorText}`
      );

    }


    /* =====================================
       PARSE GRAPHQL RESPONSE
    ===================================== */

    const result = await response.json();

    if (result.errors) {

      console.error(
        "Shopify GraphQL errors:",
        result.errors
      );

      return res.status(500).json({
        error: result.errors
      });

    }

    const edges = result?.data?.products?.edges || [];


    /* =====================================
       NORMALIZE PRODUCT DATA

       This is the most important update.
    ===================================== */

    const products = edges.map(({ node }) => {

      const metafield = node.metafield;

      const variants = (node.variants?.edges || []).map(
        ({ node: variant }) => {

          const selectedOptions =
            variant.selectedOptions || [];

          return {

            id: variant.id,
            title: variant.title,
            barcode: variant.barcode,
            sku: variant.sku,

            selectedOptions,

            // Preserve legacy option fields.
            option1: selectedOptions[0]?.value || "",
            option2: selectedOptions[1]?.value || "",
            option3: selectedOptions[2]?.value || ""

          };

        }
      );

      const product = {

        id: node.id,

        title: node.title,

        handle: node.handle,

        url: `/products/${node.handle}`,

        vendor: node.vendor,

        productType: node.productType,

        totalInventory: node.totalInventory,

        // Actual Shopify color metafield
        color: metafield?.value || "",
        color1: metafield?.value || "",

        metafields: {
          custom: {
            color1: metafield
              ? {
                  value: metafield.value,
                  type: metafield.type
                }
              : null
          }
        },

        options: node.options || [],

        variants,

        image:
          node.images?.edges?.[0]?.node?.url || ""

      };

      return product;

    });


    /* =====================================
       INVENTORY FILTER

       Preserves your original behavior.
    ===================================== */

    const availableProducts = products.filter(product =>
      Number(product.totalInventory) > 0
    );


    /* =====================================
       RELEVANCE RANKING

       Exact title first.
       Full title second.
       Partial matches afterward.
    ===================================== */

    const rankedProducts = availableProducts

      .map(product => {

        const score = calculateProductScore(
          product,
          searchTerm
        );

        return {
          ...product,
          searchScore: score
        };

      })

      .filter(product => product.searchScore > 0)

      .sort((a, b) =>
        b.searchScore - a.searchScore
      );


    /* =====================================
       FINAL RESPONSE
    ===================================== */

    console.log(
      "Products returned:",
      rankedProducts.length
    );

    console.log(
      "Top matching products:",
      rankedProducts.slice(0, 10).map(product => ({
        title: product.title,
        vendor: product.vendor,
        color: product.color,
        score: product.searchScore
      }))
    );

    return res.status(200).json({

      query: searchTerm,

      total: rankedProducts.length,

      products: rankedProducts

    });

  } catch (err) {

    console.error("Handler error:", err);

    return res.status(500).json({

      error: err.message,

      products: []

    });

  }

}
