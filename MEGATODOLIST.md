# VideoNinja - Mega TODO List

## Projektin Yleiskuvaus
VideoNinja on Electron-pohjainen YouTube-videoiden lataustyökalu, joka käyttää yt-dlp.exe:ä videoiden lataamiseen. Sovellus tukee Windowsia (ensisijainen) ja macOS:ää (placeholder-tuki).

---

## 1. PROJEKTIN SETUP JA KONFIGURAATIO

### 1.1 Projektin Puhdistus
- [x] Poista vanhat Chilaca-scraping-tiedostot
- [x] Poista vanhat ostoskori- ja scraping-toiminnallisuudet
- [x] Päivitä package.json uusilla riippuvuuksilla
- [x] Päivitä README.md projektin kuvauksella
- [x] Säilytä Electron-rakenne ja taskbar/tray-toiminnallisuus

### 1.2 Riippuvuudet
- [ ] Lisää yt-dlp integraatiota varten tarvittavat Node.js-kirjastot
- [ ] Lisää file system monitoring (levytilan tarkistus)
- [ ] Lisää progress tracking -kirjasto
- [ ] Lisää child_process-hallinta yt-dlp:n ajamiseen

### 1.3 Konfiguraatio
- [ ] Luo config.json rakenne asetuksille
- [ ] Määrittele oletusasetukset
- [ ] Luo asetustenhallinta (settings manager)

---

## 2. YT-DLP INTEGRAATIO

### 2.1 YT-DLP Tarkistus
- [x] Toteuta yt-dlp.exe:n olemassaolon tarkistus Windowsilla
- [x] Toteuta yt-dlp:n olemassaolon tarkistus macOS:lla (placeholder)
- [x] Tarkista PATH-ympäristömuuttujasta
- [x] Tarkista yleisistä asennussijaineista
- [x] Tarkista projektin kansiosta (paikallinen asennus)

### 2.2 YT-DLP Käyttö
- [x] Luo wrapper-funktio yt-dlp:n kutsumiseen
- [x] Toteuta child_process-hallinta
- [x] Toteuta progress tracking (stderr/stdout parsing)
- [x] Toteuta virheenkäsittely
- [ ] Toteuta latauksen keskeytys
- [ ] Toteuta latauksen jatkaminen (resume)

### 2.3 Latausparametrit
- [x] Määrittele peruslatausparametrit
- [x] Määrittele laaduvalinnat (720p, 1080p, 4K, jne.)
- [x] Määrittele formaattivalinnat (mp4, webm, audio-only, jne.)
- [ ] Määrittele subtitles-valinnat
- [x] Luo dropdown-UI parametrivalinnoille

---

## 3. KÄYTTÖLIITTYMÄ (UI/UX)

### 3.1 Aloitusnäkymä (yt-dlp ei löydy)
- [x] Luo "yt-dlp puuttuu" -näkymä
- [x] Lisää linkit asennusohjeisiin Windowsille
- [x] Lisää linkit asennusohjeisiin macOS:lle (placeholder)
- [x] Lisää "Päivitä" / "Retry" -nappi

### 3.2 Asetukset (Settings)
- [x] Luo Settings-UI keskelle ruutua
- [x] Näytä yt-dlp.exe:n sijainti
- [x] Latauspolun valinta (folder picker)
- [x] Tallenna asetukset pysyvästi
- [x] Lataa asetukset sovelluksen käynnistyessä

### 3.3 Pääikkunan UI
- [x] URL-syöttökenttä
- [x] Latausparametrien dropdown
- [x] "Aloita lataus" -nappi
- [x] Latauslista (queue + valmis + epäonnistunut)
- [x] Progress-palkit aktiivisille latauksille
- [x] Päivämäärä ja aika valmistuneille latauksille
- [x] Statusikoni (vihreä ruksi, punainen X, keltainen kello)
- [x] "Avaa video" -toiminto valmiille latauksille

### 3.4 UI-visuaalisuus
- [x] Säilytä iloinen värimaailma
- [x] Käytä kirkkaita, positiivisia värejä
- [x] Luo yhtenäinen design-systeemi
- [x] Responsiivinen layout

---

## 4. LATAUSJONO JA TILANHALLINTA

### 4.1 Latausjono (Queue)
- [x] Luo queue-datamalli
- [x] Yksi lataus kerrallaan -logiikka
- [x] Automaattinen jonon käsittely
- [x] Jonon tallentaminen (persist)
- [x] Jonon lataaminen sovelluksen käynnistyessä

### 4.2 Latausten Tila
- [x] Määrittele tilat: pending, downloading, completed, failed
- [x] Tilan päivitys UI:hin
- [x] Tilan persistointi
- [x] Historianlista

### 4.3 Automaattinen Jatkaminen
- [x] Tarkista kesken jääneet lataukset käynnistyksessä
- [x] Jatka automaattisesti keskeneräisiä latauksia
- [ ] Resume-tuki yt-dlp:llä

---

## 5. TIEDOSTOJENHALLINTA

### 5.1 Latauspolku
- [ ] Tallenna käyttäjän valitsema latauspolku
- [ ] Tarkista polun olemassaolo
- [ ] Luo kansio automaattisesti jos puuttuu
- [ ] Tarkista kirjoitusoikeudet

### 5.2 Levytilan Tarkistus
- [ ] Tarkista vapaata levytilaa ennen latausta
- [ ] Jatkuva levytilan monitorointi
- [ ] Varoitus kun tilaa < 5GB
- [ ] Hälytys kun tilaa < 1GB
- [ ] Näytä jäljellä oleva tila UI:ssa

