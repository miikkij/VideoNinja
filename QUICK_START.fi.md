# VideoNinjan pikaohje

[English](QUICK_START.md) · [Vianetsintä](docs/TROUBLESHOOTING.md)

Ohje kuvaa **1.2-kehitysversioita**, jotka käynnistetään
[lähdekoodista](README.md#run-from-source). Julkiset
[1.1.0:n latauspaketit](README.md#download-videoninja-110) ovat edelleen Windows
x64:lle, macOS Apple Siliconille ja Linux x64:lle. Paketit ovat
allekirjoittamattomia, eikä macOS-pakettia ole notarisoitu. Niissä ei ole tässä
kuvattuja uusia 1.2-toimintoja.

## Valmistelu

Valitse yläreunasta **Suomi**. Asetukset avautuvat, jos käyttöönotto on kesken;
avaa ne myöhemmin Asetukset-painikkeella tai F3:lla.

1. Valitse kirjoitettava latauskansio.
2. Tarkista yt-dlp:n, ffmpegin/ffproben ja JavaScript-ajoympäristön tila.
3. Asenna tai päivitä hallitut työkalut niiden painikkeista.
4. macOS:llä noudata ffmpegin asennusohjetta ja tarkista työkalut uudelleen.
5. Tarkista YouTube-tuki erillisellä diagnostiikkatoiminnolla.

Windows/Linux tukevat yt-dlp:n, ffmpeg/ffproben ja Denon hallittua asennusta;
macOS tukee yt-dlp:tä ja Denoa sekä ffmpegin ohjattua asennusta. Työkalut
asennetaan sovelluksen omaan käyttäjähakemistoon. Järjestelmän muita asennuksia ei
päivitetä samalla. Anna kaikkien töiden valmistua tai poista ne jonosta, myös
tauotetut, ja sulje esikatselut ennen työkalujen asennusta tai päivitystä.
Pelkkä tauotus ei riitä. EJS-tarkistus tutkii asennetut komponentit ja niiden yhteensopivuuden;
se ei ratkaise YouTuben haastetta oikealla videolla.

Julkaistussa 1.1-versiossa työkalut asennetaan erikseen. Noudata virallisia
[yt-dlp:n](https://github.com/yt-dlp/yt-dlp#installation),
[ffmpegin](https://ffmpeg.org/download.html),
[Denon](https://docs.deno.com/runtime/getting_started/installation/) ja
[EJS:n](https://github.com/yt-dlp/yt-dlp/wiki/EJS) ohjeita.
[Englanninkielinen pikaohje](QUICK_START.md#1-choose-a-folder-and-set-up-tools)
sisältää tarkistuskomennot. Käynnistä sovellus kokonaan uudelleen, jos muutit PATHia.

## Lataaminen

1. Liitä sallitut HTTP(S)-videolinkit, yksi kullekin riville.
2. Valitse enimmäislaatu tai pelkkä ääni ja mahdollinen muunnos.
3. Esikatsele ensimmäinen linkki nähdäksesi lähteen muodot, koodekit, tarkkuudet
   ja kokoarviot. Valitse automaattinen tai tarkka lähdemuoto.
4. Valitse tarvittaessa tekstitykset ja kielet, esimerkiksi `en,fi`.
   Automaattiset tekstitykset otetaan mukaan erillisellä valinnalla.
5. Aseta halutessasi työn nopeusraja KiB/s tai käytä tallennettua profiilia.
6. Lisää jonoon painikkeella tai Enterillä. Shift+Enter lisää rivinvaihdon.

Lomake tyhjenee vasta hyväksynnän jälkeen. Tavallinen erä hyväksyy 100 linkkiä,
poistaa erän toistuvat linkit ja mahtuu jonon 500 työn kokonaisrajaan.
Tarkka muotovalinta koskee esikatseltua linkkiä; vaihtaessasi linkin esikatsele
uudelleen. Pelkkä videoraita voi tarvita erillisen äänen ja ffmpegin.
Kokoarvio ei välttämättä sisällä lisä-ääntä, tekstityksiä tai käsittelyn tilantarvetta.

Enintään 20 nimettyä profiilia tallentaa kansion, laatu- ja äänivalinnat,
tekstitykset sekä nopeuden. Tunnistautumistietoja tai lähdekohtaisia tarkkoja
muototunnuksia ei tallenneta profiiliin. Laatu on enimmäiskorkeus, ei lupaus
lähteen tarjoamasta tarkkuudesta.

## Videot soittolistalta

1. Liitä soittolistan URL ensimmäiseksi ja paina **Valitse soittolistalta**.
2. Hae nykyiseltä sivulta, valitse rivit tai numeroalue kuten `1-10,15`.
3. Lisää valitut jonoon tai tyhjennä valinta ennen sivun vaihtamista.
4. Siirry seuraavalle sivulle päästäksesi yli 500. kohteen.

Sivulla on enintään 500 kohdetta. Aluksi mitään ei ole valittu. Poistettuja,
yksityisiä, virheellisiä tai sisäkkäisiä soittolistoja ei voi valita. Haku ja
numeroalueet koskevat nykyistä sivua; valinnat eivät siirry sivulta toiselle.
Valinnan pitää mahtua jonon jäljellä olevaan kapasiteettiin.

Esikatselu hakee metatiedot, ei mediatiedostoja. Se vanhenee 15 minuutissa;
sulkeminen keskeyttää haun ja tyhjentää valinnan. Epäonnistunut jonoon lisäys
säilyttää valinnan. Tavallinen jonoon lisäys ei laajenna kokonaista soittolistaa.

## Jonon hallinta

Oletuksena ladataan yksi työ kerrallaan. Asetuksissa raja on 1–5. Valitse useita
rivejä tauotusta, jatkamista, perumista tai odottavien töiden kärkeen siirtämistä
varten. Myös yksittäisten rivien toiminnot säilyvät. Tauotus ja peruminen jättävät
osittaiset tiedostot paikoilleen. Muut työt jatkavat itsenäisesti. Samaan URLiin
ja kansioon kohdistuvat työt odottavat toisiaan.

- Yhteinen nopeusraja jaetaan varovaisesti määritettyjen latauspaikkojen kesken.
  `0` tarkoittaa rajoittamatonta. Työn oma pienempi raja säilyy. Yhteisen rajan
  muuttaminen tai rinnakkaisuuden muuttaminen sen ollessa käytössä käynnistää
  siirrot uudelleen säilytetyistä osatiedostoista. Ilman yhteistä rajaa
  rinnakkaisuuden pienentäminen antaa aktiivisten töiden valmistua.
- Paikallisen ajan latausikkuna voi jatkua yli keskiyön. Ikkunan päättyessä työt
  tauotetaan; ajastuksen tauottamat jatkuvat seuraavassa ikkunassa. Itse tauotetut
  pysyvät tauolla. Sovelluksen on oltava käynnissä.
- Palautuvat verkko-, nopeusrajoitus- ja jumittumisvirheet voivat yrittää
  automaattisesti uudelleen enintään viisi kertaa. Tunnistautumis- ja muotovirheet
  vaativat korjauksen. Latauksella ja jälkikäsittelyllä on erilliset aikarajat.
- Levytilan turvaraja ja arviot aktiivisten töiden tilantarpeesta voivat siirtää
  aloitusta. Tuntematon tiedostokoko ei muutu varmaksi arvioksi.
- Valinnaiset työpöytäilmoitukset kokoavat valmistumiset ilman videoiden nimiä.

Duplikaattiarkisto voi ohittaa saman lähdekohteen samalla kohdekansiolla ja
valinnoilla, jos sen valmis, ei-tyhjä tiedosto on yhä olemassa. Poista ohitus
käytöstä, kun haluat tarkoituksella uuden siirron. Arkisto ei tutki kaikkia
levyllä olevia mediatiedostoja.

## Historia, yksityisyys ja päivitykset

Valmiin työn voi avata tai näyttää kansiossa. ffprobe tarkistaa tiedostosäiliön ja
mediaraitojen luettavuuden. Ilman sitä tulos kertoo pelkästä kokotarkistuksesta.
Tarkistus ei dekoodaa jokaista kuvaa. Virhe näyttää luokan ja seuraavan
korjausehdotuksen; tarvittaessa yritä uudelleen eri asetuksilla.

Historiaa voi hakea, poistaa valitut rivit, rajata säilytyspäivillä, viedä
rajattuun JSON-tiedostoon tai tyhjentää. Enintään 100 historiariviä säilyy.
Säilytysaika `0` poistaa ikärajan, ei määrärajaa. Poisto purkaa myös vastaavat
duplikaattiarkiston viitteet. Mediatiedostoja ei poisteta.

Yksityinen tila koskee uusia töitä. Niiden jonoa, historiaa tai duplikaattitietoja
ei tallenneta, joten ne katoavat lopetuksessa. Ladatut tiedostot jäävät levylle.
Valinnainen tallennetun toiminnan salaus käyttää käyttöjärjestelmän
salaisuustallennusta. Se ei salaa mediaa, evästetiedostoja tai vanhoja
selväkielisiä varmuuskopioita. Säilytä profiilista yksityinen varmuuskopio ennen
palautustoimia.
Ennen paluuta versioon 1.1 poista salaus käytöstä 1.2:ssa ja ota varmuuskopio,
tai käytä erillistä profiilia. 1.1 ei osaa lukea 1.2:n salattua sisältöä.

Valitse vaalea, tumma tai järjestelmän teema. Sovelluspäivitysten käynnistystarkistus
ottaa yhteyden GitHubiin; sen voi poistaa käytöstä. Lataaminen ja asentaminen ovat
erillisiä toimintoja. Lähdekoodiajo sekä tukemattomat tai allekirjoittamattomat
pakettityypit ohjaavat julkaisusivulle. Allekirjoitettua 1.2-julkaisua ei vielä ole.

Ikkunan sulkeminen piilottaa sovelluksen, jos ilmoitusalue toimii. Valitse sieltä
**Lopeta** turvallista pysäytystä varten. Ilman ilmoitusaluetta sulkeminen lopettaa.
Odottavat työt palaavat jonoon käynnistyksessä ajastuksen ja tilarajojen ehdoilla;
itse tauotetut pysyvät tauolla. Yksityiset työt eivät palaudu. Automaattinen
käynnistys kirjautuessa vaatii asennetun sovelluksen.
