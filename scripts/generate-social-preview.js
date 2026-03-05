/**
 * Generate social preview image for GitHub (1280x640)
 * Uses the project's icon SVG embedded inline, no external dependencies.
 * Run: node scripts/generate-social-preview.js
 * Output: docs/social-preview.svg (upload to GitHub Settings → General → Social preview)
 */

const fs = require('fs');
const path = require('path');

const svg = `<svg width="1280" height="640" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#16213e;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#FF6B9D;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#C239B3;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="accent2" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#FF6B9D;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#C239B3;stop-opacity:1" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1280" height="640" fill="url(#bg)" />

  <!-- Subtle grid pattern -->
  <g opacity="0.03">
    ${Array.from({length: 32}, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="640" stroke="white" stroke-width="1"/>`).join('\n    ')}
    ${Array.from({length: 16}, (_, i) => `<line x1="0" y1="${i * 40}" x2="1280" y2="${i * 40}" stroke="white" stroke-width="1"/>`).join('\n    ')}
  </g>

  <!-- Decorative circles -->
  <circle cx="1100" cy="100" r="200" fill="url(#accent)" opacity="0.05" />
  <circle cx="180" cy="540" r="150" fill="url(#accent)" opacity="0.05" />

  <!-- Accent line at top -->
  <rect x="0" y="0" width="1280" height="4" fill="url(#accent2)" />

  <!-- App icon (scaled down from icon.svg) -->
  <g transform="translate(200, 190) scale(0.5)">
    <!-- Background circle -->
    <circle cx="256" cy="256" r="220" fill="url(#accent)"/>
    <!-- Camera body -->
    <rect x="120" y="180" width="272" height="216" rx="30" fill="#FFFFFF" opacity="0.95"/>
    <!-- Camera lens -->
    <circle cx="256" cy="288" r="90" fill="url(#accent)"/>
    <circle cx="256" cy="288" r="70" fill="#FFFFFF" opacity="0.3"/>
    <circle cx="256" cy="288" r="50" fill="#FFFFFF" opacity="0.5"/>
    <circle cx="256" cy="288" r="30" fill="#FFFFFF" opacity="0.8"/>
    <!-- Viewfinder -->
    <rect x="150" y="130" width="90" height="60" rx="12" fill="#FFFFFF" opacity="0.95"/>
    <rect x="155" y="135" width="80" height="50" rx="8" fill="url(#accent)"/>
    <!-- Record button -->
    <circle cx="340" cy="210" r="20" fill="#FF5252"/>
    <circle cx="340" cy="210" r="15" fill="#FFFFFF" opacity="0.3"/>
    <!-- Ninja element -->
    <g transform="translate(180, 210)">
      <path d="M 0,-15 L 3,-3 L 15,0 L 3,3 L 0,15 L -3,3 L -15,0 L -3,-3 Z" fill="#333333" opacity="0.2"/>
    </g>
  </g>

  <!-- App name -->
  <text x="530" y="300" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="72" font-weight="700" fill="white" letter-spacing="-1">
    Video<tspan fill="url(#accent)">Ninja</tspan>
  </text>

  <!-- Tagline -->
  <text x="530" y="355" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="24" fill="#8892b0" font-weight="400">
    A beautiful, user-friendly video downloader
  </text>

  <!-- Feature pills -->
  <g transform="translate(530, 400)">
    <!-- Electron pill -->
    <rect x="0" y="0" width="110" height="36" rx="18" fill="#FF6B9D" opacity="0.15" stroke="#FF6B9D" stroke-width="1" stroke-opacity="0.3"/>
    <text x="55" y="23" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="14" fill="#FF6B9D" text-anchor="middle" font-weight="500">Electron</text>

    <!-- yt-dlp pill -->
    <rect x="125" y="0" width="90" height="36" rx="18" fill="#FF6B9D" opacity="0.15" stroke="#FF6B9D" stroke-width="1" stroke-opacity="0.3"/>
    <text x="170" y="23" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="14" fill="#FF6B9D" text-anchor="middle" font-weight="500">yt-dlp</text>

    <!-- Cross-platform pill -->
    <rect x="230" y="0" width="150" height="36" rx="18" fill="#FF6B9D" opacity="0.15" stroke="#FF6B9D" stroke-width="1" stroke-opacity="0.3"/>
    <text x="305" y="23" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="14" fill="#FF6B9D" text-anchor="middle" font-weight="500">Cross-platform</text>

    <!-- Open Source pill -->
    <rect x="395" y="0" width="130" height="36" rx="18" fill="#FF6B9D" opacity="0.15" stroke="#FF6B9D" stroke-width="1" stroke-opacity="0.3"/>
    <text x="460" y="23" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="14" fill="#FF6B9D" text-anchor="middle" font-weight="500">Open Source</text>
  </g>

  <!-- Bottom accent line -->
  <rect x="0" y="636" width="1280" height="4" fill="url(#accent2)" />
</svg>`;

const outputPath = path.join(__dirname, '..', 'docs', 'social-preview.svg');
fs.writeFileSync(outputPath, svg, 'utf8');
console.log(`Social preview SVG created at: ${outputPath}`);
console.log('');
console.log('To use as GitHub social preview:');
console.log('1. Open the SVG in a browser');
console.log('2. Take a screenshot or use a tool to convert to PNG (1280x640)');
console.log('3. Go to GitHub repo → Settings → General → Social preview → Upload');
console.log('');
console.log('Or convert with: npx svg2png-cli docs/social-preview.svg -o docs/social-preview.png -w 1280 -h 640');
