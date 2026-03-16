import os
import re
import shutil
import threading
from collections import Counter
from datetime import datetime
from werkzeug.utils import secure_filename
import hashlib
from flask import Flask, request, jsonify, send_file, render_template
from PIL import Image
from collections import OrderedDict
import json
from database import (
    DB_PATH,
    save_global_widget_layout, get_global_widget_layout, clear_all_image_ratings,
    get_setting, get_all_translations, set_setting, init_db, add_flag,
    save_dataset_vocabulary, get_dataset_vocabulary, save_image_rating,
    get_image_rating_and_hash, get_all_ratings_for_dataset,
    get_all_flags, rename_flag, delete_flag, get_image_rating
)
import sqlite3
from auto_tag import AutoTagger

app = Flask(__name__)
app.json.sort_keys = False

init_db()

current_dataset_path = None
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

auto_tag_status = {
    'running': False,
    'total': 0,
    'processed': 0,
    'current_file': '',
    'model_name': ''
}
auto_tag_lock = threading.Lock()
tagger = AutoTagger(models_dir='models')

backup_status = {
    'running': False,
    'total': 0,
    'processed': 0,
    'current_file': '',
    'error': None
}
backup_lock = threading.Lock()

rating_status = {
    'running': False,
    'total': 0,
    'processed': 0,
    'current_file': '',
    'dataset_path': None
}
rating_lock = threading.Lock()

RATING_MODEL = "wd-swinv2-tagger-v3"

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
    tags = [tag.strip() for tag in caption.split(',') if tag.strip()]
    return tags

def get_working_directory():
    raw_path = get_setting('working_directory', '')
    if not raw_path:
        return None

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
    else:  # Unix-подобные (Linux, macOS)
        if normalized.startswith('/'):
            abs_path = normalized
        else:
            abs_path = os.path.join(BASE_DIR, normalized)

    abs_path = os.path.abspath(abs_path)
    if not os.path.isdir(abs_path):
        return None
    return abs_path

def safe_join(working_dir, *paths):
    full = os.path.realpath(os.path.join(working_dir, *paths))
    if not full.startswith(os.path.realpath(working_dir)):
        raise ValueError("Path traversal attempt")
    return full

def version_key(v):
    m = re.match(r'v(\d+)_(\d+)', v)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    return (0, 0)

def natural_key(text):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r'(\d+)', text)]

def perform_backup(dataset_path):
    global backup_status
    images = get_image_files(dataset_path)
    total = len(images)
    with backup_lock:
        backup_status['running'] = True
        backup_status['total'] = total
        backup_status['processed'] = 0
        backup_status['current_file'] = ''
        backup_status['error'] = None

    backup_dir = os.path.join(dataset_path, 'backup')
    os.makedirs(backup_dir, exist_ok=True)

    try:
        for idx, img in enumerate(images):
            with backup_lock:
                if not backup_status['running']:
                    break
                backup_status['current_file'] = img

            src_img = os.path.join(dataset_path, img)
            dst_img = os.path.join(backup_dir, img)
            shutil.copy2(src_img, dst_img)

            txt_path = get_caption_path(src_img)
            if os.path.exists(txt_path):
                dst_txt = os.path.join(backup_dir, os.path.basename(txt_path))
                shutil.copy2(txt_path, dst_txt)

            with backup_lock:
                backup_status['processed'] = idx + 1
    except Exception as e:
        with backup_lock:
            backup_status['error'] = str(e)
            backup_status['running'] = False
            backup_status['current_file'] = ''
        app.logger.error(f"Backup failed: {e}")
        return

    with backup_lock:
        backup_status['running'] = False
        backup_status['current_file'] = ''

@app.route('/api/backup/start', methods=['POST'])
def backup_start():
    if not current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    with backup_lock:
        if backup_status['running']:
            return jsonify({'error': 'Бэкап уже выполняется'}), 400
    thread = threading.Thread(target=perform_backup, args=(current_dataset_path,))
    thread.daemon = True
    thread.start()
    return jsonify({'success': True})

@app.route('/api/backup/status', methods=['GET'])
def backup_status_api():
    with backup_lock:
        return jsonify(backup_status)

@app.route('/api/backup/stop', methods=['POST'])
def backup_stop():
    with backup_lock:
        backup_status['running'] = False
    return jsonify({'success': True})

def format_tags(tags):
    return ', '.join(tags)

def get_all_tags(dataset_path):
    if not dataset_path or not os.path.isdir(dataset_path):
        return Counter()
    image_files = get_image_files(dataset_path)
    all_tags = []
    for img in image_files:
        txt_path = get_caption_path(os.path.join(dataset_path, img))
        caption = read_caption(txt_path)
        tags = parse_tags(caption)
        all_tags.extend(tags)
    return Counter(all_tags)

def get_image_dimensions(img_path):
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

def is_multiple_of(image_size, base=32):
    w, h = image_size
    return (w % base == 0) and (h % base == 0)

