const { ipcRenderer } = require('electron');

let currentOffers = [];

// Close button handler
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      window.close();
    });
  }
});

// Listen for offers data from main process
ipcRenderer.on('offers-data', (event, offers) => {
  console.log('Received offers:', offers);
  console.log('Offer image URLs:', offers.map(o => o.imageUrl));
  currentOffers = offers;
  displayOffers(offers);
});

function displayOffers(offers) {
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const containerEl = document.getElementById('offers-container');
  const actionsEl = document.getElementById('actions');
  
  // Hide loading
  loadingEl.style.display = 'none';
  
  // Check if we have offers
  if (!offers || offers.length === 0) {
    errorEl.style.display = 'block';
    return;
  }
  
  // Clear container
  containerEl.innerHTML = '';
  
  // Create product cards
  offers.forEach((offer, index) => {
    const card = createProductCard(offer, index);
    containerEl.appendChild(card);
  });
  
  // Show actions
  actionsEl.style.display = 'block';
}

function createProductCard(offer, index) {
  const card = document.createElement('div');
  card.className = 'product-card';
  
  // Product image
  const imageContainer = document.createElement('div');
  imageContainer.className = 'product-image-container';
  
  const img = document.createElement('img');
  img.className = 'product-image';
  img.src = offer.imageUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="%23f0f0f0"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%23666" font-size="16">No Image</text></svg>';
  img.alt = offer.name;
  img.onerror = () => {
    img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="%23f0f0f0"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%23666" font-size="16">🌶️</text></svg>';
  };
  
  imageContainer.appendChild(img);
  
  // Product info
  const infoDiv = document.createElement('div');
  infoDiv.className = 'product-info';
  
  const nameEl = document.createElement('div');
  nameEl.className = 'product-name';
  nameEl.textContent = offer.name || 'Unknown Product';
  
  infoDiv.appendChild(nameEl);
  
  // Product details row: Plant size | Fruit size | Fruit color | Heat level
  const detailsRow = document.createElement('div');
  detailsRow.className = 'product-details-row';
  
  // Plant size SVG
  if (offer.plantSizeSvg) {
    const plantSizeEl = document.createElement('div');
    plantSizeEl.className = 'product-detail-item';
    
    const temp = document.createElement('div');
    temp.innerHTML = offer.plantSizeSvg;
    const svgElement = temp.querySelector('svg');
    
    if (svgElement) {
      plantSizeEl.appendChild(svgElement);
      detailsRow.appendChild(plantSizeEl);
    }
  }
  
  // Fruit Size SVG
  if (offer.fruitSizeSvg) {
    const fruitSizeEl = document.createElement('div');
    fruitSizeEl.className = 'product-detail-item';
    
    const temp = document.createElement('div');
    temp.innerHTML = offer.fruitSizeSvg;
    const svgElement = temp.querySelector('svg');
    
    if (svgElement) {
      fruitSizeEl.appendChild(svgElement);
      detailsRow.appendChild(fruitSizeEl);
    }
  }
  
  // Fruit color text
  if (offer.fruitColor) {
    const fruitColorEl = document.createElement('div');
    fruitColorEl.className = 'product-detail-item product-detail-color';
    fruitColorEl.textContent = offer.fruitColor;
    detailsRow.appendChild(fruitColorEl);
  }
  
  // Heat level SVG (move to end)
  if (offer.heatSvg) {
    const heatDetailEl = document.createElement('div');
    heatDetailEl.className = 'product-detail-item';
    
    const temp = document.createElement('div');
    temp.innerHTML = offer.heatSvg;
    const svgElement = temp.querySelector('svg');
    
    if (svgElement) {
      heatDetailEl.appendChild(svgElement);
      detailsRow.appendChild(heatDetailEl);
    }
  }
  
  infoDiv.appendChild(detailsRow);
  
  // Add to cart button
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-secondary';
  addBtn.textContent = '🛒 Add to Cart';
  addBtn.onclick = () => addToCart(offer);
  
  // Assemble card
  card.appendChild(imageContainer);
  card.appendChild(infoDiv);
  card.appendChild(addBtn);
  
  return card;
}

function getHeatIcons(count) {
  if (!count || count === 0) return '';
  return '🌶️'.repeat(Math.min(count, 5));
}

function addToCart(offer) {
  console.log('Adding to cart:', offer);
  ipcRenderer.send('add-to-cart', offer.addToCartUrl);
}

function addAllToCart() {
  console.log('Adding all to cart:', currentOffers);
  ipcRenderer.send('add-all-to-cart', currentOffers);
  
  // Close window after a short delay to allow browser tabs to open
  setTimeout(() => {
    window.close();
  }, 1500); // 1.5 second delay
}

// Event listeners
document.getElementById('add-all-btn').addEventListener('click', addAllToCart);

// Request initial data if not received yet
setTimeout(() => {
  if (currentOffers.length === 0) {
    console.log('No offers received, showing error');
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
  }
}, 5000); // 5 second timeout
