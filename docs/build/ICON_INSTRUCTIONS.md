# IKONIEN LUOMINEN / CREATING ICONS

Sovellus tarvitsee seuraavat ikonit toimiakseen kunnolla:

## 1. Tray-ikonit (System Tray / Menu Bar)

### chili.png
- **Normaali tila** - Chili-ikoni
- **Koko**: 22x22 pikselia (macOS), 16x16 ja 32x32 pikselia (Windows)
- **Formaatti**: PNG läpinäkyvällä taustalla
- **Tyyli**: Yksinkertainen, selkeä mustavalkoinen tai värillinen

### chili-alert.png
- **Huomio-tila** - Chili-ikoni + huutomerkki
- **Koko**: Sama kuin yllä
- **Formaatti**: PNG läpinäkyvällä taustalla
- **Idea**: Chili + ❗ symboli tai vilkkuva efekti

## 2. Sovellusikonit (App Icons)

### icon.icns (macOS)
- **Käyttö**: macOS sovelluksen ikoni
- **Koko**: 1024x1024 pikselia lähtökuva
- **Luo tästä**: https://cloudconvert.com/png-to-icns
- **Lataa**: .icns tiedosto → tallenna `src/assets/icons/icon.icns`

### icon.ico (Windows)
- **Käyttö**: Windows sovelluksen ikoni
- **Koko**: 256x256 pikselia lähtökuva (sisältää automaattisesti 16, 32, 48, 256)
- **Luo tästä**: https://cloudconvert.com/png-to-ico
- **Lataa**: .ico tiedosto → tallenna `src/assets/icons/icon.ico`

---

## Pikaohjeet

### Vaihe 1: Luo tai hanki chili-ikoni
- Piirrä itse
- Käytä AI-generaattoria (DALL-E, Midjourney, etc.)
- Lataa royalty-free ikonisivustolta (Flaticon, Icons8, etc.)

### Vaihe 2: Muokkaa oikeaan kokoon
**Online-työkalu**: https://www.iloveimg.com/resize-image
- Lataa chili-kuva
- Resize to 22x22 (tray icon) ja 1024x1024 (app icon)
- Lataa molemmat

### Vaihe 3: Luo "alert" versio
- Avaa 22x22 chili.png kuvankäsittelyohjelmassa
- Lisää huutomerkki ❗ tai keltainen reunus
- Tallenna nimellä `chili-alert.png`

### Vaihe 4: Konvertoi sovellusikonit
1. Mene: https://cloudconvert.com/png-to-icns
2. Lataa 1024x1024 chili-kuva
3. Konvertoi → Lataa `icon.icns`

4. Mene: https://cloudconvert.com/png-to-ico
5. Lataa sama 1024x1024 chili-kuva
6. Konvertoi → Lataa `icon.ico`

### Vaihe 5: Korvaa placeholder-tiedostot
Kopioi luomasi ikonit:
```
src/assets/icons/
├── chili.png           ← Tray icon (normaali)
├── chili-alert.png     ← Tray icon (alert)
├── icon.icns           ← macOS app icon
└── icon.ico            ← Windows app icon
```

---

## Suositellut Värit

- **Pääväri**: Punainen (#FF6B6B tai #C92A2A)
- **Alert-väri**: Oranssi/Keltainen (#FFB020)
- **Tausta**: Läpinäkyvä (tray icons)

---

## Valmis testaamaan!

Kun olet lisännyt ikonit:
```bash
npm start
```

Näet tray-ikonin toiminnassa!

## Buildaaminen

```bash
npm run build:mac    # macOS .dmg
npm run build:win    # Windows .exe
```

HUOM: Buildaus ei toimi ilman oikeita .icns ja .ico tiedostoja!

---

**Tarvitsetko apua?** 
- Voin tehdä placeholder-ikonit väliaikaisesti
- Tai auttaa oman designin kanssa! 🌶️
