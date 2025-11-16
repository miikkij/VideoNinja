# Fatalii's Daily Offers - Tekninen Suunnitelma

## 📋 Yhteenveto

Status bar/system tray sovellus, joka näyttää päivittäiset 20% alennukset Fataliiseeds.net sivustolta macOS:lle ja Windowsille.

---

## 🎯 Vaatimukset

### Toiminnallisuudet
1. **Status bar ikoni**
   - Chili-ikoni joka animoituu (chili ↔ huutomerkki 0,5-1s välein) kun uudet tarjoukset saatavilla
   - Toimii macOS menu bar:ssa ja Windows system tray:ssä

2. **Päivän tarjoukset**
   - Scrape 3 päivittäistä lajiketta fataliiseeds.net etusivulta
   - Kohdasta "Varieties of the day with 20% discount"
   - Tiedot: kuva, nimi, tulisuus (FHU-taso)

3. **Käyttöliittymä**
   - Popup-ikkuna kun klikataan status bar ikonia
   - Näyttää 3 tuotetta:
     - Tuotekuva (~200px leveys, korkeus vaihtelee)
     - Tuotteen nimi
     - Tulisuus (FHU-symboli)
   - "Add to cart" -nappi jokaiselle tuotteelle
   - "Add all to cart" -nappi kaikille
   - Muistutusteksti: "Use coupon code: DAILY20 at fataliiseeds.net to get 20% discount with these products"

4. **Menu-toiminnot** (right-click)
   - Quit
   - Start at login

---

## 🛠️ Teknologiasuositukset

### Vaihtoehto 1: **Electron + Electron-store** ⭐ SUOSITUS
#### Plussat:
- ✅ Täysi cross-platform tuki (macOS, Windows, Linux)
- ✅ Hyvät kirjastot system tray:lle: `electron`
- ✅ Web-scraping helppoa: `cheerio` tai `puppeteer`
- ✅ Moderni UI mahdollinen: React/Vue/vanilla HTML/CSS
- ✅ Laaja yhteisö ja dokumentaatio
- ✅ Helppo paketointitapa: `electron-builder`
- ✅ Auto-update tuki valmis

#### Miinukset:
- ⚠️ Suurempi tiedostokoko (~100-150MB)
- ⚠️ Enemmän muistia käytössä

#### Tekninen stack:
```
- Electron (system tray + native menus)
- Node.js backend
- Cheerio tai Puppeteer (web scraping)
- HTML/CSS/JavaScript (UI)
- electron-builder (packaging)
- electron-store (settings storage)
```

---

### Vaihtoehto 2: **Tauri + Rust**
#### Plussat:
- ✅ Erittäin pieni tiedostokoko (~5-10MB)
- ✅ Nopea ja vähän muistia
- ✅ Cross-platform
- ✅ Moderni web-teknologia frontend

#### Miinukset:
- ⚠️ Rust-osaaminen tarvitaan backend-koodiin
- ⚠️ Pienempi yhteisö
- ⚠️ System tray tuki vähemmän kypsä

---

### Vaihtoehto 3: **SwiftUI (macOS only) + C#/.NET (Windows only)**
#### Plussat:
- ✅ Natiivi suorituskyky
- ✅ Pienin tiedostokoko

#### Miinukset:
- ❌ Kaksi erillistä koodipohjaa
- ❌ 2x työmäärä ylläpidossa
- ❌ Ei suositeltava cross-platform projektiin

---

## 🎨 Suositeltu Arkkitehtuuri (Electron)

### Projektihierarkia:
```
fatalii-daily-offers/
├── src/
│   ├── main/               # Electron main process
│   │   ├── index.js        # Entry point
│   │   ├── tray.js         # System tray logic
│   │   ├── scraper.js      # Web scraping
│   │   └── store.js        # Settings storage
│   ├── renderer/           # UI (popup window)
│   │   ├── index.html
│   │   ├── styles.css
│   │   └── app.js
│   └── assets/
│       ├── icons/
│       │   ├── chili.png          # Normal icon
│       │   ├── chili-alert.png    # Alert icon (with exclamation)
│       │   ├── icon.icns          # macOS app icon
│       │   └── icon.ico           # Windows app icon
├── package.json
├── electron-builder.json   # Build configuration
└── README.md
```

---

## 🔍 Web Scraping Strategia

### Päivän tarjoukset (Etusivu)
Kohdassa: **"Varieties of the day with 20% discount"**

```html
<!-- Löydetty rakenne: -->
<h2>Varieties of the day with 20% discount</h2>
<!-- 3x tuote-elementit -->
```

**Tarvittava data per tuote:**
1. Tuotteen nimi
2. Tuotteen URL (linkki tuotesivulle)
3. Kuvan URL
4. Tulisuus (FHU-symboli määrä)

