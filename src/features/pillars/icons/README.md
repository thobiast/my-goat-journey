# Lucide Body and management icons

Official Lucide geometry is vendored here without installing `lucide-react` or another runtime icon dependency.

Pinned upstream commit: `548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde`.

## Body

[`biceps-flexed.svg`](https://github.com/lucide-icons/lucide/blob/548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde/icons/biceps-flexed.svg) supplies the unchanged three path values in `BicepsFlexed.tsx`. The upstream file has SHA-256 `cca896375bc3a09b4b1c01ed4ed795cabba17ff59c97044cfa6bd14a75cc1a78`; the local SVG differs only by omission of its final LF byte (`0a`).

The shared pillar renderer uses a 24-by-24 viewBox, stroke 1.8 and a 20px square in summaries or 24px square in headers. Fixed square dimensions, block display, aspect ratio 1 and no flex shrink prevent distortion. Body inherits the context color (burgundy in the summary and white in the colored header), rather than baking color into the geometry. The SVG is decorative (`aria-hidden="true"`, `focusable="false"`) beside the visible pillar name. The other original pillar drawings are not Lucide assets and remain unchanged.

## Management controls

`ManagementIcon.tsx` uses official `ellipsis`, `chevron-up` and `chevron-down` geometry from the same commit, with stroke 1.8 and a 20px square. These three local SVGs preserve the upstream bytes exactly, including their final LF:

| Source | SHA-256 (upstream and local) |
| --- | --- |
| [ellipsis.svg](https://github.com/lucide-icons/lucide/blob/548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde/icons/ellipsis.svg) | `4f495cc72013ffdfec677f03b33a150f7b4dd741979283fd6853a09024bca112` |
| [chevron-up.svg](https://github.com/lucide-icons/lucide/blob/548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde/icons/chevron-up.svg) | `d09f13fcbef3c493ead7e4663b5ee91804fec38d5edb5e7cc3acfbd547641cf4` |
| [chevron-down.svg](https://github.com/lucide-icons/lucide/blob/548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde/icons/chevron-down.svg) | `66ea878e72ed3488bb3b464c39dfdccee8d1f78e560dccea40e5e12da0e87e87` |

Reviewed sources contain only static path/circle geometry, without scripts, references or foreign content. The management SVGs are decorative; accessible control names belong to their enclosing buttons.

## License and distribution

The complete pinned [upstream ISC license](https://github.com/lucide-icons/lucide/blob/548cb9cdf50993fc01bb1bc65f7f4bce61f3ebde/LICENSE) is retained in [`LICENSE.lucide`](LICENSE.lucide). That local license differs only by omission of the upstream final LF; its notice text is unchanged. This newline normalization also applies to `biceps-flexed.svg`, **not** to the three management SVGs.

The complete ISC notice and the Body, management, Journey and completion asset inventory are included in [`public/third-party-notices.txt`](../../../../public/third-party-notices.txt), which must remain in the compiled app artifact. The [Journey icon README](../../journey/icons/README.md) documents the other vendored Lucide sources. These third-party terms do not settle licensing or redistribution rights for the project's own code or branding.
