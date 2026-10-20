# Lucide Journey icons

Official `footprints`, `check`, `flag`, `chevron-left`, `chevron-right`, `medal`, and `sparkles` geometry, vendored without a runtime icon-package dependency. Today uses the shared renderer's decorative medal for transient completion recognition, not stored ownership, and a static 16px Sparkles icon in its total-XP badge.

Pinned upstream commit: `548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde`, matching the existing vendored Body icon.

## Sources

- [footprints.svg](https://github.com/lucide-icons/lucide/blob/548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde/icons/footprints.svg)
- [check.svg](https://github.com/lucide-icons/lucide/blob/548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde/icons/check.svg)
- [flag.svg](https://github.com/lucide-icons/lucide/blob/548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde/icons/flag.svg)
- [chevron-left.svg](https://github.com/lucide-icons/lucide/blob/548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde/icons/chevron-left.svg)
- [chevron-right.svg](https://github.com/lucide-icons/lucide/blob/548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde/icons/chevron-right.svg)
- [medal.svg](https://github.com/lucide-icons/lucide/blob/548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde/icons/medal.svg) — SHA-256 `19a93f0d070d0a04283e2bee11799d3fd73de214936224c5d4141ebe3e119756`; retrieved through the existing container wrapper and reviewed as static path/circle geometry.
- [sparkles.svg](https://github.com/lucide-icons/lucide/blob/548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde/icons/sparkles.svg) — SHA-256 `cc8061ee31c43138e081522260d2ddd35465dfb2a4435fddd3d9857952d7231e`; retrieved through the existing container wrapper and reviewed as static path geometry. The pinned upstream license was verified byte-identical to the existing notice.
- [LICENSE](https://github.com/lucide-icons/lucide/blob/548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde/LICENSE)

The SVG files and `LICENSE.lucide` are unmodified upstream source bytes. `../TrailIcons.tsx` preserves every path value, the flag's line attributes and the medal's circle attributes exactly, including element order. The React wrapper uses stroke 1.8, `currentColor`, a 24-by-24 viewBox, a default 20px square size, and decorative accessibility attributes. Callers supply adjacent accessible text. Source SVGs retain their upstream 24px size and stroke 2.

`tests/ui/trail-icons.test.ts` checks pinned-source SHA-256 hashes, rendered geometry equality, decorative attributes, sizing, and the complete license.

The full upstream ISC notice is preserved in `LICENSE.lucide`. The application must include that notice in its distributed third-party notices when integrating these icons.