def analyze_ratings_background(dataset_path):
    images = get_image_files(dataset_path)
    total = len(images)
    logger = app.logger

    with rating_lock:
        rating_status['running'] = True
        rating_status['total'] = total
        rating_status['processed'] = 0
        rating_status['current_file'] = ''
        rating_status['dataset_path'] = dataset_path

    logger.info(f"Запуск фонового анализа рейтингов для {total} изображений")

    for idx, img in enumerate(images):
        with rating_lock:
            if rating_status.get('dataset_path') != dataset_path:
                logger.info("Анализ рейтингов остановлен из-за смены датасета")
                break
            rating_status['current_file'] = img

        img_path = os.path.join(dataset_path, img)

        try:
            current_hash = get_file_hash(img_path)
        except Exception as e:
            logger.error(f"Ошибка вычисления хэша для {img}: {e}")
            current_hash = None

        saved_rating, saved_hash = get_image_rating_and_hash(dataset_path, img)
        if saved_hash and saved_hash == current_hash:
            with rating_lock:
                rating_status['processed'] = idx + 1
            continue

        try:
            rating = tagger.get_rating(img_path, RATING_MODEL)
            save_image_rating(dataset_path, img, rating, current_hash)
        except Exception as e:
            logger.error(f"Ошибка при анализе рейтинга для {img}: {e}")
            save_image_rating(dataset_path, img, 'general', current_hash)

        with rating_lock:
            rating_status['processed'] = idx + 1

        if idx % 10 == 0:
            logger.info(f"Прогресс рейтингов: {idx+1}/{total}")

    with rating_lock:
        rating_status['running'] = False
        rating_status['current_file'] = ''

    logger.info("Фоновый анализ рейтингов завершён")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/load-dataset', methods=['POST'])
def load_dataset():
    global current_dataset_path
    data = request.get_json()
    path = data.get('path', '').strip()
    if not os.path.isdir(path):
        return jsonify({'error': 'Папка не существует'}), 400

    with rating_lock:
        rating_status['dataset_path'] = None

    current_dataset_path = path
    images = get_image_files(path)

    thread = threading.Thread(target=analyze_ratings_background, args=(path,))
    thread.daemon = True
    thread.start()

    return jsonify({
        'count': len(images),
        'images': images[:20]
    })

@app.route('/api/get-tags', methods=['GET'])
def get_tags():
    if not current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    tag_counter = get_all_tags(current_dataset_path)
    tags = [{'tag': tag, 'count': count} for tag, count in tag_counter.most_common()]
    return jsonify(tags)

@app.route('/api/get-images', methods=['POST'])
def get_images():
    if not current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    selected_tags = data.get('tags', [])
    image_files = get_image_files(current_dataset_path)
    result = []
    for img in image_files:
        txt_path = get_caption_path(os.path.join(current_dataset_path, img))
        caption = read_caption(txt_path)
        tags = set(parse_tags(caption))
        if selected_tags:
            if not all(tag in tags for tag in selected_tags):
                continue
        img_path_full = os.path.join(current_dataset_path, img)
        try:
            w, h = get_image_dimensions(img_path_full)
            mtime = os.path.getmtime(img_path_full)
        except:
            w, h = 0, 0
            mtime = 0
        rating = get_image_rating(current_dataset_path, img) or 'general'
        result.append({
            'filename': img,
            'tag_count': len(tags),
            'width': w,
            'height': h,
            'rating': rating,
            'mtime': mtime
        })
    return jsonify(result)

@app.route('/api/reset-ratings', methods=['POST'])
def reset_ratings():
    try:
        clear_all_image_ratings()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/datasets', methods=['GET'])
def list_datasets():
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана или недоступна'}), 400
    try:
        datasets = []
        for name in os.listdir(wd):
            dataset_path = os.path.join(wd, name)
            if not os.path.isdir(dataset_path):
                continue
            image_count = 0
            cover = None
            for root, dirs, files in os.walk(dataset_path):
                for f in files:
                    if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                        image_count += 1
                        if cover is None:
                            cover = os.path.relpath(os.path.join(root, f), dataset_path)
            versions = [d for d in os.listdir(dataset_path)
                        if os.path.isdir(os.path.join(dataset_path, d)) and re.match(r'v\d+_\d+', d)]
            versions.sort(key=version_key)
            last_version = versions[-1] if versions else None

            datasets.append({
                'name': name,
                'image_count': image_count,
                'cover': cover,
                'last_version': last_version
            })
        return jsonify(datasets)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/datasets', methods=['POST'])
