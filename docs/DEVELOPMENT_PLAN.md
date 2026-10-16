# VideoNinjan kehitysanalyysi ja toteumatilanne

## Versiot ja rajaus

Lähdekoodin versio on **1.2.0, kehitysversio**. Julkinen
[1.1.0-julkaisu](https://github.com/miikkij/VideoNinja/releases/tag/v1.1.0) säilyy
latauslinkkien kohteena. Tässä työssä ei julkaista uutta versiota. Julkaistut
Windows x64-, macOS ARM64- ja Linux x64 -paketit ovat allekirjoittamattomia;
macOS-pakettia ei ole notarisoitu.

1.1:n pohjatyö eristi rendererin, validoi IPC:n ja latausvalinnat, korjasi jonon
keskeytyskilpailut, lisäsi suomen/englannin sekä natiivin kolmen käyttöjärjestelmän
paketoinnin. Nyt toteutettu 1.2 laajentaa käytettävyyttä, palautumista ja ylläpitoa.
Taulukon toteuma tarkoittaa lähdekoodissa olevaa toimintoa. Se ei tarkoita
julkaistua pakettia tai vielä vahvistettua uuden commitin CI-tulosta.

## Hyväksytyt 20 parannusta

| #   | Parannus                                     | Toteutettu toiminta                                                                                                                                                                        | Raja tai varmennuksen ehto                                                                                                                                               |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Työkalujen asennus, päivitys ja EJS          | Hallittu yt-dlp/Deno, Windows/Linux ffmpeg/ffprobe, macOS ffmpeg-ohjaus; tarkistussummat, väliaikainen asennus ja palautus. EJS:n asennettu versio ja ajonaikainen ympäristö tarkistetaan. | macOS ffmpeg asennetaan ohjatusti erikseen. EJS-vertailu tarvitsee tunnistettavan yt-dlp-version; se ei ole oikea YouTube-haastetesti.                                   |
| 2   | Toimintaan ohjaavat virheet                  | Rajatut virheluokat ja kaksikielinen korjausehdotus, erikseen uudelleenyritykseen sopivat virheet.                                                                                         | Ulkoisen työkalun teksti voi muuttua; tuntematon virhe säilyy tuntemattomana.                                                                                            |
| 3   | Sovelluspäivitykset ja allekirjoitusvalmius  | GitHubin vakaan julkaisun tarkistus, erillinen lataus/asennus, päivitysmanifestit, Windows-julkaisijan tarkistus ja macOS-notarisoinnin build-asetukset.                                   | Avaimia ei ole määritetty, allekirjoitettua julkaisua ei ole. Lähdeajo ja sopimattomat pakettityypit käyttävät julkaisusivua.                                            |
| 4   | Rajatut automaattiset uudelleenyritykset     | Oletuksena kaksi, enintään viisi palautuville verkko-, rajoitus- ja jumittumisvirheille; kasvava odotus.                                                                                   | Tunnistautumista tai virheellistä muotovalintaa ei ratkaista toistamalla rajatta.                                                                                        |
| 5   | Levytilan ennakkovaraus                      | Metadata-arvio, aktiivisten töiden yhteiset varaumat ja oletuksena 1024 MiB turvaraja; riittämätön tila odottaa.                                                                           | Ei käyttöjärjestelmän varausta. Tuntematon koko ja muiden sovellusten kulutus estävät täydellisen takuun.                                                                |
| 6   | Jonon monivalinta                            | Valittujen tauotus, jatkaminen, peruminen ja odottavien siirto kärkeen vakailla tunnuksilla.                                                                                               | Aktiivisen prosessin paikka vapautuu vasta sen päätyttyä.                                                                                                                |
| 7   | Todelliset mediamuodot                       | Enintään 200 rajattua muototietuetta: koodekit, tarkkuus, kuvataajuus ja kokoarviot; tarkka video/ääni-ID validoidaan metatiedoista.                                                       | Ei vapaita yt-dlp-valintalausekkeita. Muoto kuuluu kyseiseen linkkiin ja voi muuttua lähteessä.                                                                          |
| 8   | Nimetyt latausprofiilit                      | Enintään 20 profiilia kansiolle, laadulle, äänelle, tekstityksille ja nopeudelle.                                                                                                          | Ei tunnistautumista eikä lähdekohtaisia tarkkoja muototunnuksia.                                                                                                         |
| 9   | Tekstitysvalinnat                            | Kielikoodit ja automaattisten tekstitysten erillinen valinta käyttöliittymässä.                                                                                                            | Lähteen täytyy tarjota pyydetyt tekstitykset.                                                                                                                            |
| 10  | Lähdetunnukseen perustuva duplikaattiarkisto | Lähde/kansio/valintayhdistelmä ohitetaan vain, jos aiempi ei-tyhjä tiedosto löytyy.                                                                                                        | Enintään 10 000 tietuetta ja 2 MiB; ei koko levyn sisältövertailua. Yleislähteet säilyttävät URL-erottelun.                                                              |
| 11  | Suuret soittolistat                          | Haku ja numeroalueet nykyiseltä sivulta, edellinen/seuraava sivu yli 500. kohteen, 15 minuutin esikatseluvälimuisti.                                                                       | Enintään 500 kohdetta sivulla ja yhteensä 500 työtä jonossa. Valinta lisätään tai tyhjennetään ennen sivunvaihtoa.                                                       |
| 12  | Nopeusrajat                                  | Työkohtainen ja yhteinen KiB/s-raja; yhteinen jaetaan määritetyille latauspaikoille.                                                                                                       | Muutos käynnistää rajatut aktiiviset siirrot uudelleen osatiedostot säilyttäen. Tyhjät paikat voivat jättää kapasiteettia käyttämättä.                                   |
| 13  | Ajoitusikkunat                               | Paikallisen ajan ikkunat myös yli keskiyön; ikkunan sulkeutuessa tauotus ja seuraavassa jatkaminen.                                                                                        | Sovelluksen on oltava käynnissä. Käyttäjän itse tauottamat eivät jatka automaattisesti.                                                                                  |
| 14  | Ryhmitellyt ilmoitukset                      | Valinnaiset käyttöjärjestelmäilmoitukset valmistumisista/virheistä viiden sekunnin ryhmissä.                                                                                               | Oletuksena pois. Ei mediaotsikoita eikä yksityisiä töitä; OS voi estää ilmoitukset.                                                                                      |
| 15  | Historian valikoiva poisto ja säilytys       | Valittujen poistaminen, ikäraja ja enintään 100 historiariviä; vastaavien arkistoviitteiden poisto.                                                                                        | Mediatiedostot säilyvät. Säilytysaika 0 poistaa ikärajan, ei määrärajaa.                                                                                                 |
| 16  | Yksityiset työt ja salattu tallennus         | Uudet yksityiset työt jäävät muistiin. Valinnainen OS safeStorage salaa tallennetut asetukset ja toiminnan.                                                                                | Yksityinen työ katoaa lopetuksessa; aiempi julkinen historia säilyy. Media, evästeet ja vanhat selväkieliset kopiot eivät salaudu. Linux vaatii turvallisen avainsäilön. |
| 17  | Vaiheen huomioiva jumittumisvahti            | Todellinen tavumäärän/prosentin eteneminen tai vaiheenvaihto nollaa ajastimen; lataukselle ja käsittelylle eri rajat.                                                                      | Oletukset 180/900 s. Hidas mutta toimiva lähde voi tarvita asetuksen muuttamista.                                                                                        |
| 18  | Lopputiedoston eheystarkistus                | Tavallinen ei-tyhjä tiedosto kohdekansion sisällä ja ffproben kontti-/mediaraitatarkistus.                                                                                                 | Ilman ffprobea näkyvä pelkkä kokotarkistus. Ei jokaisen kuvan täydellistä dekoodausta.                                                                                   |
| 19  | Teemat                                       | Vaalea, tumma ja järjestelmän mukaan vaihtuva teema; valinta tallentuu.                                                                                                                    | OS-teeman seuranta riippuu alustan ilmoittamasta asetuksesta.                                                                                                            |
| 20  | Oikea media kolmen OS:n CI:ssä               | Työkalujen valmistelu ja generoidun localhost-median testit Windows/macOS/Linux-ajureissa; lisäksi oikea Electron-lähde-/pakettitestaus.                                                   | Työnkulku on toteutettu. Uuden commitin onnistuminen vahvistetaan Actions-ajosta; testi ei käytä elävää YouTubea tai henkilökohtaisia evästeitä.                         |

## Varmennusnäyttö ja vielä tarkistettava

Paikallinen kone on Windows. Hallitun asennuksen erillisessä
`.tools/tool-install-smoke`-hakemistossa todettiin yt-dlp **2026.08.19**, Deno
**2.9.7** ja ffmpeg/ffprobe **N-127588-g0b19c65afe-20261016**. Asennus tarkisti
upstream-tiivisteet, työkalujen löytymisen ja versiot. EJS **0.8.0** vastasi
asennetun yt-dlp-revision odottamaa komponenttia. Tämä ei ole livepalvelutesti.

Mediasavun 13 tarkistusta kattavat omat videon/äänen testiaineistot,
progressiivisen latauksen, saman tiedoston uusinnan muuttamatta sisältöä tai
mtimea, URL-aliasrinnakkaisuuden, DASH-yhdistämisen, alkuperäisen äänen ja MP3:n.
Lisäksi tarkistetaan tarkka progressiivinen muoto, tarkka video+ääni-yhdistelmä,
soittolistan toinen sivu ja adapterin ffprobe-eheystulos. Siirrot käyttävät vain
`127.0.0.1`-palvelinta; kansion nimessä on Unicodea, välilyöntejä ja prosenttimerkki.

Oikean Electronin uusi ominaisuussavu tarkisti paikallisesti profiilit,
muodot/tekstitykset, duplikaattiohituksen, sivutuksen yli 500. kohteen,
ryhmätoiminnot, valikoivan historian poiston, yksityiset työt, tumman teeman sekä
OS-salauksen tallennuksen ja palautumisen uudessa käynnistyksessä. Ulkoisen
lataustyökalun raja on tässä UI-testissä kontrolloitu testisovitin.

Koko `pnpm check`-, audit- ja CI-näyttö kirjataan viimeiselle tarkistetulle
commitille. Pelkkä työnkulun olemassaolo ei osoita macOS/Linux-läpimenoa.
[Actions](https://github.com/miikkij/VideoNinja/actions) sisältää commit-kohtaiset
ajot. Natiivin Windows-asentimen asennus/poisto tehdään vain kertakäyttöisellä
CI-ajurilla; DMG:n liittäminen ja DEB:n purkaminen eivät vastaa kaikkia OS:n
asennuksen jälkeisiä toimintoja.

## Ylläpito ja julkaisemisen ehdot

Node on lukittu versioon **24.22.0** ja pnpm versioon **10.20.0**. Suorita
`pnpm check`, `pnpm run audit`, `pnpm test:smoke`, `pnpm test:features` ja
`pnpm test:media`; paketoinnin jälkeen myös paketoidut savut ja
`pnpm release:verify --artifacts`. Tarkat komennot ja allekirjoituksen salaisuudet
ovat [Contributing-ohjeessa](../CONTRIBUTING.md).

Paikallisessa 1.2:n auditissa ei ollut tuotantoriippuvuuksien löydöksiä eikä koko
puun high/critical-löydöksiä. Jäljellä on yksi build-ketjun moderate-tiedote
[sprintf-js GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).
Sitä ei ohiteta eikä kuvata korjatuksi. Riippuvuuksia muutettaessa audit uusitaan;
[Security](../SECURITY.md) kuvaa löydöksen ja rajaukset.

Seuraavan julkaisun ehdot ovat vihreä CI täsmälleen julkaistavalle commitille,
artefaktien ja päivitysmanifestien tarkistus sekä todellisten asennus-/päivityspolkujen
varmennus. Allekirjoitus/notarisointi vaatii ylläpitäjän varmenteet ja Apple-avaimet.
Avaimia tai maksullisia palveluja ei ole hankittu tämän toteutuksen osana.

Ympäristökohtaisia tarkistuksia jää: avainsäilöt ja ilmoitusalueet Linuxissa,
automaattikäynnistys käyttäjäprofiileilla, verkkoasemien oikeudet, allekirjoitettu
asennettu päivityskierto sekä lähdepalvelujen muuttuvat kirjautumis-/EJS-käytännöt.
Näitä ei esitetä ohjelmakoodilla lopullisesti ratkaistuina ongelmina.
