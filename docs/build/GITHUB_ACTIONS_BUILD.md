# GitHub Actions -buildaus

## Käyttö

1. **Pushaa koodi GitHubiin:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/SINUN-KÄYTTÄJÄ/fatalii.git
   git push -u origin main
   ```

2. **Luo release tag:**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. **GitHub buildaa automaattisesti:**
   - GitHub käyttää Mac- ja Windows-virtuaalikoneita
   - Buildit näkyvät: `Actions` -välilehdellä
   - Lataa valmiit paketit `Artifacts`-osiosta

## Manuaalinen buildaus GitHubissa

1. Mene reposi GitHub-sivulle
2. Klikkaa `Actions` -välilehti
3. Valitse "Build Apps" workflow
4. Klikkaa `Run workflow` → `Run workflow`
5. Odota ~5-10 minuuttia
6. Lataa valmiit paketit!

## Mitä saat

- **macOS:** `.dmg` ja `.zip` tiedostot
- **Windows:** `.exe` ja `win-unpacked` kansio

## Ilmainen!

GitHub Actions on ilmainen julkisille repoille:
- 2000 minuuttia/kk macOS buildia
- 3000 minuuttia/kk Windows buildia

Yksi build ~10 min, eli ~200 Mac buildia/kk ilmaiseksi!

## Vaihtoehdot GitHubille

Jos et halua julkista repoa:
- CircleCI (ilmainen tier)
- Travis CI (ilmainen open sourcelle)
- AppVeyor (Windows)