### Tuotesivu (esim. /product/chilaca/)
Tarvitaan tuotesivulta:
- Product ID / SKU (ostoskoriin lisäämistä varten)
- Tuotekuva (korkealaatuinen)
- Tulisuustaso (FHU-symbolit)

---

## 🛒 Ostoskoriin Lisääminen

Fataliiseeds.net käyttää **WooCommerce**-alustaa.

### Strategiat:

#### Vaihtoehto A: **Avaa suoraan selaimessa** ⭐ HELPOIN
```javascript
// Avaa product page + auto-add to cart parameter
const url = `https://fataliiseeds.net/product/${productSlug}/?add-to-cart=${productId}`;
require('electron').shell.openExternal(url);
```

#### Vaihtoehto B: **WooCommerce REST API**
Vaatii:
- API-avaimet Fataliiseeds.net:stä (epätodennäköinen ilman pääsyä backendiin)
- OAuth-autentikointi

#### Vaihtoehto C: **Browser automation (Puppeteer)**
- Monimutkainen ja hidas
- Ei suositeltava

**👉 SUOSITUS: Vaihtoehto A - Avaa selaimessa**
- Yksinkertaisin
- Ei vaadi API-avaimia
- Käyttäjä näkee ostoskorin normaalisti selaimessa

---

## 📦 Tiedon Tallennus

### Mitä tallennetaan:
1. **Viimeisin päivitetty päivämäärä** (tarkistus onko uudet tarjoukset)
2. **Käyttäjäasetukset:**
   - Start at login (boolean)
   - Viimeksi nähty tarjouspäivä
   - Notification preference (optional future feature)

### Tallennusratkaisu:
**electron-store** - Helppo key-value store

```javascript
const Store = require('electron-store');
const store = new Store();

// Tallenna
store.set('lastCheckDate', '2025-11-11');
store.set('startAtLogin', true);

// Lue
const lastCheck = store.get('lastCheckDate');
```

---

## 🔔 Animaation Toteutus

### Chili ↔ Huutomerkki Animaatio

```javascript
let isNewOffersAvailable = false;
let animationInterval = null;

function checkForNewOffers() {
    const today = new Date().toDateString();
    const lastCheck = store.get('lastCheckDate');
    
    if (lastCheck !== today) {
        isNewOffersAvailable = true;
        startAnimation();
        store.set('lastCheckDate', today);
    }
}

function startAnimation() {
    let showAlert = false;
    animationInterval = setInterval(() => {
        const icon = showAlert ? 'chili-alert.png' : 'chili.png';
        tray.setImage(path.join(__dirname, '../assets/icons', icon));
        showAlert = !showAlert;
    }, 750); // 0.75s välein
}

function stopAnimation() {
    clearInterval(animationInterval);
    tray.setImage(path.join(__dirname, '../assets/icons/chili.png'));
    isNewOffersAvailable = false;
}

// Pysäytä kun käyttäjä avaa menun
tray.on('click', () => {
    stopAnimation();
    showOffersWindow();
});
```

---

## 🚀 Start at Login Toteutus

Electron tarjoaa valmiin API:n:

```javascript
const { app } = require('electron');

// Aseta
app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true // macOS: ei avaa ikkunaa
});

// Tarkista status
const settings = app.getLoginItemSettings();
console.log(settings.openAtLogin); // true/false
```

---

## 📱 UI Mockup Kuvaus

```
┌─────────────────────────────────────────┐
│  Fatalii's Daily Offers                 │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────┐                          │
│  │ [Image]  │  Chilaca                 │
│  │ 200x?px  │  🌶️🌶️ (Mild)             │
│  └──────────┘  [Add to cart]           │
│                                         │
│  ┌──────────┐                          │
│  │ [Image]  │  Moruga, Green           │
│  │ 200x?px  │  🌶️🌶️🌶️🌶️🌶️ (Super Hot) │
│  └──────────┘  [Add to cart]           │
│                                         │
│  ┌──────────┐                          │
│  │ [Image]  │  Chocolate Mirasol        │
│  │ 200x?px  │  🌶️🌶️🌶️ (Hot)            │
│  └──────────┘  [Add to cart]           │
│                                         │
│        [Add all to cart]                │
│                                         │
│  💡 Use coupon code: DAILY20           │
│     at fataliiseeds.net for 20% off    │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🧪 Testaussuunnitelma

### 1. Scraping-testit
- ✅ Parsii oikein 3 päivän tarjousta
- ✅ Käsittelee virhetilanteet (ei nettiyhteyttä, sivuston rakenne muuttunut)

### 2. Cross-platform testit
- ✅ macOS menu bar toimii
- ✅ Windows system tray toimii
- ✅ Start at login toimii molemmissa

