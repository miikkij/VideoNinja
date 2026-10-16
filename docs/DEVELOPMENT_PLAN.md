# VideoNinja: analyysi, toteutus ja varmennus

Päivitetty 16.10.2026. Lähtötilanne oli commit `32d8027`, versio 1.0.1.
Tämä työ toteuttaa sovitun parannussuunnitelman versioon 1.1.0.
Lähdekoodin valmistuminen, CI-varmennus ja julkinen julkaisu ovat eri asioita.

## Tulos

Nykyinen Electron-sovellus säilytettiin. Turvallisuusrajat, latausjono ja
työkalusovitin rakennettiin testattaviksi moduuleiksi. Käyttäjä voi valita
suomen tai englannin. Paketointi kattaa Windowsin, macOS:n ja Linuxin.
Jonon järjestely, tauotus ja jatkaminen, erälisäys, esikatselu ja historian
hallinta toteutettiin samaan kokonaisuuteen.

Lataukset käsitellään edelleen peräkkäin ja soittolistat on estetty.
Rinnakkaisuus ja soittolistat olivat alkuperäisessä suunnitelmassa erikseen
päätettäviä laajennuksia. Niitä ei otettu käyttöön oletuksena.

## Lähtötilanteen havainnot

Alkuperäiset 27 testiä läpäisivät, mutta eivät kattaneet olennaisia todellisia
suoritusrajoja. Tarkastuksessa todennettiin aktiivisen työn perumisesta johtuva
seuraavan työn katoaminen, törmäävät tunnisteet, väliaikaisen tiedostopolun
tallentuminen valmiiksi lataukseksi ja keksitty levytila virhetilanteessa.
Rendererillä oli Node-oikeudet, ulkoista tekstiä sijoitettiin HTML:ään ja
yt-dlp käynnistettiin komentotulkin kautta.

16.10.2026 lähtötilanteen audit ilmoitti koko puusta 2 critical-, 100 high-,
51 moderate- ja 8 low-ilmoitusta. Tuotantoriippuvuuksissa oli 8 high- ja
2 moderate-ilmoitusta. Nämä ovat työkalun ilmoituksia riippuvuuspoluista,
eivät erikseen todennettujen hyökkäysten lukumääriä.

## Toteutetut korjaukset

