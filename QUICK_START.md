# 🚀 PIKAOPAS - Quick Start

## 1. Asenna riippuvuudet / Install Dependencies

Avaa terminaali tässä kansiossa ja aja:

```bash
npm install
```

Tämä asentaa:
- Electron (desktop app framework)
- Cheerio (web scraping)
- Axios (HTTP requests)
- electron-store (tallentaa asetukset)
- electron-builder (builds installers)

⏱️ Kestää noin 2-3 minuuttia ensimmäisellä kerralla.

---

## 2. Käynnistä sovellus / Start the App

```bash
npm start
```

Näet:
- ✅ Punaisen pallon system tray:ssä (placeholder icon)
- 🔄 Jos vilkkuu punainen/oranssi = uudet tarjoukset saatavilla
- 👆 Klikkaa ikonia = avaa tarjousikkuna

---

## 3. Testaa toiminnallisuudet / Test Features

### Left Click Icon
- Avaa popup-ikkunan päivän tarjouksilla
- Näyttää 3 tuotetta kuvilla ja tulisuudella
- "Add to Cart" nappi per tuote
- "Add All to Cart" nappi

### Right Click Icon
- **Start at Login** - Käynnistyy automaattisesti kun kirjaudut sisään
- **Refresh Offers** - Päivitä tarjoukset manuaalisesti
- **Quit** - Sulje sovellus

---

## 4. Korvaa ikonit omillasi (TÄRKEÄ!)

Sovellus käyttää nyt placeholder-ikoneita (punainen/oranssi pallo).

### Tarvitaan:
1. `src/assets/icons/chili.png` - Normaali chili-ikoni (22x22px)
2. `src/assets/icons/chili-alert.png` - Huomio-ikoni (22x22px)  
3. `src/assets/icons/icon.icns` - macOS app icon (1024x1024 → .icns)
4. `src/assets/icons/icon.ico` - Windows app icon (256x256 → .ico)

📖 **Katso tarkat ohjeet:** `ICON_INSTRUCTIONS.md`

---

## 5. Toiminnan testaus / Testing

### Tarkista että tarjoukset latautuvat:
1. Käynnistä sovellus: `npm start`
2. Klikkaa tray-ikonia
3. Pitäisi näkyä 3 päivän tarjousta fataliiseeds.net:stä

### Jos ei toimi:
- Avaa Developer Tools: View → Toggle Developer Tools
- Katso Console-välilehti virheilmoituksia
- Tarkista internet-yhteys
- Testaa että fataliiseeds.net on saavutettavissa

### Testaa animaatio:
Animaatio alkaa kun:
1. Sovellus käynnistyy ensimmäistä kertaa päivässä
2. Kello on 06:00 ja uudet tarjoukset ladattu
3. Klikkaamalla ikonia animaatio pysähtyy

---

## 6. Kehitystyökalut / Dev Tools

### Avaa Developer Console:
```
View → Toggle Developer Tools
```
tai näppäinyhdistelmä:
- macOS: `Cmd + Option + I`
- Windows: `Ctrl + Shift + I`

### Tyhjennä tallennetut tiedot:
```javascript
// Developer Console:ssa
require('electron-store').clear()
```

---

## 7. Buildaa installer (kun valmis)

### macOS:
```bash
npm run build:mac
```
Luo `dist/Fatalii's Daily Offers-1.0.0.dmg`

### Windows:
```bash
npm run build:win
```
Luo `dist/Fatalii's Daily Offers Setup 1.0.0.exe`

⚠️ **HUOM:** Buildaus ei toimi ilman oikeita .icns ja .ico tiedostoja!

---

## 8. Yleisimmät ongelmat / Troubleshooting

### "Cannot find module 'electron'"
```bash
rm -rf node_modules package-lock.json
npm install
```

### Ikoni ei näy tray:ssä
- Tarkista että sovellus käynnistyi (katso Task Manager / Activity Monitor)
- Windows: Katso "piilotettuja ikoneita" system tray:n nuolesta
- macOS: Katso menu bar:n oikeaa reunaa

### Tarjoukset eivät lataudu
- Tarkista Developer Console:sta virheilmoitukset
- Testaa: `curl https://fataliiseeds.net` terminaalissa
- Fataliiseeds.net sivuston rakenne saattanut muuttua (päivitä scraper.js)

### Sovellus ei sammu
```bash
# macOS/Linux:
pkill -f "Electron"

# Windows PowerShell:
Get-Process | Where-Object {$_.ProcessName -like "*Electron*"} | Stop-Process
```

---

## 9. Seuraavat askeleet

1. ✅ Testaa että sovellus toimii
2. 🎨 Luo/hanki oikeat chili-ikonit
3. 🔨 Buildaa installer kun kaikki toimii
4. 📦 Jaa muille!

---

## Hyödyllisiä komentoja

```bash
# Käynnistä dev-tilassa
npm start

# Buildaa macOS installer
npm run build:mac

# Buildaa Windows installer  
npm run build:win

# Buildaa molemmat
npm run build:all

# Tyhjennä dist-kansio
rm -rf dist/
```

---

## Tarvitsetko apua?

Katso:
- `README.md` - Täysi dokumentaatio
- `ICON_INSTRUCTIONS.md` - Ikonien luonti
- `TEKNINEN_SUUNNITELMA.md` - Arkkitehtuuri

**Hyvää kehitystä! 🌶️🔥**
