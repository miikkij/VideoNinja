const fs = require('fs');
const path = require('path');

// Create icons directory if it doesn't exist
const iconsDir = path.join(__dirname, 'src', 'assets', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Normal camera icon (purple/pink)
const normalIcon = `<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#FF6B9D;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#C239B3;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Camera body -->
  <rect x="40" y="80" width="176" height="140" rx="20" fill="url(#grad1)"/>
  
  <!-- Camera lens -->
  <circle cx="128" cy="150" r="50" fill="#FFFFFF" opacity="0.3"/>
  <circle cx="128" cy="150" r="35" fill="#FFFFFF" opacity="0.5"/>
  <circle cx="128" cy="150" r="20" fill="#FFFFFF" opacity="0.8"/>
  
  <!-- Viewfinder -->
  <rect x="60" y="50" width="60" height="40" rx="8" fill="url(#grad1)"/>
  
  <!-- Record button -->
  <circle cx="180" cy="100" r="12" fill="#FF5252"/>
</svg>`;

// Alert icon (with lightning bolt)
const alertIcon = `<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#FFD700;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#FFA500;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Camera body -->
  <rect x="40" y="80" width="176" height="140" rx="20" fill="url(#grad2)"/>
  
  <!-- Camera lens -->
  <circle cx="128" cy="150" r="50" fill="#FFFFFF" opacity="0.3"/>
  <circle cx="128" cy="150" r="35" fill="#FFFFFF" opacity="0.5"/>
  <circle cx="128" cy="150" r="20" fill="#FFFFFF" opacity="0.8"/>
  
  <!-- Viewfinder -->
  <rect x="60" y="50" width="60" height="40" rx="8" fill="url(#grad2)"/>
  
  <!-- Lightning bolt -->
  <path d="M 200 60 L 180 100 L 195 100 L 175 140 L 210 95 L 190 95 Z" fill="#FFD700" stroke="#FF5252" stroke-width="2"/>
</svg>`;

// Main app icon (PNG needed for Windows)
const mainIconSvg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad3" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#FF6B9D;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#C239B3;stop-opacity:1" />
    </linearGradient>
    <filter id="shadow">
      <feGaussianBlur in="SourceAlpha" stdDeviation="8"/>
      <feOffset dx="0" dy="4" result="offsetblur"/>
      <feComponentTransfer>
        <feFuncA type="linear" slope="0.3"/>
      </feComponentTransfer>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  
  <!-- Background circle -->
  <circle cx="256" cy="256" r="220" fill="url(#grad3)" filter="url(#shadow)"/>
  
  <!-- Camera body -->
  <rect x="120" y="180" width="272" height="216" rx="30" fill="#FFFFFF" opacity="0.95"/>
  
  <!-- Camera lens outer -->
  <circle cx="256" cy="288" r="90" fill="url(#grad3)"/>
  
  <!-- Camera lens middle -->
  <circle cx="256" cy="288" r="70" fill="#FFFFFF" opacity="0.3"/>
  <circle cx="256" cy="288" r="50" fill="#FFFFFF" opacity="0.5"/>
  <circle cx="256" cy="288" r="30" fill="#FFFFFF" opacity="0.8"/>
  
  <!-- Viewfinder -->
  <rect x="150" y="130" width="90" height="60" rx="12" fill="#FFFFFF" opacity="0.95"/>
  <rect x="155" y="135" width="80" height="50" rx="8" fill="url(#grad3)"/>
  
  <!-- Record button -->
  <circle cx="340" cy="210" r="20" fill="#FF5252"/>
  <circle cx="340" cy="210" r="15" fill="#FFFFFF" opacity="0.3"/>
  
  <!-- Ninja element (small shuriken) -->
  <g transform="translate(180, 210)">
    <path d="M 0,-15 L 3,-3 L 15,0 L 3,3 L 0,15 L -3,3 L -15,0 L -3,-3 Z" fill="#333333" opacity="0.2"/>
  </g>
</svg>`;

// Write SVG files
fs.writeFileSync(path.join(iconsDir, 'icon.svg'), mainIconSvg);
fs.writeFileSync(path.join(iconsDir, 'icon-normal.svg'), normalIcon);
fs.writeFileSync(path.join(iconsDir, 'icon-alert.svg'), alertIcon);

console.log('✅ Icons generated!');
console.log('📁 Location: src/assets/icons/');
console.log('📝 Files created:');
console.log('   - icon.svg (main app icon)');
console.log('   - icon-normal.svg (tray icon)');
console.log('   - icon-alert.svg (tray alert icon)');
console.log('');
console.log('💡 To generate PNG versions for Windows, you can:');
console.log('   1. Open the SVG files in a browser or image editor');
console.log('   2. Export as PNG in different sizes (16x16, 32x32, 256x256, 512x512)');
console.log('   3. Or use an online converter like cloudconvert.com');