### 3. UI-testit
- ✅ Kuvat latautuvat oikein
- ✅ Tuotteet näkyvät oikein
- ✅ Add to cart avaa selaimen oikean URL:n kanssa

---

## 📦 Build & Distribution

### Electron Builder Configuration

**electron-builder.json:**
```json
{
  "appId": "net.fataliiseeds.dailyoffers",
  "productName": "Fatalii's Daily Offers",
  "directories": {
    "output": "dist"
  },
  "mac": {
    "category": "public.app-category.lifestyle",
    "icon": "src/assets/icons/icon.icns",
    "target": ["dmg", "zip"]
  },
  "win": {
    "icon": "src/assets/icons/icon.ico",
    "target": ["nsis", "portable"]
  }
}
```

### Build-komennot:
```bash
npm run build:mac     # macOS (.dmg)
npm run build:win     # Windows (.exe)
npm run build:all     # Molemmat
```

---

## 🔐 Turvallisuusnäkökohdat

1. **HTTPS-yhteydet** - Käytä aina HTTPS scraping:ssa
2. **Rate limiting** - Älä scrape liian usein (kerran päivässä riittää)
3. **Error handling** - Käsittele verkkovirheet elegantisti
4. **Update mekanismi** - Mahdollista automaattiset päivitykset (electron-updater)

---

## ⏱️ Arvioitu Toteutusaika

| Vaihe | Aika |
|-------|------|
| Projektin setup (Electron) | 2-3h |
| System tray + ikoni-animaatio | 3-4h |
| Web scraping logiikka | 4-6h |
| UI-toteutus (popup) | 4-5h |
| Ostoskoriin lisääminen | 2-3h |
| Start at login + asetukset | 2h |
| Testaus + bugfixing | 4-6h |
| Build & package | 2-3h |
| **YHTEENSÄ** | **23-32h** |

---

## 🎯 Suositeltu Toteutusjärjestys

1. ✅ **Projektin setup** - Electron + tarvittavat paketit
2. ✅ **System tray perustoteutus** - Näytä ikoni
3. ✅ **Web scraping** - Hae päivän tarjoukset
4. ✅ **Popup UI** - Näytä tuotteet
5. ✅ **Add to cart** - Selain integraatio
6. ✅ **Ikoni-animaatio** - Chili ↔ huutomerkki
7. ✅ **Start at login** - Automaattinen käynnistys
8. ✅ **Testaus & polish**
9. ✅ **Build & package**

---

## 📚 Tarvittavat npm-paketit

```json
{
  "dependencies": {
    "electron": "^latest",
    "electron-store": "^latest",
    "cheerio": "^latest",
    "axios": "^latest"
  },
  "devDependencies": {
    "electron-builder": "^latest"
  }
}
```

---

## 🔄 Päivitysstrategia (Future)

- **Automaattiset päivitykset**: `electron-updater`
- **Notifikaatiot**: Ilmoitus kun uudet tarjoukset saatavilla
- **Historiikki**: Näytä aiempien päivien tarjouksia
- **Suosikit**: Tallenna kiinnostavat lajikkeet

---

## 💬 Tuetut käyttöjärjestelmät

- ✅ **macOS** 10.13+ (High Sierra ja uudemmat)
- ✅ **Windows** 10/11 (64-bit)
- ⚠️ **Linux** - Teknisesti mahdollinen mutta ei prioriteetti

---

## 🐛 Tunnetut Haasteet & Ratkaisut

### Haaste 1: Sivuston rakenne muuttuu
**Ratkaisu:** 
- Tarkista scraping-logiikka säännöllisesti
- Lisää error handling
- Fallback: Näytä error-viesti jos ei löydy dataa

### Haaste 2: CORS-ongelmat selaimen avausessa
**Ratkaisu:** 
- Käytä `shell.openExternal()` joka avaa default-selaimen
- Ei tarvitse käsitellä CORS:ia sovelluksessa

### Haaste 3: Ikonien koko system tray:ssä
**Ratkaisu:**
- macOS: 22x22 px (template image)
- Windows: 16x16 px ja 32x32 px (multi-size .ico)

---

## ✅ Lopullinen Suositus

**Käytä Electronia** seuraavista syistä:
1. Helppo cross-platform kehitys
2. Laaja dokumentaatio ja yhteisö
3. Hyvät työkalut system tray-sovelluksille
4. Web-teknologia (HTML/CSS/JS) - tuttu monille
5. Helppo paketointiprosessi

**Toteutuksen runko:**
- Electron (tray + menus)
- Cheerio (web scraping)
- Vanilla JavaScript/HTML/CSS (UI)
- electron-builder (packaging)
- electron-store (settings)

---

Valmis toteutukseen! 🌶️🚀
