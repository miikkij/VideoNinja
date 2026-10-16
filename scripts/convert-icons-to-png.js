const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const iconsDir = path.join(__dirname, '..', 'src', 'assets', 'icons');

// Sizes needed for Windows
const sizes = [16, 32, 48, 64, 128, 256, 512];

async function convertSvgToPng(svgPath, outputPrefix, mainSize) {
  console.log(`\n📷 Converting ${path.basename(svgPath)}...`);

  for (const size of sizes) {
    const outputPath = path.join(iconsDir, `${outputPrefix}-${size}x${size}.png`);

    await sharp(svgPath).resize(size, size).png().toFile(outputPath);

    console.log(`   ✅ ${size}x${size} → ${path.basename(outputPath)}`);
  }

  // Preserve the 512px app icon for packaging and the 256px tray icons.
  const mainIconPath = path.join(iconsDir, `${outputPrefix}.png`);
  await sharp(svgPath).resize(mainSize, mainSize).png().toFile(mainIconPath);
  console.log(`   ✅ Main icon → ${path.basename(mainIconPath)}`);
}

async function main() {
  console.log('🎨 VideoNinja Icon Converter\n');
  console.log('━'.repeat(50));

  const svgFiles = [
    { path: path.join(iconsDir, 'icon.svg'), prefix: 'icon', mainSize: 512 },
    { path: path.join(iconsDir, 'icon-normal.svg'), prefix: 'icon-normal', mainSize: 256 },
    { path: path.join(iconsDir, 'icon-alert.svg'), prefix: 'icon-alert', mainSize: 256 },
  ];

  for (const svg of svgFiles) {
    if (!fs.existsSync(svg.path)) {
      throw new Error(
        `Missing icon source: ${svg.path}. Run node scripts/generate-icons.js first.`,
      );
    }
  }

  for (const svg of svgFiles) {
    await convertSvgToPng(svg.path, svg.prefix, svg.mainSize);
  }

  console.log('\n━'.repeat(50));
  console.log('✨ Done! PNG icons created in src/assets/icons/\n');
  console.log(
    'The Windows icon.ico is unchanged. Update that separate asset when artwork changes.',
  );
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
