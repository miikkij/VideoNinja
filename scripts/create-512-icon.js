const fs = require('fs');
const { createCanvas } = require('canvas');

// Create 512x512 icon
const canvas = createCanvas(512, 512);
const ctx = canvas.getContext('2d');

// Red circle background
ctx.fillStyle = '#FF6B6B';
ctx.beginPath();
ctx.arc(256, 256, 240, 0, Math.PI * 2);
ctx.fill();

// White circle for chili emoji background
ctx.fillStyle = 'white';
ctx.font = 'bold 380px Arial';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('🌶️', 256, 280);

// Save
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('src/assets/icons/icon.png', buffer);
console.log('Created 512x512 icon.png');
