import os
import hashlib
import re

def get_file_hash(filepath):
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for block in iter(lambda: f.read(65536), b''):
            sha256.update(block)
    return sha256.hexdigest()

def get_image_files(path):
    valid_ext = ('.jpg', '.jpeg', '.png', '.webp')
    files = []
    for f in os.listdir(path):
        if f.lower().endswith(valid_ext):
            files.append(f)
    files.sort(key=natural_key)
    return files

def natural_key(text):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r'(\d+)', text)]

def get_caption_path(image_path):
    base, _ = os.path.splitext(image_path)
    return base + '.txt'

def read_caption(txt_path):
    if os.path.exists(txt_path):
        with open(txt_path, 'r', encoding='utf-8') as f:
            return f.read().strip()
    return ''

def parse_tags(caption):
    if not caption:
        return []
    tags = [tag.strip() for tag in caption.split(',') if tag.strip()]
    return tags