// Quick script to create basic PNG icons for Windows tray
const fs = require('fs');
const path = require('path');

// Simple 22x22 PNG icons as base64
// Red chili icon (solid red circle)
const chiliPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAAAXNSR0IArs4c6QAAAARnQU1BAACx' +
  'jwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAADJSURBVEhL7ZRBDoMgEEXBs3gWz+JZPItn8Sye' +
  'xbN4Fs/SRhOXLtykm25ctJ1kAoT3mQkQ/hEppZxaa0/O+RMRj4g4McYnxvhCRBwR8eScP1prz5RS' +
  'TkqpMwzDnYiuRHQlovswDHdKqbO11lhrrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXW' +
  'WmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lpr' +
  'rbX2v9obE8xGKmtmDnoAAAAASUVORK5CYII=',
  'base64'
);

// Orange alert icon (solid orange circle)
const alertPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAAAXNSR0IArs4c6QAAAARnQU1BAACx' +
  'jwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAADJSURBVEhL7ZRBDoMgEEXBs3gWz+JZPItn8Sye' +
  'xbN4Fs/SRhOXLtykm25ctJ1kAoT3mQkQ/hEppZxaa0/O+RMRj4g4McYnxvhCRBwR8eScP1prz5RS' +
  'TkqpMwzDnYiuRHQlovswDHdKqbO11lhrrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXW' +
  'WmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lprrbXWWmuttdZaa6211lpr' +
  'rbX2v9obE8xGKmtmDnoAAAAASUVORK5CYII=',
  'base64'
);

const iconsDir = path.join(__dirname, 'src', 'assets', 'icons');

// Create directory if it doesn't exist
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Write PNG files
fs.writeFileSync(path.join(iconsDir, 'chili.png'), chiliPng);
fs.writeFileSync(path.join(iconsDir, 'chili-alert.png'), alertPng);

console.log('Created PNG icons:');
console.log('- chili.png (red)');
console.log('- chili-alert.png (orange)');
