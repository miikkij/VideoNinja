# Fatalii's Daily Offers - Täydelliset Rakennusohjeet

Tämä sovellus näyttää Fatalii Seedsin päivittäiset 20% alennustarjoukset suoraan tietokoneesi ilmoitusalueella (system tray).

## 📋 Sisältö

- [Pika-aloitus (GitHub Actions)](#github-actions---automaattinen-buildaus)
- [Paikallinen buildaus Windowsille](#windowsille-buildaus)
- [Paikallinen buildaus Macille](#macille-buildaus)
- [Kehitysympäristö](#kehitysympäristö)
- [Ongelmien ratkaisu](#ongelmien-ratkaisu)

---

## 🚀 GitHub Actions - Automaattinen Buildaus

**SUOSITELTU TAPA** - Buildaa sekä Windows että Mac versiot ilmaiseksi GitHubissa!

### 1. Luo GitHub-repo

```bash
# Alusta git-repo
git init
git add .
git commit -m "Initial commit: Fatalii Daily Offers"

# Luo uusi repo GitHubissa: https://github.com/new
# Linkitä ja pushaa
git remote add origin https://github.com/SINUN-KÄYTTÄJÄ/fatalii-daily-offers.git
git branch -M main
git push -u origin main
```

### 2. Käynnistä automaattinen buildaus

**Vaihtoehto A: Release tag**
```bash
git tag v1.0.0
git push origin v1.0.0
```

**Vaihtoehto B: Manuaalinen triggeröinti**
1. Mene: `https://github.com/SINUN-KÄYTTÄJÄ/fatalii-daily-offers`
2. Klikkaa `Actions` välilehti
3. Valitse "Build Apps" workflow
4. Klikkaa `Run workflow` → `Run workflow`

### 3. Lataa valmiit paketit

1. Odota 5-10 minuuttia (seuraa etenemistä Actions-välilehdellä)
2. Build valmis? Klikkaa buildia
3. Scrollaa alas → `Artifacts`
4. Lataa:
   - `app-macos-latest` → Mac-versio (.dmg ja .zip)
   - `app-windows-latest` → Windows-versio

**Valmis!** 🎉

---

## 💻 Windowsille Buildaus

### 1. Asenna tarvittavat työkalut

#### Node.js
1. Lataa: https://nodejs.org/en/download/
2. Valitse **LTS-versio** (esim. 20.x)
3. Asenna (käytä oletusasetuksia)
4. Tarkista asennus:
   ```powershell
   node --version
   # Pitäisi näyttää: v20.x.x
   ```

#### pnpm (paketinhallinta)
```powershell
# Avaa PowerShell JÄRJESTELMÄNVALVOJANA
npm install -g pnpm

# Tarkista
pnpm --version
# Pitäisi näyttää: 10.x.x
```

### 2. Kloonaa/kopioi projekti

```powershell
# Jos GitHubissa
git clone https://github.com/SINUN-KÄYTTÄJÄ/fatalii-daily-offers.git
cd fatalii-daily-offers

# TAI kopioi projekti-kansio haluamaasi paikkaan
cd e:\dev\fatalii
```

### 3. Asenna riippuvuudet

```powershell
pnpm install
```

Asennus kestää 2-5 minuuttia ja lataa ~200MB paketteja.

### 4. Testaa sovellus

```powershell
pnpm start
```

Chili-ikoni ilmestyy ilmoitusalueelle. Klikkaa sitä nähdäksesi tarjoukset!

### 5. Buildaa Windows-paketti

```powershell
pnpm build:win
```

**Valmis!** Paketti löytyy:
- `dist\win-unpacked\` - Ajettava sovellus
- `dist\Fatalii-Daily-Offers-Windows.zip` - Jaettava zip-paketti

### Jakaminen

Jaa `Fatalii-Daily-Offers-Windows.zip`:
1. Vastaanottaja purkaa zipin
2. Suorittaa `Fatalii's Daily Offers.exe`
3. Valmis!

---

## 🍎 Macille Buildaus

### 1. Asenna tarvittavat työkalut (Macilla)

#### Xcode Command Line Tools
```bash
xcode-select --install
```

#### Node.js
```bash
# Homebrew (suositeltu)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node

# TAI lataa: https://nodejs.org
```

Tarkista:
```bash
node --version  # v20.x.x
npm --version   # 10.x.x
```

#### pnpm
```bash
npm install -g pnpm
pnpm --version  # 10.x.x
```

### 2. Kopioi projekti Macille

```bash
# Jos GitHubissa
git clone https://github.com/SINUN-KÄYTTÄJÄ/fatalii-daily-offers.git
cd fatalii-daily-offers

# TAI kopioi projekti-kansio (esim. AirDropilla)
cd ~/projekti/fatalii
```

### 3. Asenna riippuvuudet

```bash
pnpm install
```

### 4. Testaa sovellus

```bash
pnpm start
```

Chili-ikoni ilmestyy yläpalkkiin. Klikkaa sitä!

### 5. Buildaa Mac-paketti

**Pikabuild:**
```bash
chmod +x build-mac.sh
./build-mac.sh
```

**TAI manuaalisesti:**
```bash
pnpm build:mac
```

**Valmis!** Paketit löytyvät:
- `dist/Fatalii's Daily Offers-1.0.0.dmg` - Installer
- `dist/Fatalii's Daily Offers-1.0.0-mac.zip` - Portable

### Jakaminen

**Unsigned app (ei maksullista dev-tiliä):**

⚠️ **TÄRKEÄ**: macOS sanoo "damaged and can't be opened" - tämä on NORMAALIA!

**Korjaus:**
1. Avaa .dmg
2. **ÄLÄ** kaksoisklikkaa sovellusta
3. **Hiiren oikea klikkaus** sovelluksella → **Avaa**
4. Vahvista "Avaa" dialogissa
5. Tämän jälkeen toimii normaalisti!

**TAI terminaalissa:**
```bash
# Poista karanteeni
xattr -cr "/Applications/Fatalii's Daily Offers.app"
```

**Jakamisohje:**
1. Jaa .dmg tai .zip
2. Ohjeista: "Hiiren oikea → Avaa (ENSIMMÄISELLÄ KERRALLA)"
3. Sen jälkeen aukeaa normaalisti

**Signed app (Apple Developer $99/vuosi):**
1. Luo Developer ID certificate
2. Lisää `package.json`:
   ```json
   "mac": {
     "identity": "Developer ID Application: Sinun Nimesi (TEAM_ID)"
   }
   ```
3. Buildaa: `pnpm build:mac`
4. Avautuu ilman varoituksia!

---

## 🛠️ Kehitysympäristö

### Suorita kehitystilassa

```bash
pnpm start
```

### Komentoja

```bash
pnpm start          # Käynnistä sovellus
pnpm build:win      # Buildaa Windowsille
pnpm build:mac      # Buildaa Macille
pnpm build:all      # Buildaa molemmille (vain Macilla)
```

### Projektin rakenne

```
fatalii/
├── src/
│   ├── main/
│   │   ├── index.js       # Electron pääprosessi (tray, ikkunat)
│   │   └── scraper.js     # Webscraper (hakee tarjoukset)
│   ├── renderer/
│   │   ├── index.html     # Popup-ikkunan HTML
│   │   ├── styles.css     # Tyylit
│   │   └── app.js         # Frontend-logiikka
│   └── assets/
│       └── icons/         # Ikonit (chili.png, chili.svg)
├── dist/                  # Buildatut paketit
├── package.json           # Projektin konfiguraatio
└── README.md             # Tämä tiedosto
```

### Tärkeät tiedostot

- **`src/main/index.js`** - Tray-ikoni, ikkunat, ajastin (6 AM tarkistus)
- **`src/main/scraper.js`** - Hakee 3 tuotetta fataliiseeds.net:stä
- **`src/renderer/app.js`** - Näyttää tuotteet, "Add to cart" -toiminto
- **`package.json`** - Build-asetukset, riippuvuudet

### Muokkaa sovellusta

**Vaihda tarjousten määrää:**
```javascript
// src/main/scraper.js, rivi ~41
if (offers.length >= 3) return false; // Muuta 3 → haluamasi määrä
```

**Vaihda tarkistusaikaa:**
```javascript
// src/main/index.js, rivi ~230
targetHour: 6,  // 6 AM → vaihda haluamaksesi tunniksi (0-23)
```

**Vaihda värejä:**
```css
/* src/renderer/styles.css */
header {
  background: linear-gradient(135deg, #FF6B6B 0%, #C92A2A 100%);
  /* Muuta värikoodit */
}
```

---

## 🔧 Ongelmien Ratkaisu

### Windows

**"pnpm: command not found"**
```powershell
# Asenna uudelleen järjestelmänvalvojana
npm install -g pnpm
```

**Build epäonnistuu "cannot create symbolic link"**
- Tämä on normaali code signing -virhe
- Sovellus buildattiin silti!
- Löytyy: `dist\win-unpacked\`

**Sovellus ei käynnisty**
- Tarkista että Node.js on asennettu
- Suorita: `pnpm install` uudelleen
- Tarkista: Onko antivirusohjelma estänyt?

### Mac

**"xcrun: error: invalid active developer path"**
```bash
xcode-select --install
```

**"Permission denied" buildin aikana**
```bash
chmod +x build-mac.sh
chmod +x quick-build-mac.sh
```

**"App is damaged and can't be opened"**
```bash
# Poista karanteeni
xattr -cr "dist/mac/Fatalii's Daily Offers.app"
```

**Build epäonnistuu "no provisioning profile"**
- Tämä on normaalia jos ei ole Apple Developer -tiliä
- .app-paketti on silti käyttökelpoinen!
- Ensimmäinen avaus: Hiiren oikea → Avaa

### GitHub Actions

**Build epäonnistuu**
1. Tarkista: `.github/workflows/build.yml` on oikein
2. Tarkista: `package.json` syntaksi on OK
3. Katso virheloki Actions-välilehdeltä

**Artifacts ei näy**
- Build on vielä käynnissä (odota)
- Build epäonnistui (tarkista loki)
- Artifacts vanhenevat 90 päivän jälkeen

---

## 📦 Tiedostokoot

- **Windows:** ~136 MB (zip), ~300 MB (purettuna)
- **Mac:** ~140 MB (dmg/zip), ~300 MB (asennettu)

Tämä on normaalia Electron-sovelluksille (sisältävät Chrome-selaimen).

---

## 🚀 Pikaohjeet

**Buildaa heti:**
```bash
# Windows
pnpm install && pnpm build:win

# Mac
pnpm install && pnpm build:mac

# GitHub Actions
git push origin main
# → Mene GitHub → Actions → Run workflow
```

---

## 📄 Lisenssi

MIT License - Vapaa käyttää ja muokata!

---

## 🌶️ Ominaisuudet

✅ Tray-ikoni (chili)  
✅ Animoitu ikoni kun uusia tarjouksia  
✅ Näyttää 3 päivän tarjousta (20% alennus)  
✅ Tuotekuvat ja lämpöasteet  
✅ "Add to cart" -painike  
✅ Automaattinen päivitys klo 6:00  
✅ "Start at login" -asetus  
✅ Cross-platform (Windows + Mac)  

---

## 💡 Vinkkejä

- **Kehityksessä:** Käytä `pnpm start`, muutokset vaativat uudelleenkäynnistyksen
- **Testaa ensin:** Aja `pnpm start` ennen buildia
- **GitHub Actions:** Nopein tapa saada molemmat versiot
- **Jakaminen:** Zip-tiedostot helpoimpia jakaa (ei asennusta)
- **Unsigned Mac app:** Ohjeista käyttäjiä: "Oikea klikkaus → Avaa"

---

**Ongelmia? Tarkista:**
1. Node.js ja pnpm asennettu oikein
2. `pnpm install` suoritettu
3. Internet-yhteys toimii (scraper tarvitsee)
4. Antivirusohjelma ei estä

**Hyvää chilien kasvattamista!** 🌶️