| Suunnitelma             | Toteutus                                                                                                                                                                                      | Varmennus                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| P0.1 Prosessiraja       | Absoluuttinen työkalupolku, shell:false, validoitu HTTP(S)-URL, optionpäätin, sallittujen lisäoptioiden lista. Ulkopuoliset konfiguraatiot, lisäosat ja automaattiset etäkomponentit estetty. | Tuotannon argumenttirakentajan ja prosessisovittimen testit, oikea paikallinen medialataus.                         |
| P0.2 Renderer ja IPC    | Sandbox, context isolation, rajattu preload, paikallinen protokolla ja CSP, teksti-DOM, lähettäjän ja payloadin validointi. Tiedostotoiminnot tunnetun työn tunnisteella.                     | Haitallinen otsake/virhe näkyy tekstinä, Node ei ole rendererin käytössä, väärät pyynnöt ja tiedostopolut hylätään. |
| P1.1 Peruminen          | Aktiivisen prosessipuun lopetus odotetaan ennen seuraavaa työtä. Työ poistetaan tunnisteella.                                                                                                 | Kilpailutilannetestejä sekä oikean Windows-aliprosessipuun lopetus.                                                 |
| P1.2 Tunnisteet         | UUID-tunnisteet jokaiselle työlle.                                                                                                                                                            | Samanaikaiset lisäykset ja kohdistetut toiminnot.                                                                   |
| P1.3 Lopputiedosto      | yt-dlp after_move -protokolla, olemassaolon ja hakemistorajauksen tarkistus sekä symlinkkien ratkaisu.                                                                                        | Oikea yhdistetty video, alkuperäinen ääni, MP3 ja jo olemassa oleva lataus.                                         |
| P1.4 Levytila           | fs.statfs, todellinen kapasiteetti tai erillinen tuntematon tila.                                                                                                                             | Toimiva hakemisto, virhe, tyhjä levy ja kapasiteettirajojen testit.                                                 |
| P1.5 Ensikäynnistys     | Näkyvät asetukset ja kansiovalinta; tallennusvirhe estää virheellisen valmiusilmoituksen ja tarjoaa uusinnan.                                                                                 | DOM-testit ja oikean Electronin tyhjä testiprofiili.                                                                |
| P1.6 Uusintatarkistus   | Eksplisiittinen työkalujen uusintatarkistus ja jokaisella sivun latauksella haettava alkutila.                                                                                                | DOM- ja Electron-uudelleenlataustesti.                                                                              |
| P1.7 Laatu              | Oikeat korkeusrajat myös fallbackille, ääni ei palaudu videoksi, näkyvä ääniformaatti.                                                                                                        | Kaikkien presetien testit ja oikeat äänilataukset.                                                                  |
| P1.8 Lisäyksen kuittaus | Koko erän validointi ennen lisäystä, tulos ennen lomakkeen tyhjennystä, Enter/Shift+Enter.                                                                                                    | Virheellisen erän atomisuus ja syötteen säilyminen.                                                                 |
| P2 Vastuut              | Erilliset optio-, työkalu-, prosessi-, IPC-, tallennus-, käynnistys- ja jonokerrokset.                                                                                                        | Tuotantofunktioita kutsuvat injektoitavat testit ja JSDoc-optioraja.                                                |
| P2 Tallennus            | Skeemaversio, vanhan tilan migraatio, vioittuneen tiedoston karanteeni, rajat ja välittömät kestävät tilanvaihdot. Progress ei kirjoita levyä.                                                | Palautumis-, korruptio-, rajaus- ja tallennusvirhetestit.                                                           |
| P2 Käytettävyys         | Näppäimistökäyttö, dialogin kohdistus, säilyvät rivit, live-ilmoitukset, osiosiirtymät ja 200 % asettelu.                                                                                     | DOM-testit sekä 500 työn / 100 historiarivin Electron-testi.                                                        |
| P2 Työkalut             | Windows/macOS/Linux-haku, havaittu ffmpeg-polku välitetään, runtime-versiot tarkistetaan, Bun poistettu.                                                                                      | Alustariippumattomat hakutestit ja paikalliset oikeat versiotarkistukset.                                           |
| P2 Yksityisyys          | Ei argumenttien tai asetusten konsolilokeja, rajatut ja peitetyt virheet, hallittu historian tyhjennys ja rajattu vienti.                                                                     | Peitto-, vienti- ja tiedostonavausrajauksen testit.                                                                 |
| P2 Julkaisuputki        | Lukitut Actions-commitit, kolme käyttöjärjestelmää, savutestit, täydet paketit, version ja artefaktien tarkistus, luonnosjulkaisu.                                                            | CI ja natiivien jakelupakettien erilliset tarkistukset.                                                             |
| P3 Jonon käyttö         | Tauotus/jatkaminen, järjestys, enintään 100 URL:n lisäys, esikatselu, historian haku/tyhjennys/vienti.                                                                                        | Jono-, IPC-, renderer- ja Electron-testit.                                                                          |
| P3 Kieli ja alustat     | Käyttäjän valittavat englanti/suomi, Windows/macOS/Linux-paketointi.                                                                                                                          | Kieliasetuksen tallennus ja uudelleenkäynnistys, alustakohtainen CI.                                                |

## Riippuvuudet ja siivous

Electron 39.2 päivitettiin versioon 44.8, electron-store 11:stä 12:een,
electron-builder 26.15.3:een ja Vitest 5.0.5:een. Myös lint-, kuva- ja
muut kehitystyökalut päivitettiin. Node-kehitysympäristö on lukittu versioon
24.22.0 ja pnpm versioon 10.20.0. Vite 7.3.7 ja esbuild 0.28.2 ovat
nykyisen testipinon yhteensopivat versiot.

