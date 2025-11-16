const axios = require('axios');
const cheerio = require('cheerio');

async function testProductDetails() {
  const response = await axios.get('https://fataliiseeds.net/product/chocolate-mirasol/', {
    timeout: 10000,
    headers: {'User-Agent': 'Mozilla/5.0'}
  });
  
  const $ = cheerio.load(response.data);
  
  console.log('=== Looking for product details ===\n');
  
  // Try to find Plant size, Fruit size, Fruit color images/icons
  // Look for any icon/image elements near these labels
  
  // Method 1: Look for dt/dd structures
  $('dt, .label, .attr-label').each((i, el) => {
    const text = $(el).text().trim();
    if (text.match(/plant size|fruit size|fruit color/i)) {
      console.log(`Found label: "${text}"`);
      const next = $(el).next();
      console.log('Next element HTML:', next.html()?.substring(0, 200));
      console.log('');
    }
  });
  
  // Method 2: Look for specific classes or data attributes
  console.log('\n=== All images with size/color in context ===\n');
  $('img').each((i, img) => {
    const alt = $(img).attr('alt') || '';
    const src = $(img).attr('src') || '';
    const parent = $(img).parent();
    const parentText = parent.text().trim();
    
    if (parentText.match(/plant|fruit|size|color/i)) {
      console.log(`Image ${i}:`);
      console.log('  Alt:', alt);
      console.log('  Src:', src.substring(0, 100));
      console.log('  Parent text:', parentText.substring(0, 100));
      console.log('');
    }
  });
  
  // Method 3: Look for product detail SVG icons
  console.log('\n=== Product detail SVGs ===\n');
  
  // Heat level SVG (10 paths)
  const heatSvg = $('svg').filter((i, svg) => $(svg).find('path').length === 10).first();
  if (heatSvg.length) {
    console.log('Heat level SVG:');
    console.log($.html(heatSvg).substring(0, 200));
    console.log('...\n');
  }
  
  // Size SVG (4 paths, class contains 'size')
  const sizeSvgs = $('svg').filter((i, svg) => {
    const paths = $(svg).find('path').length;
    const parent = $(svg).parent();
    const parentClass = parent.attr('class') || '';
    return paths === 4 && parentClass.includes('size');
  });
  
  console.log(`Found ${sizeSvgs.length} size SVGs`);
  if (sizeSvgs.length > 0) {
    console.log('\nFirst size SVG:');
    console.log($.html(sizeSvgs.first()).substring(0, 300));
    console.log('...\n');
  }
  
  // Look for fruit color and size text
  console.log('\n=== Product specification table ===\n');
  $('dt, dd, .specification, .product-info, [class*="spec"], [class*="detail"]').each((i, el) => {
    const text = $(el).text().trim();
    const tagName = el.tagName.toLowerCase();
    const className = $(el).attr('class') || '';
    
    if (text.toLowerCase().includes('size') || 
        text.toLowerCase().includes('color') || 
        text.toLowerCase().includes('colour') ||
        text.toLowerCase().includes('koko') ||
        text.toLowerCase().includes('väri')) {
      console.log(`${tagName}.${className}: "${text}"`);
    }
  });
  
  // Check for product attributes table
  console.log('\n=== Product params table structure ===\n');
  const paramsTable = $('table.detail-product__params');
  if (paramsTable.length) {
    console.log('Found params table!\n');
    
    paramsTable.find('tr').each((i, row) => {
      const label = $(row).find('td').first().text().trim();
      const valueCell = $(row).find('td').eq(1);
      
      // Check for SVG in value cell
      const svg = valueCell.find('svg');
      if (svg.length) {
        const paths = svg.find('path').length;
        const svgClass = svg.attr('class') || '';
        const parentClass = svg.parent().attr('class') || '';
        console.log(`Row ${i}: "${label}"`);
        console.log(`  SVG: ${paths} paths, svg class: "${svgClass}", parent: "${parentClass}"`);
        console.log(`  HTML preview: ${$.html(svg).substring(0, 150)}...\n`);
      } else {
        const text = valueCell.text().trim();
        console.log(`Row ${i}: "${label}" = "${text}"\n`);
      }
    });
  } else {
    console.log('No params table found');
  }
}

testProductDetails();
