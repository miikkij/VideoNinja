const axios = require('axios');
const cheerio = require('cheerio');

const FATALIISEEDS_URL = 'https://fataliiseeds.net';

/**
 * Fetch daily offers from Fataliiseeds.net
 * @returns {Promise<Array>} Array of product objects with name, image, heat, url, productId
 */
async function fetchDailyOffers() {
  try {
    console.log('Fetching daily offers from:', FATALIISEEDS_URL);
    const response = await axios.get(FATALIISEEDS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000 // 10 second timeout
    });
    
    console.log('Response received, status:', response.status);
    const $ = cheerio.load(response.data);
    const offers = [];
    
    // Find the "Varieties of the day with 20% discount" section
    const dailySection = $('h2:contains("Varieties of the day with 20% discount")').parent();
    
    console.log('Daily section found:', dailySection.length > 0);
    
    if (!dailySection.length) {
      console.error('Daily offers section not found');
      console.log('Trying alternative method...');
      return await fetchOffersAlternativeMethod($);
    }
    
    // Find product links with "20% off!" text
    const productLinks = dailySection.find('a[href*="/product/"]:has(img)');
    
    console.log('Product links found:', productLinks.length);
    
    productLinks.each((i, elem) => {
      if (offers.length >= 3) return false; // Only get first 3
      
      const $elem = $(elem);
      const productUrl = $elem.attr('href');
      
      if (!productUrl || !productUrl.includes('/product/')) return;
      
      // Extract product slug from URL
      const productSlug = productUrl.split('/product/')[1]?.replace('/', '');
      if (!productSlug) return;
      
      // Get product image
      const $img = $elem.find('img');
      const imageUrl = $img.attr('src') || $img.attr('data-src');
      
      // Get product name from title or alt text
      let productName = $img.attr('alt') || $img.attr('title') || '';
      
      // Skip invalid products like promo images or banners
      if (!productName || productName.toLowerCase().includes('promo') || 
          productName.toLowerCase().includes('banner') || 
          productName.toLowerCase().includes('advertisement')) {
        return;
      }
      
      // Try to find product name from nearby text
      if (!productName) {
        const titleText = $elem.closest('a').next().text().trim();
        if (titleText) productName = titleText;
      }
      
      // Clean up name - remove "20% off!" prefix
      productName = productName.replace(/20%\s*off!\s*/i, '').trim();
      
      offers.push({
        name: productName,
        imageUrl: imageUrl,
        productUrl: productUrl,
        slug: productSlug,
        heat: null, // Will be fetched from product page if needed
        addToCartUrl: productUrl // Will be updated with product ID if available
      });
    });
    
    // If we couldn't find 3 offers with the primary method, try alternative
    if (offers.length < 3) {
      console.log(`Primary method found only ${offers.length} offers, trying alternative...`);
      const altOffers = await fetchOffersAlternativeMethod($);
      console.log('Alternative method found:', altOffers.length, 'offers');
      
      if (altOffers.length > 0) {
        console.log('Fetching details for alternative offers...');
        const detailedAltOffers = await Promise.all(
          altOffers.map(offer => fetchProductDetails(offer))
        );
        const validAltOffers = detailedAltOffers.filter(offer => offer !== null);
        console.log('Returning', validAltOffers.length, 'valid alternative offers');
        return validAltOffers;
      }
      
      return altOffers;
    }
    
    console.log('Found', offers.length, 'offers, fetching details...');
    
    // Fetch detailed info for each product (including heat level and product ID)
    const detailedOffers = await Promise.all(
      offers.map(offer => fetchProductDetails(offer))
    );
    
    const validOffers = detailedOffers.filter(offer => offer !== null);
    console.log('Returning', validOffers.length, 'valid offers');
    
    return validOffers;
    
  } catch (error) {
    console.error('Error fetching daily offers:', error.message);
    console.error('Error stack:', error.stack);
    if (error.code) console.error('Error code:', error.code);
    return [];
  }
}

/**
 * Alternative method to find daily offers
 */