Electron 40–44:n [muutosohjeet](https://www.electronjs.org/docs/latest/breaking-changes)
tarkistettiin. Renderer käyttää selaimen clipboard-rajapintaa ja eristettyä
preloadia. Versio 44 tarvitsee macOS 13:n tai uudemman ja 64-bittisen alustan.
Työkalut suoritetaan erillisinä ohjelmina; Electronin sisäinen Node ei korvaa niitä.

`auto-launch` poistettiin ja korvattiin käyttöjärjestelmän käynnistysrajapinnoilla.
Poistettiin tarpeettomat importit, vanhat väärät ohjeet, canvas-sallinta ja
automaattinen build-tuotosten poisto. Ikoniskriptien polut, kuvakoot ja
virhepalautukset korjattiin. Aiemmin havaittu paikallinen rikkinäisten
node_modules-linkkien ongelma korjaantui pnpm:n uudelleenasennuksella.

Audit 16.10.2026: **0 critical, 0 high, 1 moderate koko riippuvuuspuussa;
tuotantoriippuvuuksissa ei ilmoituksia**. Jäljellä on build-ketjun
[sprintf-js-tiedote](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), jolle
ei ole julkaistu korjattua versiota. Tarkastetun global-agent-kutsuketjun
muotoilumerkkijonot ovat vakioita ja muuttuva tieto kulkee rakenteisina kenttinä.
Tämä rajaa havaittua altistumista, mutta ei poista tiedotetta. Sitä ei ohiteta
audit-asetuksissa. Koko puun high/critical ja kaikki tuotantolöydökset pysäyttävät
`pnpm run audit` -tarkistuksen.

## Varmennusnäyttö

- `pnpm check`: 144 testiä, 10 tiedostoa; lintissä ei virheitä eikä varoituksia.
- `pnpm run audit`: läpäisee yllä kuvatulla yhdellä moderate-tiedotteella.
- `pnpm test:smoke`: oikea Electron 44.8, erillinen profiili, tyhjä ensikäynnistys,
  kielenvaihto, reload, IPC-rajat, tekstirenderöinti, 500 tauotettua työtä,
  100 historiariviä, kohdistus, järjestys ja 200 % reflow.
- `pnpm test:media`: paikallisesti generoitu video ja localhost-palvelin.
  Metatiedot, progressiivinen lataus, saman tiedoston uusintalataus muuttamatta
  sisältöä tai mtimea, DASH-yhdistäminen, ääni ja MP3. Kohdekansion nimessä
  välilyöntejä, Unicodea ja prosenttimerkki.
- Windowsin NSIS- ja portable-paketit muodostuivat paikallisesti.
- Kolmen käyttöjärjestelmän lopullisen commitin CI-tulos kirjataan alle
  vasta oikean palvelinajon valmistuttua.

Paikallinen kone käyttää Windowsia. Mac- ja Linux-näyttö perustuu natiiveihin
CI-ajureihin, ei Windowsilla simuloituun asennukseen. Testit eivät lataa
ulkopuolisten tekijöiden mediaa tai käytä henkilökohtaisia evästeitä.

## Julkaisun rajaukset ja ylläpito

Julkista 1.1.0-julkaisua tai tagia ei tehdä tämän lähdekoodimuutoksen perusteella.
Allekirjoitusvarmenteet, macOS-notarisointi ja automaattinen päivityskanava
tarvitsevat ylläpitäjän jakelu- ja kustannuspäätökset. Nykyiset paketit ovat
allekirjoittamattomia. CI:n DMG-mount ja Debian-purku eivät todenna kaikkien
työpöytäympäristöjen asennuksen jälkeisiä käytäntöjä.

Verkkoasemien käyttöoikeudet, eri Linux-työpöytien ilmoitusalueet sekä todelliset
käyttäjäkohtaiset automaattikäynnistykset jäävät ympäristökohtaisiksi tarkistuksiksi.
Tallennusta ei salata. Historian vienti on rajattu, mutta sen otsikot ja URL-polut
voivat silti olla yksityisiä. EJS:n saatavuutta ei voi päätellä pelkästä
yt-dlp:n version löytymisestä.

Jatkuva ylläpito: seuraa Electronin tukijaksoa, yt-dlp:n sivustokorjauksia,
audit-tiedotteita ja lukittujen Actions-versioiden päivityksiä.
[Contributing](../CONTRIBUTING.md) kuvaa tarkistus- ja julkaisukäytännön.
