const axios = require('axios');
const cheerio = require('cheerio');

async function testSvgHtml() {
  const response = await axios.get('https://fataliiseeds.net/product/chocolate-mirasol/', {
    timeout: 10000,
    headers: {'User-Agent': 'Mozilla/5.0'}
  });
  
  const $ = cheerio.load(response.data);
  
  let heatSvg = null;
  $('svg').each((i, svg) => {
    if ($(svg).find('path').length === 10 && !heatSvg) {
      heatSvg = $(svg);
    }
  });
  
  if (heatSvg) {
    const html = $.html(heatSvg);
    console.log('SVG HTML length:', html.length);
    console.log('\nFull SVG HTML:');
    console.log(html);
  }
}

testSvgHtml();
