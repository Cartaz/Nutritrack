#!/usr/bin/env python3
"""Genera le icone PWA mancanti: maskable-512, apple-touch-180, favicon-16/32/48, favicon.ico.

Crea una variante "maskable" dell'icona esistente con padding 10% (sfondo verde a tutto quadro,
icona ridotta all'80% per safe-zone maskable). Genera apple-touch-icon 180x180 e favicon
multi-size. Usa solo PIL.

Path resolution basata su __file__: funziona da qualsiasi working directory
e da qualsiasi clone del repo (no path hardcoded).
"""
import os
from PIL import Image, ImageDraw

# Risoluzione path relativa allo script:
#   scripts/gen-icons.py  ->  ../public/icons
# Così lo script è portabile e non dipende dalla macchina di sviluppo.
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_SCRIPT_DIR)
ICONS_DIR = os.path.join(_PROJECT_ROOT, 'public', 'icons')
SRC_512 = os.path.join(ICONS_DIR, 'icon-512.png')

BRAND = (16, 185, 129, 255)  # #10b981

def make_maskable(size: int) -> None:
    """Crea maskable: sfondo brand + icona originale al 80% centrata."""
    out = Image.new('RGBA', (size, size), BRAND)
    src = Image.open(SRC_512).convert('RGBA').resize((int(size * 0.80), int(size * 0.80)), Image.LANCZOS)
    offset = ((size - src.width) // 2, (size - src.height) // 2)
    out.paste(src, offset, src)
    out.save(os.path.join(ICONS_DIR, f'icon-maskable-{size}.png'), 'PNG')
    print(f'  -> icon-maskable-{size}.png')

def make_apple_touch(size: int = 180) -> None:
    """apple-touch-icon: sfondo brand + icona bianca al 70%."""
    out = Image.new('RGBA', (size, size), BRAND)
    src = Image.open(SRC_512).convert('RGBA').resize((int(size * 0.70), int(size * 0.70)), Image.LANCZOS)
    offset = ((size - src.width) // 2, (size - src.height) // 2)
    out.paste(src, offset, src)
    out.save(os.path.join(ICONS_DIR, f'apple-touch-icon.png'), 'PNG')
    print(f'  -> apple-touch-icon.png ({size}x{size})')

def make_favicon_png(size: int) -> None:
    out = Image.new('RGBA', (size, size), BRAND)
    src = Image.open(SRC_512).convert('RGBA').resize((int(size * 0.85), int(size * 0.85)), Image.LANCZOS)
    offset = ((size - src.width) // 2, (size - src.height) // 2)
    out.paste(src, offset, src)
    out.save(os.path.join(ICONS_DIR, f'favicon-{size}.png'), 'PNG')
    print(f'  -> favicon-{size}.png')

def make_favicon_ico() -> None:
    """favicon.ico con sizes 16/32/48 multipage."""
    sizes = [16, 32, 48]
    imgs = []
    for s in sizes:
        out = Image.new('RGBA', (s, s), BRAND)
        src = Image.open(SRC_512).convert('RGBA').resize((int(s * 0.85), int(s * 0.85)), Image.LANCZOS)
        offset = ((s - src.width) // 2, (s - src.height) // 2)
        out.paste(src, offset, src)
        imgs.append(out)
    imgs[0].save(os.path.join(ICONS_DIR, 'favicon.ico'), format='ICO', sizes=[(s, s) for s in sizes], append_images=imgs[1:])
    print(f'  -> favicon.ico (16/32/48)')

if __name__ == '__main__':
    # Sanity check: SRC_512 deve esistere, altrimenti guida l'utente.
    if not os.path.isfile(SRC_512):
        raise SystemExit(
            f'[gen-icons] File sorgente non trovato: {SRC_512}\n'
            f'            Genera prima icon-512.png (es. da icon.svg) e riprova.'
        )
    print('Generazione icone PWA in', ICONS_DIR)
    make_maskable(512)
    make_apple_touch(180)
    make_favicon_png(16)
    make_favicon_png(32)
    make_favicon_png(48)
    make_favicon_ico()
    print('Done.')