def create_dataset():
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    name = request.form.get('name')
    if not name:
        return jsonify({'error': 'Имя датасета обязательно'}), 400
    safe_name = secure_filename(name)
    if not safe_name:
        return jsonify({'error': 'Некорректное имя'}), 400
    dataset_path = os.path.join(wd, safe_name)
    if os.path.exists(dataset_path):
        return jsonify({'error': 'Датасет с таким именем уже существует'}), 400
    os.mkdir(dataset_path)

    version_path = os.path.join(dataset_path, 'v0_1')
    os.mkdir(version_path)

    cover_file = request.files.get('cover')
    cover_filename = None
    if cover_file and cover_file.filename:
        if cover_file.filename.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
            cover_filename = secure_filename(cover_file.filename)
            cover_path = os.path.join(dataset_path, cover_filename)
            cover_file.save(cover_path)

    metadata = {
        'name': name,
        'created': datetime.now().isoformat(),
        'versions': {
            'v0_1': {
                'created': datetime.now().isoformat(),
                'flags': []
            }
        },
        'cover': cover_filename
    }
    with open(os.path.join(dataset_path, 'metadata.json'), 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    return jsonify({'success': True, 'name': safe_name})

@app.route('/api/datasets/<path:dataset_name>/browse', methods=['GET'])
def browse_dataset(dataset_name):
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    subpath = request.args.get('path', '')
    try:
        base_path = safe_join(wd, dataset_name)
        current_path = safe_join(base_path, subpath) if subpath else base_path
        if not os.path.isdir(current_path):
            return jsonify({'error': 'Это не папка'}), 400

        dirs = []
        images = []
        for entry in os.listdir(current_path):
            full = os.path.join(current_path, entry)
            if os.path.isdir(full):
                dirs.append(entry)
            else:
                ext = os.path.splitext(entry)[1].lower()
                if ext in ('.jpg', '.jpeg', '.png', '.webp'):
                    txt_path = os.path.splitext(full)[0] + '.txt'
                    has_caption = os.path.exists(txt_path)
                    images.append({
                        'name': entry,
                        'type': 'image',
                        'has_caption': has_caption,
                        'size': os.path.getsize(full),
                        'mtime': os.path.getmtime(full)
                    })
        dirs.sort(key=natural_key)
        images.sort(key=lambda x: natural_key(x['name']))
        items = [{'name': d, 'type': 'directory'} for d in dirs] + images
        return jsonify({'path': subpath, 'items': items})
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/thumbnail/<path:filename>')
def serve_thumbnail(filename):
    if not current_dataset_path:
        return 'Dataset not loaded', 404
    safe_path = os.path.join(current_dataset_path, filename)
    if not os.path.realpath(safe_path).startswith(os.path.realpath(current_dataset_path)):
        return 'Access denied', 403
    if not os.path.isfile(safe_path):
        return 'File not found', 404

    from PIL import Image
    import io

    img = Image.open(safe_path)
    img.thumbnail((450, 450), Image.Resampling.LANCZOS)

    img_io = io.BytesIO()
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        img.save(img_io, format='PNG')
        mimetype = 'image/png'
    else:
        img.save(img_io, format='JPEG', quality=85, optimize=True)
        mimetype = 'image/jpeg'

    img_io.seek(0)
    response = send_file(img_io, mimetype=mimetype)
    response.headers['Cache-Control'] = 'public, max-age=604800, immutable'
    return response

@app.route('/api/datasets/<path:dataset_name>/rename', methods=['POST'])
def rename_dataset_item(dataset_name):
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    data = request.get_json()
    old_name = data.get('old_name')
    new_name = data.get('new_name')
    current_path = data.get('current_path', '')
    if not old_name or not new_name:
        return jsonify({'error': 'Не указаны имена'}), 400
    try:
        base_path = safe_join(wd, dataset_name)
        parent = safe_join(base_path, current_path) if current_path else base_path
        old_full = os.path.join(parent, old_name)
        new_full = os.path.join(parent, new_name)
        if not os.path.exists(old_full):
            return jsonify({'error': 'Исходный файл не найден'}), 404
        if os.path.exists(new_full):
            return jsonify({'error': 'Файл с новым именем уже существует'}), 400
        os.rename(old_full, new_full)
        if os.path.isfile(old_full) and old_name.lower().endswith(('.jpg','.jpeg','.png','.webp')):
            old_txt = os.path.splitext(old_full)[0] + '.txt'
            new_txt = os.path.splitext(new_full)[0] + '.txt'
            if os.path.exists(old_txt):
                os.rename(old_txt, new_txt)
        return jsonify({'success': True})
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/datasets/<path:dataset_name>/delete', methods=['DELETE'])
def delete_dataset_item(dataset_name):
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    data = request.get_json()
    name = data.get('name')
    current_path = data.get('current_path', '')
    if not name:
        return jsonify({'error': 'Не указано имя'}), 400
    try:
        base_path = safe_join(wd, dataset_name)
        target = safe_join(base_path, current_path, name) if current_path else safe_join(base_path, name)
        if not os.path.exists(target):
            print(target)
            return jsonify({'error': 'Файл не найден'}), 404
        if os.path.isdir(target):
            shutil.rmtree(target)
        else:
            os.remove(target)
            txt = os.path.splitext(target)[0] + '.txt'
            if os.path.exists(txt):
                os.remove(txt)
        return jsonify({'success': True})
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/datasets/<name>', methods=['DELETE'])
def delete_dataset(name):
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    dataset_path = os.path.join(wd, name)
    if not os.path.isdir(dataset_path):
        return jsonify({'error': 'Датасет не найден'}), 404
    try:
        shutil.rmtree(dataset_path)
        with sqlite3.connect(DB_PATH) as conn:
            c = conn.cursor()
            c.execute('DELETE FROM image_ratings WHERE dataset_path=?', (dataset_path,))
            c.execute('DELETE FROM dataset_vocabulary WHERE dataset_path=?', (dataset_path,))
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/flags', methods=['GET'])
def get_flags():
    return jsonify(get_all_flags())

@app.route('/api/flags', methods=['POST'])
def create_flag():
    data = request.get_json()
    name = data.get('name')
    color = data.get('color', '#3b82f6')
    if not name:
        return jsonify({'error': 'Имя флага обязательно'}), 400
    add_flag(name, color)
    return jsonify({'success': True})

@app.route('/api/flags/<name>', methods=['PUT'])
def update_flag(name):
    data = request.get_json()
    new_name = data.get('name')
    new_color = data.get('color')
    if not new_name:
        return jsonify({'error': 'Новое имя обязательно'}), 400
    rename_flag(name, new_name, new_color)
    return jsonify({'success': True})

@app.route('/api/flags/<name>', methods=['DELETE'])
def remove_flag(name):
    delete_flag(name)
    return jsonify({'success': True})

@app.route('/api/datasets/<path:dataset_name>/thumbnail/<path:filepath>')
def dataset_thumbnail(dataset_name, filepath):
    wd = get_working_directory()
    if not wd:
        return 'Рабочая директория не задана', 400
    try:
        full_path = safe_join(wd, dataset_name, filepath)
        if not os.path.isfile(full_path) or not full_path.lower().endswith(('.jpg','.jpeg','.png','.webp')):
            return 'Not an image', 404

        from PIL import Image
        import io

        img = Image.open(full_path)
        img.thumbnail((450, 450), Image.Resampling.LANCZOS)

        img_io = io.BytesIO()
        if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
            img.save(img_io, format='PNG')
            mimetype = 'image/png'
        else:
            img.save(img_io, format='JPEG', quality=85, optimize=True)
            mimetype = 'image/jpeg'

        img_io.seek(0)

        response = send_file(img_io, mimetype=mimetype)
        response.headers['Cache-Control'] = 'public, max-age=604800, immutable'
        return response
    except Exception as e:
        return str(e), 500

@app.route('/api/datasets/<path:dataset_name>/image/<path:filepath>')
def dataset_image(dataset_name, filepath):
    wd = get_working_directory()
    if not wd:
        return 'Рабочая директория не задана', 400
    try:
        full_path = safe_join(wd, dataset_name, filepath)
        if not os.path.isfile(full_path) or not full_path.lower().endswith(('.jpg','.jpeg','.png','.webp')):
            return 'Not an image', 404
        response = send_file(full_path)
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    except Exception as e:
        return str(e), 500

@app.route('/api/datasets/<name>/fullpath', methods=['GET'])
def dataset_fullpath(name):
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    subpath = request.args.get('path', '')
    try:
        base_path = safe_join(wd, name)
        target_path = safe_join(base_path, subpath) if subpath else base_path
        if not os.path.exists(target_path):
            return jsonify({'error': 'Путь не найден'}), 404
        return jsonify({'path': target_path})
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

@app.route('/api/datasets/<path:dataset_name>/upload', methods=['POST'])
def upload_to_dataset(dataset_name):
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    target_path = request.form.get('path', '')
    try:
        base_path = safe_join(wd, dataset_name)
        dest_dir = safe_join(base_path, target_path) if target_path else base_path
        if not os.path.isdir(dest_dir):
            return jsonify({'error': 'Целевая папка не существует'}), 400

        uploaded_files = request.files.getlist('files')
        for file in uploaded_files:
            filename = secure_filename(file.filename)
            if not filename:
                continue
            save_path = os.path.join(dest_dir, filename)
            file.save(save_path)
            if filename.lower().endswith('.txt'):
                base = os.path.splitext(filename)[0]
                found = False
                for ext in ('.jpg', '.jpeg', '.png', '.webp'):
                    if os.path.exists(os.path.join(dest_dir, base + ext)):
                        found = True
                        break
                if not found:
                    os.remove(save_path)
        return jsonify({'success': True})
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/datasets/<path:dataset_name>/create_version', methods=['POST'])
def create_dataset_version(dataset_name):
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    data = request.get_json()
    major = data.get('major', 0)
    minor = data.get('minor', 0)
    base_version = data.get('base_version')
    flags = data.get('flags', [])
    try:
        base_path = safe_join(wd, dataset_name)
        version_name = f"v{major}_{minor}"
        version_path = os.path.join(base_path, version_name)

        if os.path.exists(version_path):
            return jsonify({'error': 'Такая версия уже существует'}), 400

        if base_version:
            base_version_path = os.path.join(base_path, base_version)
            if not os.path.isdir(base_version_path):
                return jsonify({'error': 'Базовая версия не существует'}), 400
            shutil.copytree(base_version_path, version_path)
        else:
            os.mkdir(version_path)

        meta_path = os.path.join(base_path, 'metadata.json')
        if os.path.exists(meta_path):
            with open(meta_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
        else:
            metadata = {}
        if 'versions' not in metadata:
            metadata['versions'] = {}
        metadata['versions'][version_name] = {
            'created': datetime.now().isoformat(),
            'flags': flags
        }
        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

        return jsonify({'success': True, 'version': version_name})
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/datasets/<path:dataset_name>/versions', methods=['GET'])
def dataset_versions(dataset_name):
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    try:
        base_path = safe_join(wd, dataset_name)
        meta_path = os.path.join(base_path, 'metadata.json')
        if os.path.exists(meta_path):
            with open(meta_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
        else:
            metadata = {}
        versions = metadata.get('versions', {})
        return jsonify(versions)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/datasets/<path:dataset_name>/info', methods=['GET'])
def dataset_info(dataset_name):
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    try:
        base_path = safe_join(wd, dataset_name)
        if not os.path.isdir(base_path):
            return jsonify({'error': 'Датасет не найден'}), 404
        metadata = {}
        meta_path = os.path.join(base_path, 'metadata.json')
        if os.path.exists(meta_path):
            with open(meta_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
        versions = [d for d in os.listdir(base_path)
                    if os.path.isdir(os.path.join(base_path, d)) and re.match(r'v\d+_\d+', d)]
        versions.sort(key=version_key)
        image_count = 0
        for root, dirs, files in os.walk(base_path):
            for f in files:
                if f.lower().endswith(('.jpg','.jpeg','.png','.webp')):
                    image_count += 1
        return jsonify({
            'name': dataset_name,
            'metadata': metadata,
            'versions': versions,
            'image_count': image_count
        })
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/datasets/<old_name>/rename_dataset', methods=['POST'])
def rename_dataset(old_name):
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    data = request.get_json()
    new_name = data.get('new_name')
    if not new_name:
        return jsonify({'error': 'Новое имя не указано'}), 400

    safe_new = secure_filename(new_name)
    if not safe_new:
        return jsonify({'error': 'Некорректное имя'}), 400

    old_path = os.path.join(wd, old_name)
    new_path = os.path.join(wd, safe_new)

    if not os.path.exists(old_path):
        return jsonify({'error': 'Датасет не найден'}), 404
    if os.path.exists(new_path):
        return jsonify({'error': 'Датасет с таким именем уже существует'}), 400

    try:
        os.rename(old_path, new_path)
        with sqlite3.connect(DB_PATH) as conn:
            c = conn.cursor()
            c.execute('UPDATE image_ratings SET dataset_path = ? WHERE dataset_path = ?',
                      (new_path, old_path))
            c.execute('UPDATE dataset_vocabulary SET dataset_path = ? WHERE dataset_path = ?',
                      (new_path, old_path))
            conn.commit()
        return jsonify({'success': True, 'new_name': safe_new})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/datasets/<name>/cover', methods=['POST'])
def upload_dataset_cover(name):
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    dataset_path = os.path.join(wd, name)
    if not os.path.isdir(dataset_path):
        return jsonify({'error': 'Датасет не найден'}), 404

    file = request.files.get('cover')
    if not file or not file.filename:
        return jsonify({'error': 'Файл не передан'}), 400

    if not file.filename.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
        return jsonify({'error': 'Недопустимый формат изображения'}), 400

    meta_path = os.path.join(dataset_path, 'metadata.json')
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        old_cover = metadata.get('cover')
        if old_cover:
            old_cover_path = os.path.join(dataset_path, old_cover)
            if os.path.exists(old_cover_path):
                os.remove(old_cover_path)
    else:
        metadata = {}

    filename = secure_filename(file.filename)
    save_path = os.path.join(dataset_path, filename)
    file.save(save_path)

    metadata['cover'] = filename
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    return jsonify({'success': True, 'cover': filename})


@app.route('/api/datasets/<name>/cover', methods=['DELETE'])
def delete_dataset_cover(name):
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    dataset_path = os.path.join(wd, name)
    if not os.path.isdir(dataset_path):
        return jsonify({'error': 'Датасет не найден'}), 404

    meta_path = os.path.join(dataset_path, 'metadata.json')
    if not os.path.exists(meta_path):
        return jsonify({'success': True})

    with open(meta_path, 'r', encoding='utf-8') as f:
        metadata = json.load(f)

    old_cover = metadata.get('cover')
    if old_cover:
        cover_path = os.path.join(dataset_path, old_cover)
        if os.path.exists(cover_path):
            os.remove(cover_path)

    metadata.pop('cover', None)
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    return jsonify({'success': True})


@app.route('/api/datasets/<name>/version/<version>', methods=['DELETE'])
def delete_dataset_version(name, version):
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    dataset_path = os.path.join(wd, name)
    version_path = os.path.join(dataset_path, version)

    if not os.path.isdir(version_path):
        return jsonify({'error': 'Версия не найдена'}), 404

    if not re.match(r'v\d+_\d+', version):
        return jsonify({'error': 'Некорректное имя версии'}), 400

    try:
        shutil.rmtree(version_path)
    except Exception as e:
        return jsonify({'error': f'Не удалось удалить папку: {str(e)}'}), 500

    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('DELETE FROM image_ratings WHERE dataset_path=? AND filename LIKE ?',
                  (dataset_path, version + '/%'))
        conn.commit()

    meta_path = os.path.join(dataset_path, 'metadata.json')
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        if 'versions' in metadata and version in metadata['versions']:
            del metadata['versions'][version]
            with open(meta_path, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2)

    return jsonify({'success': True})

@app.route('/api/vocabulary/<path:dataset_path>', methods=['GET'])
def get_vocabulary(dataset_path):
    if not os.path.isdir(dataset_path):
        return jsonify({'error': 'Dataset path does not exist'}), 404
    content_json = get_dataset_vocabulary(dataset_path)
    if content_json:
        return jsonify({'content': json.loads(content_json)})
    else:
        fallback = OrderedDict([
            ("Trigger_words", ["example_trigger word", "anower_example"]),
            ("Default outfit", ["example_outfit word", "anower_example"]),
            ("Optional", ["example_optional word", "anower_example"])
        ])
        return jsonify({'content': fallback})

@app.route('/api/vocabulary/<path:dataset_path>', methods=['POST'])
def save_vocabulary(dataset_path):
    if not os.path.isdir(dataset_path):
        return jsonify({'error': 'Dataset path does not exist'}), 404
    data = request.get_json()
    content = data.get('content')
    if content is None:
        return jsonify({'error': 'Missing content'}), 400
    save_dataset_vocabulary(dataset_path, json.dumps(content))
    return jsonify({'success': True})

@app.route('/api/image/<path:filename>')
def serve_image(filename):
    if not current_dataset_path:
        return 'Dataset not loaded', 404
    safe_path = os.path.join(current_dataset_path, filename)
    if not os.path.realpath(safe_path).startswith(os.path.realpath(current_dataset_path)):
        return 'Access denied', 403
    if not os.path.isfile(safe_path):
        return 'File not found', 404
    response = send_file(safe_path)
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/api/get-caption', methods=['POST'])
def get_caption():
    if not current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    filename = data.get('filename')
    txt_path = get_caption_path(os.path.join(current_dataset_path, filename))
    caption = read_caption(txt_path)
    return jsonify({'caption': caption})

@app.route('/api/update-caption', methods=['POST'])
def update_caption():
    if not current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    filename = data.get('filename')
    caption = data.get('caption', '')
    txt_path = get_caption_path(os.path.join(current_dataset_path, filename))
    write_caption(txt_path, caption)
    return jsonify({'success': True})

@app.route('/api/bulk-rename', methods=['POST'])
def bulk_rename():
    if not current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    images = get_image_files(current_dataset_path)
    for idx, img in enumerate(images, start=1):
        base, ext = os.path.splitext(img)
        new_img_name = f"{idx}{ext}"
        old_img_path = os.path.join(current_dataset_path, img)
        new_img_path = os.path.join(current_dataset_path, new_img_name)
        os.rename(old_img_path, new_img_path)
        old_txt_path = get_caption_path(old_img_path)
        new_txt_path = get_caption_path(new_img_path)
        if os.path.exists(old_txt_path):
            os.rename(old_txt_path, new_txt_path)
        else:
            write_caption(new_txt_path, '')
    return jsonify({'success': True})

@app.route('/api/bulk-delete-tags', methods=['POST'])
def bulk_delete_tags():
    if not current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    tags_to_delete = data.get('tags', [])
    if not tags_to_delete:
        return jsonify({'error': 'Нет тегов для удаления'}), 400
    images = get_image_files(current_dataset_path)
    for img in images:
        txt_path = get_caption_path(os.path.join(current_dataset_path, img))
        caption = read_caption(txt_path)
        tags = parse_tags(caption)
        new_tags = [t for t in tags if t not in tags_to_delete]
        if len(new_tags) != len(tags):
            write_caption(txt_path, format_tags(new_tags))
    return jsonify({'success': True})

@app.route('/api/bulk-add-tags', methods=['POST'])
def bulk_add_tags():
    if not current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    tags_to_add = data.get('tags', [])
    position = data.get('position', 'end')
    if not tags_to_add:
        return jsonify({'error': 'Нет тегов для добавления'}), 400
    images = get_image_files(current_dataset_path)
    for img in images:
        txt_path = get_caption_path(os.path.join(current_dataset_path, img))
        caption = read_caption(txt_path)
        tags = parse_tags(caption)
        new_tags = tags[:]
        for tag in tags_to_add:
            if tag not in tags:
                if position == 'start':
                    new_tags.insert(0, tag)
                else:
                    new_tags.append(tag)
        if new_tags != tags:
            write_caption(txt_path, format_tags(new_tags))
    return jsonify({'success': True})

@app.route('/api/bulk-replace-tag', methods=['POST'])
def bulk_replace_tag():
    if not current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    old_tag = data.get('old_tag', '').strip()
    new_tag = data.get('new_tag', '').strip()
    if not old_tag or not new_tag:
        return jsonify({'error': 'Укажите оба тега'}), 400
    images = get_image_files(current_dataset_path)
    for img in images:
        txt_path = get_caption_path(os.path.join(current_dataset_path, img))
        caption = read_caption(txt_path)
        tags = parse_tags(caption)
        new_tags = [new_tag if t == old_tag else t for t in tags]
        if new_tags != tags:
            write_caption(txt_path, format_tags(new_tags))
    return jsonify({'success': True})

@app.route('/api/get-analysis', methods=['GET'])
def get_analysis():
    if not current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    images = get_image_files(current_dataset_path)
    rating_counts = {'general': 0, 'sensitive': 0, 'questionable': 0, 'explicit': 0}
    ratings_dict = get_all_ratings_for_dataset(current_dataset_path)
    resolution_counter = Counter()
    tag_counter = Counter()
    aspect_counter = Counter()
    good_for_training_count = 0
    total_tags_count = 0

    for img in images:
        rating = ratings_dict.get(img, 'general')
        if rating in rating_counts:
            rating_counts[rating] += 1
        else:
            rating_counts['general'] += 1

        txt_path = get_caption_path(os.path.join(current_dataset_path, img))
        caption = read_caption(txt_path)
        tags = parse_tags(caption)
        tag_counter.update(tags)
        total_tags_count += len(tags)

        img_path_full = os.path.join(current_dataset_path, img)
        try:
            w, h = get_image_dimensions(img_path_full)
            resolution_counter[f"{w}x{h}"] += 1
            aspect = get_aspect_ratio_label(w, h)
            aspect_counter[aspect] += 1
            if (w % 32 == 0 and h % 32 == 0) or (w % 64 == 0 and h % 64 == 0):
                good_for_training_count += 1
        except:
            pass

    top_tags = [{'tag': tag, 'count': count} for tag, count in tag_counter.most_common(20)]
    predominant_aspect = aspect_counter.most_common(1)[0][0] if aspect_counter else 'N/A'
    total_images = len(images)
    good_percent = round((good_for_training_count / total_images * 100), 1) if total_images else 0

    return jsonify({
        'ratings': rating_counts,
        'resolutions': [{'resolution': res, 'count': cnt} for res, cnt in resolution_counter.items()],
        'top_tags': top_tags,
        'total_images': total_images,
        'unique_tags': len(tag_counter),
        'avg_tags_per_image': round(total_tags_count / total_images, 1) if total_images else 0,
        'predominant_aspect': predominant_aspect,
        'good_for_training_count': good_for_training_count,
        'good_for_training_percent': good_percent
    })

@app.route('/api/image-rating/<path:filename>', methods=['GET'])
def get_image_rating_api(filename):
    if not current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    rating = get_image_rating(current_dataset_path, filename)
    if rating is None:
        rating = 'general'
    return jsonify({'rating': rating})

@app.route('/api/rating-analysis/status', methods=['GET'])
def rating_status_api():
    with rating_lock:
        status = rating_status.copy()
        status.pop('dataset_path', None)
        return jsonify(status)

@app.route('/api/languages', methods=['GET'])
def get_languages():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute('SELECT DISTINCT lang FROM translations')
        langs = [row[0] for row in c.fetchall()]
    return jsonify(langs)

@app.route('/api/translations/<lang>', methods=['GET'])
def get_translations(lang):
    return jsonify(get_all_translations(lang))

@app.route('/api/settings', methods=['GET'])
def get_settings():
    lang = get_setting('language', 'ru')
    color = get_setting('accent_color', '#3b82f6')
    wd = get_setting('working_directory', '')
    zoom_enabled = get_setting('zoom_enabled', 'true') == 'true'
    zoom_factor = float(get_setting('zoom_factor', '2.0'))
    return jsonify({
        'language': lang,
        'accent_color': color,
        'working_directory': wd,
        'zoom_enabled': zoom_enabled,
        'zoom_factor': zoom_factor
    })

@app.route('/api/settings', methods=['POST'])
def save_settings():
    data = request.get_json()
    lang = data.get('language')
    color = data.get('accent_color')
    wd = data.get('working_directory')
    zoom_enabled = data.get('zoom_enabled')
    zoom_factor = data.get('zoom_factor')
    if lang:
        set_setting('language', lang)
    if color:
        set_setting('accent_color', color)
    if wd is not None:
        set_setting('working_directory', wd)
    if zoom_enabled is not None:
        set_setting('zoom_enabled', 'true' if zoom_enabled else 'false')
    if zoom_factor is not None:
        set_setting('zoom_factor', str(zoom_factor))
    return jsonify({'success': True})

@app.route('/api/delete-image', methods=['POST'])
def delete_image():
    if not current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    data = request.get_json()
    filename = data.get('filename')
    if not filename:
        return jsonify({'error': 'Filename required'}), 400

    safe_path = os.path.join(current_dataset_path, filename)
    if not os.path.realpath(safe_path).startswith(os.path.realpath(current_dataset_path)):
        return jsonify({'error': 'Access denied'}), 403

    if not os.path.isfile(safe_path):
        return jsonify({'error': 'File not found'}), 404

    try:
        os.remove(safe_path)
        txt_path = get_caption_path(safe_path)
        if os.path.exists(txt_path):
            os.remove(txt_path)
        with sqlite3.connect(DB_PATH) as conn:
            c = conn.cursor()
            c.execute('DELETE FROM image_ratings WHERE dataset_path=? AND filename=?',
                      (current_dataset_path, filename))
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/widget-layout', methods=['GET'])
def get_widget_layout_api():
    layout_json = get_global_widget_layout()
    if layout_json:
        return jsonify({'layout': json.loads(layout_json)})
    else:
        return jsonify({'layout': []})

@app.route('/api/widget-layout', methods=['POST'])
def save_widget_layout_api():
    data = request.get_json()
    layout = data.get('layout')
    if layout is None:
        return jsonify({'error': 'layout required'}), 400
    save_global_widget_layout(json.dumps(layout))
    return jsonify({'success': True})

@app.route('/api/auto-models', methods=['GET'])
def auto_models():
    models = tagger.list_models()
    return jsonify(models)

@app.route('/api/auto-tag/start', methods=['POST'])
def auto_tag_start():
    global auto_tag_status
    if not current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    with auto_tag_lock:
        if auto_tag_status['running']:
            return jsonify({'error': 'Процесс уже запущен'}), 400
    data = request.get_json()
    model = data.get('model')
    threshold = data.get('threshold', 0.35)
    mode = data.get('mode', 'append')

    if not model:
        return jsonify({'error': 'Модель не выбрана'}), 400

    available_models = tagger.list_models()
    if model not in available_models:
        return jsonify({'error': f'Модель "{model}" не найдена в папке models'}), 400

    def process():
        global auto_tag_status
        images = get_image_files(current_dataset_path)
        total = len(images)
        with auto_tag_lock:
            auto_tag_status['running'] = True
            auto_tag_status['total'] = total
            auto_tag_status['processed'] = 0
            auto_tag_status['current_file'] = ''
            auto_tag_status['model_name'] = model

        for idx, img in enumerate(images):
            with auto_tag_lock:
                if not auto_tag_status['running']:
                    break
                auto_tag_status['current_file'] = img

            img_path = os.path.join(current_dataset_path, img)
            txt_path = get_caption_path(img_path)

            try:
                new_tags = tagger.tag_image(img_path, model, threshold)
            except Exception as e:
                import traceback
                print(f"Ошибка при обработке {img}: {e}")
                traceback.print_exc()
                new_tags = []

            old_caption = read_caption(txt_path)
            old_tags = parse_tags(old_caption)

            if mode == 'replace':
                final_tags = new_tags
            elif mode == 'add_if_empty':
                if not old_tags:
                    final_tags = new_tags
                else:
                    final_tags = old_tags
            else:
                existing_set = set(old_tags)
                final_tags = old_tags + [tag for tag in new_tags if tag not in existing_set]

            write_caption(txt_path, format_tags(final_tags))

            with auto_tag_lock:
                auto_tag_status['processed'] = idx + 1

        with auto_tag_lock:
            auto_tag_status['running'] = False
            auto_tag_status['current_file'] = ''

    thread = threading.Thread(target=process)
    thread.start()
    return jsonify({'success': True})

@app.route('/api/auto-tag/status', methods=['GET'])
def auto_tag_status_api():
    with auto_tag_lock:
        return jsonify(auto_tag_status)

@app.route('/api/auto-tag/stop', methods=['POST'])
def auto_tag_stop():
    with auto_tag_lock:
        auto_tag_status['running'] = False
    return jsonify({'success': True})

if __name__ == '__main__':
    app.run(debug=True)