### 5.3 Tiedostojen Avaaminen
- [ ] "Avaa video" -toiminto
- [ ] Käytä järjestelmän oletussoitinta
- [ ] "Näytä kansiossa" -toiminto
- [ ] Virheenkäsittely jos tiedosto puuttuu

---

## 6. SYSTEM TRAY / TASKBAR

### 6.1 Tray-ikoni
- [x] Säilytä videokamera-teemainen ikoni (tai vastaava)
- [x] Normaali tila
- [x] "Vilkkuva" tila kun lataus valmis
- [x] Kontekstimenu (avaa, sulje, asetukset)

### 6.2 Ilmoitukset
- [x] Lataus valmis -ilmoitus
- [ ] Lataus epäonnistui -ilmoitus
- [ ] Levytila vähissä -ilmoitus
- [x] Vilkkuva ikoni latauksen valmistuessa

---

## 7. VIRHEENKÄSITTELY

### 7.1 YT-DLP Virheet
- [ ] Virheelliset URL:t
- [ ] Verkkovirheet
- [ ] Video ei saatavilla
- [ ] Geoblokatut videot
- [ ] Käyttäjäystävälliset virheilmoitukset

### 7.2 Tiedostovirheet
- [ ] Levytila täynnä
- [ ] Kirjoitusoikeudet puuttuvat
- [ ] Polku ei kelpaa

### 7.3 Järjestelmävirheet
- [ ] yt-dlp kaatuu kesken
- [ ] Järjestelmä sammuu kesken latauksen
- [ ] Recovery-mekanismi

---

## 8. DATAN PERSISTOINTI

### 8.1 Asetukset
- [ ] Tallenna käyttäjän asetukset JSON-tiedostoon
- [ ] Latauspolku
- [ ] yt-dlp:n sijainti
- [ ] Oletuslatausparametrit

### 8.2 Lataushistoria
- [ ] Tallenna lataushistoria
- [ ] URL, tiedostonimi, polku, päivämäärä, status
- [ ] Rajoita historian koko (esim. 1000 viimeisintä)

### 8.3 Jono
- [ ] Tallenna aktiivinen jono
- [ ] Lataa jono käynnistyksessä

---

## 9. CROSS-PLATFORM TUKI

### 9.1 Windows (Ensisijainen)
- [ ] yt-dlp.exe tarkistus
- [ ] Windows-polut
- [ ] Windows-ilmoitukset
- [ ] Windows-tray

### 9.2 macOS (Placeholder)
- [ ] Placeholder-viestit macOS:lle
- [ ] Ohjeet yt-dlp:n asennukseen Macille
- [ ] Placeholder lataus/settings-toiminnoille
- [ ] Kommentit koodissa tulevaa Mac-tukea varten

---

## 10. TESTAUS JA VIIMEISTELY

### 10.1 Toiminnallisuustestit
- [ ] Testaa yt-dlp integraatio
- [ ] Testaa latausjono
- [ ] Testaa progress tracking
- [ ] Testaa tray-ilmoitukset
- [ ] Testaa levytilan tarkistus

### 10.2 UI/UX Testit
- [ ] Testaa responsiviisuus
- [ ] Testaa käyttäjävirtoja
- [ ] Testaa virhetilanteet
- [ ] Käytettävyystestaus

### 10.3 Build ja Paketointi
- [ ] Electron Builder -konfiguraatio Windowsille
- [ ] Testaa .exe-build
- [ ] Ikonit ja resurssit
- [ ] Installer-konfiguraatio

---

## 11. DOKUMENTAATIO

### 11.1 Käyttäjädokumentaatio
- [ ] README.md päivitys
- [ ] Asennusohjeet
- [ ] Käyttöohjeet
- [ ] FAQ

### 11.2 Kehittäjädokumentaatio
- [ ] Arkkitehtuurikuvaus
- [ ] Koodin kommentointi
- [ ] Build-ohjeet
- [ ] macOS-tuen jatkokehitysohjeet

---

## PRIORITEETTI-JÄRJESTYS

### VAIHE 1: Perusta (Core Foundation)
1. Projektin puhdistus
2. YT-DLP tarkistus ja integraatio
3. Perus UI (Settings + URL input)
4. Yksittäisen videon lataus

### VAIHE 2: Latausjärjestelmä
5. Latausjono
6. Progress tracking
7. Lataushistoria
8. Tilan persistointi

### VAIHE 3: Kehittyneet Ominaisuudet
9. Latausparametrit ja dropdown
10. Levytilan monitorointi
11. Tray-ilmoitukset
12. Virheenkäsittely

### VAIHE 4: Viimeistely
13. UI-visuaalisuus
14. Cross-platform placeholderit
15. Testaus
16. Dokumentaatio
17. Build ja paketointi

---

## TEKNINEN STACK

- **Framework**: Electron
- **Backend**: Node.js
- **Frontend**: HTML, CSS, JavaScript (Vanilla)
- **Lataustyökalu**: yt-dlp.exe
- **Datan tallennus**: JSON-tiedostot
- **Build**: electron-builder

---

**Projektin Tavoite**: Luoda yksinkertainen, käyttäjäystävällinen YouTube-videoiden lataustyökalu, joka on visuaalisesti miellyttävä ja helppokäyttöinen.

**Projektin Status**: Käynnistämätön - Tämä dokumentti luo kehityksen roadmapin.
