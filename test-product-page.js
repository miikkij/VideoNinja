const axios = require('axios');
const cheerio = require('cheerio');

async function testProductPage() {
  try {
    // Test multiple products
    const urls = [
      { name: 'Chilaca (Mild)', url: 'https://fataliiseeds.net/product/chilaca/' },
      { name: 'Chocolate Mirasol (Medium)', url: 'https://fataliiseeds.net/product/chocolate-mirasol/' },
      { name: 'Moruga Green (Super Hot)', url: 'https://fataliiseeds.net/product/moruga-green/' }
    ];
    
    for (const product of urls) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`Testing: ${product.name}`);
      console.log(`URL: ${product.url}`);
      console.log('='.repeat(70));
      
      const response = await axios.get(product.url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const $ = cheerio.load(response.data);
      
      // Find heat SVG (has exactly 10 paths)
      let heatSvg = null;
      $('svg').each((i, svg) => {
        const pathCount = $(svg).find('path').length;
        if (pathCount === 10 && !heatSvg) {
          heatSvg = $(svg);
          console.log(`\nFound heat SVG #${i} with 10 paths`);
        }
      });
      
      if (heatSvg) {
        const paths = heatSvg.find('path');
        console.log('\nAll path colors:');
        
        let coloredChilies = 0;
        const colors = [];
        
        paths.each((j, p) => {
          const fill = $(p).attr('fill');
          const opacity = $(p).attr('fill-opacity');
          console.log(`  Path ${j}: fill=${fill}, opacity=${opacity}`);
          
          // Count non-gray, non-transparent paths
          // Gray = #B3B3B3 or #717B72
          // Leaf = #3F8048
          if (fill && fill !== '#B3B3B3' && fill !== '#717B72' && fill !== '#3F8048' && !opacity) {
            coloredChilies++;
            if (!colors.includes(fill)) colors.push(fill);
          }
        });
        
        console.log(`\nColored chilies found: ${coloredChilies}`);
        console.log(`Unique body colors: ${colors.join(', ')}`);
        console.log(`Heat level: ${coloredChilies}/5`);
        
        const heatNames = {
          0: 'None',
          1: 'Mild',
          2: 'Medium',
          3: 'Hot',
          4: 'Very Hot',
          5: 'Super Hot'
        };
        
        console.log(`Heat description: ${heatNames[coloredChilies]}`);
      } else {
        console.log('No heat SVG found');
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testProductPage();
