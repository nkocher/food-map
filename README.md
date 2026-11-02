# CI Picks

A clean, mobile-friendly viewer for the Cooking Issues Patreon food & drink map. It shows only the picks: no Google POI clutter, with category filters, search, and near-me sorting.

**This repo has no map data in it.** The map is for Patreon members only, so the page loads the KML on your device and keeps it in your browser's local storage.

## Refreshing the picks
1. Signed in to Google, open the live KML (it downloads the current map):
   `https://www.google.com/maps/d/kml?forcekml=1&mid=16g2lfFXxypXlUWefU82mDbjU3mJDZ2PA`
   (If that's not your default account, use `/maps/d/u/1/kml?...` instead.)
2. On the site, tap **⤓ KML** and pick the downloaded file.

Places added since your last load get a **New** badge and a "New" filter chip.

On iPhone, add the site to your Home Screen. Safari can clear storage for sites you haven't visited in a while, and home-screen apps are exempt. If the data ever disappears, just load the KML again.

## Stack
Static HTML/JS, Leaflet + markercluster, Esri gray canvas tiles (no business POIs). No build step.
