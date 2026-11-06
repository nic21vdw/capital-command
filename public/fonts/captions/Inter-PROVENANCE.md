These static Inter faces are derived from `../InterVariable.woff2`, already bundled
with this repository. Copyright (c) 2016 The Inter Project Authors. They remain
under the SIL Open Font License 1.1 in [Inter-LICENSE.txt](../Inter-LICENSE.txt).

Source SHA-256: `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`.

Generated locally with existing fontTools 4.66.0, without downloading fonts or
adding a runtime dependency. For each standard weight 100 through 900:

```python
font = TTFont("public/fonts/InterVariable.woff2")
font.flavor = None
font = instantiateVariableFont(font, {"wght": weight, "opsz": 14},
                               inplace=True, updateFontNames=True)
```

Name records 1/4/16 use `Inter Overlay <weight>`, 2/17 use `Regular`, and 6 uses
`InterOverlay-<weight>` on every platform. These isolated aliases select the
exact static outlines without synthetic bold and avoid changing the legacy
`Inter` fallback used by existing caption styles. Output filenames are
`Inter-Text-<weight>.ttf`. Original copyright, license and other font data remain.

The overlay renderer maps explicit `Inter` to these faces and rejects weights
outside those nine instances. Optical size is fixed at 14; the browser's variable
optical sizing, CSS display padding, antialiasing and line breaking can differ.
