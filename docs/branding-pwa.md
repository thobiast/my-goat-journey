# Branding and installation assets

The application uses owner-supplied My GOAT Journey images and locally generated icon derivatives. [Apache-2.0](../LICENSE) covers the project’s own code, documentation and original assets, including the supplied logos and derived installation icons, to the extent of the rights available to license. Third-party material retains its existing licenses. No exclusivity, trademark registration or name-availability review is claimed. Source hashes identify bytes, not ownership or rights beyond those available.

## Source assets and current uses

All three publication source images are opaque RGB PNGs, 1254 × 1254. The supplied
artwork is preserved pixel-for-pixel. Only non-rendering generation/editing
provenance metadata was removed, without re-encoding image data or changing
dimensions, colors or opacity. Other PNG chunks, including any rendering-relevant
color information, must be preserved during metadata maintenance.

| Source | Repository path | Use |
|---|---|---|
| Color app icon | `public/branding/My_GOAT_Journey_app_icon.png` | PWA and Apple derivatives |
| Monochrome ascent emblem | `public/branding/My_GOAT_Journey_Monochrome_ascent_emblem.png` | Small browser favicons; available landing alternative |
| Full mountain logo | `public/branding/My_GOAT_Journey_mountain_logo.png` | Onboarding welcome branding with wordmark; not installed as an app icon |

Source SHA-256:

```text
My_GOAT_Journey_app_icon.png
dd8b188075253267e876656927de32962456e3956e5432abf462d31fafd745a3
My_GOAT_Journey_Monochrome_ascent_emblem.png
9e4546e2560e21b636fb6931f1701bb0f4b3c4218857a04f5568b47cbf044467
My_GOAT_Journey_mountain_logo.png
5d54452545948ece91f1c156bece5ffe1746d49913c5d14394fc536b58dd25c5
```

The landing and licensing-page headers use
`landing/assets/My_GOAT_Journey_color_symbol.png`, a byte-identical copy of the
complete color app-icon source, beside a single written product name. It includes
the yellow sun and green mountains without a wordmark. Byte-identical mountain-logo
and monochrome-emblem copies are also available in `landing/assets/`; they are not
the current header image. The original in-app mountain SVG is a separate project
asset; vendored Lucide geometry is third-party material under its own terms.

## Artwork provenance and attribution

The supplied logos have known AI-assisted generation provenance; they are not
represented as exclusively human-authored. Publication PNGs omit unnecessary
generation/editing metadata; this sanitization does not establish a specific
generation model, a named human author or a copyright holder, and does not resolve
those separate provenance questions. Source hashes establish file identity, not
authorship or ownership, and a GitHub username does not establish legal identity.

Owner clarification is still needed for any named copyright-holder attribution
and any additional generation/source details that can be substantiated. Until
then, retain this provenance limitation without inventing an author, model,
copyright holder or additional rights claim. The project licensing scope above
does not replace applicable third-party terms or establish exclusive rights.

## Derivatives

All paths are relative to `public/`. Every PNG is square/opaque with preserved proportions/colors and the near-white background. No crop, recoloring, extracted symbol, redesign, wordmark or rounded launcher corners is baked into the icon derivatives.

| Asset | Size | Source/declaration |
|---|---|---|
| `icons/app-icon-192-v1.png` | 192 × 192 | Color; manifest `image/png`, `any` |
| `icons/app-icon-512-v1.png` | 512 × 512 | Color; manifest `image/png`, `any` |
| `icons/app-icon-maskable-512-v1.png` | 512 × 512 | Separate padded color; manifest `image/png`, `maskable` |
| `icons/apple-touch-icon-180-v1.png` | 180 × 180 | Color; HTML Apple touch link |
| `icons/favicon-16-v1.png` | 16 × 16 | Monochrome; PNG |
| `icons/favicon-32-v1.png` | 32 × 32 | Monochrome; PNG |
| `icons/favicon-48-v1.png` | 48 × 48 | Monochrome; PNG |
| `icons/favicon-v1.ico` | 16, 32, 48 payloads | Exact generated PNG payloads; `image/x-icon` |

Standard/Apple/favicons resize the complete source square. Maskable generation centers the complete color source on a white 512 × 512 canvas. The script computes uniform scaling to fit colored artwork inside a radius of 38% of the canvas, within the 40%-radius safe circle; minimum RGB < 235 distinguishes artwork from near-white paper texture. Review circular and rounded-square crops for clipping. Fine emblem detail necessarily merges at 16px. Pixel and browser checks do not establish physical-launcher support.

Metadata-only source cleanup leaves the existing decoded artwork and icon
derivatives unchanged; it does not require regenerating or renaming those icons.
Changes to shipped source-image bytes still require the shared production build
to regenerate final-byte integrity and the app-shell version. Never edit images
inside an already hashed `dist/` artifact.

## Manifest, identity and cache

`public/site-v1.webmanifest` declares the app name, theme/background `#fffaf0`, `display: standalone`, relative `start_url: ./`, `scope: ./` and icon URLs. Head references use Vite's `%BASE_URL%`. **Explicit `id` is omitted**; installed identity derives from the resolved start URL.

The shared `SITE_PREFIX` contract places the manifest beneath the derived app path, by default `/my-goat-journey/app/site-v1.webmanifest`. Start/scope/derived identity resolve to `/my-goat-journey/app/`; installed launch must open the PWA, not the landing. The app worker controls that app path only. See [PWA reliability](pwa-reliability.md) for installation and device checks.

Production uses coherent app-shell caching and guarded quiet updates; development does not register a worker. Icon/manifest files participate in the app's final-byte shell integrity/version contract. An artwork update needs a reviewed filename revision and coordinated head/manifest references while preserving the intended start/identity. Browser/OS favicon and installed-icon caches are separate: inspect URLs and ordinary reload/reopen first. **Never clear site data or remove a real installation merely to refresh an icon.** Export and validate a backup before clearing data or removing an installation.

## Container-only generation and checks

Prepare [the development environment](development.md) first. From the checkout directory, generation uses Canvas in the matching Playwright image without a host image package or external icon service:

```sh
podman run --rm --userns=keep-id --network my-goat-journey \
  --label app=my-goat-journey --shm-size=512m \
  -v "$PWD:/workspace:z" \
  -v my-goat-journey-deps:/workspace/node_modules:U \
  localhost/my-goat-journey-e2e:local node scripts/generate-brand-icons.mjs
```

Generation writes icon derivatives and an ignored `artifacts/brand-icons/generation.json` report, never the `public/branding/` sources. Use the image tag exactly as shown. Before accepting regeneration, compare source hashes, full icon dimensions/opacity, ICO payloads, maskable pixels, head/manifest links and fresh production response bytes/MIME. Keep the final artifact's third-party notices.

Ordinary checks and specialized compiled icon/prefix fixture prerequisites are in
[Development](development.md). Browser installation requirements and storage
limitations are documented in [device coverage and limitations](pwa-reliability.md#device-coverage-and-limitations);
use the [physical-device checklist](pwa-reliability.md#physical-device-checklist)
for itemized installation and icon checks with disposable data on trusted HTTPS.

## Other local icon notices

Pinned Lucide ISC geometry and full notices remain beside the sources: [Journey icons](../src/features/journey/icons/README.md), [Body and management icons](../src/features/pillars/icons/README.md), and [distributed third-party notices](../public/third-party-notices.txt). Their existing licenses and attributions remain in force alongside the project’s Apache-2.0 license; they are not relicensed as project-owned work.
