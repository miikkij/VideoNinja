# Mac-buildin Vaihtoehdot

## ✅ Suositellut Ratkaisut

### 1. GitHub Actions (ILMAINEN & HELPOIN)
- Pushaa koodi GitHubiin
- Luo release tag tai triggeröi workflow manuaalisesti  
- GitHub buildaa sekä Mac että Windows version automaattisesti
- Katso: `GITHUB_ACTIONS_BUILD.md`

### 2. Kaverin/Kolleegan Mac
- Kopioi projekti USB-tikulle tai lähetä zip-tiedostona
- Pyydä ajamaan: `pnpm install && pnpm build:mac`
- Saat takaisin .dmg-tiedoston

### 3. Vuokraa Mac pilvessä
- **MacStadium** ($99-299/kk): Oikea Mac pilvessä
- **AWS EC2 Mac** ($25/vrk): Amazon macOS-instanssit
- **Scaleway** (~€50/kk): Mac mini pilvessä
- Kallis jos vain yhteen buildiin!

### 4. Käytä Mac-kahvilaa 😄
- Mene Apple Storeen
- Avaa Terminal demokoneella
- Buildaa siinä (jos ehtii 😅)

## ❌ EI TOIMI

### Ubuntu/Linux + Wine/CrossOver
- ❌ Ei voi buildaa macOS .dmg-tiedostoja
- ❌ Apple ei salli cross-compilation
- ❌ Code signing vaatii oikean macOS:n

### Docker macOS
- ❌ macOS-lisenssi kieltää virtualisoinnin ei-Apple laitteilla
- ❌ Laiton useimmissa tapauksissa
- ❌ Epäluotettava ja hidas

### Hackintosh
- ❌ Laiton Applen lisenssiehdoissa
- ❌ Epävakaa
- ❌ Ei suositeltu

## 💡 KÄYTÄNNÖN SUOSITUS

**GitHub Actions** on ylivoimaisesti paras ratkaisu:
- ✅ Ilmainen
- ✅ Laillinen
- ✅ Luotettava
- ✅ Buildaa automaattisesti molemmille alustoille
- ✅ Versiointi ja release management sisäänrakennettu

Jos koodi on yksityinen:
- GitHub Private repo: 2000 min/kk ilmaiseksi
- GitLab CI: 400 min/kk ilmaiseksi (shared runners)
