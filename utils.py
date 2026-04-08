import os
import re
import hashlib
import socket
import cv2
import numpy as np


def natural_key(text):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r'(\d+)', text)]

def safe_join(base_dir, *paths):
    full = os.path.realpath(os.path.join(base_dir, *paths))
    if not full.startswith(os.path.realpath(base_dir)):
        raise ValueError("Path traversal attempt")
    return full

def get_working_directory():
    from database import get_setting
    raw_path = get_setting('working_directory', '')
    if not raw_path:
        return None
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    normalized = raw_path.replace('/', os.sep).replace('\\', os.sep)
    if os.name == 'nt':  # Windows
        if (len(normalized) > 1 and normalized[1] == ':') or normalized.startswith('\\\\'):
            abs_path = normalized
        else:
            if normalized.startswith(os.sep):
                rel_path = normalized.lstrip(os.sep)
            else:
                rel_path = normalized
            abs_path = os.path.join(BASE_DIR, rel_path)
    else:  # Unix
        if normalized.startswith('/'):
            abs_path = normalized
        else:
            abs_path = os.path.join(BASE_DIR, normalized)
    abs_path = os.path.abspath(abs_path)
    if not os.path.isdir(abs_path):
        return None
    return abs_path

def get_image_files(path):
    valid_ext = ('.jpg', '.jpeg', '.png', '.webp')
    files = [f for f in os.listdir(path) if f.lower().endswith(valid_ext)]
    files.sort(key=natural_key)
    return files

def get_caption_path(image_path):
    base, _ = os.path.splitext(image_path)
    return base + '.txt'

def read_caption(txt_path):
    if os.path.exists(txt_path):
        with open(txt_path, 'r', encoding='utf-8') as f:
            return f.read().strip()
    return ''

def write_caption(txt_path, content):
    with open(txt_path, 'w', encoding='utf-8') as f:
        f.write(content)

def parse_tags(caption):
    if not caption:
        return []
    return [tag.strip() for tag in caption.split(',') if tag.strip()]

def format_tags(tags):
    return ', '.join(tags)

def get_file_hash(filepath, algorithm='sha256'):
    hash_func = hashlib.sha256() if algorithm == 'sha256' else hashlib.md5()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            hash_func.update(chunk)
    return hash_func.hexdigest()

def get_image_dimensions(img_path):
    from PIL import Image
    with Image.open(img_path) as img:
        return img.size

def get_aspect_ratio_label(width, height):
    ratio = width / height
    targets = {
        '1:1': 1.0,
        '4:3': 4/3,
        '3:4': 3/4,
        '16:9': 16/9,
        '9:16': 9/16,
        '2:3': 2/3,
        '3:2': 3/2,
        '21:9': 21/9,
        '9:21': 9/21,
    }
    best = min(targets.items(), key=lambda item: abs(ratio - item[1]))
    return best[0]

def is_port_available(host, port):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind((host, port))
            return True
    except socket.error:
        return False

def get_server_ips():
    ips = set()
    ips.add('127.0.0.1')
    try:
        hostname = socket.gethostname()
        ips.add(socket.gethostbyname(hostname))
        for info in socket.getaddrinfo(hostname, None):
            addr = info[4][0]
            if ':' not in addr:
                ips.add(addr)
    except:
        pass
    return list(ips)

def update_run_bat(host, port):
    if not host:
        host = '127.0.0.1'
    if not port:
        port = 5000
    else:
        port = int(port)

    browser_host = '127.0.0.1' if host == '0.0.0.0' else host
    url = f"http://{browser_host}:{port}"

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    bat_path = os.path.join(BASE_DIR, 'run.bat')
    template_lines = [
        '@echo off\n',
        'chcp 65001 >nul\n',
        'echo Launching TagForge...\n',
        'echo.\n',
        'call "%~dp0venv\\Scripts\\activate.bat"\n',
        'if errorlevel 1 (\n',
        '    echo [ERROR] The environment could not be activated.\n',
        '    pause\n',
        '    exit /b 1\n',
        ')\n',
        'echo Opening browser...\n',
        f'start /b "" cmd /c "start {url}"\n',
        'python app.py\n',
        'if errorlevel 1 (\n',
        '    echo.\n',
        '    echo [ERROR] The program has terminated with an error.\n',
        '    pause\n',
        ')\n',
        'deactivate\n'
    ]

    try:
        if os.path.exists(bat_path):
            with open(bat_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
        else:
            lines = template_lines

        replaced = False
        for i, line in enumerate(lines):
            if 'start /b "" cmd /c "start' in line:
                lines[i] = f'start /b "" cmd /c "start {url}"\n'
                replaced = True
                break
        if not replaced:
            for i, line in enumerate(lines):
                if line.strip().startswith('python app.py'):
                    lines.insert(i, f'start /b "" cmd /c "start {url}"\n')
                    replaced = True
                    break
            if not replaced:
                lines.append(f'start /b "" cmd /c "start {url}"\n')

        with open(bat_path, 'w', encoding='utf-8') as f:
            f.writelines(lines)
    except Exception as e:
        import logging
        logging.error(f"Failed to update run.bat: {e}")

def get_app_temp_dir():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    temp_dir = os.path.join(base_dir, 'tmp')
    os.makedirs(temp_dir, exist_ok=True)
    return temp_dir

def read_image_with_opencv(file_path):
    try:
        with open(file_path, 'rb') as file_handle:
            image_bytes = file_handle.read()
        image_array = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        return image
    except Exception:
        return None

def write_image_with_opencv(file_path, image_bgr):
    try:
        _, file_extension = os.path.splitext(file_path)
        file_extension = file_extension.lower()
        if file_extension == '.png':
            success, encoded_image = cv2.imencode('.png', image_bgr)
        else:
            success, encoded_image = cv2.imencode('.jpg', image_bgr)
        if success:
            with open(file_path, 'wb') as file_handle:
                file_handle.write(encoded_image.tobytes())
            return True
        return False
    except Exception:
        return False
