import os
import re
import shutil
import json
import threading
from datetime import datetime
from flask import Flask, request, jsonify, send_file, render_template
from werkzeug.utils import secure_filename
from app_context import AppContext
from routes import all_blueprints
from database import get_setting, init_db
from utils import (
    safe_join, natural_key, get_working_directory, get_image_files,
    get_caption_path, read_caption, parse_tags, get_file_hash,
    get_server_ips, is_port_available
)
import sqlite3

app = Flask(__name__)
app.json.sort_keys = False

context = AppContext()
app.config['CONTEXT'] = context

for bp in all_blueprints:
    bp.context = context
    app.register_blueprint(bp)

init_db()

# ------------------------------------------------------------
# Маршруты для работы с датасетами
# ------------------------------------------------------------

@app.route('/')
def index():
    client_ip = request.remote_addr
    server_ips = get_server_ips()
    show_path_input = client_ip in server_ips
    return render_template('index.html', show_path_input=show_path_input)

@app.route('/api/load-dataset', methods=['POST'])
def load_dataset():
    data = request.get_json()
    path = data.get('path', '').strip()
    if not os.path.isdir(path):
        return jsonify({'error': 'Папка не существует'}), 400

    context.set_dataset_path(path)
    images = get_image_files(path)

    file_hashes = {}
    for img in images:
        img_path = os.path.join(path, img)
        try:
            file_hashes[img] = get_file_hash(img_path)
        except Exception as e:
            app.logger.error(f"Ошибка вычисления хэша для {img}: {e}")
            file_hashes[img] = None

    threading.Thread(target=context.rating.start, args=(path, file_hashes), daemon=True).start()
    threading.Thread(target=context.analysis.start, args=(path, file_hashes), daemon=True).start()

    return jsonify({'count': len(images), 'images': images[:20]})

