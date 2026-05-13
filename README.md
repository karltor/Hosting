# Mini-Värd

Liten Firebase-baserad värdtjänst där användare kan ladda upp HTML-sidor (valfritt med `.js`/`.css`) och dela dem via en kort länk.

## Struktur

```
index.html   – Dashboard: ladda upp, lista, redigera, ta bort
view.html    – Renderar en sparad sida via #<id>
app.js       – Klientlogik (Firebase Auth + Firestore)
style.css    – Layout (desktop-/Chromebook-först)
.nojekyll    – Stänger av Jekyll så GitHub Pages serverar filerna som de är
firestore.rules – Säkerhetsregler för `sites/{id}` (klistras in i Firebase-konsolen)
```

## Datamodell

Firestore-collection: `sites/{id}` (id = 7-tecken slumpad slug).

```
{
  ownerUid: <auth.uid>,
  name:     "Visningsnamn",
  files:    { "index.html": "...", "app.js": "...", "style.css": "..." },
  sizeBytes: <int>,
  createdAt, updatedAt
}
```

## Gränser

| Värde | Storlek |
| --- | --- |
| Max per fil | 200 KB |
| Max per sida (alla filer) | 500 KB |
| Max filer per sida | 10 |
| Max sidor per användare | 10 |

För 100 användare → worst case ≈ 500 MB i Firestore (gratisnivå: 1 GiB).

## Driftsätta (GitHub Pages)

1. Pusha till `main` (eller den branch som GitHub Pages är inställd på).
2. I Firebase-konsolen → **Authentication → Settings → Authorized domains**: lägg till `karltor.github.io` så att anonym inloggning fungerar från sajten.
3. I Firebase-konsolen → **Firestore → Rules**: klistra in innehållet från `firestore.rules` och tryck **Publish**.

URL:er:
- Dashboard: `https://karltor.github.io/Hosting/`
- Delningslänkar: `https://karltor.github.io/Hosting/view.html#<id>`

## Säkerhet

- Anonym auth binder varje sida till en användare.
- `firestore.rules` ser till att endast ägaren får skriva/uppdatera/ta bort.
- Visning sker i en sandboxad `<iframe srcdoc>` (utan `allow-same-origin`) så att uppladdad JS körs isolerat och inte kan komma åt andra användares data.
