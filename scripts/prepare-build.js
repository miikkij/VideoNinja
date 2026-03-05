// Script to create app icons from PNG
const fs = require('fs');
const path = require('path');

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  Fatalii Daily Offers - Icon Generation Instructions      ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');
console.log('To build the app for distribution, you need app icons:');
console.log('');
console.log('Option 1: Use online icon converter (EASIEST)');
console.log('─────────────────────────────────────────────────');
console.log('1. Visit: https://cloudconvert.com/png-to-icns');
console.log('2. Upload: src/assets/icons/chili.png');
console.log('3. Download the .icns file');
console.log('4. Save as: src/assets/icons/icon.icns');
console.log('');
console.log('5. Visit: https://cloudconvert.com/png-to-ico');
console.log('6. Upload: src/assets/icons/chili.png');
console.log('7. Download the .ico file');
console.log('8. Save as: src/assets/icons/icon.ico');
console.log('');
console.log('Option 2: Create simple placeholder icons (QUICK)');
console.log('─────────────────────────────────────────────────');
console.log('We can create basic 256x256 PNG files and electron-builder');
console.log('will attempt to convert them automatically.');
console.log('');

const iconsDir = path.join(__dirname, 'src', 'assets', 'icons');

// Check if icons already exist
const icnsExists = fs.existsSync(path.join(iconsDir, 'icon.icns'));
const icoExists = fs.existsSync(path.join(iconsDir, 'icon.ico'));

if (icnsExists && icoExists) {
  console.log('✅ icon.icns exists');
  console.log('✅ icon.ico exists');
  console.log('');
  console.log('You can now build the app:');
  console.log('');
  console.log('  pnpm build:mac    - Build for macOS (.dmg)');
  console.log('  pnpm build:win    - Build for Windows (.exe)');
  console.log('  pnpm build:all    - Build for both platforms');
  console.log('');
} else {
  console.log('⚠️  Missing icon files:');
  if (!icnsExists) console.log('   - icon.icns (for macOS)');
  if (!icoExists) console.log('   - icon.ico (for Windows)');
  console.log('');
  console.log('Creating placeholder PNG (you should replace these later)...');
  console.log('');
  
  // Create a larger placeholder PNG
  const { execSync } = require('child_process');
  
  try {
    // Try to use ImageMagick if available
    execSync('magick --version', { stdio: 'ignore' });
    console.log('ImageMagick detected, creating icons...');
    
    const pngPath = path.join(iconsDir, 'chili.png');
    const iconPath = path.join(iconsDir, 'icon.png');
    
    // Create 512x512 version for better quality
    execSync(`magick "${pngPath}" -resize 512x512 "${iconPath}"`);
    console.log('✅ Created icon.png (512x512)');
    
    console.log('');
    console.log('Now you can:');
    console.log('1. Upload icon.png to https://cloudconvert.com');
    console.log('2. Convert to .icns and .ico');
    console.log('3. Save in src/assets/icons/');
    
  } catch (e) {
    console.log('⚠️  ImageMagick not found.');
    console.log('');
    console.log('Next steps:');
    console.log('1. Use the chili.png file in src/assets/icons/');
    console.log('2. Convert it to .icns and .ico using cloudconvert.com');
    console.log('3. Place them in src/assets/icons/');
    console.log('4. Run: pnpm build:all');
  }
}

console.log('');
console.log('═══════════════════════════════════════════════════════════');