async function fetchOffersAlternativeMethod($) {
  const offers = [];
  const seenUrls = new Set();
  
  // Try multiple selectors to find daily offers
  const selectors = [
    'a[href*="DAILY20"]',           // Links with DAILY20 in URL
    'a:contains("20% off")',         // Links mentioning 20% off
    'a:contains("DAILY20")',         // Links mentioning DAILY20 text
    '.product a[href*="/product/"]', // General product links as fallback
    'li.product a.woocommerce-LoopProduct-link' // WooCommerce product links
  ];
  
  for (const selector of selectors) {
    if (offers.length >= 3) break;
    
    $(selector).each((i, elem) => {
      if (offers.length >= 3) return false;
      
      const $elem = $(elem);
      const $productLink = $elem.attr('href')?.includes('/product/') 
        ? $elem 
        : $elem.closest('a[href*="/product/"]').length 
          ? $elem.closest('a[href*="/product/"]') 
          : $elem.find('a[href*="/product/"]').first();
      
      if (!$productLink.length) return;
      
      const productUrl = $productLink.attr('href');
      if (!productUrl || seenUrls.has(productUrl)) return;
      
      const productSlug = productUrl?.split('/product/')[1]?.replace('/', '');
      if (!productSlug) return;
      
      seenUrls.add(productUrl);
      
      const $img = $productLink.find('img').first();
      const imageUrl = $img.attr('src') || $img.attr('data-src');
      const productName = $img.attr('alt') || productSlug.replace(/-/g, ' ');
      
      offers.push({
        name: productName,
        imageUrl: imageUrl,
        productUrl: productUrl,
        slug: productSlug,
        heat: null,
        addToCartUrl: productUrl
      });
    });
  }
  
  console.log(`Alternative method found ${offers.length} unique products`);
  return offers;
}

/**
 * Fetch detailed product information including heat level and product ID
 */
