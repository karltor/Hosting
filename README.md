# Mini-Värd

Liten Firebase-baserad värdtjänst där användare kan ladda upp HTML-sidor (valfritt med `.js`/`.css`) och dela dem via en kort länk.

## Struktur

```
public/
  index.html   – Dashboard: ladda upp, lista, redigera, ta bort
  view.html    – Renderar en sparad sida via #<id>
  app.js       – Klientlogik (Firebase Auth + Firestore)
  style.css    – Layout (desktop-/Chromebook-först)
firebase.json   – Hosting + Firestore-konfig
firestore.rules – Säkerhetsregler för `sites/{id}`
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

## Driftsätta

```
npm install -g firebase-tools
firebase login
firebase use hosting-9c87a
firebase deploy --only hosting,firestore:rules
```

Delningslänkar: `https://hosting-9c87a.web.app/view.html#<id>`
(eller med rewrite i `firebase.json`: `/s/<id>`).

## Säkerhet

- Anonym auth binder varje sida till en användare.
- `firestore.rules` ser till att endast ägaren får skriva/uppdatera/ta bort.
- Visning sker i en sandboxad `<iframe srcdoc>` (utan `allow-same-origin`) så att uppladdad JS körs isolerat och inte kan komma åt andra användares data.
