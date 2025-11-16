const axios = require('axios');
const cheerio = require('cheerio');

async function testScrape() {
  const url = 'https://fataliiseeds.net/product/chilaca/';
  console.log('Fetching:', url);
  
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    timeout: 10000
  });
  
  const $ = cheerio.load(response.data);
  
  console.log('\n=== Image selectors test ===');
  
  const selectors = [
    '.woocommerce-product-gallery__image img',
    '.product-image img',
    '.wp-post-image',
    'img.attachment-shop_single',
    '.product img[src*=".jpg"]',
    '.product img[src*=".png"]',
    'meta[property="og:image"]',
    'img[alt*="chilaca"]',
    'img[alt*="Chilaca"]',
    '.woocommerce-product-gallery img',
    'figure img'
  ];
  
  selectors.forEach(selector => {
    const $elem = $(selector).first();
    if ($elem.length > 0) {
      if (selector.includes('meta')) {
        console.log(`✓ ${selector}: ${$elem.attr('content')}`);
      } else {
        console.log(`✓ ${selector}:`);
        console.log(`  src: ${$elem.attr('src')}`);
        console.log(`  data-src: ${$elem.attr('data-src')}`);
        console.log(`  srcset: ${$elem.attr('srcset')?.substring(0, 100)}`);
      }
    } else {
      console.log(`✗ ${selector}: not found`);
    }
  });
  
  // Just list ALL images
  console.log('\n=== All images on page ===');
  let count = 0;
  $('img').each((i, elem) => {
    const $img = $(elem);
    const src = $img.attr('src');
    if (src && !src.includes('data:image') && src.length > 10) {
      count++;
      console.log(`Image ${count}:`);
      console.log(`  src: ${src}`);
      console.log(`  alt: ${$img.attr('alt')}`);
      console.log(`  class: ${$img.attr('class')}`);
    }
  });
}

testScrape().catch(console.error);
