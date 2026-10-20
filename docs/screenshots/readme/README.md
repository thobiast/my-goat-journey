# Reviewed fictional screenshots

These three images show the current interface with fictional habits, not a personal diary. They were captured from the local compiled Chromium runtime in fresh isolated Playwright contexts, using `e2e/publication-captures.spec.ts`.

The fixture creates four habits through onboarding, then records checklist completions through the UI with an injected October 7–14, 2026 clock. Screenshot navigation leaves the saved dataset unchanged. Capture-only service workers are blocked; these images do not verify installation or offline behavior.

Each image is an actual 760-pixel-wide browser viewport, with height fitted to its content. Navigation remains visible; no UI was hidden, composited or added. The Pillars disclosures were opened through the UI. Every retained image was visually reviewed. PNGs contain only IHDR, IDAT and IEND chunks, without text or EXIF metadata. Byte-identical copies are used by the landing page.

| Image | Size | SHA-256 |
|---|---|---|
| `today-en.png` | 760 × 1618 | `dabfe80f81dac60a5df3866515a4726a79a513ce1f5d9a76b933295b53156bc4` |
| `pillars-en.png` | 760 × 1175 | `d50b1a9178c4a193186ccefce1292ebf8528842c93cf83744336023ed7624657` |
| `progress-en.png` | 760 × 1882 | `2019a45d579f0ab7c9f687d1209776122965ee7be8da27778085b81eeb750c1e` |

The capture suite is opt-in (`PUBLICATION_CAPTURE=1`). Its `BASE_URL` must be the complete app entry URL for the chosen environment. Review newly generated candidates privately before replacing these files. Do not capture a normal browser profile or include raw traces, exports or browser databases in publication.

Project-owned documentation and original assets, including the supplied logos and derived icons visible in these captures, are included in [Apache-2.0](../../../LICENSE), to the extent of the rights available to license. Third-party material retains its existing terms; see [third-party notices](../../../public/third-party-notices.txt) and [branding provenance](../../branding-pwa.md). The captures do not establish additional ownership or exclusivity.
