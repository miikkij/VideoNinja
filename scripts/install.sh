#!/bin/bash

echo "========================================"
echo "Fatalii's Daily Offers - Installation"
echo "========================================"
echo ""
echo "Installing dependencies..."
echo ""

npm install

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================"
    echo "Installation complete!"
    echo "========================================"
    echo ""
    echo "Next steps:"
    echo "1. Add your custom icons to src/assets/icons/"
    echo "2. Run: npm start"
    echo ""
    echo "See QUICK_START.md for details"
    echo ""
else
    echo ""
    echo "========================================"
    echo "Installation failed!"
    echo "========================================"
    echo ""
    echo "Please check:"
    echo "- Node.js is installed"
    echo "- npm is available"
    echo "- You have internet connection"
    echo ""
fi
