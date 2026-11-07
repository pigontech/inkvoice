# E-invoice PDF assets

Files the ZUGFeRD / Factur-X hybrid PDF needs to be a valid PDF/A-3 document
(`services/einvoice-pdf.service.ts`). PDF/A requires every font to be embedded
and an output intent with a color profile.

| File | What | Source | License |
|---|---|---|---|
| `DejaVuSans.ttf` | DejaVu Sans 2.37, embedded as a subset (only the glyphs a PDF uses) | [dejavu-fonts release version_2_37](https://github.com/dejavu-fonts/dejavu-fonts/releases/tag/version_2_37), `dejavu-sans-ttf-2.37.zip` | Bitstream Vera license with DejaVu changes in the public domain, see `DejaVuSans-LICENSE.txt` |
| `sRGB2014.icc` | sRGB IEC61966-2.1 color profile (v2), used as the PDF/A output intent. Copyright International Color Consortium, 2015 | [ICC sRGB profiles](https://registry.color.org/rgb-registry/srgbprofiles) | [ICC profile license](https://registry.color.org/profile-library/#license): "This profile is made available by the International Color Consortium, and may be copied, distributed, embedded, made, used, and sold without restriction." |
