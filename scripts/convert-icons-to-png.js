const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const iconsDir = path.join(__dirname, 'src', 'assets', 'icons');

// Sizes needed for Windows
const sizes = [16, 32, 48, 64, 128, 256, 512];

async function convertSvgToPng(svgPath, outputPrefix) {
  console.log(`\n📷 Converting ${path.basename(svgPath)}...`);
  
  for (const size of sizes) {
    try {
      const outputPath = path.join(iconsDir, `${outputPrefix}-${size}x${size}.png`);
      
      await sharp(svgPath)
        .resize(size, size)
        .png()
        .toFile(outputPath);
      
      console.log(`   ✅ ${size}x${size} → ${path.basename(outputPath)}`);
    } catch (err) {
      console.error(`   ❌ ${size}x${size} failed:`, err.message);
    }
  }
  
  // Create the main icon.png (256x256 for electron-builder)
  const mainIconPath = path.join(iconsDir, `${outputPrefix}.png`);
  await sharp(svgPath)
    .resize(256, 256)
    .png()
    .toFile(mainIconPath);
  console.log(`   ✅ Main icon → ${path.basename(mainIconPath)}`);
}

async function main() {
  console.log('🎨 VideoNinja Icon Converter\n');
  console.log('━'.repeat(50));
  
  const svgFiles = [
    { path: path.join(iconsDir, 'icon.svg'), prefix: 'icon' },
    { path: path.join(iconsDir, 'icon-normal.svg'), prefix: 'icon-normal' },
    { path: path.join(iconsDir, 'icon-alert.svg'), prefix: 'icon-alert' }
  ];
  
  for (const svg of svgFiles) {
    if (fs.existsSync(svg.path)) {
      await convertSvgToPng(svg.path, svg.prefix);
    } else {
      console.log(`⚠️  ${svg.path} not found, skipping...`);
    }
  }
  
  console.log('\n━'.repeat(50));
  console.log('✨ Done! PNG icons created in src/assets/icons/\n');
  console.log('💡 Tip: For .ico file, you can use:');
  console.log('   - https://convertico.com/');
  console.log('   - Or electron-builder will create it automatically on build');
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
