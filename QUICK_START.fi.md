# VideoNinjan pikaohje

Lataa käyttöjärjestelmällesi sopiva paketti
[VideoNinja 1.1.0:n latauslinkeistä](README.md#download-videoninja-110).
macOS-paketti on Apple Silicon -koneille. Paketit ovat allekirjoittamattomia,
eikä macOS-sovellusta ole notarisoitu.

## Valmistelu

Asenna erikseen [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation),
[ffmpeg ja ffprobe](https://ffmpeg.org/download.html) sekä
[Deno](https://docs.deno.com/runtime/getting_started/installation/).
YouTube tarvitsee myös yt-dlp:n version kanssa yhteensopivat
[EJS-skriptit](https://github.com/yt-dlp/yt-dlp/wiki/EJS).
Tarkemmat asennuskomennot ovat [englanninkielisessä pikaohjeessa](QUICK_START.md).

Käynnistä sovellus ja valitse yläreunan kielivalikosta **Suomi**.
Ensikäynnistyksessä asetukset avautuvat näkyviin. Valitse latauskansio ja tarkista
työkalujen tila. Asennettuasi puuttuvan työkalun paina **Tarkista työkalut uudelleen**.
Jos muutit PATH-ympäristömuuttujaa, käynnistä sovellus uudelleen.

## Lataaminen

1. Liitä yksi tai useampi videolinkki, jokainen omalle rivilleen.
2. Valitse laatu. Äänen latauksessa voit valita alkuperäisen muodon tai muunnoksen.
3. Esikatsele halutessasi ensimmäisen linkin tiedot.
4. Lisää linkit jonoon painikkeella tai Enterillä. Shift+Enter lisää rivinvaihdon.
5. Hallitse töitä tauotus-, jatkamis-, perumis- ja siirtopainikkeilla.

Oletuksena ladataan yksi työ kerrallaan. Valitse asetuksista
**Samanaikaisten latausten enimmäismäärä**, 1–5. Määrän kasvattaminen käynnistää
odottavia töitä. Pienentäminen antaa käynnissä olevien töiden valmistua ensin.
Samaan URL-osoitteeseen ja kansioon kohdistuvat työt odottavat toisiaan.
Rinnakkaiset lataukset jakavat verkkoyhteyden, ja lähdesivusto voi rajoittaa niitä.

Tavallinen erä hyväksyy enintään 100 linkkiä. Saman erän toistuvat linkit lisätään
vain kerran, ja jonossa voi olla yhteensä enintään 500 työtä.
Korkeusvalinta on enimmäisraja.
Ääni ja kuva yhdistetään tarvittaessa ffmpegillä. Tauolta jatkaminen riippuu
palvelimen ja yt-dlp:n tuesta. Peruminen ei poista osittaisia tiedostoja eikä
keskeytä muita aktiivisia latauksia.

## Videot soittolistalta

1. Liitä soittolistan URL ensimmäiseksi linkiksi.
2. Valitse laatu ja mahdollinen äänimuunnos päälomakkeesta.
3. Paina **Valitse soittolistalta**. Esikatselu hakee metatiedot, ei mediatiedostoja.
4. Valitse haluamasi videot tai **Valitse kaikki saatavilla olevat**. Aluksi mitään ei ole valittu.
5. Paina **Lisää valitut jonoon**.

Yksityisiä, poistettuja tai muuten saavuttamattomia kohteita ei voi valita.
Esikatselu näyttää enintään ensimmäiset 500 kohdetta ja ilmoittaa, jos niitä on
lisää. Myöhempiä kohteita varten käytä pienempää soittolistaa tai yksittäisiä
videolinkkejä. Valittujen töiden pitää mahtua jonon jäljellä olevaan kapasiteettiin.
Saman valinnan toistuvat linkit lisätään vain kerran.

Esikatselu vanhenee 15 minuutissa. Sulje ja avaa se uudelleen tarvittaessa.
Sulkeminen peruuttaa keskeneräisen esikatselun. Jos jonoon lisäys epäonnistuu,
valinnat säilyvät ja virhe jää näkyviin. Tavallinen **Lisää jonoon** käsittelee
yksittäisiä töitä; koko soittolista ei käynnisty vahingossa.

## Historia

Historia tarjoaa haun, uusintayrityksen, tiedoston avaamisen ja kansion näyttämisen.
Viennistä jätetään pois paikalliset polut, kirjautumisasetukset ja virheet.
Historian tyhjennys pyytää vahvistuksen ja säilyttää mediatiedostot.

## Asetukset ja lopettaminen

Avaa asetukset **Asetukset**-painikkeella tai F3:lla. Kieli ja asetukset tallentuvat
automaattisesti. Tallennusvirhe näkyy käyttöliittymässä ja tallennusta voi yrittää
uudelleen. Evästeet ovat valinnaisia ja voivat antaa pääsyn tiliisi; säilytä ne
yksityisinä.

Ikkunan sulkeminen piilottaa sovelluksen ilmoitusalueelle, jos kuvake on käytettävissä.
Valitse kuvakkeen valikosta **Lopeta**, kun haluat sulkea sovelluksen. Ilman
ilmoitusalueen kuvaketta ikkunan sulkeminen lopettaa sovelluksen. Odottavat työt
palautuvat seuraavalla käynnistyksellä; tauotetut säilyvät tauolla.

Katso myös [vianmääritys](docs/TROUBLESHOOTING.md) ja
[toteutuksen varmennus](docs/DEVELOPMENT_PLAN.md).
