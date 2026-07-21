from PIL import Image
import os

icons_dir = r'd:\silver step\src\icons'

for fname in os.listdir(icons_dir):
    fpath = os.path.join(icons_dir, fname)
    if os.path.isfile(fpath):
        try:
            img = Image.open(fpath)
            print(f'{fname}: Format={img.format}, Size={img.size}, Mode={img.mode}')
        except Exception as e:
            print(f'{fname}: ERROR - {e}')

# Fix: convert to proper PNG with correct sizes
print('\n--- Fixing icons ---')

img = Image.open(os.path.join(icons_dir, 'icon-192x192.png'))
img192 = img.convert('RGBA').resize((192, 192), Image.LANCZOS)
img192.save(os.path.join(icons_dir, 'icon-192x192.png'), 'PNG')
print('Saved icon-192x192.png as true PNG 192x192')

img = Image.open(os.path.join(icons_dir, 'icon-512x512.png'))
img512 = img.convert('RGBA').resize((512, 512), Image.LANCZOS)
img512.save(os.path.join(icons_dir, 'icon-512x512.png'), 'PNG')
print('Saved icon-512x512.png as true PNG 512x512')

# Verify
for size in [192, 512]:
    fpath = os.path.join(icons_dir, f'icon-{size}x{size}.png')
    img = Image.open(fpath)
    print(f'Verified icon-{size}x{size}.png: Format={img.format}, Size={img.size}')
