# VideoNinjan pikaohje

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

Lataukset käsitellään yksi kerrallaan. Korkeusvalinta on enimmäisraja.
Ääni ja kuva yhdistetään tarvittaessa ffmpegillä. Tauolta jatkaminen riippuu
palvelimen ja yt-dlp:n tuesta. Peruminen ei poista osittaisia tiedostoja.

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