async function fetchProductDetails(offer) {
  try {
    const response = await axios.get(offer.productUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000 // 10 second timeout
    });
    
    const $ = cheerio.load(response.data);
    
    // Extract product ID from add to cart button/form
    const productId = $('button[name="add-to-cart"]').attr('value') ||
                      $('input[name="add-to-cart"]').attr('value') ||
                      $('.product').attr('data-product_id');
    
    // Get heat level SVG HTML directly (instead of counting)
    let heatLevel = 0;
    let heatDescription = 'Unknown';
    let heatSvgHtml = null;
    
    // Find heat level SVG (has exactly 10 paths for 5 chilies)
    let heatSvg = null;
    $('svg').each((i, svg) => {
      const pathCount = $(svg).find('path').length;
      if (pathCount === 10 && !heatSvg) {
        heatSvg = $(svg);
      }
    });
    
    if (heatSvg) {
      // Get the SVG HTML directly
      heatSvgHtml = $.html(heatSvg);
      
      // Also count for backwards compatibility
      const paths = heatSvg.find('path');
      let fullChilies = 0;
      
      paths.each((i, path) => {
        const fill = $(path).attr('fill');
        const opacity = $(path).attr('fill-opacity');
        
        if (fill && 
            fill !== '#B3B3B3' && 
            fill !== '#717B72' && 
            fill !== '#3F8048' && 
            !opacity) {
          fullChilies++;
        }
      });
      
      heatLevel = fullChilies;
      const heatNames = {
        0: 'None',
        1: 'Mild',
        2: 'Medium',
        3: 'Hot',
        4: 'Very Hot',
        5: 'Super Hot'
      };
      heatDescription = heatNames[fullChilies] || 'Unknown';
      
      console.log(`Found heat level for ${offer.slug}: ${heatLevel}/5 (${heatDescription})`);
    }
    
    // Extract Plant size SVG (4 paths in params table)
    let plantSizeSvgHtml = '';
    const paramsTable = $('table.detail-product__params');
    if (paramsTable.length) {
      const rows = paramsTable.find('tr');
      rows.each((i, row) => {
        const label = $(row).find('td').first().text().trim();
        if (label === 'Plant size') {
          const valueCell = $(row).find('td').eq(1);
          const svg = valueCell.find('svg');
          if (svg.length) {
            plantSizeSvgHtml = $.html(svg);
            console.log(`Found Plant size SVG for ${offer.slug}`);
          }
        }
      });
    }
    
    // Extract Fruit Size SVG (18 paths in params table)
    let fruitSizeSvgHtml = '';
    if (paramsTable.length) {
      const rows = paramsTable.find('tr');
      rows.each((i, row) => {
        const label = $(row).find('td').first().text().trim();
        if (label === 'Fruit Size') {
          const valueCell = $(row).find('td').eq(1);
          const svg = valueCell.find('svg');
          if (svg.length) {
            fruitSizeSvgHtml = $.html(svg);
            console.log(`Found Fruit Size SVG for ${offer.slug}`);
          }
        }
      });
    }
    
    // Extract Fruit color text (might be empty)
    let fruitColor = '';
    if (paramsTable.length) {
      const rows = paramsTable.find('tr');
      rows.each((i, row) => {
        const label = $(row).find('td').first().text().trim();
        if (label === 'Fruit color') {
          const valueCell = $(row).find('td').eq(1);
          fruitColor = valueCell.text().trim();
          if (fruitColor) {
            console.log(`Found Fruit color for ${offer.slug}: ${fruitColor}`);
          }
        }
      });
    }
    
    // Get better quality image - try multiple selectors
    const imageSelectors = [
      '.woocommerce-product-gallery__image img',
      '.product-image img',
      '.wp-post-image',
      'img.attachment-shop_single',
      '.product img[src*=".jpg"], .product img[src*=".png"]',
      'meta[property="og:image"]',
      'img' // Fallback: just get first meaningful image
    ];
    
    let betterImageUrl = offer.imageUrl;
    
    // First try: look for image with product name in alt text (case-insensitive)
    const productNameWords = offer.name.split(/[-\s]+/);
    for (const word of productNameWords) {
      if (word.length > 2) { // Skip very short words
        const $imgByAlt = $(`img[alt*="${word}" i]`).first(); // 'i' flag for case-insensitive
        const altUrl = $imgByAlt.attr('src');
        if (altUrl && (altUrl.includes('.jpg') || altUrl.includes('.png') || altUrl.includes('.webp'))) {
          betterImageUrl = altUrl;
          console.log(`Found image by alt text match '${word}' for ${offer.slug}: ${altUrl}`);
          break;
        }
      }
    }
    
    // If not found by alt, try other selectors
    if (!betterImageUrl) {
      for (const selector of imageSelectors) {
        const $img = $(selector).first();
        if (selector.includes('meta')) {
          const metaUrl = $img.attr('content');
          if (metaUrl) {
            betterImageUrl = metaUrl;
            console.log(`Found image from meta tag for ${offer.slug}: ${metaUrl}`);
            break;
          }
        } else {
          const imgUrl = $img.attr('src') || $img.attr('data-src') || $img.attr('data-large_image');
          if (imgUrl && (imgUrl.includes('.jpg') || imgUrl.includes('.png') || imgUrl.includes('.webp'))) {
            betterImageUrl = imgUrl;
            console.log(`Found image with selector '${selector}' for ${offer.slug}: ${imgUrl}`);
            break;
          }
        }
      }
    }
    
    if (!betterImageUrl) {
      console.warn(`No image found for ${offer.slug}, keeping original: ${offer.imageUrl}`);
    }
    
    // Get product name if we don't have it
    let productName = offer.name;
    if (!productName || productName.length < 2) {
      productName = $('.product_title, h1.entry-title').first().text().trim();
    }
    
    return {
      ...offer,
      name: productName,
      imageUrl: betterImageUrl,
      heat: heatDescription,
      heatLevel: heatLevel,
      heatSvg: heatSvgHtml, // Raw SVG HTML
      plantSizeSvg: plantSizeSvgHtml, // Raw Plant size SVG HTML
      fruitSizeSvg: fruitSizeSvgHtml, // Raw Fruit Size SVG HTML
      fruitColor: fruitColor, // Fruit color text (may be empty)
      productId: productId,
      addToCartUrl: productId 
        ? `${offer.productUrl}?add-to-cart=${productId}`
        : offer.productUrl
    };
    
  } catch (error) {
    console.error(`Error fetching details for ${offer.name}:`, error.message);
    return offer; // Return original offer if details fetch fails
  }
}

/**
 * Convert heat icon count to heat level text
 */
function heatLevel(iconCount) {
  if (iconCount === 0 || iconCount === 1) return 'Mild';
  if (iconCount === 2) return 'Medium';
  if (iconCount === 3) return 'Hot';
  if (iconCount === 4) return 'Very Hot';
  if (iconCount >= 5) return 'Super Hot';
  return 'Unknown';
}

module.exports = {
  fetchDailyOffers
};