@app.route('/api/get-tags', methods=['GET'])
def get_tags():
    if not context.current_dataset_path:
        return jsonify({'error': 'Датасет не загружен'}), 400
    from collections import Counter
    tag_counter = Counter()
    for img in get_image_files(context.current_dataset_path):
        caption = read_caption(get_caption_path(os.path.join(context.current_dataset_path, img)))
        tag_counter.update(parse_tags(caption))
    return jsonify([{'tag': t, 'count': c} for t, c in tag_counter.most_common()])

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
            for root, _, files in os.walk(dataset_path):
                for f in files:
                    if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                        image_count += 1
                        if cover is None:
                            cover = os.path.relpath(os.path.join(root, f), dataset_path)
            versions = [d for d in os.listdir(dataset_path) if os.path.isdir(os.path.join(dataset_path, d)) and re.match(r'v\d+_\d+', d)]
            versions.sort(key=lambda v: tuple(map(int, re.match(r'v(\d+)_(\d+)', v).groups())))
            datasets.append({
                'name': name,
                'image_count': image_count,
                'cover': cover,
                'last_version': versions[-1] if versions else None
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
    os.mkdir(os.path.join(dataset_path, 'v0_1'))

    cover_file = request.files.get('cover')
    cover_filename = None
    if cover_file and cover_file.filename and cover_file.filename.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
        cover_filename = secure_filename(cover_file.filename)
        cover_file.save(os.path.join(dataset_path, cover_filename))

    metadata = {
        'name': name,
        'created': datetime.now().isoformat(),
        'versions': {'v0_1': {'created': datetime.now().isoformat(), 'flags': []}},
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
        dirs, images = [], []
        for entry in os.listdir(current_path):
            full = os.path.join(current_path, entry)
            if os.path.isdir(full):
                dirs.append(entry)
            elif entry.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                txt_path = os.path.splitext(full)[0] + '.txt'
                images.append({
                    'name': entry, 'type': 'image', 'has_caption': os.path.exists(txt_path),
                    'size': os.path.getsize(full), 'mtime': os.path.getmtime(full)
                })
        dirs.sort(key=natural_key)
        images.sort(key=lambda x: natural_key(x['name']))
        items = [{'name': d, 'type': 'directory'} for d in dirs] + images
        return jsonify({'path': subpath, 'items': items})
    except ValueError as e:
        return jsonify({'error': str(e)}), 403

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
        is_dir = os.path.isdir(old_full)
        os.rename(old_full, new_full)
        if is_dir:
            from database import rename_folder_prefix_in_db
            rename_folder_prefix_in_db(old_full, new_full)
            return jsonify({'success': True, 'old_path': old_full, 'new_path': new_full})
        if old_name.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
            old_txt = os.path.splitext(old_full)[0] + '.txt'
            new_txt = os.path.splitext(new_full)[0] + '.txt'
            if os.path.exists(old_txt):
                os.rename(old_txt, new_txt)
        db = context.db
        with sqlite3.connect(db.db_path) as conn:
            c = conn.cursor()
            c.execute('UPDATE image_quality SET filename=? WHERE dataset_path=? AND filename=?',
                      (new_name, parent, old_name))
            c.execute('UPDATE image_ratings SET filename=? WHERE dataset_path=? AND filename=?',
                      (new_name, parent, old_name))
            conn.commit()
        from database import rename_file_in_similar_pairs, rename_file_in_duplicate_groups
        rename_file_in_similar_pairs(parent, old_name, new_name)
        file_hash = db.get_image_quality(parent, old_name).get('file_hash') if db.get_image_quality(parent, old_name) else None
        if file_hash:
            rename_file_in_duplicate_groups(parent, old_name, new_name, file_hash)
        return jsonify({'success': True, 'old_path': old_full, 'new_path': new_full})
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
            return jsonify({'error': 'Файл не найден'}), 404
        if os.path.isdir(target):
            shutil.rmtree(target)
            prefix = target + os.sep
            db = context.db
            with sqlite3.connect(db.db_path) as conn:
                c = conn.cursor()
                for table in ('image_quality', 'image_ratings'):
                    c.execute(f'DELETE FROM {table} WHERE dataset_path=? OR dataset_path LIKE ?', (target, prefix + '%'))
                c.execute('DELETE FROM similar_pairs WHERE dataset_path=? OR dataset_path LIKE ?', (target, prefix + '%'))
                c.execute('DELETE FROM duplicate_groups WHERE dataset_path=? OR dataset_path LIKE ?', (target, prefix + '%'))
                conn.commit()
        else:
            os.remove(target)
            txt = os.path.splitext(target)[0] + '.txt'
            if os.path.exists(txt):
                os.remove(txt)
            db = context.db
            with sqlite3.connect(db.db_path) as conn:
                c = conn.cursor()
                c.execute('DELETE FROM image_quality WHERE dataset_path=? AND filename=?', (os.path.dirname(target), name))
                c.execute('DELETE FROM image_ratings WHERE dataset_path=? AND filename=?', (os.path.dirname(target), name))
                c.execute('DELETE FROM similar_pairs WHERE dataset_path=? AND (filename1=? OR filename2=?)',
                          (os.path.dirname(target), name, name))
                conn.commit()
            from database import remove_from_duplicate_groups, remove_from_similar_pairs
            remove_from_duplicate_groups(os.path.dirname(target), name)
            remove_from_similar_pairs(os.path.dirname(target), name)
        return jsonify({'success': True, 'old_path': target})
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
        prefix = dataset_path + os.sep
        db = context.db
        with sqlite3.connect(db.db_path) as conn:
            c = conn.cursor()
            for table in ('image_quality', 'image_ratings', 'similar_pairs', 'duplicate_groups'):
                c.execute(f'DELETE FROM {table} WHERE dataset_path=? OR dataset_path LIKE ?', (dataset_path, prefix + '%'))
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/datasets/<path:dataset_name>/thumbnail/<path:filepath>')
def dataset_thumbnail(dataset_name, filepath):
    wd = get_working_directory()
    if not wd:
        return 'Рабочая директория не задана', 400
    try:
        full_path = safe_join(wd, dataset_name, filepath)
        if not os.path.isfile(full_path) or not full_path.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
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
        if not os.path.isfile(full_path) or not full_path.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
            return 'Not an image', 404
        response = send_file(full_path)
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
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
        groups = {}
        for file in uploaded_files:
            original_filename = secure_filename(file.filename)
            if not original_filename:
                continue
            base, ext = os.path.splitext(original_filename)
            ext = ext.lower()
            groups.setdefault(base, []).append((file, ext))

        image_extensions = {'.jpg', '.jpeg', '.png', '.webp'}

        def get_unique_basename(directory, base_name, extensions):
            def exists(basename):
                for ext in extensions:
                    if os.path.exists(os.path.join(directory, f"{basename}{ext}")):
                        return True
                return False
            if not exists(base_name):
                return base_name
            counter = 1
            while True:
                new_base = f"{base_name}_{counter}"
                if not exists(new_base):
                    return new_base
                counter += 1

        for base, files in groups.items():
            extensions = list(set(ext for _, ext in files))
            new_base = get_unique_basename(dest_dir, base, extensions)
            has_image = any(ext in image_extensions for _, ext in files)
            for file, ext in files:
                new_filename = new_base + ext
                file.save(os.path.join(dest_dir, new_filename))
            if not has_image:
                for _, ext in files:
                    if ext == '.txt':
                        txt_path = os.path.join(dest_dir, new_base + ext)
                        if os.path.exists(txt_path):
                            os.remove(txt_path)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/datasets/<path:dataset_name>/upload-url', methods=['POST'])
def upload_image_from_url(dataset_name):
    wd = get_working_directory()
    if not wd:
        return jsonify({'error': 'Рабочая директория не задана'}), 400
    data = request.get_json()
    url = data.get('url')
    target_path = data.get('path', '')
    if not url:
        return jsonify({'error': 'URL не указан'}), 400
    try:
        base_path = safe_join(wd, dataset_name)
        dest_dir = safe_join(base_path, target_path) if target_path else base_path
        if not os.path.isdir(dest_dir):
            return jsonify({'error': 'Целевая папка не существует'}), 400
        import requests
        import hashlib
        headers = {'User-Agent': 'Mozilla/5.0'}
        resp = requests.get(url, headers=headers, timeout=30)
        if resp.status_code != 200:
            return jsonify({'error': f'Не удалось загрузить: HTTP {resp.status_code}'}), 400
        content_type = resp.headers.get('Content-Type', '')
        if not content_type.startswith('image/'):
            return jsonify({'error': 'URL не указывает на изображение'}), 400
        ext_map = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif'}
        ext = ext_map.get(content_type, '.jpg')
        url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
        base_name = f"web_{url_hash}"
        def get_unique_filename(directory, filename):
            base, ext = os.path.splitext(filename)
            counter = 1
            new_name = filename
            while os.path.exists(os.path.join(directory, new_name)):
                new_name = f"{base}_{counter}{ext}"
                counter += 1
            return new_name
        final_filename = get_unique_filename(dest_dir, base_name + ext)
        final_path = os.path.join(dest_dir, final_filename)
        with open(final_path, 'wb') as f:
            f.write(resp.content)
        return jsonify({'success': True, 'filename': final_filename})
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
        metadata.setdefault('versions', {})[version_name] = {
            'created': datetime.now().isoformat(),
            'flags': flags
        }
        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
        return jsonify({'success': True, 'version': version_name})
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
        return jsonify(metadata.get('versions', {}))
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
        versions = [d for d in os.listdir(base_path) if os.path.isdir(os.path.join(base_path, d)) and re.match(r'v\d+_\d+', d)]
        versions.sort(key=lambda v: tuple(map(int, re.match(r'v(\d+)_(\d+)', v).groups())))
        image_count = sum(1 for root, _, files in os.walk(base_path) for f in files if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')))
        return jsonify({'name': dataset_name, 'metadata': metadata, 'versions': versions, 'image_count': image_count})
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
        prefix = old_path + os.sep
        db = context.db
        with sqlite3.connect(db.db_path) as conn:
            c = conn.cursor()
            for table in ('image_quality', 'image_ratings', 'similar_pairs', 'duplicate_groups'):
                c.execute(f'SELECT DISTINCT dataset_path FROM {table} WHERE dataset_path = ? OR dataset_path LIKE ?', (old_path, prefix + '%'))
                for (old_db_path,) in c.fetchall():
                    new_db_path = new_path + old_db_path[len(old_path):]
                    c.execute(f'UPDATE {table} SET dataset_path = ? WHERE dataset_path = ?', (new_db_path, old_db_path))
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
        return jsonify({'error': 'Недопустимый формат'}), 400
    meta_path = os.path.join(dataset_path, 'metadata.json')
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        old_cover = metadata.get('cover')
        if old_cover and os.path.exists(os.path.join(dataset_path, old_cover)):
            os.remove(os.path.join(dataset_path, old_cover))
    else:
        metadata = {}
    filename = secure_filename(file.filename)
    file.save(os.path.join(dataset_path, filename))
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
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        old_cover = metadata.pop('cover', None)
        if old_cover and os.path.exists(os.path.join(dataset_path, old_cover)):
            os.remove(os.path.join(dataset_path, old_cover))
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
        prefix = version_path + os.sep
        db = context.db
        with sqlite3.connect(db.db_path) as conn:
            c = conn.cursor()
            for table in ('image_quality', 'image_ratings'):
                c.execute(f'DELETE FROM {table} WHERE dataset_path = ? OR dataset_path LIKE ?', (version_path, prefix + '%'))
            c.execute('DELETE FROM similar_pairs WHERE dataset_path = ? OR dataset_path LIKE ?', (version_path, prefix + '%'))
            c.execute('DELETE FROM duplicate_groups WHERE dataset_path = ? OR dataset_path LIKE ?', (version_path, prefix + '%'))
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
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ------------------------------------------------------------
# Запуск приложения
# ------------------------------------------------------------
if __name__ == '__main__':
    host = get_setting('server_host')
    port = get_setting('server_port')
    if not host: host = '127.0.0.1'
    if not port: port = 5000
    else: port = int(port)

    context.active_host = host
    context.active_port = port

    if not os.environ.get('WERKZEUG_RUN_MAIN'):
        if not is_port_available(host, port):
            print(f"Адрес {host}:{port} недоступен, запускаем на 127.0.0.1:5000")
            host = '127.0.0.1'
            port = 5000
    app.run(host=host, port=port, debug=True)
