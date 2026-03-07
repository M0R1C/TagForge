import os
import re
import shutil
import threading
from collections import Counter
from flask import Flask, request, jsonify, send_file, render_template
from PIL import Image
from collections import OrderedDict
import json
from database import (
    DB_PATH,
    save_global_widget_layout, get_global_widget_layout, clear_all_image_ratings,
    get_nsfw_tags, get_setting, get_all_translations, set_setting,
    add_nsfw_tag, remove_nsfw_tag, init_db, save_dataset_vocabulary, get_dataset_vocabulary,
    save_image_rating, get_image_rating, get_all_ratings_for_dataset
)
import sqlite3
from auto_tag import AutoTagger

app = Flask(__name__)
app.json.sort_keys = False

init_db()

current_dataset_path = None

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

def get_nsfw_tag_set():
    return set(get_nsfw_tags())

def get_image_files(path):
    valid_ext = ('.jpg', '.jpeg', '.png', '.webp')
    files = []
    for f in os.listdir(path):
        if f.lower().endswith(valid_ext):
            files.append(f)
    return sorted(files)

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

        existing = get_image_rating(dataset_path, img)
        if existing:
            with rating_lock:
                rating_status['processed'] = idx + 1
            continue

        try:
            img_path = os.path.join(dataset_path, img)
            rating = tagger.get_rating(img_path, RATING_MODEL)
            save_image_rating(dataset_path, img, rating)
        except Exception as e:
            logger.error(f"Ошибка при анализе рейтинга для {img}: {e}")
            save_image_rating(dataset_path, img, 'general')

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
        except:
            w, h = 0, 0
        rating = get_image_rating(current_dataset_path, img) or 'general'
        result.append({
            'filename': img,
            'tag_count': len(tags),
            'width': w,
            'height': h,
            'rating': rating
        })
    return jsonify(result)

@app.route('/api/reset-ratings', methods=['POST'])
def reset_ratings():
    try:
        clear_all_image_ratings()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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
    return send_file(safe_path)

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
    return jsonify({'language': lang, 'accent_color': color})

@app.route('/api/settings', methods=['POST'])
def save_settings():
    data = request.get_json()
    lang = data.get('language')
    color = data.get('accent_color')
    if lang:
        set_setting('language', lang)
    if color:
        set_setting('accent_color', color)
    return jsonify({'success': True})

@app.route('/api/nsfw-tags', methods=['GET'])
def get_nsfw_tags_api():
    return jsonify(get_nsfw_tags())

@app.route('/api/nsfw-tags', methods=['POST'])
def add_nsfw_tag_api():
    data = request.get_json()
    tag = data.get('tag')
    if tag:
        add_nsfw_tag(tag)
        return jsonify({'success': True})
    return jsonify({'error': 'Tag required'}), 400

@app.route('/api/nsfw-tags/<tag>', methods=['DELETE'])
def delete_nsfw_tag_api(tag):
    remove_nsfw_tag(tag)
    return jsonify({'success': True})

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